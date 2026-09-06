# Plan d'exécution — nesting multi-tôles (BPP) — 2026-09-03

Plan destiné à un agent d'implémentation. Il découle de
[`AUDIT-NESTING-MULTITOLES-2026-09-03.md`](AUDIT-NESTING-MULTITOLES-2026-09-03.md)
(les identifiants C*/A*/P*/D*/U* renvoient à ses tableaux). Lis l'audit en
entier, puis la section « Pièges » d'AGENTS.md (surtout #3, #6, #14g, #33b,
#46, #48, #51-#56) avant de toucher au code.

## Règles du chantier

- **Une phase = une PR (ou un commit atomique par étape numérotée)**, en
  français, conventional commits (`fix(nesting): …`), jamais de `git add -A`
  (il y a du travail non commité d'autrui : `AGENTS.md`, `app/tests/
  replayUserBpp.test.js`, `bench/`, `spike/`, `scripts/*` — ne les commite pas
  sans qu'ils fassent partie de ton étape).
- **Commence par committer l'état actuel des « poches BPP » du 02/09**
  (`residual.py`, `structure.py`, `residualClient.js`, leurs tests,
  `AGENTS.md`) tel quel, en une PR `feat(nesting): poches des colonnes
  partielles + retry dégradé (livraison 2026-09-02)` — le banc de cet audit a
  été mesuré sur cet état, il sert de référence. Tout ce qui suit part de là.
- **Miroir Python ↔ JS obligatoire** pour tout changement de post-pass
  (`residual.py` ↔ `residualClient.js`, `holefill.py` ↔ `localBridge.js`,
  `structure.py` ↔ `structureClient.js`, `metrics.py` ↔ `nest-report`). Une
  étape n'est terminée que quand les deux côtés ont le test.
- **Tout changement moteur = rebuild wasm dans la même PR** (`workers/nesting/
  engine/build-wasm.sh`, piège #33b) + rejeu `bench/determinism_lock.py` + vider
  le cache navigateur avant de conclure (#14i).
- **Validation = banc chiffré, jamais l'œil.** Chaque étape liste ses
  critères. La physique (0 chevauchement, 0 hors tôle, 0 pose dupliquée,
  min-dist ≥ space − 1e-4, 4 fans/trou) est **bloquante** : un gain de chute au
  prix d'un chevauchement = NO-GO.
- Le dossier Docker local est la référence de test : les conteneurs exécutent
  l'image `nest2d-nesting-worker:dev` **sans volume** — après tout changement
  Python/Rust : `docker compose build nesting-worker && docker compose up -d
  nesting-worker` ; après tout changement app/JS : `docker compose build app &&
  docker compose up -d app`.

## Commandes de banc (à copier)

```bash
# Serveur : seed + attente + physique (image = copie de travail)
docker run --rm -i --network nestorcut_nest2d -e MONGO_URI=mongodb://mongo:27017/nest2d \
  -e BENCH_SPACE=0.1 -e BENCH_BUDGET=120 nest2d-nesting-worker:dev python - < workers/nesting/bench/seed_bpp_2sheets.py
# → JOB bench-bpp2s-1-<ts> ; attendre status done (mongosh) puis :
docker run --rm -i --network nestorcut_nest2d -e MONGO_URI=mongodb://mongo:27017/nest2d \
  -e SPACE=0.1 -e SHEET_W=1000 -e SHEET_H=1000 nest2d-nesting-worker:dev python - <slug> < workers/nesting/bench/check_physical.py

# Navigateur : e2e Playwright complet (login guillaume@local.dev, projet THIS DEVICE, 100+800, 2×1000×1000)
QA_OUT=.qa-pw/e2e-2sheets QA_SPACE=0.1 node scripts/qa-e2e-local-2sheets.mjs
# → SVG par tôle + full.json dans QA_OUT ; physique générique (serveur OU navigateur) :
docker run --rm -d --name audit-svg --network nestorcut_nest2d --entrypoint sleep nest2d-nesting-worker:dev 3600
docker cp .qa-pw/e2e-2sheets audit-svg:/tmp/b && docker cp workers/nesting/bench/check_svg_dir.py audit-svg:/tmp/
docker exec audit-svg python /tmp/check_svg_dir.py /tmp/b 0.1 1000 1000      # MSYS_NO_PATHCONV=1 sous Git Bash

# Tests
cd workers/nesting && python -m pytest tests/ -q --ignore=tests/test_integration_holes.py   # (dans l'image : docker exec)
npx vitest run
cd workers/nesting/engine && cargo test --release -p nest-engine
```

Référence chiffrée de départ (copie de travail du 03/09, space 0,1 / 2) :
serveur 589+311 / 555+345 pièces, used 0,694 / 0,727, chute tôle 2 580×1000 /
522×1000 ; navigateur 591+309 / 558+342, used 0,695 / 0,727. Physique OK partout.

---

## Phase 0 — Rendre les bugs visibles (filet + vue live) — ½ à 1 jour

Sans cette phase, aucune autre ne peut être validée autrement qu'à l'œil.

### 0.1 Vérification physique sans plafond (A3 / D12)
- `workers/nesting/core/metrics.py::verify_layout` : remplacer la double boucle
  par un `STRtree` (requête `buffer(space + 1)`), supprimer
  `VERIFY_MAX_PARTS_PER_SHEET` (ou le monter à 5 000) ; ajouter au rapport
  `duplicatePoses` (paires à distance 0 ET aire d'intersection > 99 % de la
  plus petite) et `verifyStatus: 'measured' | 'skipped'`. Tolérance
  `insideSheet` ±1e-6 (A15).
- Miroir Rust `workers/geometry/crates/nest-report/src/lib.rs:303` : broadphase
  bbox + même plafond + mêmes champs ; rebuild wasm géométrie.
- `app/components/ResultModal.vue:709-714` : afficher un badge « non vérifié »
  quand `verifyStatus === 'skipped'`, badge rouge sur `duplicatePoses > 0`.
- Tests : `test_metrics.py::TestVerifyLayoutLargeSheets` (600 pièces →
  champs non `None`, doublon injecté détecté, < 1 s) ; vitest équivalent sur
  `nest-report` via le worker géométrie.

### 0.2 Garde anti-perte par classe + rejet des doublons (A4 / D13)
- `main.py::_finalize_alternative` : compte **par `item_id`** vs `count` ;
  si `verification.overlapFree === False` ou `duplicatePoses > 0` → l'alternative
  est **écartée** (log erreur + compteur) sauf variable d'env
  `NEST_ALLOW_INVALID_ALTS=1` (debug).
- `app/composables/localJobPrivate.js:509-511` : même garde sur les
  alternatives moteur (pas seulement structurelle).
- Tests : `TestFinalizeGuardPerClass` (doublon + perte compensée → rejetée) ;
  vitest `localJobPrivate` idem.

### 0.3 Observabilité des post-pass (A5 / D6 / inventaire des catch)
- Champ additif `report.postPass = { expandMeta, holeFillRecovered,
  residualMoved, residualRounds, compactRollback: bool, errors: [{stage,
  message}] }` alimenté par `main.py` (Python) et `localBridge.js` (JS).
  `moved` ne compte que les transformations réellement modifiées (D16).
- `residualClient.js:567-572` : `catch (e) { if (e !== COMPACT_ROLLBACK) throw e; … }`.
- `console.error` + `errors[]` dans chaque catch de finalisation listé à
  l'audit §6 (`localBridge.js:332, 766, 869, 1005`, `localJobPrivate.js:550,
  570`, `engine.worker.js:77`).
- Affichage compact dans le modal (une ligne « post-pass : n déplacées ·
  rollback » sous les badges).
- Tests : injection d'exception en compaction JS → propagation + `errors[]` ;
  Python : `report.postPass.compactRollback` vrai sur la fixture H1.

### 0.4 Vue live BPP cohérente (D1 / D2 / U2)
- `app/utils/liveJob.js:80-81` : `return ar > br` (remnant plus grand = mieux) ;
  corriger `liveJob.test.js:80-83` et ajouter « remnant 0,6 bat 0,4 ».
- `frameIsBetter` : une frame `stage ∈ {final, reveal}` bat toute frame live à
  tôles égales (ou reset des champions quand `stage === 'final'`).
- Vérifier que `localJobPrivate.js::buildLiveLayout` émet la frame **post-pass**
  (après `buildAlternativeArtifacts`) et que `_alt_to_live` côté Python reste
  le reveal des alternatives finales.
- Test d'intégration `LiveNestingView` : après `localReveal`, `best` est la
  frame finale ; capture e2e `03-stage-final.png` ≡ modal.

**GO phase 0** : sur le run de référence, le modal affiche des badges mesurés
(min-dist 0,0996/0,1000, 0 chevauchement), le panneau live final = résultat
post-passé, `report.postPass` présent des deux côtés.

---

## Phase 1 — Correctifs bloquants des post-pass (Python + JS) — 1 à 2 jours

### 1.1 Validation à space 0 (A1) et seuil JS (D5)
- `residual.py::_validate_batch` : `d = poly.distance(other)` ;
  `if d < max(space − _EPS, 0) or (d == 0 and poly.intersection(other).area >
  OVERLAP_EPS)` → False. Décision propriétaire §8.1 : contact permis.
- `residualClient.js:203` : `lim = space − EPS` (mêmes anneaux simplifiés que
  Python), plus test explicite du chevauchement à `d == 0`.
- Tests : `TestSpace0Validation` (pose identique → False ; chevauchement
  partiel → False ; contact exact → True ; pipeline 2 tôles à space 0 → 0 pose
  dupliquée, 0 paire d'aire > 0,01) ; vitest « paire à 0,03 à space 0,1
  rejetée », « paire à 1,95 à space 2 rejetée », « space 0 : 0 doublon ».

### 1.2 Rollback de compaction sûr (A2 / A6)
- `_compact_last_sheet` (et `compactLastSheet`) : snapshot complet **avant**
  `_regrid_helices` ; libres détachées **avant** le re-grid ; en fin de phase 2,
  restauration des libres non replacées validée contre l'état complet ; sur
  échec : restauration du snapshot complet, `moved = 0`,
  `postPass.compactRollback = true`. Ne jamais retourner `moved > 0` après
  rollback.
- Tests : `TestH1CompactRollbackRestoresFullState` (fixture de l'audit :
  19 hôtes à droite + pièce 700×500 rotation `[0]` + 120 fans → 0
  chevauchement ; si rollback, hôtes à leur pose d'origine) ;
  `TestCompactValidatedAgainstFrees` ; vitest miroir avec parité `moved`.

### 1.3 Rotations non quart de tour côté JS (D3) et rotations du payload (D4)
- Court terme : garde en tête de `fillResidualBands`/`applyHoleFill`/
  `buildGridAlternative` (JS) et de `fill_residual_bands` (Python, pour
  `_rotated_bbox`) : si une rotation placée ou permise n'est pas ≡ 0 mod 90 →
  no-op + `postPass.errors.push({stage, message: 'rotations non quart de tour'})`.
- Moyen terme : `placedRing`/`rotatedBbox` JS en cos/sin exact.
- `main.py` payload local + `localPayloadBuilder.js` : ajouter `rotations` à
  chaque `part` ; `residualClient.js::partRotations` ne consulte plus
  `instance.items`.
- Tests : fixture `rotations [0,45,…]` → no-op des deux côtés ; `partRotations`
  avec `idMap` non identité.

### 1.4 Poche clippée et lattice tourné ancré à gauche (P1 / P2)
- `_regrid_helices` : `pocket[3] = top des colonnes pleines` (pas `sh − space`)
  — la bande haute reste une bande classique pleine largeur, remplie en
  gravité −X avant la bande droite.
- `structure.py::_lattice_rotated` (+ `structureClient.js::latticeRotated`) :
  après génération, translation rigide du bloc de `−(min_x − x0)` quand
  `axis == 'x'` (et `−(min_y − y0)` pour `axis == 'y'`) ; tie-break du score
  `(n, −far, −near)`.
- Corriger D10 (`cap=None` pour la famille tournée côté Python) et D14
  (regroupement des colonnes par tolérance 1e-6).
- Tests : T-poche « la bande haute x∈[0,200]×y∈[900,1000] reçoit des fans » ;
  T-lattice « bande étroite 99×900 : min_x des poses = x0 + ε » ; parité JS.

### 1.5 Divers post-pass
- A7 : filtrage individuel des poses du batch avec un STRtree construit une
  fois par appel (plus de `take //= 2` aveugle) ; D8 : broadphase bbox dans
  `validateBatch`.
- A10 : `cost = len(layouts)` après retrait des layouts vides.
- A11 : `free.remove` par identité dans `holefill.py`.
- A13 : re-lancer `apply_hole_fill` après `fill_residual_bands` (les deux côtés).
- D7 : `fillHoles`/`hasHoles` dans `localPayload`, gate JS = `hasHoles`.
- D11 : centroïde d'aire partout en JS ; D15 : constante unique pour le contact.
- A16 : fixtures T10/T12 légales, assertion sur toutes les paires.

### 1.6 Verrous de parité et de régression
- `TestPipelineTwoSheetsPhysical` paramétré `space ∈ {0, 0.1, 1, 2}` :
  `expand_meta → apply_hole_fill → fill_residual_bands`, 0 chevauchement, 0
  doublon, bornes ±1e-6, compte par classe invariant, `holesOverflow == 0`,
  < 10 s.
- Test de parité chiffrée Python ↔ JS sur la fixture user : étendre
  `bench/audit_replay_user.py` pour dumper `out_user_layouts_post_py.json` ;
  vitest (`skipIf` absent) comparant par tôle `placed_items.length`,
  `layoutAabb` à 1e-6, ensemble `(item_id, rot, tx, ty)` à 1e-6, `moved`.
  Toute différence résiduelle = D9 à quantifier (dichotomie décimée).
- Réécrire `app/tests/replayUserBpp.test.js` : appeler `expandMeta` (meta 1+1),
  seuils `space − 1e-6`, hors tôle ±1e-6, doublons = 0, 4 fans/trou,
  idempotence bit-identique au 2ᵉ appel.

**GO phase 1** : suites vertes ; banc serveur et navigateur à space 0 / 0,1 / 2
physiquement OK ; sur le run de référence 0,1 : front tôle 2 ≤ 400 mm
(P1+P2, aujourd'hui 419,6), tôle 1 ≥ 530 fans (aujourd'hui 508-510) ; parité
JS/Python chiffrée à 1e-6 ou écart documenté.

---

## Phase 2 — Moteur : corriger la cause racine — 2 à 4 jours

Toutes les étapes : `cargo test --release -p nest-engine`, rebuild wasm,
`determinism_lock.py`, banc serveur + navigateur.

### 2.1 Décision de tôle par tôle (C1 / C2)
- `bpp/constructive.rs::construct` : pour chaque item, chercher dans les
  layouts ouverts **dans l'ordre d'ouverture** ; règle lexicographique :
  (1) première tôle offrant une pose à `growth == 0` (trou/poche) ; (2) sinon
  première tôle qui admet l'item (first-fit) ; la perte (`growth × steer +
  bottom_left`) ne départage que les poses **d'une même tôle**.
- `steer` sur le Δ d'extent `(merged.x_max − used.x_max)/bin_w`.
- Tests T2 (`constructive_fills_first_sheet_bands_before_growing_second` :
  81 carrés + fans, 2 tôles → tôle 1 reçoit ≥ k fans en bandes) et T3
  (`dir_bias_steer_is_per_sheet`).
- Critère banc : rejeu payload user → tôle 1 ≥ 81 hôtes + ≥ 150 fans **avant
  tout post-pass** (aujourd'hui 8) ; used final ≤ 0,68.

### 2.2 Pas final de descente absolu (C6)
- sparrow `sample/coord_descent.rs` / `consts.rs` : borne finale
  `min(0,001 × min_dim, 0,01 mm)` (paramétrable dans `SampleConfig`) ; ou passe
  de compaction par tôle après le constructif (miroir BPP de `gravity.rs`).
- Test T7 `hosts_pack_9x9_at_space_0_1` (81 carrés 100×100, tôle 1000×1000,
  space 0,1 → 1 layout). Critère banc : 81 hôtes sur la tôle 1 en navigateur
  (aujourd'hui 80).

### 2.3 Recuit utile (C3 / C4 / C7)
- Moves *type-aware* : tirer deux positions d'ids **différents** ; représenter
  la séquence en blocs `(id, run_len)` pour les instances à forte multiplicité.
- rng d'évaluation dérivé de `(seed, hash(seq))` → `construct` déterministe
  par séquence (le SA compare des séquences, pas du bruit).
- `cost_of` : `(unplaced, bin_cost, −max_remnant, −Σ fill²)`.
- Plateau : `MIN_ITERS_BEFORE_PLATEAU` remplacé par un minimum en temps
  (`max(3 s, 20 × durée moyenne d'itération)`) borné par le budget.
- Tests T4 (`sa_moves_change_sequence` ≥ 95 %), `construct_is_deterministic_per_sequence`,
  T5 (`cost_prefers_concentrated_remnant`).
- Critère banc : sur le payload user, ≥ 1 amélioration après la 1ʳᵉ seconde ;
  `iterations` > 200 dans le rapport à budget 120 s.

### 2.4 Robustesse moteur (C5 / C10 / C11 / C12 / C13)
- C5 : ouverture du bin = `min(cost, loss)` sur tous les types avec stock
  (test T6) — **bloquant si le produit expose deux formats** (question §8.4).
- C10 : validation du warm-start (ids < n, multiplicités) — test T9.
- C11 : throttle 500 ms des frames live BPP — test T11.
- C12 : `bins` = nombre de tôles + `bin_cost` séparé (adapter `liveJob.js`,
  `main.py` live).
- C13 : filtrer/renuméroter les tôles `count: 0` dans `nesting_input_builder.py`
  et `localPayloadBuilder.js` avec map-back de `container_id` — test T10.
- T1 `bpp_bin_index_stable_live_cost_export` (verrou de l'identité des bins).
- T12 `physical_min_distance_ge_space` (verrou permanent f32).

**GO phase 2** : banc de référence space 0,1 : used ≤ 0,66, chute tôle 2 ≥
640×1000 (aujourd'hui 580), physique OK ; navigateur = serveur à ±1 pièce par
tôle ; `determinism_lock.py` vert ; démo et suites ESICUP (`benchmarks/
test_benchmarks.py -m slow`) sans régression de densité > 0,5 pt.

---

## Phase 3 — Simplifier : retirer des post-pass sous verrous — 1 à 2 jours

À faire **seulement** après GO phase 2, en mesurant à chaque retrait.

1. Rendre `_compact_last_sheet` **conditionnelle** : ne s'exécute que si la
   donneuse a un front dentelé mesuré (ex. `AABB.maxx − x_front_médian > 2 ×
   largeur de la petite pièce`) ; sinon no-op. Banc : chute identique à ±5 mm.
2. Si 2.1 fait son travail, `fill_residual_bands` inter-tôles devient un filet
   (mesurer `residualMoved` : s'il est ≈ 0 sur 10 seeds, le garder mais le
   sortir du chemin critique du navigateur — Web Worker, D8).
3. Unifier les seuils (A14/D5) : une constante partagée `POSTPASS_MIN_DIST =
   space − ε` sur anneaux simplifiés, documentée dans AGENTS.md.
4. Mettre à jour AGENTS.md : pièges #57 (space 0 → seuil planché des DEUX
   côtés), #58 (snapshot AVANT toute mutation d'un post-pass multi-phases),
   #59 (remnant : plus grand = mieux, partout), #60 (la vérification ne doit
   jamais être « skipped » silencieusement), #61 (rotations non quart de tour
   : garde JS), et corriger #51 (cause racine C1/C2 réglée, le post-pass est un
   filet).

## Phase 4 (optionnelle, spike 1 jour) — multi-tôles = une bande SPP avec séparateurs

Idée à évaluer si la phase 2 ne suffit pas ou si le coût de maintenance des
post-pass reste trop élevé : pour N tôles du même format W×H, résoudre **un
seul SPP** sparrow de hauteur H et largeur max N×W + (N−1)×g, avec des zones
interdites (`ExtContainer.zones`, qualité 0, largeur g ≥ 2×space) aux
abscisses k×(W+g). Le SPP minimise la largeur totale → remplit les tôles
1..N−1 au plus dense et laisse la chute sur la dernière, sans aucun post-pass
de bandes ; découpe des layouts par plage d'x au retour. Points à vérifier au
spike : support des zones par sparrow (hazards `InferiorQualityZone`), piège #6
(pas de borne dure → validation), map-back des frames live, pré-passe trous
inchangée, temps sur 900 pièces. Livrable : `spike/spp_separators/` + note
chiffrée vs phase 2 ; décision propriétaire avant toute intégration.

## Ordre d'exécution résumé

1. PR « livraison poches 02/09 » (état actuel) → référence banc.
2. Phase 0 (filet + live) — GO 0.
3. Phase 1 (A1, A2/A6, D3/D4, P1/P2, divers, parité) — GO 1.
4. Phase 2 (C1/C2 → C6 → C3/C4/C7 → robustesse) — GO 2, une PR par étape.
5. Phase 3 (retraits, AGENTS.md).
6. Phase 4 si décidée.

## Estimation

| Phase | Dev | Banc/QA |
|---|---|---|
| 0 | 0,5 j | 0,5 j |
| 1 | 1,5 j | 0,5 j |
| 2 | 3 j | 1 j |
| 3 | 1 j | 0,5 j |
| 4 (spike) | 1 j | — |
