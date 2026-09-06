# Plan d'implémentation + plan de tests — remplissage des poches BPP (F1+F2)

Suite directe de [`AUDIT-BPP-2026-09-02.md`](AUDIT-BPP-2026-09-02.md)
(failles F1 « poches internes jamais remplies » et F2 « bande droite
monopolise les donneurs »). Objectif chiffré sur le corpus 100+800 /
2×1000×1000 / space 0,1 : **front de la tôle 2 de x≈500 à x≤450, chute
réutilisable ≥ 560×1000 (+12 %)**, physique inchangée (0 chevauchement,
min-dist ≥ space−ε, 4 fans/trou, tôle 1 intacte).

Périmètre : `workers/nesting/core/residual.py` + miroir JS
`app/composables/residualClient.js` uniquement — **aucun Rust, aucun
rebuild wasm** (piège #33b). Mêmes contrats que le pass existant :
déterminisme, hôtes/nichées jamais déplacées (sauf re-grid rigide),
compte global invariant, rollback à la moindre anomalie, SPP/1-tôle
no-op strict (T5/T8).

---

## Partie A — Plan d'implémentation

### Étape A1. `_regrid_helices` retourne les rectangles des colonnes partielles

**Fichier** : `core/residual.py::_regrid_helices` (miroir
`residualClient.js::regridHelices`).

Changement de signature : `moved, free_rects = _regrid_helices(...)`.
`free_rects` = liste de rects libres `{rect, name}` des colonnes de
lattice incomplètes, dans l'ordre x croissant :

1. Regrouper les poses posées de la classe en colonnes par abscisse du
   centre (tolérance 1e-3 — les pas lattice sont périodiques, les cx
   d'une même colonne sont exactement égaux en grille, quasi en zigzag).
2. Capacité de colonne = max du nombre de poses par colonne ; une
   colonne incomplète (n_poses < capacité ET ce n'est pas la dernière
   colonne en x) génère :
   `rect = (x0_col, top_dernière_pose + space, x1_col, sh - space)`.
3. Rects d'aire < 2× aire d'une fan ~ écartés (bruit).

Cas témoin (banc) : 19 hélices → colonnes 9, 9, 1 → 1 poche
x[200,300]×y[100,900] ≈ 79 800 mm². Si la classe tient entièrement en
colonnes pleines (rare), `free_rects` vide — comportement inchangé.

**Rollback inchangé** : en cas d'échec du lattice, retour `(0, [])`.

### Étape A2. `_fill_one_batch` accepte des zones prioritaires

**Fichier** : `core/residual.py::_fill_one_batch` (miroir
`fillOneBatch`).

Nouveau paramètre `bands=None` (par défaut : `residual_bands(used, ...)`)
— la boucle `for band in bands` reste identique. C'est le seul point
d'extension : la compaction passera `free_rects` d'abord, puis les
bandes classiques.

### Étape A3. Batches d'une pose + retry dégradé (F2a/F2b)

**Fichier** : `core/residual.py::_fill_one_batch` (miroir idem).

1. `if not lat or len(lat) < 2: continue` → `len(lat) < 1` (une pose
   valide = une pièce compactée). Terminaison garantie : chaque batch
   consomme ≥ 1 donneur, le stock décroît strictement.
2. Sur échec de `_validate_batch` : retry dégradé — re-valider avec
   `take // 2` poses (max 3 essais, puis `take = 1`) avant le rollback
   complet. Borné : au plus ~4 validations par batch, coût négligeable
   devant le gain (une bande entière n'est plus perdue sur une seule
   pose fautive).

### Étape A4. `_compact_last_sheet` remplit poches puis bandes

**Fichier** : `core/residual.py::_compact_last_sheet` (miroir
`compactLastSheet`).

Nouvel enchaînement de la phase 2 (libres détachées) :

1. `bands = free_rects_du_regrid` (tri aire décroissante pour le
   déterminisme) puis `residual_bands(used, ...)` habituelles ;
2. la boucle `while` existante appelle `_fill_one_batch(...,
   bands=bands)` — avec A3, elle visite poche puis bande haute puis
   bande droite au fur et à mesure que les donneurs s'épuisent ;
3. inchangé : libres restantes → pose d'origine validée contre le
   layout final, sinon `_CompactRollback` (hélices re-grillées
   conservées, libres restaurées au snapshot).

Ordre poche-avant-bande-droite = le principe −X : remplir à gauche
réduit le front mesuré (`usedSheetShare`, chute) même si tout est placé.

### Étape A5. Miroir JS intégral

**Fichier** : `app/composables/residualClient.js` — dupliquer A1-A4 à
l'identique (`regridHelices` retourne `{moved, freeRects}` ;
`fillOneBatch({bands})` ; seuil `< 1` ; retry dégradé). Les fonctions
sont déjà structurées en miroir ligne à ligne — garder cette bijection,
y compris les commentaires de contrat. Vérifier `localBridge.js`
(callers de `regridHelices` : seul `compactLastSheet` l'appelle).

### Étape A6. Branchement et vérifications de non-régression

- Aucun changement de `main.py` (le pass est déjà appelé par tôle pour
  les alternatives moteur non structurelles) ni de `holefill.py`.
- Contrats existants T1-T9 (`tests/test_residual.py`,
  `residualClient.test.js`) doivent rester verts SANS modification
  (sauf si un test verrouillait expressément `len(lat) < 2` — vérifier
  avant ; dans ce cas le test évolue avec justification en commentaire).

### Pièges à respecter (existants)

- **#52** : jamais de pooling inter-tôles — les poches proviennent du
  SEUL re-grid de la donneuse, consommées sur la même tôle.
- **#33b** : aucun artefact wasm/Rust à rebuild.
- **#56** : les mesures de position sur les SVG de résultat passent par
  `y ← H − y` (miroir `svg_colored.py`).
- Déterminisme : tris stables partout (rects par aire puis nom/indice ;
  donneurs par distance au centre décroissante — inchangé).

---

## Partie B — Plan de tests

### B1. Tests unitaires Python (`workers/nesting/tests/test_residual.py`)

Reprendre la fabrique de layouts des T1-T9 (fixtures carré 100×100 r35 +
fan Fillx4 de `bench/seed_user_repro`) :

| Test | Vérifie |
|---|---|
| **T10** poches du re-grid | 19 hélices re-grillées → `free_rects` = 1 rect ≈ x[200,300]×y[100,900] (±ε) ; 18 hélices (2 colonnes pleines) → liste vide ; échec lattice → `(0, [])` |
| **T11** poche remplie avant la bande droite | tôle 2 : 19 hélices + N fans libres ; après compaction, des fans occupent la poche (centroïdes x∈[200,300]) et maxx global < maxx sans le fix (comparaison chiffrée) |
| **T12** batch de 1 | une bande n'acceptant qu'une pose → 1 fan déplacée (l'ancien code : 0) |
| **T13** retry dégradé | une pose du lattice artificiellement en conflit (pièce leurre à cheval sur la bande) → batch réduit posé quand même, pas de rollback total |
| **T14** terminaison | 300 fans libres, boucle de compaction termine (< N_ITER × bandes, assertion de temps ou de compteur d'itérations) |
| **T15** invariants | comptes par tôle invariants, hôtes/nichées jamais bougées hors re-grid rigide, SPP/1-tôle no-op strict (reprise de T5/T8 sur le nouveau chemin) |
| **T16** trou de bande haute** | assez de fans pour déborder la poche → la bande haute y[901,1000] reçoit des fans (l'ancien code : jamais si la droite absorbe tout) |

### B2. Tests miroir Vitest (`app/tests/residualClient.test.js`)

- **Parité chiffrée** : mêmes scénarios que T10-T16, assertion
  `moved`, AABB par tôle et front identiques JS == Python (précédent :
  parité « moved=334, AABB [16, 2, 998, 984] » du T9 — même style).
- Les 5 tests `livePaneLayout` et les 377 existants restent verts.

### B3. Banc serveur (docker local, réseau `nestorcut_nest2d`)

1. **Réplication du gain** — `seed_bpp_2sheets.py` (space 0,1) puis
   `analyze_bpp_regions.py` + script poches (mesures en y-up, piège #56) :
   - front tôle 2 : maxx toutes pièces ≤ **450** (avant : 499,2) ;
   - poche interne x[200,300] : aire libre < **5 000 mm²** (avant : 79 800) ;
   - chute réutilisable ≥ **560×1000** (avant : 500,8) ;
   - tôle 1 inchangée à ±1 pièce (591 attendues, densité ~81 %) ;
   - `usedSheetShare` global ≤ 0,69 (avant : 0,713).
2. **Physique** — `check_physical.py` multi-tôles : VERDICT OK
   (0 chevauchement, 0 hors tôle, 0 pose dupliquée, min-dist ≥ 0,099,
   in-hole = 4/trou exactement sur les 100 trous).
3. **Idempotence** — `bench/audit_bpp_replay.py` sur le résultat final :
   2e application moved < ε (le pass converge, plus d'amélioration
   résiduelle — corrigé de la convention Y du parseur).
4. **Non-régression space 2** — re-run du banc historique (space 2) :
   tôle 1 ≥ 474 fans (référence LIVRAISON §1).

### B4. Critères d'acceptation (GO/NO-GO)

- Tous les tests A/B1/B2 verts ; banc B3.1-B3.3 atteints ; B3.4 ≥
  référence. Physique B3.2 OK est **bloquant** — un front plus court au
  prix d'un seul chevauchement = NO-GO (rollback du fix).
- Vérification finale navigateur (QA Mirror local, mêmes paramètres que
  le run user) : vue 2 panneaux, poches remplies, « % used » cohérent
  avec le banc à ±0,5 pt.

### B5. Estimation

- A1-A4 Python : ~80 lignes modifiées/ajoutées ; A5 JS : bijection.
- Tests : ~150 lignes pytest + ~120 vitest ; banc : réutilisation des
  scripts existants + 1 petit script de mesure des poches (déjà prototypé
  pendant l'audit — à intégrer proprement en y-up).
- Durée estimée : 1 journée dev + tests, ½ journée banc/QA.

## Ordre d'exécution

1. A1 → T10 (la poche est détectée) ;
2. A2+A3 → T12, T13, T14 (mécanique de remplissage) ;
3. A4 → T11, T15, T16 (intégration compaction) ;
4. A5 → parité B2 ;
5. B3 banc complet → GO/NO-GO ;
6. Commit atomique `feat(nesting): remplir les poches des colonnes
   partielles + bandes restantes en BPP` + màj
   LIVRAISON-BPP/AGENTS.md (pièges #52/#56 rappelés, chiffres banc).
