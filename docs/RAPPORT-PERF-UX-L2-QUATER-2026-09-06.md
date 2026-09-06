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
