# Plan d'implémentation — (1) job infaisable dit clairement, (2) alternatives « grille » et « compaction » homogènes en multi-tôles — 2026-09-05

Plan destiné à un agent d'implémentation. Contexte : chantier multi-tôles
clos par [`PLAN-CORRECTIF-4-NESTING-MULTITOLES-2026-09-04.md`](PLAN-CORRECTIF-4-NESTING-MULTITOLES-2026-09-04.md) §5
(livrable). Règles inchangées : une PR par étape, miroir Python ↔ JS
obligatoire, `bench/assert_images_head.sh` OK contre HEAD avant tout banc
rapporté, physique bloquante (0 chevauchement, 0 hors tôle, 0 doublon),
critères d'acceptation génériques (jamais « nombre de fans »), corpus de
torture rejoué (`bench/seed_corpus.py` + `eval_corpus.py`).

---

## Partie 1 — Un job qui ne tient pas doit le dire, vite et clairement

### 1.0 Constat (captures propriétaire, THIS DEVICE)

900 Fillx4 + 100 Piece_Trou, **1 tôle 1000×2000, espacement 4 mm**, −X.
Résultat livré `done` après ~4 min : « 99,6 % used », pièces au-delà du
bord droit de la tôle (vue DXF), badges **contradictoires** : « Overlap-free
✓ », « Inside sheet ✗ », « Gap ≥ −4,01 mm ✗ », « All 1000 parts placed ✓ »,
téléchargement possible. Densité matière 58,4 %.

Diagnostic (code) :

1. **Le choix SPP et le test « tout tient sur une tôle » ignorent
   l'espacement.** `main.py:776-779` / `localPayloadBuilder.js:660-662` :
   `total_outer_area ≤ 0,80 × aire tôle` avec l'aire **nue**. À 4 mm,
   chaque pièce occupe en réalité son aire gonflée de `space/2` de chaque
   côté (Minkowski : `A + P·s/2 + π·s²/4`) : une fan 40×28 (615 mm²,
   périmètre ≈ 130) passe à ≈ 615 + 260 + 12,6 ≈ 890 mm² (+45 %) ; un hôte
   100×100 à 10 816 (+8 %). Aire gonflée totale ≈ 900×890 + 100×10 816 ≈
   1,88 m² pour 2 m² de tôle : **ratio ≈ 0,94**, infaisable en pratique
   (pas d'empilement à 100 %), alors que le test nu voit 0,58.
2. **sparrow n'a pas de borne dure** (piège #6) : il livre une bande plus
   large que la tôle. Le chemin serveur multi-walks émet `error infeasible`
   quand aucun walk ne tient (`spp.rs:640-655`) ; le chemin **navigateur**
   (mono-walk, merge wasm) a livré la solution hors tôle comme valide — le
   chemin exact qui laisse passer est à identifier (§1.2.b).
3. **Le rapport n'a pas de verdict global** : les badges sont indépendants,
   « All parts placed » compare `placed` à `requested` sans regarder
   `insideSheet`, et `smallestGapMm` négatif (pièce hors tôle) est affiché
   comme un espacement.
4. **Rien ne s'arrête tôt** : 4 min de recuit pour une instance dont
   l'infaisabilité est calculable en quelques millisecondes.

### 1.1 Objectif

Un job infaisable est refusé **avant** le calcul quand c'est calculable,
arrêté **tôt** sinon, et dans tous les cas livré comme **échec explicite et
actionnable** : « Ne tient pas sur 1 tôle 1000×2000 à 4 mm : il faudrait
≈ 2 tôles, ou ≤ 640 pièces, ou un espacement ≤ 2,5 mm », quota refondu,
aucun badge vert, aucun téléchargement de layout invalide.

### 1.2 Implémentation

**a) Pré-contrôle de capacité avec espacement** — `workers/nesting/core/
capacity.py` (nouveau) + miroir `app/composables/capacityClient.js` +
appel dans `server/api/project/[slug]/nest.post.js` (refus 422 immédiat,
sans consommer de quota) et dans `main.py` / `localPayloadBuilder.js`
(défense en profondeur).

- Aire gonflée par pièce : `A + P·s/2 + π·s²/4` (anneau externe, sur
  coords simplifiées) ; aire tôle utile : `(W − s)·(H − s)` (jagua déflate
  le conteneur de `s/2`, piège #49).
- Ratio `R = Σ aire_gonflée × count / Σ aire_utile × stock`.
- Seuils (constantes documentées, calibrées sur le corpus) :
  `R > 1,0` → **infaisable certain** ; `0,88 < R ≤ 1,0` → **très probablement
  infaisable** (le meilleur taux d'empilement mesuré sur le corpus est
  0,81-0,87) : refus avec message « à la limite » et proposition ;
  `R ≤ 0,88` → on lance.
- Bornes complémentaires : pièce qui ne tient dans aucune tôle (existant
  `part_fits_any_sheet`) ; borne « rangées » pour les pièces rectangulaires
  dominantes (`floor((W+s)/(w+s)) × floor((H+s)/(h+s))` par orientation).
- Sortie : `{ratio, sheetsNeeded: ceil(R×stock/0,85), maxPartsAtSpacing:
  floor(count × 0,85/R) (par classe, proportionnel), maxSpacingForFit:
  résolution de R(s) = 0,85 par dichotomie}` — les trois leviers de la
  phrase utilisateur.
- **Choix SPP/BPP** : `SPP_MAX_AREA_RATIO` s'applique désormais à l'aire
  **gonflée** (`R_1tôle ≤ 0,80`), sinon BPP même avec stock 1 → le BPP
  livre alors une solution partielle avec `unplaced` explicite (X2) plutôt
  qu'une bande hors tôle.

**b) Arrêt tôt et verdict moteur** — `spp.rs`, `localPool.js`, `main.py`.

- Identifier le chemin navigateur qui a exporté une bande > tôle : soit le
  merge wasm (piège #7 : « peut rendre un layout plus large que le live »),
  soit la phase 2 sans `fitsSheet`, soit `n_workers = 1` sans le filtre
  `feasible1`. Verrou : test wasm « tous les walks > max_width ⇒ erreur
  infeasible », jamais une alternative.
- Plafond de temps quand la largeur reste > `max_width × 1,05` après le
  premier plateau : `error infeasible` avec `best_strip_width` (déjà émis
  côté serveur) — le worker/local convertit en `sheetsNeeded =
  ceil(best_strip_width / W)`.
- `main.py` : sur `EngineError infeasible` → `status: error` avec
  `information` humaine ET un champ structuré additif
  `unfit: {reason: 'strip'|'capacity'|'partial', ratio, sheetsNeeded,
  maxPartsAtSpacing, maxSpacingForFit, bestStripWidthMm}` ; local →
  `local-fail` avec le même `unfit` (refund).

**c) Verdict unique dans l'UI** — `ResultModal.vue`, `UserResultItem.vue`,
`i18n.js`.

- Un état `verdict ∈ {valid, unfit, partial, unverified}` calculé depuis
  le rapport : `insideSheet === false` ou `overlapFree === false` ou
  `duplicatePoses > 0` ⇒ `unfit` ; `unplaced > 0` ⇒ `partial`.
- `unfit` : bandeau rouge en tête du modal « Ce résultat n'est pas
  découpable : N pièces dépassent la tôle de X mm » + les trois leviers
  (`sheetsNeeded`, `maxPartsAtSpacing`, `maxSpacingForFit`) avec boutons
  « Ajouter une tôle » (incrémente `count`), « Réduire l'espacement »
  (préremplit `maxSpacingForFit`), « Relancer ». Badge « All parts placed »
  **jamais vert** si `unfit` ; téléchargements désactivés (ou DXF avec
  calque `NESTING_INVALID`).
- Gap négatif : libellé « pièces hors tôle de 4,0 mm », pas « Gap ≥ −4 ».
- Carte résultat : « Ne tient pas » en rouge, pas « Results · 1 sheet ».

**d) Ne pas calculer pour rien** — quand le pré-contrôle refuse, aucun job
n'est créé (422) ; quand il est « à la limite », le job part en BPP avec
un budget plafonné (`min(budget, 60 s)`) et livre partiel + `unfit.partial`.

### 1.3 Tests et banc

- `tests/test_capacity.py` : ratio gonflé (fan 4 mm → +45 %), seuils,
  `sheetsNeeded`/`maxPartsAtSpacing`/`maxSpacingForFit` sur le cas des
  captures (attendu : ≈ 2 tôles, ≈ 600-650 pièces, ≈ 2,5 mm) ; miroir
  vitest `capacityClient` avec parité chiffrée à 1e-9.
- `server/tests/nest.capacity.test.js` : 422 immédiat, quota intact.
- Cargo/wasm : « tous les walks hors largeur ⇒ infeasible » (natif + wasm).
- e2e navigateur (`scripts/qa-e2e-local-2sheets.mjs`, nouveau profil
  `QA_SPACE=4 QA_SHEET_COUNT=1 QA_SHEET_H=2000`) : refus en < 10 s, bandeau
  rouge, boutons présents, aucun téléchargement actif, `local-fail`
  appelé (quota refondu).
- Corpus : cas **T-J** « infaisable par espacement » (le cas des captures)
  et **T-K** « à la limite » (R ≈ 0,9) → partiel avec `unplaced` et verdict
  `partial`.
- GO : le cas des captures ne consomme plus 4 min ni de quota, et affiche
  la phrase actionnable des deux côtés.

---

## Partie 2 — Deux alternatives homogènes en multi-tôles : « Grille » et « Compaction »

### 2.0 Constat

En mono-tôle, l'utilisateur a deux propositions : la grille canonique
(stratégie `grid`) et le résultat moteur compact. En multi-tôles il n'en a
qu'une, **hybride** : tôle 1 = moteur compact (hôtes en grille, fans
moteur/lattice dans les bandes), tôle 2 = re-grillée par la compaction
donneuse (colonnes d'hôtes depuis −X, fans en lattice derrière). Le mélange
vient de l'histoire du chantier : la compaction de la dernière tôle a été
ajoutée au résultat moteur au lieu de constituer une alternative.

### 2.1 Objectif

Pour un job BPP à N tôles : **deux alternatives, chacune homogène sur
toutes ses tôles**, présentées comme en mono-tôle :

- **Grille** (`strategy: 'grid'`) : tôles 1..N−1 = grille canonique pleine
  (hôtes au pas `w + s`, petites pièces dans les trous puis en lattice dans
  les bandes), tôle N = colonnes d'hôtes depuis le bord −X + lattice des
  petites pièces derrière (chute rectangulaire propre). Même style partout.
- **Compaction** (`strategy: 'left'` / `'bottom'` / `'balanced'` selon les
  directions) : résultat moteur + remplissage des trous + remplissage
  inter-tôles, **sans re-grille des hôtes** sur aucune tôle ; la dernière
  tôle garde la disposition moteur (compacte, dentelée si le moteur l'est).
  Même style partout.

L'invariant « jamais pire que le moteur » reste vrai pour chacune (compte
par tôle, physique) ; l'alternative grille peut être **absente** si la
grille exige plus de tôles que le stock (comme en mono quand elle sort de
la tolérance).

### 2.2 Implémentation

**a) Séparer les deux profils de post-pass** — `residual.py`,
`residualClient.js` : `fill_residual_bands(..., profile='compact'|'grid')`.
`compact` = passe fusionnée + compaction donneuse **sans** `_regrid_helices`
(libres seulement, derrière l'ancre moteur, acceptation front) ; `grid` =
voir b). Le profil est porté par l'alternative (`engine_alt['profile']`) et
exposé dans `report.postPass.profile`.

**b) Constructeur de grille multi-tôles** — `core/structure_multi.py`
(nouveau, réutilise `small_lattice`, `_regrid_helices`,
`_relay_frees_behind_anchor`, `pinwheel_capacity`) + miroir
`app/composables/structureMultiClient.js` :

1. Capacité d'une tôle pleine en hôtes : `cols × rows` par orientation
   permise (`floor((W − s)/(w + s))`, idem hauteur), meilleure orientation ;
   petites pièces : capacité des trous (pinwheel validé, `meta`) + capacité
   lattice des bandes restantes (`small_lattice` sur les 5 rectangles de
   `residual_bands` autour du bloc d'hôtes).
2. Remplissage séquentiel : tôle k reçoit `min(hôtes restants, capacité)`
   hôtes en grille, puis les petites pièces (trous, puis bandes) jusqu'à
   capacité ; la dernière tôle = `_regrid_helices` (colonnes depuis −X) +
   `_relay_frees_behind_anchor` pour le reste. Tout-ou-rien par tôle,
   validation physique par tôle (`_validate_batch` sur toutes les poses).
3. Si les pièces restantes ne tiennent pas dans le stock → pas
   d'alternative grille (log + `postPass.errors`), jamais une grille
   partielle.
4. Généricité (§5 du plan correctif 2) : la grille n'existe que si
   `detect_structural_case` reconnaît le motif « classe rectangulaire
   dominante + petite classe » (déjà utilisé en mono) ; sinon aucune
   alternative grille (les autres géométries n'ont pas de « grille »
   canonique). Le corpus T-B..T-I doit rester **sans** alternative grille
   et sans erreur.

**c) Branchement** — `main.py` (après le moteur, avant reveal) et
`localJobPrivate.js`/`localBridge.js` :

- alternative moteur → profil `compact` ;
- alternative grille → `build_grid_layouts_multi(...)`, ajoutée avec
  `structural: True, self_contained: True, strategy: 'grid'` (comme en
  mono : sautée par l'expansion meta et le hole-fill), `layoutCount`
  = nombre de tôles réellement utilisées ;
- tri d'affichage inchangé (`grid` d'abord, `_DIRECTION_ORDER`), reveal des
  deux, vue live finale = alternative rang 0 ;
- garde par classe + physique s'appliquent aux deux.

**d) UI** — `ResultModal.vue` : le sélecteur d'alternatives existant suffit
(« Grille · 2 tôles · 77 % » / « Compaction −X · 2 tôles · 76 % ») ; ajouter
la chute réutilisable par tôle dans la ligne de chaque alternative pour que
l'utilisateur compare sur ce qui compte (U3 de l'audit).

### 2.3 Tests et banc

- `tests/test_structure_multi.py` : capacité par tôle (81 hôtes à s = 0,1 ;
  ≤ 81 à s = 2 selon le pas), séquence 100 hôtes → 81 + 19, dernière tôle
  en colonnes depuis −X, 800 fans répartis trous → bandes → tôle 2, tout
  validé ; stock insuffisant → `None` ; corpus T-B (pas de motif) → `None`.
  Miroir vitest avec parité chiffrée (comptes par tôle, AABB à 1e-6).
- `test_residual.py` : profil `compact` n'appelle jamais `_regrid_helices`
  (les hôtes de toutes les tôles gardent leur pose moteur) ; profil `grid`
  inchangé sur la fixture user.
- Banc de référence (100 + 800, 2×1000×1000, 0,1 et 2) : **deux
  alternatives**, chacune homogène : grille = hôtes de la tôle 1 ET de la
  tôle 2 alignés sur le pas (test automatique : abscisses des hôtes ≡ 0
  mod `w + s` à 0,5 mm près sur toutes les tôles) ; compaction = aucun hôte
  déplacé par rapport à `postPass.pre` sur aucune tôle. Physique OK, aucune
  des deux « pire que le moteur » en compte.
- e2e navigateur : le sélecteur montre les deux alternatives, captures des
  deux tôles pour chacune ; parité comptes/front avec le serveur ± 3.
- Corpus complet : aucun cas hors T-A ne gagne d'alternative grille, aucun
  ne régresse.

---

## Ordre d'exécution et estimation

| Étape | Contenu | Dev | Banc |
|---|---|---|---|
| 1a | capacité gonflée + choix SPP/BPP + 422 serveur | 0,5 j | 0,25 j |
| 1b | arrêt tôt / chemin navigateur hors tôle / `unfit` structuré | 0,5 j | 0,25 j |
| 1c-d | verdict unique UI, leviers, refund, T-J/T-K | 0,5 j | 0,25 j |
| 2a | profils `compact`/`grid` du post-pass | 0,5 j | 0,25 j |
| 2b-c | constructeur grille multi-tôles + branchement + miroir JS | 1,5 j | 0,5 j |
| 2d | UI alternatives + chute par tôle | 0,25 j | 0,25 j |

Livrer la partie 1 d'abord (elle protège l'utilisateur et le quota) ; la
partie 2 ensuite, en une PR par étape. Décisions propriétaire à confirmer
avant 1a : seuils 0,88 / 0,85 (à calibrer sur le corpus, à documenter dans
`specs/20-moteur-nesting.md`) et politique de refund du cas « partiel ».

---

## Vérification de la partie 1 (commits `a787657..ee21242`) + plan de la suite — 2026-09-04, 22 h

Méthode : `git status` propre, `assert_images_head.sh` OK contre HEAD ;
suites ; e2e navigateur (cas 4 mm et non-régression 0,1) ; banc serveur
(cas 4 mm **semé directement**, 0,1, 2) ; corpus T-J/T-K ; relecture de
`capacity.py`, du filtre du merge wasm et du câblage aux trois couches.

### Vérifié conforme

- **Le cas des captures est refusé avant tout calcul côté navigateur**,
  avec remboursement (capture `docs/qa/audit-multitoles-2026-09-03/
  verif7-0905-navigateur-refus-4mm.png`) ; côté API : 422 sans quota
  (`nest.post.js:240-250`), couvert par les tests serveur (153 verts).
- Ratio gonflé (Minkowski, tôle utile `(W−s)(H−s)`) et trois leviers
  calculés (`capacity.py`, miroir `capacityClient.js`, 128 lignes de
  tests) ; seuils 0,88 / 0,85 documentés dans `specs/20-moteur-nesting.md` ;
  choix SPP/BPP sur l'aire gonflée (`main.py`).
- **Chemin navigateur hors tôle identifié et fermé** : le merge wasm
  n'appliquait pas `strip_width ≤ max_strip_width` ; désormais tout walk
  hors largeur est écarté, tous hors largeur ⇒ erreur (`merge.rs`).
- Non-régression multi-tôles : serveur 0,1 = 589/311 (chute 600,3) ;
  2 = 577/323 (chute 544) ; navigateur 0,1 = 590/310 (603,7). Physique OK.
- Suites : pytest 198 + 1, vitest 422 (dont serveur 153), cargo 71 + 1,
  `retry_overshoot` isolé (`#[ignore]`).

### Réserves (Z)

| Id | Sév. | Constat | Preuve |
|---|---|---|---|
| **Z1** | M (UX) | Le refus navigateur est une **ligne d'erreur générique** (« These parts do not fit … refunded ») : ni les trois leviers chiffrés (≈ 2 tôles, ≤ 924 pièces, ≤ 2,1 mm) ni les boutons « Ajouter une tôle » / « Réduire l'espacement » prévus en §1.2c. Les nombres existent dans `capacityReport` mais ne sont pas affichés. | Capture 99-error ; `localJobPrivate.js:403-415` (`capacity_exceeded` → texte seul). |
| **Z2** | M (défense) | **Pas de refus côté worker** : un job qui n'est pas passé par l'API (semé, autre route) part au moteur — le cas 4 mm semé a tourné **115 s** et livré un partiel 982/1000 (`unplaced 18`, `unfit null`). Le plan §1.2a demandait la défense en profondeur dans `main.py`. | `bench-unfit-40-1788553278` : `done`, 114,8 s, `unfit null`. |
| **Z3** | M (produit) | Solution **partielle** livrée sans les leviers : `unfit` reste `null` (§1.2b prévoyait `unfit.partial` avec `sheetsNeeded`, `maxPartsAtSpacing`, `maxSpacingForFit`) ; l'utilisateur voit « 18 pièces non placées » sans savoir quoi faire. | même job ; T-J 983/1000, T-K 984/1000. |
| Z4 | m (exactitude) | `_bbox_grid_capacity` : `floor((W + s)/(w + s))` sur-compte d'une colonne quand `W mod (w+s) ∈ [w, w+s)` ; la géométrie jagua (piège #49) donne `floor(W/(w + s))` (n pièces : `n·w + (n−1)·s + s ≤ W`). Exemple : W = 19, w = 8, s = 2 → 2 au lieu de 1. Comme c'est une **dérogation** (ne jamais refuser si la construction tient), l'erreur va dans le sens « laisser passer un infaisable ». Une seule orientation (0°) considérée. | Lecture `capacity.py:75-92`. |
| Z5 | m (corpus) | **T-K n'est pas « à la limite »** : 2×1000×1000 à 4 mm a la même aire utile que 1×1000×2000 → R ≈ 0,92 (le commentaire « R≈0,46/tôle » est une lecture par tôle). Il devrait être refusé par l'API ; semé directement il livre un partiel (984/1000). Un vrai cas limite : même job à **2,4-2,5 mm** (R ≈ 0,86-0,88). `eval_corpus.py` note « OK » un partiel attendu : distinguer `PARTIEL (attendu)`. | Sortie corpus J/K ; calcul Minkowski. |
| Z6 | m (e2e) | Le script met 75 s à détecter le refus (attente fixe 15 s + `waitForSelector('.stage__status')` 60 s) : lire `.content__error` dès le clic. | `run.log` : clic 20:21:03, détection 20:22:18. |

### Plan de la suite (ordre)

**Étape 1 — Boucler la partie 1 (Z1-Z6), ½ jour**

1. Z1 : le 422 et le refus local portent déjà `capacityReport` → afficher
   dans le bandeau : « Il faudrait ≈ {sheetsNeeded} tôles, ou ≤
   {maxParts} pièces, ou un espacement ≤ {maxSpacing} mm » + boutons
   « Ajouter une tôle » (count+1 sur le 1er format), « Réduire
   l'espacement » (préremplit `maxSpacingForFitMm`), « Relancer ».
   i18n FR/EN (piège #20). Test vitest du composant + e2e (Z6 corrigé).
2. Z2 : `main.py` : si `_cap["refused"]` → `status: error`, `information`
   humaine, champ `unfit {reason:'capacity', …leviers}`, **aucun appel
   moteur** ; test pytest « job refusé en < 1 s ».
3. Z3 : quand la solution est partielle (`unplaced > 0`) → `unfit
   {reason:'partial', unplaced, …leviers}` des deux côtés ; le modal
   affiche les leviers sous le badge « n pièces non placées ».
4. Z4 : `floor(W/(w+s))`, orientations 0/90 ; test « W=19, w=8, s=2 → 1 ».
5. Z5 : T-K à 2,4 mm ; verdict `PARTIEL (attendu)` dans `eval_corpus.py`
   pour T-J (semé) ; T-J via l'API = 422 (test serveur déjà présent).
6. Z6 : détection immédiate de `.content__error` dans le runner.

GO 1 : e2e du cas 4 mm affiche les trois leviers et les boutons ; job semé
à 4 mm refusé par le worker en < 1 s ; T-K à 2,4 mm livré complet ou
partiel avec leviers ; corpus complet vert.

**Étape 2 — Partie 2 du plan (alternatives « Grille » et « Compaction »
homogènes), 2,5 jours** — inchangée, voir §2.2-§2.3 ci-dessus. Rappels de
cadrage issus des vérifications précédentes :

- profil `compact` = moteur + trous + passe fusionnée, **sans**
  `_regrid_helices` ; profil `grid` = constructeur multi-tôles autonome,
  présent seulement si `detect_structural_case` reconnaît le motif ;
- chaque alternative homogène sur toutes ses tôles (verrou automatique :
  hôtes au pas sur toutes les tôles pour `grid` ; aucun hôte déplacé vs
  `postPass.pre` pour `compact`) ;
- invariant « jamais pire que le moteur » et physique bloquante pour les
  deux ; corpus T-B..T-I sans alternative grille et sans régression ;
- e2e : sélecteur à deux alternatives, captures des deux tôles pour
  chacune, parité serveur/navigateur ± 3 pièces.

**Étape 3 — Déploiement** : après GO 1 (la partie 1 protège l'utilisateur
et le quota), avec `assert_images_head.sh` sur les images publiées ; la
partie 2 suit en release séparée.

---

## Vérification de la partie 2 (commits `23bb4aa..b3a06eb`) — 2026-09-05, 9 h — VALIDÉE

Méthode : images = HEAD (script OK ; le `M residual.py` de `git status` est
un artefact CRLF, md5 identique HEAD/working/conteneur) ; suites ; banc
serveur 0,1 et 2 ; e2e navigateur 0,1 et 2 ; corpus complet 11 cas ;
physique shapely sur anneaux bruts et **homogénéité mesurée** (hôtes au pas
`w + s` sur chaque tôle) pour **chaque alternative**.

| Run | Grille (t1 / t2, chute) | Compaction (t1 / t2, chute) | Physique |
|---|---|---|---|
| Serveur 0,1 | 587 / 313, 580 | 582 / 318, 604 | OK ×2 (grille : min-dist 0,1000 exact, 0 paire < space) |
| Serveur 2 | 573 / 327, 544 | 528 / 372, 514 (merge refusé « front ») | OK ×2 |
| Navigateur 0,1 | **587 / 313**, 580 (= serveur) | 590 / 310, 604 | OK ×2 |
| Navigateur 2 | **573 / 327**, 544 (= serveur) | 555 / 345, 479 | OK ×2 |

Homogénéité : la grille a ses 81 + 19 hôtes exactement au pas (écart 0,00 mm)
sur les deux tôles, aux deux espacements, des deux côtés ; la compaction
garde les hôtes moteur libres sur les deux tôles (aucune re-grille).
La grille est **bit-identique serveur ↔ navigateur** ; la compaction porte la
variance moteur (C8). Corpus 11/11 : alternative grille seulement sur T-A et
T-K (motif reconnu), aucune sur T-B..T-I, T-J refusé, T-F partiel attendu.
Suites : pytest 215 + 1, vitest 436, cargo 71 + 1.

Réserves non bloquantes : (1) la compaction à space 2 oscille entre runs et
chemins (528 serveur avec merge refusé, 555 navigateur) — la grille couvre
le besoin et s'affiche en premier ; (2) piège #44 toujours vrai : les
fichiers `_alt0_` sont l'alternative moteur et `_alt1_` la grille, l'ordre
d'affichage est inverse ; (3) ajouter `.gitattributes` (`*.py text eol=lf`)
pour supprimer le faux `M` CRLF ; (4) paires à 0,099 mm côté navigateur sur
la compaction (D9), inchangé.

**GO déploiement de la partie 2** (même procédure, `assert_images_head.sh`
sur les images publiées).
