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
