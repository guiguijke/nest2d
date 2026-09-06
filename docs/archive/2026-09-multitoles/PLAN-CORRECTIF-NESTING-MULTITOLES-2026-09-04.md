# Vérification de l'implémentation + plan correctif — nesting multi-tôles — 2026-09-04

Vérification indépendante des 13 commits `33b2800..2cf9f21` décrits dans
[`RAPPORT-IMPL-NESTING-MULTITOLES-2026-09-03.md`](RAPPORT-IMPL-NESTING-MULTITOLES-2026-09-03.md)
(plan [`PLAN-NESTING-MULTITOLES-2026-09-03.md`](PLAN-NESTING-MULTITOLES-2026-09-03.md),
audit [`AUDIT-NESTING-MULTITOLES-2026-09-03.md`](AUDIT-NESTING-MULTITOLES-2026-09-03.md)).
Méthode : suites rejouées, banc serveur et navigateur rejoués sur les images
locales (= HEAD, vérifié par diff conteneur/copie de travail et hash wasm),
trois relectures de code (moteur Rust, post-pass Python, miroir JS) avec
sondes exécutées. Les identifiants ci-dessous préfixés **V** sont les constats
de cette vérification ; C*/A*/D*/P* renvoient à l'audit.

## 0. Verdict

**Le rapport d'implémentation est exact sur l'essentiel** : suites vertes
(cargo 70 + 1 ignoré, pytest 175 + 1, vitest 404), badges désormais mesurés
sur le cas de référence, 0 chevauchement à space 0,1 et 2 serveur et
navigateur, rollback de compaction prouvé sain, bande haute de la tôle 2
remplie (front serveur 419,6 → 399,7 mm à space 0,1), moteur : tôle 1 brute
81 hôtes + 133-177 fans au lieu de 8.

**Mais l'implémentation n'est pas livrable en l'état** : 6 défauts bloquants
ou majeurs ont été introduits ou laissés, dont une régression de qualité
mesurée à space 2, une régression fonctionnelle du recuit sur les instances à
classe unique, un verrou de test désactivé par accident, et trois écarts de
parité serveur/navigateur (space 0, vue live, critère de compaction). Le
détail et l'ordre de correction sont en §2-§3.

## 1. Mesures de vérification

Banc serveur (images HEAD, 100 Trou + 800 Fillx4, 2×1000×1000, −X, trous ON,
budget 120 s) et navigateur (Playwright, THIS DEVICE) :

| Run | Tôle 1 | Tôle 2 | Chevauch. (anneaux bruts) | min-dist | used | Chute tôle 2 | Badges |
|---|---|---|---|---|---|---|---|
| Serveur 0 | 81 + 516 (597) | 19 + 284 (303) | **7 × 0,01-0,02 mm²** | 0 | 0,715 | 562×1000 | overlapFree true, dup 0, measured |
| Serveur 0,1 | 81 + 511 (592) | 19 + 289 (308) | 0 | 0,0990 | 0,6915 | **600×1000** | idem |
| Serveur 2 | 81 + **449** (530) | 19 + 351 (370) | 0 | 1,9990 | 0,7401 | **500,8×1000** | idem |
| Navigateur 0,1 | 81 + 506 (587) | 19 + 294 (313) | 0 | 0,0990 | 0,6986 | 580,4×1000 | idem |
| Navigateur 0 | 81 + 513 (594) | 19 + 287 (306) | **3 × 0,02 mm²** | 0 | **0,808** | **371×1000** | idem |

Référence du 03/09 (avant implémentation) : serveur 0,1 = 589/311, chute 580 ;
serveur 2 = 555 (474 fans)/345, chute 522 ; navigateur 2 = 558/342.

Lecture : gain à space 0,1 côté serveur (+20 mm de chute), **régression à
space 2 (−25 fans sur la tôle 1, chute 522 → 501)**, **navigateur très
dégradé à space 0** (chute 371 contre 562 serveur), navigateur à 0,1 en
retrait de 20 mm sur le serveur (front 419,6 contre 399,7).

## 2. Constats de vérification

Sévérité : **B** bloquant (empêche la livraison), **M** majeur, m mineur.

### 2.1 Régressions introduites

| Id | Sév. | Où | Constat | Preuve |
|---|---|---|---|---|
| **V1** | **B** | `nest-engine/src/bpp/mod.rs:306-310, 360` | Le verrou piège 14g/46 `bpp_live_frame_matches_final_export_off_center` n'est plus un test : le `#[test]` de T1 a été inséré entre l'attribut existant et l'ancienne fonction (attribut dupliqué sur T1, ancienne fn morte). Le « 70 passed » compte T1 deux fois. | `cargo build --tests` : `warning: duplicated attribute` + `function … is never used` ; `--list` affiche T1 deux fois. Vérifié dans le source. |
| **V2** | **B** | `bpp/sa.rs:274-278` (C3) | Instance à **classe unique** (N copies d'une pièce, cas produit courant) : `apply_move` renvoie `None` → `continue` avant `construct` et avant le heartbeat → une seule construction par walk sur tout le budget (perte du multi-start, le rng dérivé du hash rend la ré-évaluation identique), spin CPU sans frame live ni heartbeat jusqu'à `min_search` (≥ 3 s, ½ budget) ou la deadline si `plateau_patience` est `None`. | `plateau_stops_converged_walk_early` (1 classe) dure exactement 3,00 s avec 0 construction utile ; `continue` saute `on_heartbeat`. |
| **V3** | **M** | `constructive.rs` C1 ↔ `residual.py` | **Régression de qualité à space 2** : le constructif first-fit remplit lui-même les bandes de la tôle 1 avec des fans en désordre (pas en lattice) ; l'AABB de la tôle 1 atteint les bords, `residual_bands` n'a plus de rectangle propre et le lattice pose moins : 449 fans contre 474. Neutre à 0,1 (+3), négatif à 2 (−25). | Rendu `serveur-space2` (tôle 1 : fans épars dans les bandes haute et droite, colonnes d'hôtes 3-4 décalées) ; comptes ci-dessus, stables sur 2 runs (rapport : 446). |
| **V4** | **M** | `residual.py:182-191` `_pair_violates` ; `residualClient.js:190-202` `pairViolates` | À space > 0, une paire à **distance 0 sans aire** (contact bord à bord) n'est plus une violation (`if d > 0 … ; return area > 0.01`). L'ancien seuil `d < space − ε` la rejetait. Chemins exposés : restauration des libres après re-grid, poses lattice contre du préexistant. | Sonde : carrés en contact, `_pair_violates(space=2) = False` ; `_validate_batch` accepte une fan collée à un hôte à space 2. |
| **V5** | **M** | `residualClient.js:193` vs `residual.py:190` | **Parité space 0** : JS `lim = max(space − EPS, 1e-9)` rejette le contact, Python le permet → au banc navigateur space 0 le post-pass échoue presque partout (chute 371 contre 562 serveur, used 0,808 contre 0,715). | Banc navigateur space 0 ci-dessus. |
| **V6** | **M** | `LiveNestingView.vue:269-272, 333` ; `localJobPrivate.js:344-374` ; `main.py` `_alt_to_live` | **D2 n'est corrigé qu'en mono-classe** : la frame finale n'a pas de `bias` → classée `'best'` ; la vue affiche `champions[selected]` = `'left'` dès qu'un champion `left` existe (toujours le cas en −X). La frame finale post-passée reste invisible ; le panneau live titre encore « Optimizing sheets ». | Code ; capture de l'implémenteur `06-modal-final.png` (« Optimizing sheets » après la fin). |
| **V7** | **M** | `residual.py:610-612` vs `residualClient.js:690-694` ; `residual.py:607-632` | Compaction conditionnelle : (a) parité — Python compare l'étalement des hôtes à `_bbox(coords)[2]` (**x max**, = 50 pour un hôte centré) et JS à la **largeur** (100) → décisions différentes ; (b) le critère ignore la **position** : une colonne d'hôtes collée au bord +X et des libres au milieu = « rien à compacter » (principe −X plus garanti). Aucun test du critère. | Sondes : hôtes à x = 948 + libres à 500 → `moved 0` ; coords origine-coin → non compactées en Python. |
| **V8** | **M** | `localJobPrivate.js:521-548, 586` ; `main.py:1659-1673` | Toutes les alternatives rejetées par la nouvelle garde : navigateur → `placed = 0`, frame finale vide (qui **bat tout** au champion via `bins: 0`), job `done`, quota consommé, aucun message ; serveur → `status: error` « Not all items could be placed » (faux : c'est le post-pass qui est invalide). `NEST_ALLOW_INVALID_ALTS` non documenté. | Lecture du flux (`keptIdx` vide non traité). |

### 2.2 Correctifs incomplets ou non conformes au rapport

| Id | Sév. | Où | Constat |
|---|---|---|---|
| **V9** | M | `residualClient.js:52-55, 108-144, 196-202` | `pairViolates` sans shapely a trois angles morts : containment à d > 0 (petit polygone inclus dans un grand sans croiser sa frontière → accepté), parois de **trous** ignorées (anneau externe seul : une fan à 0,5 mm de la paroi d'un trou passe), doublons **concaves** (L/U : centroïde hors polygone, sommets/milieux sur la frontière → accepté). Sondes : carré 20 dans carré 100 → `false` ; L dup → `false`. Le filet `nest-report` attrape ensuite mais jette l'alternative entière. |
| **V10** | M | `localPayloadBuilder.js:812-838` ; `residualClient.js:42-50` ; `localBridge.js:654-658` | D4/D7 ne sont corrigés que pour le payload préparé **serveur**. En J-090 (projet 100 % privé, le mode par défaut de l'utilisateur) : `parts` sans `rotations` → `partRotations` retombe sur l'instance **réduite** (le bug D4 exact, piège #3b) ; `hasHoles` absent → `holesGateOpen` sans le terme `channelsUsable(space)`. |
| **V11** | M | `constructive.rs:341-364` (C5) + `build_bin` cost = 1 | Avec `cost: 1` partout, `min(cost, loss)` se réduit à la perte sur tôle vide = f(bin_w) → **le format le plus large gagne systématiquement**. Ce n'est pas « adéquation », et ce n'est pas la décision propriétaire (coût ∝ surface). T6 ne couvre pas le cas coûts égaux. |
| **V12** | M | `constructive.rs:1014-1040` (T7) | T7 `hosts_pack_9x9_at_space_0_1` ne tourne **pas** à space 0,1 : `Importer::new(cde, simplify, min_item_separation, concavity)` reçoit `None` en 3ᵉ position (space 0) et `Some((0.1,0.1))` en 4ᵉ (cutoff de concavité). Le claim « échoue sans le clamp » est à re-vérifier. Même confusion dans `tiny_instance`/`bands_instance`/T6. |
| V13 | M | `sparrow/sample/search.rs:96-99` (C6) | Le clamp 0,01 mm s'applique aussi au **SPP** (~2× plus de bissections par `search_placement` pour un item > 10 mm). Impact densité/débit SPP non mesuré (ESICUP « 5/5 » = seuils, pas une comparaison avant/après). |
| V14 | M | `bpp/mod.rs:150-164` (C11) | Le throttle 500 ms peut **avaler la dernière amélioration** (pas d'émission inconditionnelle après `anneal`, contrairement à `report_final` SPP) → V1, une fois réactivé, devient flaky ; la vue live peut finir sur un état antérieur à l'incumbent. |
| V15 | M | `main.py:458-472, 757-800` ; `localPayloadBuilder.js:690-700` (C13) | `container_map_back` n'est jamais appliqué aux `container_id` exportés (ids moteur persistés alors que `sheets` est la liste non filtrée) ; `bin_dims[0]` reste le format d'origine 0 pour `is_spp`/SPP ; côté JS `containerMapBack` est stocké **dans `instance`** → hashé dans le seed (seed ≠ Python dès qu'un format `count: 0` existe) et envoyé au wasm. Exposition faible (l'API impose `count ≥ 1`) mais le code est incohérent. |
| V16 | M | `structureClient.js:396-446` (D9) | Le lattice JS (dichotomie sur anneau décimé) reste plus lâche que Python : front tôle 2 navigateur 419,6 contre 399,7 serveur à space 0,1 (20 mm de chute perdus côté navigateur, où l'utilisateur travaille). « 400/1099 poses divergentes » est un écart loggué, pas une parité. |
| V17 | m | `app/components/*` | `report.postPass` (A5) n'est lu par **aucun** composant ; la garde D3 (no-op sur rotations non quart de tour) est donc invisible pour l'utilisateur ; `applyHoleFill`/`buildGridAlternative` JS ne tracent même pas leur no-op D3. |
| V18 | m | `residual.py:786`, JS idem | `residualMoved` compte les libres re-posées à pose **identique** (2ᵉ passe : 422 « déplacées » sans mouvement) ; navigateur : `postPass.expandMeta = 0` (compteur non câblé). |
| V19 | m | `metrics.py:386` | `smallestGapMm` = distance au bord quand aucune paire n'est sous le rayon `space + 1` (affiche 340 mm pour deux hôtes à 10 mm hors rayon). |
| V20 | m | `residual.py`/DXF à space 0 | À space 0, le DXF exporté (anneaux **bruts**) contient des micro-intersections fan↔fan de 0,01-0,02 mm² que le rapport déclare « sans chevauchement » (vérification sur anneaux simplifiés). Physiquement négligeable, mais la promesse du badge n'est pas tenue à space 0. |
| V21 | m | tests | Tautologies : `construct_is_deterministic_per_sequence` (teste `construct` à rng donné, pas `anneal`), T5 (teste `cmp_key`, pas `cost_of`), T3 (teste le helper, pas l'évaluateur), `test_rotated_lattice_not_truncated_before_bbox_filter` (`len ≥ 1`), `TestH1…` (assertion rollback conditionnelle), `TestPipelineTwoSheetsPhysical` sans assertion d'espacement (V4 lui échappe), fixtures `replayUserBpp` **non commitées** (skip en CI), D14 = arrondi 1e-6 et non regroupement. |
| V22 | m | `AGENTS.md` | Pièges #57-#61 insérés avant #54 ; #57 doit dire que le contact à d = 0 est accepté — à reformuler avec V4. `extent_ratio`, `n_layouts`, variable `n` : code mort. |

### 2.3 Vérifié conforme (à ne pas retoucher)

Rollback A2 (fixture H1 : `moved 0`, `compactRollback true`, poses restaurées,
0 chevauchement, Python **et** JS) ; `verify_layout` STRtree (900 pièces en
0,15 s, doublons, `verifyStatus`) ; garde par classe ; P1 (bande haute
remplie des deux côtés) ; P2 (ancrage gauche, tie-break, translation valide) ;
D1 (`ar > br`, sans effet SPP) ; D6 sentinelle ; C1/C2 (T2 réel : 133 fans) ;
C4 ; C10 ; C12 (consommateurs adaptés) ; fix panic wasm ; déterminisme
(`seq_hash` entier, pas de transcendantale nouvelle, pas d'`Instant − d` nu) ;
`nest-report` ; i18n sans apostrophe.

## 3. Plan correctif (ordre d'exécution)

Mêmes règles que le plan initial (une PR par étape, miroir Python↔JS, rebuild
wasm dans la même PR pour tout changement moteur, banc chiffré, physique
bloquante). Référence de départ = mesures §1.

### Étape 1 — Réparer ce qui a été cassé (B/M, ½ jour)

1. **V1 + V14** : remettre `#[test]` sur `bpp_live_frame_matches_final_export_off_center` ;
   émettre une frame `layout` **inconditionnelle** après `sa::anneal` avec
   `report.best_solution` (miroir de `report_final` SPP). Test : « dernière
   frame == incumbent final » à budget court.
2. **V2** : dans `anneal`, quand `apply_move` renvoie `None` (classe unique) :
   ne pas `continue` — faire un « reseed move » (dériver `eval_rng` de
   `(seed, seq_hash, compteur)`) pour conserver le random-restart, et garder le
   heartbeat. Test : 1 item × N sur 2 tôles, 2 s → > 1 `construct` par worker
   et ≥ 1 heartbeat.
3. **V4** : `_pair_violates`/`pairViolates` : `if space > ε: return d < space − ε`
   (d = 0 inclus) ; `else: return d == 0 and area > 0,01`. Test « contact à
   space 2 et 0,1 rejeté », des deux côtés ; ajouter l'assertion
   `distance ≥ space − 0,01` à `TestPipelineTwoSheetsPhysical`.
4. **V5** : JS `lim` à space 0 = même politique que Python (contact permis,
   aire > 0,01 rejetée) — `pairViolates` à `space ≤ ε` → `ringsOverlap`
   seulement. Banc navigateur space 0 : chute ≈ serveur (±20 mm).
5. **V8** : navigateur : si `keptIdx` est vide → `local-fail` (refund, carte
   en erreur, texte i18n « alternatives rejetées : chevauchement mesuré »),
   jamais de frame finale vide ; serveur : `information` distincte ; documenter
   `NEST_ALLOW_INVALID_ALTS` dans AGENTS.md.
6. **V12** : corriger les arguments d'`Importer::new` dans T7/T6/`tiny_instance`
   (`Some(0.1)` en 3ᵉ, `None` en 4ᵉ) et re-vérifier « échoue sans le clamp ».

GO : cargo sans warning `duplicated attribute`/`never used` dans nest-engine ;
banc serveur et navigateur space 0 à ±20 mm de chute ; 0 paire à d = 0 à
space > 0 sur tous les bancs.

### Étape 2 — Vue live et parité de compaction (M, ½ jour)

7. **V6** : `offerChampion` : une frame `stage ∈ {final, reveal}` remplace
   **toutes** les classes (ou reset `champions`) ; `buildLiveLayout` et
   `_alt_to_live` portent `bias` de l'alternative. Test : frame finale sans
   bias vs champion `left` → affichée ; e2e : `03-stage-final.png` titre
   « Final layout ».
8. **V7** : critère de compaction conditionnelle unifié : largeur
   `bb[2] − bb[0]` (Python) **et** position (`min(hosts_x) − bb_left ≤ space + tol`,
   `min(frees_x0) ≤ anchor_maxx + space + tol`). Tests : colonne unique au
   bord +X → compactée ; hôte centré vs origine-coin → même décision JS/Python.
9. **V18** : `residualMoved` ne compte que les transformations changées
   (bandes aussi) ; câbler `postPass.expandMeta` en JS.

### Étape 3 — Régression de qualité à space 2 (M, 1 jour)

10. **V3** : généraliser la compaction aux tôles **receveuses** : pour chaque
    tôle, ancre = hôtes + nichées ; libres = tout le reste (y compris les fans
    que le moteur a posées dans les bandes) ; détacher, bandes depuis l'AABB
    de l'ancre, lattice avec libres détachées + donneuses ; accepter si
    `count ≥ avant` (receveuse) / `front ≤ avant` (donneuse), sinon
    restauration complète. Alternative moteur (à évaluer si la précédente ne
    suffit pas) : règle (2) first-fit réservée aux items dont l'aire ≥ k × aire
    médiane, les petits restant best-fit intra-tôle.
    GO : space 2 tôle 1 ≥ 474 fans (référence), space 0,1 ≥ 511 (état actuel),
    physique OK, navigateur = serveur ± 3 pièces.
11. **V16** : dichotomie JS sur l'anneau complet (comme Python STRtree) ou
    validation exacte du couple (py, px) final ; cible : front tôle 2
    navigateur = serveur ± 2 mm à space 0,1 ; verrou parité `moved` exact +
    idempotence 2ᵉ passe.

### Étape 4 — Complétude des correctifs (M/m, 1 jour)

12. **V9** : `pairViolates` : containment (bbox incluse → `ringsOverlap`),
    anneaux de trous de l'hôte, doublon = égalité `(item_id, rot, tx, ty)` à
    1e-6 ; tests des trois cas + miroir Python attendu `True`.
13. **V10** : `localPayloadBuilder` J-090 : émettre `rotations` sur chaque part
    et `hasHoles` (avec `channelsUsable`) ; supprimer le fallback instance de
    `partRotations`. Test : payload réduit (cas C) → rotations de l'hôte ;
    `holesGateOpen` à space > 2,4 = false.
14. **V11** : appliquer la décision propriétaire : `build_bin`/`buildBin`
    `cost = round(area / area_min × 100)` ; à l'ouverture, `min(cost, loss)`
    devient ainsi « plus petite tôle qui admet » ; banc mixte
    (1×1000×1000 + 1×2000×1000) avec physique ; test coûts égaux → ordre de
    déclaration.
15. **V15** : appliquer `container_map_back` aux `container_id` persistés,
    filtrer `sheets` en conséquence, `bin_dims_engine[0]` pour `is_spp` ;
    sortir `containerMapBack` de `instance` (seed identique avec/sans format
    vide — test).
16. **V13** : banc SPP avant/après C6 (2-3 instances ESICUP, même graine, même
    budget : densité et itérations) ; si perte > 0,3 pt, limiter le clamp au
    BPP via `SampleConfig`.
17. **V17** : afficher `postPass` dans le modal (badge « post-pass partiel :
    n erreurs / rollback ») ; tracer le no-op D3 de `applyHoleFill` et
    `buildGridAlternative`.
18. **V19/V20/V21/V22** : rayon `max(space + 1, 5)` pour `smallestGapMm` ;
    avertissement UI quand `space < 0,05` (kerf) et vérification finale sur
    anneaux bruts à space 0 ; dé-tautologiser les tests listés en V21 et
    committer des fixtures réduites du replay ; réordonner AGENTS.md #54-#61,
    reformuler #57 ; supprimer le code mort.

### Étape 5 — Décisions propriétaire toujours ouvertes

- Phase 4 (SPP à séparateurs) : à lancer **après** l'étape 3 seulement — la
  saturation « ~510 fans sur la tôle 1 » invoquée par le rapport est en
  partie un artefact de V3 (le lattice n'a plus de rectangle propre), pas un
  plafond physique démontré. Mesurer d'abord.
- C8 (température à l'horloge) : variance ±2-4 pièces/tôle entre runs
  identiques ; à trancher (schedule par itérations pour les tiers payants ?).
- U4/D8 : post-pass sur le thread principal (~3,2 s mesurés en node sur
  1 099 pièces) → Web Worker.

## 4. Estimation

| Étape | Dev | Banc |
|---|---|---|
| 1 | 0,5 j | 0,25 j |
| 2 | 0,5 j | 0,25 j |
| 3 | 1 j | 0,5 j |
| 4 | 1 j | 0,5 j |

## 5. Commandes de vérification (rappel)

Voir §« Commandes de banc » du plan initial. Nouveautés utilisées ici :
`scripts/qa-e2e-local-2sheets.mjs` (QA_SPACE 0 / 0,1 / 2), 
`workers/nesting/bench/check_svg_dir.py` (SVG serveur **et** navigateur,
anneaux bruts) ; le déploiement reste suspendu au GO de l'étape 3.
