# Vérification du plan correctif n° 2 + plan correctif n° 3 — nesting multi-tôles — 2026-09-04 (soir)

Vérification indépendante des commits `9913913` + `b124f9b` (rapport
[`RAPPORT-CORRECTIF-NESTING-MULTITOLES-2026-09-04.md`](RAPPORT-CORRECTIF-NESTING-MULTITOLES-2026-09-04.md)
§3ter, plan [`PLAN-CORRECTIF-2-NESTING-MULTITOLES-2026-09-04.md`](PLAN-CORRECTIF-2-NESTING-MULTITOLES-2026-09-04.md)).
Méthode : **images Docker reconstruites depuis HEAD** (les images sur
lesquelles l'implémenteur a mesuré ses bancs finaux dataient d'avant son
commit final — `residual.py` du conteneur sans W4, bundle app sans
`containedOverlap`/`validateReturn`), suites, banc serveur 5 jobs, e2e
navigateur 2 (avec dump moteur brut `pre-solve.json`), corpus de torture
T-A..T-I rejoué + T-F ×3, diagnostic instrumenté de la passe fusionnée
(`bench/diag_merge_receivers.py`, nouveau). Identifiants **X** = constats de
ce tour.

## 0. Verdict

**Sûreté et invariant : atteints.** Aucun chevauchement, aucun hors-tôle,
aucun doublon sur 5 bancs serveur, 2 navigateur et 8 cas de corpus ;
l'invariant « jamais pire que l'état d'entrée » tient (à 0,1 la compaction
donneuse est refusée pour cause de front, le résultat livré est l'état
moteur). Suites : pytest 184 + 1, vitest 411, cargo 71 + 1. Mono-tôle OK.

**Qualité : les post-pass ne produisent plus rien, et la raison est un
défaut, pas une saturation.** Sur le corpus de référence, `mergedReceivers`
vaut 0 partout et `residualMoved` vaut 0 à space 0,1 : le résultat livré
est celui du moteur (chute 601-608 mm à 0,1 côté serveur, 603,7 côté
navigateur ; 522 à space 2 = la référence initiale). Le diagnostic montre
que la passe fusionnée W3 **pose 150 fans** dans les bandes de la tôle 1 à
space 2 (contre 119 pour le moteur, 555 pièces au lieu de 524) puis est
**annulée** par `_validate_return` : les pièces rendues à leur pose
d'origine mesurent 1,963 mm sur anneaux re-simplifiés (seuil 2 − 1e-6),
alors que le moteur les garantit à 2,0 sur ses propres anneaux. La
« saturation démontrée à space 2 » du rapport est donc **infirmée** : le
gain est disponible, bloqué par un seuil.

**Un cas de corpus échoue : T-F (deux formats, 93 % de remplissage) →
« no feasible solution » 4 fois sur 4 chez moi**, réussi 1 fois chez
l'implémenteur (29 + 61 pièces, physique propre). Faisabilité
non déterministe sur stock serré : c'est un risque produit direct (le même
job réussit ou échoue selon le run).

## 1. Mesures (images HEAD)

| Run | Tôle 1 | Tôle 2 | Chute t2 | postPass | Physique (brut) |
|---|---|---|---|---|---|
| Serveur 0 | 701 | 199 | 600 | residualMoved 199, merged 0 | OK (V20 : micro-aires) |
| Serveur 0,1 (a) | 589 | 311 | 601,7 | **moved 0, rollback 'front', merged 0** | OK, 0,1000 |
| Serveur 0,1 (b) | 589 | 311 | 601,1 | idem | OK |
| Serveur 0,1 (c) | 592 | 308 | 608,2 | idem | OK |
| Serveur 2 | 533 (81 + 452) | 367 | 522,5 | moved 367 (donneuse), merged 0 | OK, 2,0000 |
| Navigateur 0,1 | 590 | 310 | 603,7 | moved 0, rollback 'front', merged 0 | OK, 0,0990 |
| Navigateur 2 | 524 (81 + 443) | 376 | 512,3 | moved 0, rollback 'front', merged 0 | OK, 1,9990 |

Moteur brut (navigateur, `pre-solve.json`) : 0,1 → t1 81 h + 185 fans
libres, t2 19 h + 215 ; 2 → t1 81 + 119, t2 19 + 281.

Diagnostic de la passe fusionnée sur ces états (`bench/diag_merge_receivers.py`) :

| Space | Candidates (recv + donneuse) | Lattice pose | Compte receveuse après | Non-posées | `_validate_return` | Min-dist réelle des retournées (simplifié) |
|---|---|---|---|---|---|---|
| 2 | 119 + 281 | **150** | **555 ≥ 524** | 5 recv + 245 donneuse | **False / False** | **1,963** (seuil 1,999999) |
| 0,1 | 185 + 215 | 184 | 589 < 590 | 28 + 188 | False / False | — |

Avec un seuil `space − 0,06` la validation passe → la passe serait acceptée
à space 2 (+31 fans sur la tôle 1).

Corpus (mon run, image HEAD) : T-A, B, C, D, E, G, H, I **OK** ; **T-F
ÉCHEC** (« Not all items could be placed »), reproduit 3 fois de plus
(4/4). Tous les cas OK ont `residualMoved 0` / `mergedReceivers 0`.

## 2. Constats

### 2.1 Vérifié conforme

W1 (acceptation receveuse compte ET front), W2 (front de référence de la
donneuse, `compactRollbackReason`), W4 Python (containment), W5 (T7 : 81
carrés, séparation 0,1, `len == 1`), W7 (artefacts retirés, `.gitignore`),
W8, W9 (`Restart` sans champ, AGENTS #54 replacé), W10 (avertissement kerf,
i18n), miroir JS de la passe fusionnée présent, mono-tôle serveur +
navigateur, corpus 8/9.

### 2.2 À corriger

| Id | Sév. | Où | Constat | Preuve |
|---|---|---|---|---|
| **X1** | **B (qualité)** | `residual.py:324-342` `_validate_return`, `:753-830` `_merge_fill_compact_receivers` ; JS `validateReturn`/`mergeFillCompactReceivers` | La validation de retour re-juge des paires **moteur** (inchangées) sur anneaux re-simplifiés à `space − 1e-6` : à space 2 elles mesurent 1,963 → rejet → rollback de toute la passe, à chaque fois qu'elle aurait gagné. Deux défauts associés : (a) `snap_recv_by_id`/`snap_donor_by_id` indexent les **deepcopies** → `get(id(pi))` ne trouve jamais rien, la restauration de transformation est silencieusement sautée ; (b) les libres de la receveuse non re-posées sont rendues **sur la receveuse** à des poses désormais occupées par le lattice au lieu d'aller sur la donneuse. | Diagnostic §1 : 150 posées, 555 ≥ 524, `validate_return False`, min-dist 1,963 ; seuil 1,94 → True. |
| **X2** | **M (produit)** | moteur BPP, `main.py` (infaisable → `status: error`) | Faisabilité **non déterministe** sur stock serré : T-F (90 × 200×150, 1000² + 2000×1000, 93 % de remplissage) → « no feasible solution » 4/4 sur HEAD, 1 succès chez l'implémenteur (29 + 61, physique propre). Le seed est identique (déduit de l'instance) : seule la température au temps mur / le nombre d'itérations diffèrent (C8). L'utilisateur voit un job en erreur ou un succès selon la charge machine. | 4 jobs `bench-corpus-f-*` en erreur, 1 `done` (11:58Z). |
| **X3** | M (méthode) | rapport §3ter | Les bancs « finaux » du rapport ont été mesurés sur des images antérieures au commit final (worker 11:44Z, app 11:55Z, commit 12:19Z) : W4 Python, `containedOverlap`, `validateReturn` n'y étaient pas. Les chiffres 591/592/588 et chute 608-611 ne sont pas ceux de HEAD (HEAD : 589-592 / 601-608, tous par rollback). | Diff conteneur/HEAD avant reconstruction. |
| **X4** | M (méthode) | `bench/eval_corpus.py` | Le verdict « jamais pire que le moteur » n'est **pas mesuré** (docstring : « GARANTI par les critères »), l'évaluation liste tous les jobs historiques (17/21 mélangés), aucun compte brut/final par tôle n'est persisté. Sur ce tour, tous les cas OK ont un post-pass à 0 : le corpus valide les gardes, pas les gains. | Sortie `eval_corpus.py`. |
| X5 | m (observabilité) | `_merge_fill_compact_receivers` | Rollback de la passe fusionnée sans raison tracée (`mergedReceivers 0` seulement) — c'est ce qui a permis de conclure à tort à une saturation. | Code. |
| X6 | m (parité) | navigateur | Paires à 0,0990-0,0999 mm (W6) toujours présentes côté navigateur (25 paires ce run, 1 039 au précédent selon le pas) ; serveur 0,1000. | check_svg_dir. |
| X7 | m | corpus | T-E (rotations 30°) et T-I (ESICUP) rendent 1 seule tôle : ils testent les gardes mais pas le multi-tôles ; T-I retombe sur des rectangles si l'instance n'est pas parsée (noté par l'implémenteur). | Sortie corpus (`tôles 1`). |

## 3. Plan correctif n° 3 (ordre)

### Étape A — Débloquer la passe fusionnée (X1, X5) — ½ jour

1. `_validate_return`/`validateReturn` : ne re-juger les pièces rendues que
   contre les pièces **modifiées par la passe** (poses lattice), jamais
   contre les paires moteur inchangées ; à défaut, seuil `space −
   2×SIMPLIFY − ε` sur anneaux re-simplifiés (documenté A14).
2. Libres de la receveuse non re-posées → **donneuse** (validées contre
   l'état de la donneuse), jamais rendues sur la receveuse à une pose
   occupée. Acceptation inchangée : `count_receveuse ≥ before` et front.
3. Restauration : `saved_poses = {id(pi): transformation}` **avant**
   détachement (comme `_compact_last_sheet`), suppression des maps
   indexées sur les deepcopies.
4. `stats.mergedRollbackReason ∈ {'restore-recv','restore-donor','count','front'}`.
5. Test Python + JS sur l'état moteur brut de `.qa-pw/e2e-verify4-m2/
   pre-solve.json` (à committer en fixture réduite) : receveuse 524 → ≥ 550,
   0 chevauchement, physique OK ; parité de décision JS/Python.

GO A : banc space 2 serveur tôle 1 ≥ 555 pièces (81 h + ≥ 474 fans),
navigateur ± 3 ; space 0,1 inchangé (≥ 589 / chute ≥ 601) ; physique OK.

### Étape B — Faisabilité déterministe sur stock serré (X2) — 1 jour

6. Moteur : avant de déclarer « infaisable », **épuiser** les 8 walks et le
   budget (aujourd'hui l'arrêt plateau coupe des walks infaisables) ; en
   dernier recours, un walk « first-fit decreasing par aire, rotations
   toutes essayées » déterministe.
7. Sortie : si toujours infaisable, livrer la **meilleure solution
   partielle** avec `unplaced` explicite (badge « n pièces non placées »,
   pas un job en erreur), le refund restant à trancher.
8. C8 : schedule de température **par itérations** (calibré par taille
   d'instance) pour que le même job donne le même résultat sur toute
   machine ; verrou : T-F 3/3 identiques (comptes par tôle) à HEAD.

GO B : T-F 3/3 `done` avec comptes identiques ; suites ; `determinism_lock`.

### Étape C — Méthode de mesure (X3, X4, X7) — ½ jour

9. `bench/assert_images_head.sh` : diff `residual.py`/`main.py`/`metrics.py`
   conteneur ↔ HEAD + hash wasm bundle ↔ `public/` ; **obligatoire** avant
   tout banc rapporté (le rapport cite la sortie).
10. Persister `report.postPass.pre = [{sheet, count, frontX}]` (Python et
    JS) ; `eval_corpus.py` : filtrer sur le run courant (tag/horodatage),
    afficher brut → final par tôle et un verdict « pire que le moteur »
    **mesuré** ; sortie « gain » (pièces déplacées utilement).
11. Corpus : T-E et T-I en ≥ 2 tôles (quantités), T-F joué ×3.

### Étape D — Décision de fond (après A et B)

- Si, une fois X1 corrigé, le post-pass ne gagne que sur des corpus de type
  « hôtes + petites pièces », le garder comme filet **conditionnel** et
  retirer le reste ; sinon phase 4. La décision se prend sur les chiffres
  `postPass.pre → final` du corpus, pas sur une intuition.

## 4. Estimation

| Étape | Dev | Banc |
|---|---|---|
| A | 0,5 j | 0,25 j |
| B | 1 j | 0,5 j |
| C | 0,5 j | 0,25 j |
