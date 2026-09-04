# Vérification du plan correctif n° 3 + plan correctif n° 4 — nesting multi-tôles — 2026-09-04 (nuit)

Vérification indépendante des commits `deb3e01` + `1a9934b` (rapport
[`RAPPORT-CORRECTIF-NESTING-MULTITOLES-2026-09-04.md`](RAPPORT-CORRECTIF-NESTING-MULTITOLES-2026-09-04.md)
§3quater, plan [`PLAN-CORRECTIF-3-NESTING-MULTITOLES-2026-09-04.md`](PLAN-CORRECTIF-3-NESTING-MULTITOLES-2026-09-04.md)).
Méthode : `assert_images_head.sh` (OK) puis contrôle complémentaire des
hachages wasm HEAD/working/conteneur ; suites ; banc serveur 5 jobs
(0,1 ×2, 2 ×2, 0) ; e2e navigateur 0,1 et 2 avec état brut ; corpus
T-A..T-I ; test unitaire de la validation de retour ; relecture des
diffs. Identifiants **Y** = constats de ce tour.

## 0. Verdict

**Le gain bloqué est réellement libéré.** À space 2, serveur (2 runs) et
navigateur : tôle 1 = **555 pièces (81 hôtes + 474 fans)**, chute
522,5 mm, passe fusionnée acceptée (`mergedReceivers 1`), physique
propre (min-dist 2,0000). C'est exactement la référence du 3 septembre,
retrouvée avec un moteur meilleur en amont. À 0,1 : 588-590 / chute
600-604 (état moteur conservé quand le lattice ne fait pas mieux,
rollback tracé `count`/`front`). Space 0 : 593 / 607. Corpus : 9/9 OK.
Suites : pytest 184 + 1, vitest 411, cargo 71 + 1.

**Quatre défauts empêchent encore de livrer tel quel** : le wasm rebuildé
n'est pas commité (HEAD embarque le wasm du matin, sans le schedule par
itérations ni la solution partielle) ; la validation de retour vers la
donneuse est un no-op des deux côtés (prouvé : un carré posé sur un
autre est validé) ; le champ `placed` du job vaut la demande même quand
la solution est partielle ; le compteur « pre → final » inclut les 400
fans nichées de l'expansion et ne mesure donc pas le post-pass.

## 1. Mesures (images = working tree, vérifié)

| Run | pre (brut, avant expansion) | Final | Chute t2 | postPass | Physique (brut) |
|---|---|---|---|---|---|
| Serveur 0,1 (a) | [262, 238] | 589 / 311 | 600,3 | moved 495, **merged 1** | OK 0,1000 |
| Serveur 0,1 (b) | [264, 236] | 588 / 312 | 603,7 | moved 0, rb front/count | OK |
| Serveur 2 (a) | [204, 296] | **555 / 345** | 522,5 | moved 495, **merged 1** | OK 2,0000 |
| Serveur 2 (b) | [205, 295] | **555 / 345** | 522,5 | idem | OK |
| Serveur 0 | [269, 231] | 593 / 307 | 606,7 | moved 0, rb front/count | OK (V20) |
| Navigateur 0,1 | [590, 310]* | 590 / 310 | 603,7 | moved 0, rb front/count | OK 0,0990 |
| Navigateur 2 | [524, 376]* | **555 / 345** | 522,2 | moved 495, **merged 1** | OK 2,0000 |

\* côté JS, `pre` est pris après l'expansion (cohérent avec l'intention) ;
côté Python avant (Y4).

Corpus (mon run) : T-A 587/313 (merged 1), T-B 22/58, T-C 31/29, T-D
294/36, T-E 460 (1 tôle), T-F **89 placées + 1 non placée** (28 + 61,
solution partielle livrée, badge « 1 pièce non placée »), T-G 39/162,
T-H 92/92/16, T-I 96 — tous physiquement propres, aucun « pire que le
moteur » sur les comptes.

## 2. Constats

### 2.1 Vérifié conforme

X1 (validation de retour contre les seules pièces modifiées : passe
acceptée quand elle gagne, +31 fans à space 2), X5 (`mergedRollbackReason`),
X2 côté moteur (`merge_bp_runs` livre la meilleure solution partielle ;
T-F livre 89/90 au lieu d'un job en erreur), X3 (script de contrôle,
avec la réserve Y1), X4 partiellement (Y4), X7, suites, mono (tour
précédent), corpus 9/9.

### 2.2 À corriger

| Id | Sév. | Où | Constat | Preuve |
|---|---|---|---|---|
| **Y1** | **B (livraison)** | `public/engine/nest_wasm_bg.wasm` ; `bench/assert_images_head.sh` | Le wasm rebuildé (15:47, hash `8c5b4c4f…`) est **non commité** ; HEAD embarque encore le wasm du matin (`957c71d6…`, commit `db18531`), donc sans schedule par itérations ni solution partielle (piège #33b). Le script de contrôle compare le conteneur au **répertoire de travail**, pas à HEAD : il dit OK alors que HEAD est périmé ; il ne vérifie ni le binaire moteur du worker ni le bundle JS. | `git status` : `M public/engine/nest_wasm_bg.wasm` ; hashes HEAD ≠ working = conteneur. |
| **Y2** | **B (sûreté latente)** | `residual.py` `_merge_fill_compact_receivers` (`_validate_return(remaining, donor, …, changed_ids=set())`) ; `residualClient.js:923` (`new Set()`) | Les candidates non posées (libres de la receveuse **et** de la donneuse) sont rendues sur la donneuse **sans aucune validation** : `include=[]` → occupancy vide → toujours vrai. Une libre de receveuse est téléportée sur la donneuse **à ses coordonnées de receveuse**, où la donneuse peut avoir une pièce. Sur le corpus de référence ça tombe dans le vide (x > 900 sur la tôle 2) ; sur une autre géométrie c'est un chevauchement que seul le filet final attrape (alternative écartée → job en échec). | Test unitaire : carré posé sur un carré, `_validate_return(..., changed_ids=set())` → **True**. |
| **Y3** | M (produit) | `main.py:1779` (`"placed": total_requested_count`) ; JS `report.unplaced` absent | Solution partielle : le job dit `placed = 90` pour 89 posées ; côté navigateur `report.unplaced` n'est jamais calculé (badge côté serveur seulement). | T-F : `placed 90`, `unplaced 1`, `sheets [28, 61]` ; navigateur : `unplaced: None`. |
| **Y4** | M (méthode) | `main.py:1361` (snapshot `pre` avant `expand_meta` l.1405) ; `eval_corpus.py` « gain » | `postPass.pre` Python est pris **avant** l'expansion des fans nichées : « gain » T-A = [326, 74] inclut les 400 fans de `expand_meta`. Le gain du post-pass résiduel n'est donc pas mesuré (JS le prend après l'expansion : les deux côtés divergent). | T-A pre [262, 238] → final [589, 311]. |
| Y5 | m | `seed_corpus.py:190-212` | Slug `bench-corpus-<case>-<ts>` : deux cas identiques semés dans la même seconde partagent le slug (trois docs, un seul traité) — mon T-F ×3 a produit deux faux « échecs ». | `bench-corpus-f-1788537170` ×3. |
| Y6 | m | C8 | Variance résiduelle entre runs à seed égal (0,1 : 588 vs 589 ; T-F : 28 vs 29 sur la petite tôle) : le budget d'itérations est estimé à partir du temps mesuré. | bancs. |
| Y7 | m | `eval_corpus.py` | Sans `CORPUS_SINCE` le script liste tous les jobs historiques (29/59) ; les anciens docs sans `report.pre` s'affichent en « ÉCHEC (aucune alternative) ». | sortie. |

## 3. Plan correctif n° 4 (court)

1. **Y1** : committer `public/engine/nest_wasm_bg.wasm` (rebuild depuis HEAD,
   `determinism_lock.py` rejoué) ; `assert_images_head.sh` : comparer au
   **HEAD git** (`git show HEAD:<fichier> | md5sum`) et signaler tout
   fichier suivi modifié ; ajouter le md5 du bundle JS principal et la
   date de build du binaire moteur vs dernier commit `engine/`.
2. **Y2** : `_validate_return(remaining, donor, items, space)` **sans**
   `changed_ids` (tolérance A14 `space − 2×SIMPLIFY − ε` contre toute la
   donneuse) ; miroir JS ; test « libre de receveuse rendue sur une
   pièce de la donneuse → rollback `restore-donor` » (Python + JS).
3. **Y3** : `placed` = pièces réellement posées ; `report.unplaced` calculé
   en JS (miroir `engine_placed_by_id`) ; carte résultat : « 89/90 ».
4. **Y4** : snapshot `pre` **après** `expand` + `apply_hole_fill`, avant
   `fill_residual_bands` (comme le JS) ; `eval_corpus.py` : gain = final −
   pre par tôle, défaut `CORPUS_SINCE` = dernier seed.
5. **Y5** : suffixe d'index dans le slug de seed.
6. Y6/Y7 : documenter la variance résiduelle ; filtrer les docs sans `pre`.

GO : `git status` propre après commit ; script de contrôle OK contre HEAD ;
banc space 2 serveur + navigateur = 555 ± 3 ; test Y2 vert ; T-F ×3 avec
slugs distincts → 3/3 `done` avec `placed` exact.

## 4. Décision phase 4

Sur les chiffres mesurés ce tour, le post-pass apporte **+31 pièces sur la
tôle 1 à space 2** et **0 à space 0,1 et 0** (le moteur first-fit y fait
déjà aussi bien que le lattice). Le corpus hors référence n'a aucun gain
(toutes les passes no-op). Recommandation : **pas de phase 4 maintenant**.
Garder la passe fusionnée + compaction donneuse comme filet conditionnel
(elles sont sûres par l'invariant), livrer après le plan n° 4, et réévaluer
la phase 4 sur retours utilisateurs réels plutôt que sur ce corpus.
