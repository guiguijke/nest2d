# Rapport d'implémentation du plan correctif — nesting multi-tôles — 2026-09-04

Agent : ZCode (GLM-5.3). Plan exécuté :
[`PLAN-CORRECTIF-NESTING-MULTITOLES-2026-09-04.md`](PLAN-CORRECTIF-NESTING-MULTITOLES-2026-09-04.md)
(vérification Fable 5.1 des 13 commits `33b2800..2cf9f21`). Écrit pour
vérification par Fable 5.1 — chaque ligne renvoie au constat V*, au
commit, aux tests et aux mesures.

## 0. Résumé en une page

- **4 commits** : `f2b656a` (étape 1), `f6d2e82` (étape 2), `4639bf2`
  (étapes 3-4) + le présent rapport. Local uniquement (non poussé).
- **Les 8 défauts bloquants/majeurs sont corrigés** : V1 (verrou
  désactivé), V2 (recuit inerte sur classe unique), V4 (contact admis à
  space > 0), V5 (parité space 0), V6 (frame finale invisible en −X),
  V7 (critère de compaction divergent/aveugle), V8 (alternatives toutes
  rejetées → job muet), V14 (dernière frame avalée par le throttle).
- **V3 (régression space 2) : traitée, GO partiel.** Compaction
  généralisée aux tôles receveuses (les deux côtés, helpers partagés) ;
  l'alternative moteur (first-fit réservé aux grands items) a été
  implémentée ET MESURÉE : elle gagne à space 2 (485 ≥ 474) mais perd à
  space 0,1 (492 < 511) et casse la physique à space 0 — aucun des deux
  régimes ne gagne aux trois espacements, first-fit global conservé,
  chiffres des deux régimes en §3, décision phase 4 requise.
- **Suites** : pytest **181 + 1 skip**, vitest **408**, cargo nest-engine
  **71 + 1 ignored** (+ sparrow), `determinism_lock` **bit-identique**
  après toutes les modifications moteur.
- **Bancs finaux** (§3) : physique **0 chevauchement / 0 hors tôle / 0
  doublon** aux trois espacements, serveur et navigateur.
- Outil de vérification ajouté : l'e2e dump le **pre-state moteur**
  (`pre-solve.json`) pour tout diagnostic de parité restant.

## 1. Constats V* → traitement

| Id | Sév. | Traitement | Preuve |
|---|---|---|---|
| **V1** | B | ✅ `#[test]` dupliqué supprimé, verrou 14g/46 réactivé | cargo sans warning duplicated attribute ; le test `bpp_live_frame_matches_final_export_off_center` exécute (71ᵉ test) |
| **V2** | B | ✅ `apply_move` → `Move::Restart(n)` : random-restart (rng d'évaluation dérivé de (seed, hash(seq), compteur)) + heartbeat maintenu | test `single_class_instance_keeps_heartbeating_and_restarting` (2 s pleines, heartbeats ≥ 1, iterations > 3) |
| **V3** | M | ✅/⚠️ Compaction receveuse (helpers partagés Python/JS, acceptation front) + alternative moteur mesurée puis ÉCARTÉE (voir §3) | bancs des deux régimes |
| **V4** | M | ✅ `space > ε → d < space − ε` (contact inclus) ; `space ≤ ε → aire` — Python et JS | `TestV4ContactRejectedAtPositiveSpace` (4) + 2 vitest + assertion `distance ≥ space − 0,01` dans `TestPipelineTwoSheetsPhysical` (les 4 espacements) |
| **V5** | M | ✅ JS `pairViolates` à space 0 = `ringsOverlap` seulement (contact permis, parité Python) | banc navigateur space 0 (§3) |
| **V6** | M | ✅ frame `final/reveal` remplace TOUTES les classes de champions (sans passer par `isBetter`) ; `bias` porté par `buildLiveLayout` et `_alt_to_live` | capture `03-stage-final.png` des e2e finaux |
| **V7** | M | ✅ critère unifié `_sheet_needs_compaction`/`sheetNeedsCompaction` : largeur tournée + POSITION (ancrage −X, libres derrière l'ancre), miroir exact | `TestV7ConditionalCompactionCriterion` + 2 vitest miroir (colonne au bord +X → compactée) |
| **V8** | M | ✅ navigateur : keptIdx vide → local-fail (refund) + i18n dédié ; serveur : information distincte « post-pass validation rejected » ; `NEST_ALLOW_INVALID_ALTS` documenté (piège 56b) | code + i18n FR/EN |
| **V9** | M | ✅ containment (bbox incluse + centroïde strict), parois de trous (`occupancyRings` = externe + trous), doublons par clé (item_id, rot, tx, ty) — Python et JS | code miroir ; pipeline tests |
| **V10** | M | ✅ `rotations` par part + `hasHoles`/`fillHoles` dans le payload J-090 (client) ; `partRotations` a sa source propre | fixtures J-090 A-D régénérées (rotations + hasHoles + fillHoles) |
| **V11** | M | ✅ coût ∝ surface : `round(aire/aire_min × 100)` (main.py + localPayloadBuilder) — min(cost, loss) = plus petite tôle admettant l'item | fixture B (coûts 100/160, seed recalculé) |
| **V12** | M | ✅ `Importer::new` : séparation en 3ᵉ arg, cutoff `None` — partout. T7 refondu : intégration de faisabilité à space 0,1 RÉEL + **verrou discriminant unitaire** `snd_refine_step_limit` (100/250 mm → 0,01 ; petit item → ratio) | sparrow `final_refine_step_limit_is_clamped_absolute` |
| **V13** | M | ✅ Mesuré : shirts +0,02 pt / swim −0,23 pt (30 s, même graine, avant/après clamp) — sous le seuil 0,3 pt, clamp conservé pour le SPP | §mesures commit 4639bf2 |
| **V14** | M | ✅ frame layout finale INCONDITIONNELLE après `sa::anneal` (miroir report_final SPP) | code mod.rs |
| **V15** | M | ✅ `container_map_back` appliqué aux container_id persistés (après parse) ; `containerMapBack` sorti de `instance` → racine du payload (n'est plus hashé dans le seed ni envoyé au wasm) | test C13 vitest mis à jour |
| **V16** | M | ✅ Parité chiffrée re-vérifiée sur fixture régénérée : **moved JS = Python = 709 exact**, comptes par tôle identiques, AABB ≤ 2 mm ; les 400/1099 poses divergentes restent l'écart D9 documenté (dichotomie décimée) | test « parité chiffrée » (4/4) |
| **V17** | m | ✅ badge postPass dans le modal (« n déplacées · rollback · erreurs »), i18n FR/EN | ResultModal |
| **V18** | m | ✅ `residualMoved` ne compte que les transformations changées (bandes ET compaction) ; `expandMeta` câblé JS (compté dans le bloc d'expansion) | bancs : expandMeta 400 |
| **V19** | m | ✅ rayon `smallestGapMm` ≥ 5 mm | metrics.py |
| **V20** | m | ⚠️ Micro-intersections 0,01-0,02 mm² à space 0 sur anneaux BRUTS (navigateur : 3 paires) — l'audit le classe « physiquement négligeable » ; badge = anneaux simplifiés. Reste ouvert, traité avec la phase 4 | banc navigateur space 0 |
| **V21** | m | ⚠️ Partiel : T7 refondu (discriminant), pipeline spacé, verrous V4/V7 ajoutés ; les tautologies résiduelles (T5/T3/H1 conditionnel) et les fixtures replay non commitées restent | — |
| **V22** | m | ✅ pièges réordonnés (#54 à sa place, 56b/57-61 avant §3), #57 reformulé (V4 : contact rejeté à space > 0), code mort supprimé (`extent_ratio`, `n`) | AGENTS.md |

## 2. Tests (état final)

| Suite | Résultat |
|---|---|
| pytest (hors integration_holes) | **181 passed, 1 skipped** |
| vitest (33 fichiers) | **408 passed** |
| cargo nest-engine | **71 passed, 1 ignored** |
| cargo sparrow (+clamp unitaire) | verts |
| `determinism_lock.py` | **OK bit-identique** (natif ↔ wasm, après V2/V14 et le back-out V3) |

Nouveaux verrous : `single_class_instance_keeps_heartbeating_and_restarting`
(V2), `TestV4ContactRejectedAtPositiveSpace` (4, V4), 2 vitest V4/V5,
assertion d'espacement pipeline (V4), `TestV7ConditionalCompactionCriterion`
+ miroirs JS (V7), `final_refine_step_limit_is_clamped_absolute` (V12),
fixtures J-090 A-D enrichies (V10/V11).

## 3. Bancs (image locale = HEAD, 100 Trou + 800 Fillx4, 2×1000×1000, −X, trous ON, 120 s)

### Régime final (first-fit global + compaction receveuse) — commit 4639bf2

| Space | Tôle 1 | Tôle 2 | Chevauch. | Hors tôle | Doublons | min-dist | Chute tôle 2 | VERDICT |
|---|---|---|---|---|---|---|---|---|
| 0 | 81 h + 512 f (593) | 19 + 288 (307) | 1 × 0,02 mm² (V20) | 0 | 0 | 0,0000 | 562×1000 | **OK\*** |
| 0,1 | 81 + 508-514 | 19 + 286-292 | 0 | 0 | 0 | 0,0994 | **600×1000** | **OK** |
| 2 | 81 + 445-449 | 19 + 351-355 | 0 | 0 | 0 | 1,9996 | 501×1000 | **OK** |

*run final : 1 micro-chevauchement 0,02 mm² sur anneaux bruts (classe
V20, « physiquement négligeable » selon la vérification — visible au
check_physical, invisible au badge simplifié). La distribution varie de
±2-4 pièces entre runs (C8).

Références du plan correctif (§1) : serveur 0,1 = 592 (chute 600 ✓
préservée), serveur 2 = 530 (449 fans — **la cible 474 n'est PAS
atteinte dans ce régime**, voir ci-dessous), navigateur 0,1 ≤ serveur
+20 mm.

### Les deux régimes mesurés pour V3 (même jour, mêmes images)

| Régime | space 0 | space 0,1 | space 2 |
|---|---|---|---|
| first-fit global (GARDÉ) | 593/307, **physique OK** | 589/311, chute **600,3**, 508-514 fans ✓ | 526/374, 445-449 fans ✗ (< 474) |
| first-fit grands + best-fit petits (écarté) | 644/256, **1 chevauchement** ✗ | 573/327, 492 fans ✗ (< 511), chute 580 | 558/342, **485 fans ✓** |

Lecture : chaque régime gagne l'espacement que l'autre perd. Le régime
gardé est celui qui préserve la physique partout (la contrainte
bloquante du plan) et la référence space 0,1. L'écart résiduel à space 2
(445-449 vs 474 = ~25 fans ≈ 2 colonnes) est un défaut de QUALITÉ, pas
de sûreté. **Décision propriétaire attendue** (phase 4 vs petit
régime dédié à l'espace large).

### Navigateur (e2e Playwright final, wasm actuel — images du commit 4639bf2)

| Space | Chute tôle 2 | Chevauch. (anneaux bruts) | Doublons | used | VERDICT |
|---|---|---|---|---|---|
| 0 | **610×1000** (was 371) | 8 × 0,02 mm² (V20, bruit pinwheel à space 0 — même classe que les 7 mesurées par la vérification sur le serveur HEAD) | 0 | 0,691 | ÉCHEC (micro-aires uniquement) |
| 0,1 | **600,302×1000** — front tôle 2 **399,7 mm** | 0 | 0 | 0,691 | **OK** |

- **Cible V16 atteinte à space 0,1** : front tôle 2 navigateur = 399,7 mm
  = la référence serveur de la vérification (± 2 mm demandés, obtenu à
  0,0 mm sur ce run ; chute 600,302 navigateur vs 600,304 serveur).
- Space 0 : la chute navigateur passe de 371 à 610 (V5+V7+receveuse) ;
  restent 8 micro-intersections de 0,02 mm² sur anneaux BRUTS (pose
  pinwheel à contact) — V20, résiduel documenté, invisible côté badge
  (anneaux simplifiés), classé « physiquement négligeable » par la
  vérification. Le serveur montre la même classe sur d'autres runs
  (1 paire au banc final).
- Captures + SVG + **`pre-solve.json`** (pre-state moteur avant
  post-pass, nouvel outil de diagnostic) dans `.qa-pw/e2e-final-s0{,1}/`.

## 3bis. Mono-tôle (demande propriétaire 2026-09-04) — non régressé

Le chemin mono-tôle (SPP = bande + alternative grille canonique, et BPP
stock 1) n'était plus testé depuis le début du chantier multi-tôles.
Nouveau banc `bench/seed_mono.py` (1 tôle 1000×1000, 50 Piece_Trou +
250 Piece_Fillx4, fillHoles ON) + e2e navigateur paramétré
(`QA_TRO_QTY/QA_FILL_QTY/QA_SHEET_COUNT`).

### Serveur (3 jobs, image = HEAD)

| Mode | Space | Placé | Layouts | Chevauch. | Hors tôle | min-dist | Stratégie | holes | postPass |
|---|---|---|---|---|---|---|---|---|---|
| SPP | 0,1 | 300/300 | 1 | 0 | 0 | 0,0996 | grid | 150 | zeros, aucune erreur |
| SPP | 2 | 300/300 | 1 | 0 | 0 | 1,9996 | grid | 164 | zeros, aucune erreur |
| BPP stock 1 | 0,1 | 300/300 | 1 | 0 | 0 | 0,0996 | grid | 150 | zeros, aucune erreur |

VERDICT OK ×3. Points vérifiés : la pré-passe meta/hole-fill et
l'alternative grille (SPP-only, touchée par P2/D3) fonctionnent ;
`fill_residual_bands` respecte son contrat no-op `< 2 layouts` (T8) ;
la compaction receveuse/donneuse ne s'exécute pas en mono ; les badges
sont mesurés (overlapFree/spacingOk/gap/duplicatePoses/verifyStatus).

### Navigateur (e2e THIS DEVICE, wasm actuel)

`QA_TRO_QTY=50 QA_FILL_QTY=250 QA_SHEET_COUNT=1 QA_SPACE=0.1` :
job done, **300/300 placées**, 2 alternatives toutes deux physiquement
mesurées propres — grille : used 0,597, holes 150, **= serveur à
l'identique** ; moteur (left) : holes **200** (pinwheel plein),
`expandMeta: 200` (compteur V18 câblé — l'ancien delta valait 0), gap
0,0997. Vérification SVG brute (check_svg_dir) : 0 chevauchement,
0 doublon, min-dist 0,1000, 0 hors tôle, **VERDICT OK**. Captures dans
`.qa-pw/e2e-mono-s01/`.

## 3ter. Plan correctif n° 2 (vérification 2 du 04/09) — exécuté, commit 9913913

La seconde vérification (constats W1-W10 + exigence transverse §5 « le
nesting doit fonctionner pour toute pièce ») est traitée :

| Id | Traitement | Preuve |
|---|---|---|
| **W1** | ✅ receveuse : acceptation **count ≥ before ET front ≤ before+0,5** (générique §5.1, Py+JS) | banc 0,1 ×3 : 591/592/588 pièces, chute 608-611 (≥600 3/3 — l'ancienne acceptation front-seul donnait 583-586/580) |
| **W2** | ✅ donneuse : front de référence = état d'entrée, refus → restauration + `compactRollbackReason:'front'` | banc space 0 : chute 607 (moteur ≈606) — l'ancien code livrait 437 |
| **W3** | ✅ remplissage + receveuse FUSIONNÉS (candidates = receveuse détachées + DONNEUSE, avant compaction donneuse, validation de retour dédiée). MESURÉ à space 2 : receveuse AABB-pleine après remplissage moteur → lattice (67 %) ne peut pas battre le moteur → **saturation DÉMONTRÉE**, phase 4 confirmée | merged=0 à space 2 avec AABB bord ; 0,1 inchangé 591/608 |
| **W4** | ✅ containment JS rejeté aussi à space > 0 (`containedOverlap`) ; shapely rejetait déjà (d=0 par intersection) — test corrigé en conséquence | tests Py + JS |
| **W5** | ✅ T7 discriminant rétabli : 81 carrés 100, tôle 1000², séparation 0,1 → `len == 1` | cargo 71+1 |
| **W6** | ⚠️ résiduel documenté : 1 039 paires à 0,0990-0,0999 mm côté navigateur (anneaux bruts, dichotomie décimée D9) — spacingOk vrai (≥ space−0,01), serveur à 0,1000 | replay user |
| **W7** | ✅ 6,9 Mo d'artefacts retirés du git ; .gitignore + exception fixtures `out_user_*.json` (tests vitest) | `git show 9913913` |
| **W8** | ✅ retry_overshoot : budget 24 s (échec 1/3 sous charge CPU à 16 s) | cargo |
| **W9** | ✅ `Move::Restart` sans champ ; AGENTS #54 avant #55 | cargo sans warning |
| **W10** | ✅ avertissement UI « espacement < kerf laser (0,05 mm) » dans MainSettings, i18n FR/EN | capture e2e 01-preflight |

**§5 — corpus de torture** (`bench/seed_corpus.py` + `eval_corpus.py`,
commité) : 9 cas joués sur l'image HEAD, **9/9 OK** — T-A référence
(590/310, rb front = invariant actif), T-B 3 classes rectangles (80/80,
2 tôles), T-C L+U non convexes (60/60), T-D longues et fines 900×40
(330/330), T-E rotations 30° (460/460, D3 no-op tracé, résiduel 0), T-F
deux formats (90/90 : 29 sur la petite 1000² + 61 sur la grande 2000×1000
— coût ∝ surface), T-G quasi-pleine tôle (201/201), T-H classe unique
200×3 tôles (recuit vivant V2), T-I formes libres ESICUP-shapes (96/96 ;
repli rectangles si instance non parsée — noté). Aucun cas « pire que le
moteur » : l'invariant W1/W2/W3 est structurel (compte ET front, sinon
restauration tracée) et le corpus valide que les gardes tiennent sur des
géométries hors corpus de référence.

**Parité finale** (fixture régénérée) : moved JS = Python = 509 exact,
comptes par tôle identiques, AABB ≤ 2 mm, 400/1099 poses divergentes
(classe D9 documentée).

## 3quater. Plan correctif n° 3 (vérification 3 du 04/09) — exécuté, commit deb3e01

La troisième vérification (constats X1-X7) est traitée — dont
l'invalidation de ma propre conclusion « saturation démontrée » :

| Id | Traitement | Preuve (bancs avec `assert_images_head.sh` OK avant chaque) |
|---|---|---|
| **X1** | ✅ Validation de retour ne juge que contre les pièces MODIFIÉES (`changed_ids`/`include=`) ; non-posées de la receveuse → DONNEUSE ; `saved_poses` avant détachement (les maps sur deepcopies étaient du code mort) ; miroir JS | Banc space 2 : la passe fusionnée est désormais ACCEPTÉE quand elle gagne |
| **X2** | ✅ `merge_bp_runs` livre la meilleure solution PARTIELLE (jamais « infaisable » si un walk a posé) ; gardes Python comparées au posé MOTEUR ; `report.unplaced` + badge UI ; **T-F 3/3 done** (avant : 4/4 erreur produit) | 3 jobs bench-corpus-f `done`, physique propre, unplaced explicite |
| **X3** | ✅ `bench/assert_images_head.sh` créé (md5 conteneur ↔ HEAD pour workers + bundles wasm) — il a intercepté deux images périmées PENDANT ce chantier | sorties OK citées dans les bancs ci-dessous |
| **X4** | ✅ `postPass.pre = [{sheet, count, frontX}]` avant tout post-pass (Python + JS) ; `eval_corpus.py` filtre par horodatage, gain brut→final affiché, « pire que le moteur » mesuré | bancs ci-dessous : pre → final visibles |
| **X5** | ✅ `mergedRollbackReason` ∈ {restore-recv, restore-donor, count} | postPass des bancs |
| **C8** | ⚠️ Partiel : température PAR ITÉRATIONS calibrée par taille — T-F passe 3/3 done mais les comptes varient encore (28/61 vs 29/61) : la variance résiduelle vient du budget d'itérations estimé au temps mesuré | T-F 3 runs |
| **X6** | ⚠️ Résiduel documenté | — |
| **X7** | ✅ T-E 3 tôles, T-I tôles 2200 | corpus |

**Bancs finaux (HEAD vérifié)** :
- space 2 : **pre moteur [205, 295] → final [529, 371]**, merged 1
  accepté, physique 0/0/0 (un run antérieur à moteur brut plus dense :
  577 pièces tôle 1 — la passe gagne QUAND elle gagne, la variance
  inter-run reste, cf. C8) ;
- space 0,1 : **pre [265, 235] → final [589, 311]**, merged 1, physique
  OK, min-dist 0,1000.

**Ce que le rapport précédent disait faux** : la « saturation à space 2 »
était un artefact du seuil de validation de retour (X1) — le gain était
disponible et bloqué. Elle est retirée : la décision phase 4 (§4) se
prend sur les chiffres `pre → final` du corpus ci-dessus, mesurés.

## 3quinquies. Plan correctif n° 4 (vérification 4 du 04/09) — exécuté, commits 758badb + b5fb936

| Id | Traitement | Preuve |
|---|---|---|
| **Y1** | ✅ wasm moteur committé (schedule itérations + solution partielle) ; `assert_images_head.sh` compare au **CONTENU GIT DE HEAD** (`git show`), signale tout fichier suivi modifié, vérifie le bundle `nest_wasm.js` ; binaire moteur = avertissement de fraîcheur (le mtime de la couche cargo cachée ≠ contenu — faux positif corrigé) | `git status` propre ; script `ASSERT IMAGES=HEAD: OK` cité avant chaque banc |
| **Y2** | ✅ non-posées rendues sur la donneuse validées contre TOUTE la donneuse (l'ancien `changed_ids=set()` vidait l'occupancy : no-op prouvé) ; `validateReturn` exporté JS | `TestY2ReturnToDonorValidated` (fan à cheval sur la matière → rejet ; téléport receveuse→donneuse → jamais de chevauchement final) + miroir JS |
| **Y3** | ✅ `job.placed` = pièces réellement posées (somme des sheets) ; `report.unplaced` calculé côté JS | T-F ×3 : `placed 89`, `unplaced 1` |
| **Y4** | ✅ `postPass.pre` pris APRÈS expansion + hole-fill (miroir JS) | bancs : pre [531, 369] → final [577, 323] = gain du SEUL post-pass |
| **Y5** | ✅ suffixe d'index dans le slug du corpus | `bench-corpus-f-…-0/…` distincts |
| Y7 | ✅ eval_corpus filtre par défaut aux jobs à `pre` | — |

**Bancs GO (assert OK avant chaque)** :
- space 2 ×2 : **tôle 1 = 577 et 550 pièces** (81+496 / 80+470 fans),
  physique 0/0/0, `merged 1` — la cible 555 ± 3 est atteinte sur la
  moyenne (563,5), la variance inter-run C8 reste documentée (±14).
  Le gain `pre → final` est désormais PROPRE : pre [531, 369] (après
  expansion) → final [577, 323] = **+46 pièces dues au seul post-pass**.
- T-F ×3 (slugs distincts) : **3/3 `done`, `placed 89`, `unplaced 1`** —
  exact et identique sur les trois runs.

**Décision phase 4 (recommandation du vérificateur adoptée)** : PAS de
phase 4 maintenant. La passe fusionnée et la compaction donneuse restent
en filet conditionnel (sûres par l'invariant W1/W2/Y2) ; livrer après ce
plan n° 4 et réévaluer sur retours utilisateurs réels.

## 6. Partie 1 du plan 2026-09-05 (job infaisable dit non) — exécutée, commits a787657..3933451 + 5c…

Le constat des captures (900 Fillx4 + 100 Trou, 1×1000×2000, 4 mm :
« done » après 4 min, bande hors tôle, badges contradictoires) est
traité :

| Élément | Traitement | Preuve |
|---|---|---|
| Aire gonflée (Minkowski) | `core/capacity.py` + `capacityClient.js` (miroir) ; ratio du cas = **0,92** gonflé vs 0,58 nu | test_capacity 12 + capacityClient 7 |
| Refus 422 sans quota | `nest.post.js` avant la charge (polygonParts lus) + défense main.py/localPayloadBuilder | nest.capacity 3 |
| Choix SPP/BPP | sur aire GONFLÉE partout ; BPP livrera partiel propre au lieu d'une bande sans borne | suites |
| Dérogation constructive (garde #49) | instance qui tient par grilles bbox+space jamais refusée (8×8/tôle 12/space 2, ratio 0,99) | TestConstructiveOverride |
| Chemin navigateur hors tôle | **identifié** : le merge wasm n'appliquait pas le filtre strip_width ≤ max de run_spp_mem (pièges #6/#7) — verrouillé | cargo, determinism |
| `unfit` structuré | main.py (best_strip_width → sheetsNeeded) + local-fail persiste | code |
| Verdict unique UI | `activeVerdict` {valid, unfit, partial, unverified} ; bandeau rouge + 3 leviers + boutons ; gap négatif = « hors tôle de X mm » ; téléchargements bloqués ; carte « Ne tient pas » | i18n FR/EN |
| Refus navigateur rapide | throw capacity_exceeded AVANT le solve → **0 s + refund + phrase actionnable** (e2e : « These parts do not fit… refunded ») | .qa-pw/e2e-unfit-v3 |
| Corpus T-J/T-K | T-J = le cas captures (422 attendu via API ; semé direct Mongo → partiel propre 981/1000, unplaced 19, physique 0/0/0) ; T-K limite → 986/1000 partiel propre | eval_corpus |
| Décisions propriétaire | REFUSE_RATIO=0,88 / REFERENCE_PACKING=0,85 (documentés specs/20-moteur-nesting.md, local) ; partiel utile = quota consommé, échec explicite = refund | specs/20 |
| Non-régression | e2e 0,1 multi-tôle : 590/310, chute 603,7, physique OK (VERDICT OK) | .qa-pw/e2e-p1-regression |

pytest 198+1, vitest 422, cargo 71+1, determinism bit-identique.

**Partie 2 (alternatives Grille/Compaction homogènes) : NON lancée** —
livrée séparément après validation de la partie 1 par le vérificateur.

## 7. Étape 1 du plan de suite (réserves Z1-Z6 de la vérification partie 1) — exécutée, commits c878cd7 + 3327e55

Méthode : `assert_images_head.sh` OK contre HEAD (après chaque commit) ;
suites ; corpus T-A..T-K complet (semé direct) ; e2e navigateur refus 4 mm
(`QA_EXPECT=refusal`) et non-régression 0,1 ; relecture des diffs.

| Id | Traitement | Preuve |
|---|---|---|
| **Z1** leviers affichés + boutons | Bandeau `capacity-panel` sur la page projet (les 3 leviers chiffrés + « Ajouter une tôle » / « Réduire l'espacement » / « Relancer »), alimenté par le 422 API (`files.js nestUnfit`) ET le refus navigateur (`localSolverRegistry unfit`) ; modèle pur `utils/capacityPanel.js`. **Découverte corrélée** : les boutons du bandeau unfit du MODAL étaient morts depuis la partie 1 (emits `unfit-add-sheet`/`unfit-reduce-spacing` sans aucun écouteur) → branchés dans `UserResults.vue` (+ `defineEmits`). | e2e refus : levers `["About 2 sheets…", "About 925 parts max…", "About 2.12 mm…"]`, 3 boutons présents, clic add-sheet → count 1→2 + bandeau fermé ; vitest capacityPanel 5 |
| **Z2** refus worker | `main.py` : si `_cap["refused"]` → statut error + `information` + `unfit {reason:'capacity', ratio, sheetsNeeded, maxPartsAtSpacing, maxSpacingForFitMm}` AVANT tout appel moteur, exception → refund `worker_loop`. | pytest `test_refused_capacity_job_never_reaches_engine` (run_engine interdit, < 1 s, unfit complet) ; banc T-J semé : **processing 0,009 s**, `unfit {ratio 0,9184, 2 tôles, 924, 2,12}` |
| **Z3** partiel avec leviers | Serveur : `$set unfit {reason:'partial', unplaced, leviers}` sur le job done (main.py). Navigateur : `localJobPrivate` calcule les leviers (capacityClient sur le payload), les porte au record IndexedDB ET au `local-quota` (persisté assaini). Modal : bandeau ambre `report__partial` (« Imbrication partielle — n pièces non placées » + leviers + mêmes boutons). **Découverte corrélée** : `resultcontroller.js` ne mappait PAS `unfit` — le modal ne recevait jamais les leviers, même côté serveur ; mappé. | T-F : `unfit {partial, unplaced 1, ratio 0,912, 3 tôles, 83 pièces, 0,0 mm}` ; pytest/vitest verts |
| **Z4** borne rangées exacte | `floor(W/(w+s))` (conteneur déflaté de s/2, piège #49) + orientations 0° ET 90° essayées ; miroir JS identique. | tests py `W=19,w=8,s=2→1`, `100×30/pièce 25×8→10` (par l'orientation 90°), garde #49 (8×8/tôle 12) intact ; miroir vitest via refus/dérogation |
| **Z5** T-K vrai cas limite | T-K recalibré à **2,4 mm** (R ≈ 0,87) ; `eval_corpus` verdicts distincts `REFUS (attendu)` (T-J semé : status error + unfit capacity + placed 0) et `PARTIEL (attendu)` (T-F, T-K : physique propre + `unfit.reason=partial`) ; un partiel sur un cas complet reste ÉCHEC. | corpus ci-dessous : T-J REFUS, T-F PARTIEL, T-K OK |
| **Z6** e2e immédiat | Le runner attend en course `.content__error` OU `.stage__status` (plus de waitForSelector 60 s + attente fixe 15 s) ; profil `QA_EXPECT=refusal` avec assertions leviers/boutons/action. | détection du refus en **2,3 s** (75 s avant) |

**Bancs** (images = HEAD, `assert_images_head.sh` OK) :

- Corpus complet T-A..T-K : **11/11 OK** — T-A 900/900 physique 0/0/0
  gap 0,1 ; T-F **PARTIEL (attendu)** 89/90 + leviers serveur ; T-J
  **REFUS (attendu)** 0/1000 en 9 ms de traitement ; T-K (2,4 mm)
  **1000/1000 complet**, gap 2,4000, passe fusionnée acceptée
  (`mergedReceivers 1`, gain [13, −13]) ; les autres sans changement.
- e2e navigateur 0,1 (non-régression) : **590/310, chute tôle 2 603,7**,
  badges ✓/✓/✓, 900 placées ; contrôle shapely sur les SVG :
  **0 chevauchement, 0 hors tôle, VERDICT OK** (25 paires à 0,0990 =
  W6 connu).
- Suites : pytest **202 passés + 2 skipped** (3 erreurs de collection
  pré-existantes : `test_integration_holes` importe `core.geometry`,
  module supprimé au commit 220cf2f — tests périmés, non liés à ce lot) ;
  vitest **430** (dont +8 nouveaux capacité/panneau) ; cargo non touché.
- e2e refus 4 mm : capture `docs/qa/audit-multitoles-2026-09-03/
  verif8-0905-refus-leviers-boutons.png` (à copier) + `.qa-pw/e2e-verify8-refusal2`.

**Chasse du tour** (commit 3327e55) : le panneau capacité utilisait
`sizeType.s` sans que la page projet importe `sizeType` — au premier
rendu du bandeau, TypeError minifié « reading 's' » cassait le sous-arbre
de la page (carte failed SANS ligne d'erreur ni bandeau). Attrapé par le
NOUVEAU profil e2e refus (preuve qu'il protège), corrigé, image
reconstruite, e2e rejoué vert.

**Observation (pas une régression)** : T-A ce tour = brut moteur
[650, 250] (front tôle 2 = 403 mm) contre [262, 238] brut → 589/311
final chez le vérificateur — même total (900), même front tôle 2
(~400 mm → chute ~597-600), physique propre, post-pass no-op sur les
comptes. Le brut moteur diverge sous charge hôte (corpus + e2e + builds
en parallèle) : c'est la variance résiduelle Y6 (coupe au budget mur),
amplifiée, pas un effet du lot (aucun changement moteur/instance).

**NON-GO partiel assumé (Z3)** : pas d'e2e navigateur DÉDIÉ à une
solution partielle locale (pas de fixture partiel sous la main en
navigateur — T-F est serveur). Le chemin est implémenté des deux côtés,
unit-testé par morceaux (capacityPanelModel, local-quota persist), et le
jumeau serveur est prouvé sur T-F ; à rejouer si le vérificateur veut la
preuve navigateur.

## 8. Déploiement partie 1

**Déployé en production le 2026-09-04 ~21 h 30 UTC** (commits `c878cd7`,
`3327e55`, docs `ac97397`, pushed). Procédure Hetzner : workflow
« Build and publish Docker images » `completed success` sur `ac97397` ;
`df -h` AVANT pull (21 Go libres) ; `docker compose pull` ; **7/7
empreintes md5 des images publiées = HEAD** (residual/main/metrics/
holefill côté worker, nest_wasm_bg.wasm/nest_geometry_bg.wasm/
nest_wasm.js côté app) ; `up -d` ; app `200`, worker en polling.

Note CI : `app-ci` échoue en amont sur deux tests `latticeScallop` qui
timeout à 5 s sur le runner (7,5-8,3 s mesurés, pré-existant sur
`40a0d45`, verts localement) — sans lien avec ce lot ; timeouts explicites
à poser. *(Posés depuis : commit 1525601, 60 s.)*

## 9. Partie 2 du plan 2026-09-05 (alternatives « Grille » et « Compaction » homogènes) — exécutée, commits 23bb4aa, 170fffc, 24268c9, 4221ccc, 63145f3

Quatre étapes, une PR chacune, miroir Python ↔ JS partout :

| Étape | Traitement | Tests |
|---|---|---|
| **2a** profils du post-pass | `fill_residual_bands(..., profile='grid'\|'compact')` + miroir : `compact` = passe fusionnée + compaction donneuse SANS re-grille des hélices (pose moteur bit-conservée) ; `grid` = comportement historique ; `stats['profile']` exposé. Dé défaut `grid` → ce commit seul ne change RIEN | TestProfilesCompactGrid 3 (poses hôtes bit-identiques en compact) + miroir vitest ; residual 53 verts docker |
| **2b** constructeur grille multi-tôles | `core/structure_multi.py` (nouveau) + `structureMultiClient.js` : tôles 1..N−1 = grille pleine (hôtes au pas ancrés (s,s), orientation 0 — P-1 ; petites : trous pinwheel PUIS bandes `small_lattice`) ; tôle N = colonnes d'hôtes depuis −X + nichées + libres compactées derrière l'ancre (`_compact_last_sheet` re-grid, rollback ⇒ pas d'alternative) ; tout-ou-rien (stock insuffisant / motif non reconnu §5 / physique KO ⇒ None + erreur tracée) | test_structure_multi 9 (81 au pas, 81+19, dernière tôle au pas ± 0,5, physique par tôle, stock ⇒ None tracé, T-B ⇒ None silencieux, demande exacte) ; **parité chiffrée** vitest 5 contre fixture générée par le Python (2 → 81+458/19+342 ; 0,1 → 81+506/19+294) |
| **2c** branchement | Serveur : alternative grille BPP ajoutée après le solve (structural + self_contained → expansion/hole-fill/residual sautés, map-back standard), `postPass.profile='grid'` ; alternatives moteur → profil **compact**. Navigateur : miroir complet (`localJobPrivate` grille via wasm pinwheel, `localBridge` profil compact, frame finale = rang 0 après tri) | suites |
| **2d** UI | Sélecteur : « Option 1 · 2 tôles · 72,0 % used » ; chute réutilisable PAR TÔLE dans l'infobulle (scrap marqué) ; boutons du modal branchés (cf. §7 Z1) | e2e |

**Correctif mirore au passage (bloquant pour la parité)** :
`residualClient.validateBatch` flagait toute pièce posée DANS un trou
(containment W4 jugé contre l'anneau externe seul, alors que le Python
mesure sur `Polygon(outer, holes)`) — `ringInsideAHole` restaure le
miroir exact. Aucun flux existant ne validait de niche : latence nulle.

**Bancs (images = HEAD, `assert_images_head.sh` OK)** :

- Référence 100+800, 2×1000×1000, **deux espacements, DEUX alternatives
  chacune** :
  - space 2 : grille **[573, 327]** (front tôle 2 = 456 mm), moteur
    **[555, 345]** (= référence du 3 septembre, profil compact) ;
  - space 0,1 : grille **[587, 313]**, moteur **[589, 311]** (= référence).
- **Verrou grille** (`bench/check_p2_locks.py`, poses lues des SVG) :
  hôtes **[81, 19] ≡ pas w+s (± 0,5 mm) sur TOUTES les tôles**, aux trois
  espacements (0,1 / 2 / 2,4) — la grille est homogène, dernière tôle
  comprise (colonnes au même pas).
- **Verrou compaction** (`bench/check_p2_compact_lock.py`, brut moteur
  `pre-solve.json` vs SVG finaux navigateur) : **100/100 hôtes à la pose
  moteur bit-identique** dans l'alternative moteur finale (profil
  compact) — déplacées 0, nouvelles 0.
- **Jamais pire que le moteur** : les deux alternatives couvrent la
  demande complète (900/900, 1000/1000 T-K) ; physique mesurée propre
  (0 chevauchement / 0 hors tôle / min-dist = space exact sur les 4 SVG
  navigateur, shapely VERDICT OK ; badges rapport ✓/✓/✓ partout).
- **Corpus T-A..T-K complet : 12/12 OK** — T-J REFUS (attendu, 9 ms),
  T-F PARTIEL (attendu, leviers), **aucun cas hors T-A/T-K ne gagne
  d'alternative grille** (T-B..T-I moteur seul — généricité §5), aucun
  ne régresse.
- **e2e navigateur (space 2)** : sélecteur à deux onglets
  (« GRID · Option 1 · 2 sheets · 72,0 % » / « ← –X · Option 2 · 2 sheets
  · 74,9 % »), captures des deux tôles pour chacune
  (`.qa-pw/e2e-p2-space2c/06-alt{0,1}-sheet{1,2}.png`), **parité
  navigateur/serveur EXACTE sur les deux alternatives** (grille 573/327 =
  573/327, moteur 555/345 = 555/345, mesuré serveur à vide sur image
  HEAD). Le moteur navigue dans la variance Y6 sous charge (525↔577
  observés ce tour pendant des runs parallèles) ; la **grille est
  bit-déterministe** (573/327 identique sous charge, à vide, navigateur
  et serveur) — c'est précisément sa valeur produit.
- Suites : pytest **214 + 2s**, vitest **436** (37 fichiers), cargo non
  touché.

**Chasses du tour** (attrapées par les bancs, corrigées) :

1. **`geoPinwheelCapacity` renvoie `{rotations:[...]}`** (JSON Rust),
   jamais un tableau nu — `rots.length` sur l'objet = `undefined` → 0
   fan nichée silencieuse (e2e : `nested 0`, 632 libres). Déballage
   explicite + garde non-tableau.
2. **Scatter sans niche déborde sur les colonnes d'hôtes** — borne
   `min_x = bord droit du bloc hôtes + space` (miroir py/js) : mieux
   vaut pas d'alternative qu'une grille invalide.
3. `residual.py` passé en CRLF dans le répertoire de travail (écriture
   d'outil) : le build Docker copie le worktree → `assert_images_head`
   a intercepté l'écart md5 vs HEAD (autocrlf le réécrit à chaque
   checkout) — normalisé en binaire LF.
4. Outillage : `GridFS(db, collection=...)` prend le PRÉFIXE (pas
   `.files`), et les parenthèses littérales des transforms SVG doivent
   être échappées dans les regex des parseurs.

**NON-GO partiel assumé** : la parité moteur navigateur/serveur est
mesurée à vide (±0) mais PAS sous charge (variance Y6 : 525↔577 à space 2
— budget mur, pré-état différent) ; c'est le moteur, pas la partie 2 (la
grille, elle, est déterministe). Rien à corriger dans ce lot ; C8
(documenté) reste la piste si le vérificateur veut verrouiller.

**Non déployé** : release séparée conformément au plan — poussé sur
`main` (workflow images déclenché), le déploiement attend la validation
du vérificateur.

*(Suite)* **Vérification du 2026-09-05 9 h : partie 2 VALIDÉE** (verdict
en fin de plan — grille bit-identique serveur↔navigateur aux deux
espacements, hôtes au pas 0,00 mm, physique 8/8 sur anneaux bruts,
corpus 11/11, suites pytest 215+1 / vitest 436 / cargo 71+1) — **GO
déploiement**. Suggestions non bloquantes appliquées : `.gitattributes`
`*.py text eol=lf` (commit a2903f4, avec le verdict).

**DÉPLOYÉ EN PRODUCTION le 2026-09-05 ~9 h 15 UTC** (GO vérificateur) :
workflow « Build and publish Docker images » `completed success` sur
`a2903f4` ; `df -h` AVANT pull (20 Go libres) ; `docker compose pull` ;
**8/8 empreintes md5 des images publiées = HEAD** (residual/main/metrics/
holefill + structure_multi côté worker, nest_wasm_bg.wasm/
nest_geometry_bg.wasm/nest_wasm.js côté app) ; `up -d` ; app `200`,
worker en polling, tous conteneurs up.

## 4. Décisions demandées (§5 du plan correctif)

1. **Phase 4 (SPP à séparateurs)** : recommandée par la vérification « à
   mesurer après l'étape 3 » — mesure faite : la saturation space 2
   persiste dans le régime gardé (445-449 fans), l'alternative moteur
   la lève mais casse deux autres espacements. Un spike SPP à
   séparateurs adresserait les trois uniformément.
2. **C8** (température à l'horloge, ±2-4 pièces/run) : inchangé.
3. **V20/V21 résiduels** : micro-aires à space 0 (brut), tautologies
   tests restantes, fixtures replay commitées.

## 5. Non déployé

4 commits locaux (`f2b656a`, `f6d2e82`, `4639bf2`, docs) — la procédure
Hetzner (df -h, build CI « Build and publish Docker images », pull,
up -d) attend le GO du propriétaire.
