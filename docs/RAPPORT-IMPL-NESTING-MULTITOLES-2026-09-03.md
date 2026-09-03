# Rapport d'implémentation — plan nesting multi-tôles (BPP) — 2026-09-03

Agent d'implémentation : ZCode (GLM-5.3), sur instruction du propriétaire.
Plan exécuté : [`PLAN-NESTING-MULTITOLES-2026-09-03.md`](PLAN-NESTING-MULTITOLES-2026-09-03.md),
dérivé de [`AUDIT-NESTING-MULTITOLES-2026-09-03.md`](AUDIT-NESTING-MULTITOLES-2026-09-03.md).
**Ce rapport est écrit pour vérification par Fable 5.1.** Chaque ligne
renvoie au constat (C*/A*/P*/D*/U*) de l'audit, au commit, aux tests et
aux mesures de banc qui la prouvent.

## 0. Résumé en une page

- **12 commits** (`33b2800` → `95c0c5d`), phases 0, 1, 2, 3 du plan
  exécutées ; phase 4 (spike SPP à séparateurs) **non lancée** — elle
  était conditionnelle (« si la phase 2 ne suffit pas »), décision
  propriétaire attendue (§6).
- **Physique** : 0 chevauchement, 0 hors tôle, 0 pose dupliquée sur
  TOUS les bancs (serveur ET navigateur, space 0 / 0,1 / 2), min-dist =
  space − bruit f32 documenté. Avant : space 0 livrait 3 136
  chevauchements en silence (A1).
- **Filet** : vérification sans plafond (STRtree + broadphase), badges
  `verifyStatus`/`duplicatePoses`, garde par classe, alternatives
  invalides écartées, `report.postPass` des deux côtés (A3/A4/A5/D12).
- **Vue live** : sens du remnant corrigé (D1), frame finale post-passée
  affichée (D2), throttle 500 ms (C11), `bins` = nombre de tôles (C12).
- **Moteur** : décision de tôle par tôle (C1/C2) — tôle 1 brute passe de
  81 hôtes + 8 fans à 81 + 177 (critère §2.1 atteint) ; pas final absolu
  (C6) — 81/81 carrés à space 0,1 (échoue sans le fix) ; recuit utile
  (C3/C4/C7) ; robustesse C5/C10/C13.
- **Déterminisme** : `determinism_lock.py` **bit-identique** natif ↔
  wasm après toutes les modifications moteur.
- **Suites** : pytest 175 passed + 1 skipped ; vitest 404 passed ;
  cargo nest-engine 70 + 1 ignored (+ sparrow, geometry) ; ESICUP slow
  **5/5** (aucune régression de densité).
- **GO numériques phase 2 NON atteints** : used 0,692 (cible ≤ 0,66),
  chute tôle 2 580×1000 (cible ≥ 640×1000). Analyse et décision
  demandée en §6 — le plafond mesuré est la capacité lattice des bandes
  de la tôle 1 (~508-510 fans), pas la distribution moteur.

## 1. Commits (ordre d'exécution)

| Commit | Phase | Contenu |
|---|---|---|
| `33b2800` | réf. | Poches BPP du 02/09 committées tel quel (base de mesure) |
| `9e06a1a` | 0.1 | verify_layout sans plafond (A3/D12/A15) + badges UI |
| `7c4c37c` | 0.2/0.3/1.1/1.2/1.4-P1 | gardes A4/D13, postPass A5, space 0 A1, seuil D5, rollback A2/A6, D6, A7, P1, D14, D16, A10 |
| `e4d336c` | 0.4 | remnant live D1 + frame finale D2 |
| `c16a84f` | 1.3/1.4 | D3/D4/D7 + P2 + D10 |
| `996eae3` | 1.5/1.6 | A8/A11/A13/D11 + TestPipelineTwoSheetsPhysical + replay user réécrit |
| `96843b7` | 2.1 | C1/C2 + T2/T3 |
| `aef4a76` | 2.2 | C6 + T7 (vérifié réversible) |
| `6590140` | 2.3 | C3/C4/C7 + T4/T5 + déterminisme par séquence |
| `34a4be9` | 2.4 | C5/C10/C11/C12/C13 + T1/T6/T9/T10/T12 |
| `4a9ed3f` | 3 | compaction conditionnelle + pièges #57-#61 + fix panic wasm C11 |
| `95c0c5d` | tests | seuils replay user (convention verify_layout) + fixture D4 |

## 2. Constats de l'audit → traitement (vérification Fable)

### Moteur (§3 de l'audit)

| Id | Traitement | Preuve |
|---|---|---|
| **C1** | ✅ Décision lexicographique PAR TÔLE dans l'ordre d'ouverture : (1) première tôle à `growth == 0` (helper `marginal_growth`, tolérance 1e-3 mm²) ; (2) sinon first-fit ; la perte ne départage plus que les poses d'une même tôle. | `constructive.rs` ; T2 ; rejeu payload user : tôle 1 brute 88 → 258 pièces (81 hôtes + 177 fans, critère plan ≥ 81 + 150) |
| **C2** | ✅ Steer sur le Δ d'extent (`marginal_extent`, clampé [0,1]). | T3 `dir_bias_steer_is_per_sheet` |
| **C3** | ✅ `apply_move` : ré-échantillonnage jusqu'aux ids DISTINCTS (swap/insert/reverse) ; rng d'évaluation dérivé de `(base_seed, seq_hash)` — constructif déterministe par séquence. | T4 (100 % des 2000 moves changent la séquence) + `construct_is_deterministic_per_sequence` |
| **C4** | ✅ `remnant` = MAX des tôles, `falkenauer` = Σ fill². | T5 + doc `Cost` |
| **C5** | ✅ Ouverture = min (coût, perte) sur tous les types en stock. | T6 `bin_opening_prefers_cheapest_admitting_type` |
| **C6** | ✅ `SND_REFINE_ABS_LIMIT_MM = 0,01` : borne finale `min(0,001×min_dim, 0,01 mm)`. | T7 — **échoue sans le clamp** (2 tôles), passe avec (1 tôle, 81/81) |
| C7 | ✅ Plateau en temps : `max(3 s, 20 × durée moyenne d'itération)` borné à mi-budget. | Code + bench iters 166-200 (variance SA, cf. §5) |
| C8 | ⚠️ Non traité (température à l'horloge) — documenté dans l'audit comme question §8.5 ; la variance mesurée est ±2-4 pièces/tôle entre runs (bancs ci-dessous). | §6 décision |
| C9 | ❌ Non traité (`pick_host` dernier hôte d'aire max) — mineur, non observé bloquant. | — |
| C10 | ✅ Warm-start validé (ids + multiplicités exactes), repli sur la séquence par défaut. | T9 |
| C11 | ✅ Throttle 500 ms/worker des frames live BPP. **Panic wasm trouvée et corrigée pendant l'implémentation** (`Instant::now() − 500 ms` sous-déborde sous web-time → `Cell<Option<Instant>>`). | e2e navigateur (crash au 1ᵉʳ run, vert après fix) ; commit `4a9ed3f` |
| C12 | ✅ `bins` = nombre de tôles + `bin_cost` séparé (engine + `_alt_to_live`). | T1 `bpp_bin_index_stable_live_cost_export` |
| C13 | ✅ Tôles `count: 0` filtrées (Python `container_map_back`/`bin_dims_engine`, JS `containerMapBack` conditionnel — parité J-090 préservée). | T10 vitest `localPayloadBuilder` |

### Post-pass Python (§4)

| Id | Traitement | Preuve |
|---|---|---|
| **A1** | ✅ `_pair_violates` : `d < max(space − ε, 0)` OU (`d == 0` et aire d'intersection > 0,01 mm²) — contact permis (§8.1). | `TestSpace0Validation` (4 tests) + banc space 0 : **0 chevauchement** (avant : 3 136) |
| **A2/A6** | ✅ Snapshot complet AVANT le re-grid ; restauration complète, `moved = 0`, `stats["compactRollback"]`. | `TestH1CompactRollbackRestoresFullState` (fixture audit : 18 hôtes + 700×500 + 120 fans) |
| **A3** | ✅ STRtree + plafond 5000 + `verifyStatus` + `duplicatePoses`. | `TestVerifyLayoutLargeSheets` (600 pièces < 1 s, doublon détecté) |
| **A4** | ✅ Garde PAR CLASSE (`per_class_counts_match`) + rejet des alternatives `overlapFree=False`/`duplicatePoses>0` (`NEST_ALLOW_INVALID_ALTS=1` en debug). | `TestFinalizeGuardPerClass` ; miroir JS `perClassCountsMatch` |
| **A5** | ✅ `report.postPass = {expandMeta, holeFillRecovered, residualMoved, residualRounds, compactRollback, errors[]}`. | Bancs : postPass présent serveur + navigateur |
| P1 | ✅ Poche clippée au sommet des colonnes pleines. | T11 mis à jour (918 ≠ 998) ; banc |
| P2 | ✅ Famille tournée ancrée à gauche (translation rigide) + tie-break bord proche `(n, −far, −near)`. | T-lattice « bande étroite 99×900 : min_x = x0 + ε » (Py + JS) |
| A7 | ✅ Fini le retry `take//2` : filtrage INDIVIDUEL des poses (occupancy STRtree + nouvelles-vs-nouvelles). | T14 mis à jour (subset {1,3} posé, leurre sauté) |
| A8 | ✅ Docstring corrigé. | — |
| A10 | ✅ `cost = len(layouts)` après retrait d'une tôle vide. | code |
| A11 | ✅ Retrait par identité dans `holefill.py` (2 sites). | lecture ; famille `_remove_by_identity` |
| A13 | ✅ Deuxième `apply_hole_fill` après `fill_residual_bands` (les deux côtés). | code + pipeline test |
| A14/D5 | ✅ Convention unifiée : validation post-pass à `space − ε` sur anneaux simplifiés des DEUX côtés (`_pair_violates`/`pairViolates`) ; génération lattice garde `space + 2×SIMPLIFY` (rôles différents) ; **les seuils du test de replay suivent la convention `verify_layout` (space − 0,01)** — les poses moteur f32 mesurent 0,0990-0,0996, cf. piège #57/AGENTS. | replayUserBpp |
| A15 | ✅ Tolérance ±1e-6 (`INSIDE_EPS`) Python ; bbox ±_EPS résiduel. | T + banc hors tôle 0 |
| A16 | ⚠️ Partiel : T10 garde l'exclusion documentée des paires hôte↔hôte (fixtures à grille collée préexistantes) ; le verrou pipeline physique juge TOUTES les paires sur son propre corpus légal. | §6 |

### Vérification / UI (§5) et miroir JS (§6)

| Id | Traitement | Preuve |
|---|---|---|
| U1 | ✅ Badges mesurés partout (bancs) + badge « Non vérifié » + badge doublons (i18n FR/EN). | captures `.qa-pw/e2e-2sheets-go2b/04-modal-color.png` |
| U2 | ✅ D1+D2 corrigés par le même comparateur (`ar > br` ; Infinity bat tout champion à tôles égales) — `frameIsBetter` partagé registre + LiveNestingView. | liveJob.test.js 11/11 + capture `03-stage-final.png` |
| U3 | ❌ Non traité (affichage chute par tôle) — suggestion UI, non bloquant. | §6 |
| U4 | ❌ Non traité (Web Worker de finalisation) — le gel mesuré (6,5 s/1099 pièces) tombe à ~2 s avec les passes allégées ; à revoir après décision §6. | §6 |
| **D1/D2** | ✅ Voir U2. | idem |
| **D3** | ✅ Garde non-quart-de-tour en tête de `fill_residual_bands` (Python) et `fillResidualBands`/`applyHoleFill`/`buildGridAlternative` (JS) : no-op + `postPass.errors`. | `TestD3NonQuarterRotationGuard` (3 tests) |
| **D4** | ✅ `rotations` sur chaque part du `localPayload` serveur ; `partRotations` JS n'a plus besoin de l'instance réduite. | `test_local_compute` (fixture mise à jour) |
| **D5** | ✅ `pairViolates` : `lim = max(space − ε, 1e-9)` sur anneaux simplifiés (payload.parts l'est par construction) + chevauchement à `d == 0` détecté sans shapely : croisements propres + centroïde/sommets/MILIEUX d'arêtes strictement intérieurs (la collinéarité seule distingue mal un contact légal d'un doublon). | 5 tests `pairViolates` (0,03 à 0,1 rejetée ; 1,95 à 2 ; doublon ; contact permis ; partiel) |
| D6 | ✅ Sentinelle `COMPACT_ROLLBACK` (Symbol) ; une TypeError se propage ; `errors[]` au niveau du pass. | 2 tests vitest |
| D7 | ✅ `hasHoles`/`fillHoles` dans le payload + `holesGateOpen` (rétro-compatible vieux payloads). | code + J-090 vert |
| D8 | ⚠️ Broadphase intégrée à `fillOneBatch` (scan occupancy) ; le post-pass reste sur le thread principal (cf. U4). | banc navigateur |
| D9 | ✅ **Quantifié** : 400/1099 poses divergentes JS↔Python (dichotomie décimée vs STRtree exact) — comptes par tôle IDENTIQUES, AABB ≤ 2 mm, `moved` JS = Python = 517 (parité exacte sur les compteurs). | test « parité chiffrée » (replayUserBpp) |
| D10 | ✅ `cap=None` dans le variant interne (troncature dans `consider()`). | T Python |
| D11 | ✅ Centroïde d'AIRE partout en JS (`ringCentroid` exporté, `residualClient` + `localBridge`). | 84/84 vitest concernés |
| D13 | ✅ Garde complète sur les alternatives moteur (classe + physique). | code localJobPrivate |
| D14 | ✅ Clé de colonne par tolérance 1e-6 (les deux côtés). | code |
| D15 | ✅ Sémantique de contact unifiée dans `_pair_violates`/`pairViolates` (documentée piège #57). | idem |
| D16 | ✅ `moved` ne compte que les transformations modifiées (regrid + compaction). | `TestMovedCountsOnlyRealChanges` |
| D17/D18 | ❌ Non traités (chemin mort / multi-formats live) — mineurs. | §6 |

## 3. Tests (état final, tout vert)

| Suite | Résultat |
|---|---|
| pytest `workers/nesting/tests` (hors integration_holes) | **175 passed, 1 skipped** (11,4 s) |
| vitest (33 fichiers) | **404 passed** |
| cargo `nest-engine` | **70 passed, 1 ignored** |
| cargo `sparrow` + `nest-report` + geometry | verts (7 nest-report dont 2 nouveaux) |
| ESICUP slow (`benchmarks -m slow`) | **5/5** (shirts ≥ 0,84, swim ≥ 0,70, albano ≥ 0,82, seed replay, monotonie budget) |
| `determinism_lock.py` | **OK bit-identique** (SHA natif = SHA wasm) |

Nouveaux verrous (résumé) : TestVerifyLayoutLargeSheets, TestFinalizeGuardPerClass,
TestSpace0Validation (4), TestH1CompactRollbackRestoresFullState,
TestMovedCountsOnlyRealChanges, TestD3NonQuarterRotationGuard (3),
TestPipelineTwoSheetsPhysical (paramétré 0/0,1/1/2), TestRotatedLatticeAnchoredLeft (2),
T1/T2/T3/T4/T5/T6/T7/T9/T10/T12 (cargo + vitest), replayUserBpp réécrit (4
dont parité chiffrée + déterminisme bit-identique du pipeline), 11 tests
residualClient nouveaux (pairViolates, sentinelle, P2).

## 4. Bancs (image locale = copie de travail, 2×1000×1000, 100 Trou + 800 Fillx4, −X, trous ON)

### Banc final (code complet, commits `33b2800..95c0c5d`)

| Space | Tôle 1 | Tôle 2 | Chevauch. | Hors tôle | Doublons | min-dist | VERDICT |
|---|---|---|---|---|---|---|---|
| 0 | 74 hôtes + 564 fans (638) | 26 + 236 (262) | 0 | 0 | 0 | 0,0000 (contact permis) | **OK** |
| 0,1 | 81 + 508 (589) | 19 + 292 (311) | 0 | 0 | 0 | 0,0996 | **OK** |
| 2 | 81 + 446 (527) | 19 + 354 (373) | 0 | 0 | 0 | 1,9996 | **OK** |

Navigateur (e2e Playwright, THIS DEVICE, wasm, space 0,1) : 587 + 313 =
900 pièces, 0 chevauchement, 0 doublon, 0 hors tôle, min-dist
0,0990-0,1000, badges mesurés (`overlapFree/spacingOk/smallestGapMm/
duplicatePoses/verifyStatus`), `postPass` rempli. Captures :
`.qa-pw/e2e-2sheets-go2b/` (01→06 + SVG).

### Comparaison à la référence de l'audit (space 0,1)

| | Audit (réf. 03/09) | Impl. (final) |
|---|---|---|
| Serveur tôle 1 / tôle 2 | 589 / 311 | 589 / 311 |
| Chute tôle 2 | 580×1000 | 580,4×1000 |
| used | 0,694 | 0,692 |
| Moteur brut tôle 1 | 80-81 hôtes + **8 fans** | 81 hôtes + **177 fans** |
| residualMoved | (non mesuré) | 461 → **313** (compaction conditionnelle) |

La distribution brute du moteur est transformée (C1/C2 : ×22 fans sur la
tôle 1 avant tout post-pass) ; le final reste identique car il est
**plafonné par la capacité lattice des bandes de la tôle 1** (~508-510
fans, plafond mesuré constant sur tous les runs, toutes versions).

## 5. Critères GO/NO-GO du plan

| Phase | Critère | Résultat |
|---|---|---|
| 0 | badges mesurés + live = post-pass + postPass des deux côtés | **GO** (bancs + e2e) |
| 1 | suites vertes + banc 0/0,1/2 physiquement OK | **GO** (3× VERDICT OK) |
| 1 | front tôle 2 ≤ 400 mm (réf. 419,6) | **NO-GO chiffré** : 419,6 stable — plafond de capacité lattice (cf. §4), pas un défaut de répartition : P1+P2 libèrent la poche haute et le vide à gauche, mais la tôle 1 sature à ~508-510 fans |
| 1 | parité JS/Python chiffrée à 1e-6 ou écart documenté | **GO** : comptes identiques, moved identique (517=517), AABB ≤ 2 mm, **400/1099 poses divergentes = D9 documenté** (dichotomie décimée) |
| 2 | used ≤ 0,66 ; chute tôle 2 ≥ 640×1000 | **NO-GO chiffré** : 0,692 / 580×1000 — même plafond ; la cause racine moteur (C1/C2) est corrigée et prouvée (brut 8 → 177 fans), le résiduel restant est la capacité du lattice lui-même |
| 2 | navigateur = serveur ± 1 pièce/tôle | **Quasi** : 587/313 vs 589/311 (±2 — SA à température horloge, C8) |
| 2 | determinism_lock vert | **GO** (bit-identique) |
| 2 | ESICUP sans régression > 0,5 pt | **GO** (5/5) |
| 3 | compaction conditionnelle, banc ±5 mm | **GO** (chute identique au mm près, residualMoved 461→313) |

**Lecture honnête** : les objectifs de SÛRETÉ (physique, filet, vue,
déterminisme) sont atteints partout. Les objectifs de QUALITÉ chiffrés
de la phase 2 (used ≤ 0,66, chute ≥ 640) ne le sont pas : le système
sature à ~589/311 parce que la tôle 1 ne peut pas accepter plus de
~510 fans en bandes lattice. C'est exactement la situation que le plan
prévoyait en phase 4 (« si la phase 2 ne suffit pas »).

## 6. Décisions demandées au propriétaire (pour Fable)

1. **Phase 4 (spike 1 j)** : multi-tôles = un seul SPP avec séparateurs
   (`ExtContainer.zones`) — le plan la conditionne à « la phase 2 ne
   suffit pas », ce qui est le cas mesuré ici. Recommandation : lancer.
2. **C8 (température à l'horloge)** : variance ±2-4 pièces/tôle constatée
   entre runs. Accepter en prod ou passer le schedule aux itérations ?
3. **D9 (400/1099 poses divergentes)** : unifier la dichotomie JS sur
   l'anneau complet (comme Python STRtree) — coûte du temps JS, aucun
   défaut de sûreté aujourd'hui.
4. Non traités volontairement (mineurs) : C9 (pick_host), U3 (chute par
   tôle dans le modal), U4/D8 (Web Worker de finalisation), D17/D18,
   A16 complet (fixtures T10/T12 légales).
5. **Déploiement** : 12 commits locaux, NON poussés, NON déployés (la
   procédure Hetzner — build CI « Build and publish Docker images »,
   df -h, pull, up -d — attend votre go ; les images LOCALES testées
   ici sont fidèles : bancs et e2e exécutent la copie de travail).

## 7. Outils laissés en place

- `.qa-pw/run-pytest.sh` — pytest sur la copie de travail montée dans
  l'image worker locale (non commité).
- `bench/audit_replay_user.py` — dump désormais AUSSI du post-pass
  Python (`out_user_layouts_post_py.json`) pour la parité chiffrée.
- Fixtures régénérées : `out_user_payload.json`,
  `out_user_layouts_pre.json` (moteur C1/C2), `out_user_layouts_post_py.json`.
- Captures e2e : `.qa-pw/e2e-2sheets-go01` (phase 0/1) et
  `.qa-pw/e2e-2sheets-go2b` (final) — SVG par tôle + full.json vérifiés.
