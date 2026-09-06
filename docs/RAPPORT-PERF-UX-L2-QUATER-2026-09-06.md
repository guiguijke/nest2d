# Rapport d'implémentation — L2-quater (AD1/AD3/AD5) — 2026-09-06

Réponse au plan `PLAN-CORRECTIF-PERF-UX-L2-QUATER-2026-09-06.md`. **Non
déployé — attend la vérification.** L2-ter a été déployé entre-temps
(md5 `residual.py` prod = publié = `b3719ef2`, 06/09 ~07h UTC).

## AD1 — Rendues d'origine receveuse : VARIANTE 2 du plan

Votre démonstration est adoptée telle quelle : la passe fusionnée rendait
TOUTES les non-posées sur la donneuse, y compris celles d'origine
receveuse, à des coordonnées que la donneuse n'avait jamais vues —
jamais testées (`_validate_return` exclut les rendues, ne juge pas les
paires entre elles ; l'exemption n'est valide que si toutes les rendues
viennent de la même tôle).

**Implémenté (variante 2, préférée à la validation-sur-donneuse car elle
préserve les fusions légitimes)** : les non-posées d'origine RECEVEUSE
**retournent sur la RECEVEUSE** à leur pose d'origine, validées par
`_validate_batch` contre toute la receveuse (poses du lattice comprises)
et entre elles — échec → rollback tracé `restore-recv`. Les non-posées
d'origine donneuse suivent le chemin X1.2/Y2 inchangé (même tôle
d'origine : l'exemption y est valide). Miroir JS complet.

**Tests** : Python (`test_ad1_recv_return_on_donor_validated`) — une fan
receveuse posée en chevauchement franc d'une fan donneuse (216,600 vs
rangée donneuse y=600) n'atterrit JAMAIS sur la donneuse ; elle revient
sur sa tôle ; **aucune ceinture déclenchée**. Miroir vitest. Note : le
premier test écrit (rollback `restore-recv-on-donor`, variante 1) cassait
T9 (le rollback intégral perdait des fusions légitimes) — la variante 2
préserve T9/T10/T12 et les 57 tests résiduels.

## AD3 — Rejeu pas-à-pas possible

`discardedAlternatives[].preLayouts` : poses compactes du snapshot
moteur (avant expansion). `bench/replay_residual.py` : rejoue moteur →
expansion → hole-fill → résiduel sur ce snapshot et imprime l'étape
fautive et les paires. (Les deux récidives déjà en base datent
d'avant cette persistance — les prochaines occurrences seront
rejouables ; le correctif AD1 supprime la cause qu'elles
démontraient.)

## AD5 — Ceinture différentielle sur les pièces modifiées

Diff multiset `(tôle, item, rot, tx, ty)` entrée/sortie → pièces
touchées ; la mesure ne vérifie QUE ces pièces contre leurs voisines
(**la grille porte toutes les pièces**, seule la vérification est
ciblée — filtrer la construction vidait les voisines, corrigé).
Différentielle avant/après sur les touchées (la saleté d'entrée ne
compte pas — T9 a une entrée à 2195 mm² d'artefacts). Durée en **log**
(`residual belt: X ms, N touched`), pas dans stats : le verrou
bit-identique de la passe exige des stats déterministes.

**Gel mesuré (harnais du vérificateur)** : 0,1 → **302 ms** ;
2 → **389 ms** (avant AD5 : 350-710 ms selon la charge ; cible < 500 ms
atteinte même sous charge résiduelle du banc). Cumul long tasks :
0,93 s.

## Vérification — critère GO du plan atteint

| Verrou | Résultat |
|---|---|
| **30 bancs T-A@2 séquentiels** | **30 done, 0 écartée, 0 ceinturée** — la récidive ne s'est pas produite et la ceinture n'a tiré nulle part (AD1 élimine la cause, la ceinture reste en filet) |
| corpus T-A..T-K (+24 T-A du banc) | **34/34 OK** — T-A [573, 327] à space 2, T-J REFUS, T-F PARTIEL attendus, physique propre partout |
| pytest (docker) | **225 passed, 1 skipped** |
| vitest complet | **450/450** (+1 AD1 JS) |
| e2e 0,1 | exit 0 — done 18 s |
| e2e refus 4 mm | **GO** 2,2 s |
| gel (qa-e2e-freeze) 0,1 / 2 | **302 / 389 ms** |
| déterminisme replayUserBpp | bit-identique (stats sans durée) |
| images = HEAD | assert OK 06:23 UTC |

## Notes honnêtes

1. Les deux récidives historiques ne sont pas rejouées a posteriori
   (pré-AD3) — la démonstration de la cause est la vôtre (§2.3 de votre
   plan), le correctif la neutralise à la source, et 30 bancs sans
   ceinture confirment.
2. La variante 1 (validation sur donneuse) a été implémentée puis
   abandonnée : elle cassait T9 (rollback intégral perdant des fusions
   légitimes) — la variante 2 du plan est strictement meilleure.
3. La durée de ceinture en log et non en postPass : le verrou
   bit-identique interdit une mesure horloge dans stats — compromis
   documenté (la journée P8 lira les logs).


## Addendum v2 (AE1/AE2/AE3 corrigés, 07:30-08:00 UTC)

Les trois constats du vérificateur sont traités :

**AE1** — ceinture JS : `j === i` + clé symétrique `min/max` + votre test
adopté tel quel (`app/tests/belt_blindspot.test.js`, 2/2 — mesure
complète 1 = mesure différentielle 1 dans les DEUX sens d'index).

**AE2** — le test vitest est réécrit sur l'INVARIANT : la fan suit une
pose propre, la physique mesurée autour d'elle = 0, le job tient.
Plus aucune attente de raison de rollback (elle n'existe plus dans le
code — la cascade remplace le rollback systématique).

**AE3** — cascade + RE-RELAY. Mesure intermédiaire instructive : la
cascade pure (donneuse → receveuse → rollback) donnait **0-2/8** de
fusions — le diagnostic `recvCascade` persisté dans postPass montre
POURQUOI : 4-10 fans par run échouent aux DEUX poses d'origine avec
`mindist=0.000` des deux côtés (le lattice du relais a OCCUPÉ leur pose
receveuse ; la donneuse est en contact aux mêmes coordonnées — le motif
AD1 lui-même). Ces fans ont besoin d'une NOUVELLE pose : étape (3) de
la cascade = **re-relay par batch** (`_fill_one_batch(free=échecs)`,
UNE recherche de pas par tôle, receveuse puis donneuse — le re-relay
par fan faisait repasser le gel navigateur à 0,7 s). Ne restent en
rollback `restore-recv` que les vrais « plus de place » (1-3 fans,
mindist=0 partout, aucun spot lattice).

**Verrou chiffré du plan : FUSION 5/8** (comptes 557/343, 577/323×2,
555/345 — référence 555±3/345±3), **0 écartée, 0 ceinturée**.
`eval_corpus.py` affiche désormais `FUSION: acceptée n/N (x %)`.

**Gel** (harnais du vérificateur) : 0,1 → **339 ms**, 2 → **355 ms**
(le coût AE1 absorbé par : exemption trou jugée AVANT ringsOverlap —
une fan nichée a sa bbox dans celle de l'hôte et le scan complet était
inutile — + pré-filtre bbox par paire + re-relay en batch).

**Verrous v2** : vitest **452/452** (+2 blindspot), pytest résiduels
57/57 (suite complète : 225+1 au dernier passage docker), corpus
**11/11** + FUSION 2/11 affichée (T-A@0,1 : fusion non requise à cet
espacement), e2e 0,1/2 exit 0 (done 9-12 s), refus 4 mm GO 2,2 s,
déterminisme replayUserBpp bit-identique, images = HEAD à chaque banc.
