# Livraison BPP 2026-09-01 — pass bandes résiduelles + 3 correctifs

Point d'entrée de la livraison multi-tôles BPP du 2026-09-01 (commité et
déployé le même jour). Chronologie complète :

1. **2026-08-31** : constat user (tôle 1 = hélices seules, tout le reste
   empilé sur la tôle 2) → plans
   [`PLAN-bpp-remplissage-residuel.md`](PLAN-bpp-remplissage-residuel.md)
   (constat + options) et [`PLAN-bpp-impl.md`](PLAN-bpp-impl.md) (impl
   exécutable, option A GO) → **pass `fill_residual_bands`** implémenté et
   validé au banc, non commité.
2. **2026-09-01** : re-test user (2 tôles 1000×1000, 100 trous + 800
   fillers, space 0,1, THIS DEVICE) → 3 nouveaux symptômes → 3 causes
   racines corrigées (ci-dessous) → tout commité/déployé ensemble.
3. **2026-09-02 (matin)** : re-test user en prod → la tôle 2 reste un
   amas dispersé (« pas optimisée −X ») → **compaction de la dernière
   tôle** (§2.4) : les libres y sont re-posées en lattice compact
   derrière le bloc ancré, la chute redevient un rectangle unique.
4. **2026-09-02 (re-test suivant)** : deux problèmes restants →
   **chevauchements réels dans le lattice du miroir JS** (validation des
   pas sur anneau décimé — §2.5) et hélices toujours éparses sur la
   donneuse → **v2 : re-grille des hélices** en colonnes depuis le bord
   gauche (§2.6).

---

## 1. Le pass bandes résiduelles (2026-08-31)

**Problème** : en BPP le constructif ne backfill pas — la perte = croissance
marginale de bbox, donc toutes les petites pièces libres partent sur la
DERNIÈRE tôle (bbox encore petite) et les tôles précédentes gardent leurs
bandes vides. Le SA permute une séquence, il ne pose pas.

**Fix** : post-pass déterministe après `apply_hole_fill`, avant
reveal/SVG/artefacts — `fill_residual_bands`
([`workers/nesting/core/residual.py`](../workers/nesting/core/residual.py),
miroir JS [`app/composables/residualClient.js`](../app/composables/residualClient.js),
branchement `main.py` + `localBridge.js`).

- Bandes = 5 rectangles (4 côtés clippés à l'AABB utilisée + coin TR),
  inset `space` des deux bords ; pas de L, pas de pleine tôle.
- Lattice `small_lattice` des pièces LIBRES de la tôle la moins remplie
  (ratio aires outer / tôle) vers les bandes des tôles plus remplies ;
  donneurs anti-compacts d'abord (la bbox du last se rétracte).
- Hôtes et pièces nichées dans un trou : JAMAIS déplacées.
- Validation = BATCH SEULEMENT : chaque pièce ajoutée doit être dans la
  tôle et à distance ≥ space de TOUT le layout ; les paires préexistantes
  ne sont pas re-jugées. Échec → rollback du batch, alternative intacte.
- Une bande par appel `_fill_one_batch`, boucle `while` jusqu'à plus de
  progrès ; tôle source vidée de ses libres → layout retiré.
- SPP (1 layout) : no-op strict.

**Banc** (`seed_bpp_2sheets.py` + `check_physical.py` multi-tôles) :
tôle 1 passe de 324 à 474 fans (space 2) / 510 (space 0,1), chute tôle 2
↑, physique parfaite sur la tôle remplie.

## 2. Les trois correctifs du 2026-09-01

Constat user sur le run exact 2×1000×1000 / 100+800 / space 0,1 / THIS
DEVICE (réplique déterministe vérifiée : même densité au digit près).

### 2.1 Vue live : les tôles superposées pendant le calcul

**Symptôme** : pendant le calcul, les pièces des 2 tôles étaient dessinées
les unes sur les autres sur un seul contour de tôle.

**Cause** : `buildItems` (`app/components/LiveNestingView.vue`) recevait
les items BPP en 5-tuples `[id, bin, rot, x, y]` mais **jetait `bin`** —
tout était tracé sur `sheets[0]`. Le problème existait des deux côtés
(frames serveur ET navigateur) : seules les tôles partagent le bug, pas
les miroirs.

**Fix** : rendu **multi-panneaux** — `livePaneLayout`
(`app/utils/sheetView.js`) calcule un panneau par tôle visible (côte à
côte en espace écran, `dx` cumulés, plafond 6 tôles + indicateur « +N »
au-delà), un par tôle avec ses propres contour/paysage/axes/clipping ;
le zoom `viewBox` intègre l'offset par panneau. Chaque panneau prend SES
dims (`sheets[bin]`, repli entrée 0) → formats mixtes OK. SPP (un seul
panneau ancré à l'origine) : rendu inchangé au pixel.

**Verrous** : `app/tests/sheetView.test.js` (5 tests `livePaneLayout`).

### 2.2 Tôle 2 « n'importe quoi » : jumeaux parfaits sur les trous coïncidents

**Symptôme** : tôle 2 en amas illisible ; l'analyse du run montre chaque
trou avec **8 fans = 2 pinwheels strictement identiques superposés**
(2×4 à pose exacte), plus des fans téléportés aux coordonnées de l'autre
tôle.

**Cause racine** : **en BPP, les layouts partagent le repère de
coordonnées** (tôle 2 = mêmes x/y que tôle 1 ; grille canonique → trous
coïncidants). Or `apply_hole_fill` poolait `hosts`/`holes`/`free`/
`hole_members` à travers TOUS les layouts :

1. `nested_hole` (test centroïde-in-trou sur la liste POOLÉE) classait
   les fans nichés de la tôle 2 comme occupants du trou coïncidant de la
   tôle 1 (venu avant dans la liste) ;
2. les trous propres de la tôle 2 apparaissaient donc « vides de
   membres » → le repli pinwheel historique y posait un second pinwheel
   canonique **exactement sur** celui du moteur ;
3. les poses `pack_hole`/repli consumaient des fans libres d'une tôle
   pour remplir les trous d'une autre — la pièce RESTAIT dans la liste de
   sa tôle d'origine mais vivait aux coordonnées de l'autre (téléport).

Découverte associée (réécrit le diagnostic du 31/08) : les « jumeaux
expand_meta » n'étaient PAS expand_meta — `plan_hole_fills` retourne
`None` à space 0,1 sur cette géométrie, donc aucune expansion méta n'a
lieu ; les pinwheels dans les trous viennent du MOTEUR (légaux, apex
partagé au centre du trou). Le bug était BPP-only dans le post-pass.

**Fix** : scoping **par tôle** — `_fill_one_sheet_holes`
(`workers/nesting/core/holefill.py`, miroir JS
`_fillOneSheetHoles` dans `localBridge.js`) : trous, libres et membres
sont construits ET consommés dans le périmètre d'un seul layout. SPP
(un layout) : comportement inchangé.

**Verrous** : `workers/nesting/tests/test_holefill_bpp.py` +
`localBridge.test.js` — dont le **cas distinguant** (trous de la tôle 2
vides + libres sur la tôle 1 → RIEN ne bouge ; il échoue sur l'ancien
code, passe sur le nouveau).

### 2.3 Tôle 1 : coin haut-droit vide + bandes « en escalier »

**Symptôme** : la bande haute de la tôle 1 s'arrêtait en escalier avant
le coin TR (navigateur uniquement — le serveur remplissait tout).

**Cause racine** : coquille d'un caractère dans le miroir JS de l'AABB —
`layoutAabb` (`residualClient.js`) écrivait
`maxy = Math.max(maxy, tx + bb[3])` (**`tx`** au lieu de `ty`). Après le
remplissage de la bande droite (fans à tx≈996), `maxy` dépassait la tôle
(≈1016) → `residualBands` voyait une bande haute dégénérée
(y[1018, 998]) → **jamais remplie**, quel que soit le nombre de donneurs.
Le Python (`layout_aabb`, correct) remplissait tout → divergence
miroir visible uniquement côté navigateur.

**Fix** : `ty + bb[3]` + test **T9** « donneurs suffisants → le coin TR
est couvert » des deux côtés
(`tests/test_residual.py::TestT9CornerCovered`, `residualClient.test.js`),
avec parité chiffrée JS == Python sur le scénario de régression
(moved=334, AABB [16, 2, 998, 984]).

### 2.4 Tôle 2 « pas optimisée −X » : compaction de la dernière tôle

**Symptôme** (re-test prod 2026-09-02) : la tôle 2 reste un amas
fragmenté à front dentelé (carrés à gauche + fans dispersées avec vides
internes) au lieu d'un bloc compact ancré −X avec une chute
rectangulaire.

**Cause racine** : le moteur BPP n'applique AUCUNE compaction direction
par tôle (coût = nombre de tôles + remnant moyen) — en SPP le −X vient
du constructif left-compact, en BPP rien ne le fournit. Le pass bandes
remplit les tôles PRÉCÉDENTES mais ne réorganise pas la donneuse ; en
plus le choix des donneuses « anti-compacts » (les plus excentrées du
centre) retire des fans partout dans l'amas et y laisse des trous.

**Fix** : `_compact_last_sheet` (`core/residual.py`, miroir JS
`compactLastSheet` dans `residualClient.js`), appelé en fin de
`fill_residual_bands` sur la tôle la moins remplie (uniquement s'il
reste ≥ 2 tôles — contrat T8) :

- les pièces LIBRES de la tôle sont détachées ; l'ancre = AABB des
  non-libres (hôtes + nichées, jamais déplacées) ;
- les bandes autour de l'ancre (typiquement la seule bande droite,
  l'ancre touchant les autres bords) sont remplies par le MÊME mécanisme
  lattice/batch/validation (`_fill_one_batch`, paramètre `free`) — les
  colonnes poussent depuis l'ancre ;
- tout-ou-rien : les libres non replacées (capacité < donneuses —
  géométries imbriquées denses) retournent à leur pose d'origine
  VALIDÉE contre le layout final ; si ça ne passe pas, restauration
  complète (no-op) ;
- au passage, la couverture tôle de `_validate_batch` passe aux bornes
  ±ε sur anneau BRUT (miroir exact du bbox-check JS) : le simplify peut
  plonger un sommet sous un bord exactement touché et le lattice cale
  ses rangées au bord avec un bruit flottant (~1e-16) que `covers`
  strict refusait.

**Banc** (2×1000×1000, space 0,1) : tôle 2 AABB x[0, 499] (avant :
amas dentelé jusqu'à ~549), rotations 126×0° + 126×180° = lattice pur,
min-dist 0,1000 exact, 0 chevauchement, **chute rapportée
500,7×1000 réutilisable** ; tôle 1 inchangée (591 pièces, 81,2 %).

### 2.5 Chevauchements du lattice JS (anneaux scallopés)

**Symptôme** (re-test user 2026-09-02) : « les pièces se chevauchent, ça
ne va pas du tout » — chevauchements massifs fan/fan (~33 mm² chacun, 95
paires sur 83 fans analysées) dans les colonnes du lattice côté
NAVIGATEUR uniquement (le banc serveur, lui, restait exact : min-dist
0,1000 au dixième près).

**Cause racine (double)** :
1. `ringDist` (structureClient.js) ne mesurait que des distances
   **sommet→arête** : deux arêtes qui se croisent EN LEUR MILIEU
   n'impliquent aucun sommet proche — une paire chevauchant de 33 mm²
   rendait 0,11 (≥ seuil = acceptée !). Le Python shapely
   (`Polygon.distance`), lui, est exact.
2. `smallLattice` validait en plus ses pas de pavage sur un anneau
   **décimé** (`decimateRing(coords, 20)` — perf) : le scallopé réel de
   Fillx4 (95 sommets) y acceptait des pas (≈62,99) que l'anneau complet
   rejette (≈74-77). Et le couple final (py, px) n'était jamais validé
   CONJOINTEMENT.

**Fix** :
1. `ringDist` passe en distance **arête↔arête** exacte (`segSegDist` :
   0 si croisement/toucher, sinon min des 4 sommet-segment) — miroir
   des frontières shapely. Toutes les validations du pass en bénéficient.
2. la dichotomie des pas court toujours sur le décimé (perf), mais
   l'acceptation FINALE du (py, px) se fait sur l'anneau COMPLET,
   conjointement — rescale ×1,06 (≤12 essais) si échec, sinon variante
   rejetée. `latticeRotated` passe par `latticeVariant`, donc couvert.

**Preuve indépendante** (shapely sur les poses du lattice JS) : 150
poses, 0 chevauchement, min-dist 1,36 — l'ancien rendait 95 paires à
33 mm². Verrou : `app/tests/latticeScallop.test.js` + fake solve
adaptatif du test structurel (l'ancien lattice relâché absorbait tout,
le nouveau délègue le surplus au moteur — comportement voulu).

### 2.6 v2 : hélices re-grillées (le « principe −X » complet)

**Symptôme** : même compactée en v1, la donneuse gardait ses hélices là
où le moteur les avait posées (2 colonnes + éparses) — l'AABB ancre
s'étendait jusqu'à l'hôte égaré et le vide intercalaire restait.

**Fix** (`_regrid_helices` / `regridHelices`, phase 1 de la compaction) :
les HÉLICES (hôte + fans nichées) sont re-groupées en unités RIGIDES
(`_helix_units_and_free`) et re-posées en lattice de colonnes DEPUIS le
bord gauche (`small_lattice`, rotations permises, validation exacte) ;
les fans nichées suivent en transformation rigide (rotation relative +
translation conservées). Sécurité : une fan nichée vit dans le polygone
externe de son hôte → sa distance aux autres unités est celle des hôtes
(lattice-validée). Tout-ou-rien par phase : si une classe d'hôtes ne
tient pas en grille, aucun hôte ne bouge ; le rollback des libres ne
touche pas la grille des hélices. Les hôtes des tôles RECEVEUSES
restent immobiles (seule la donneuse est re-grillée). Conséquence
contrat : T3 compte le SOLDE L0↔L1 (l'hôte de la donneuse bouge, les
fans recompactées sur L1 ne la quittent pas).

## 3. Validation finale (tout appliqué)

| Vérification | Résultat |
|---|---|
| vitest (app) | **377/377** (31 fichiers) |
| pytest (worker image, monté) | **142 passed + 2 skipped** (3 erreurs `core.geometry` préexistantes : module du worker fileprocessing absent de l'image nesting) |
| Banc serveur 2×1000×1000 space 0,1 (`check_physical`) | **VERDICT OK** — 591 + 309 pièces, 0 chevauchement, 0 hors tôle, min-dist 0,0994-0,0996 (= bruit simplify/raw documenté), 0 pose dupliquée, in-hole = 4/trou exactement |
| Banc serveur 2×1000×1000 space 0,1 + compaction (2026-09-02) | **VERDICT OK** — tôle 2 AABB x[0,499], chute 500,7×1000 réutilisable, min-dist 0,1000 exact |
| Banc serveur 2×1000×1000 space 0,1 + compaction v2 (2026-09-02) | **VERDICT OK** — tôle 2 : 19 hélices re-grillées (`square:0`), AABB x[0,499], chute 500,8×1000 réutilisable, min-dist 0,1000 exact, 0 chevauchement |
| Re-test navigateur complet (QA Mirror, mêmes params que le user) | tôle 1 : **665 pièces, 85,2 %, chute 1000×2,1 mm, coin TR couvert (18 fans)** ; tôle 2 : 235 pièces, 0 pose dupliquée, chute réutilisable 471×1000 ; vue live = 2 panneaux côte à côte |
| SPP (T5/M3) | no-op strict, 1 layout |

Outils de diagnostic ajoutés au banc :
`analyze_bpp_regions.py` (classification in-hole/libre par tôle, poses
exactement dupliquées, carte d'occupation, paires en chevauchement
localisées) et `inspect_plan.py` (rejoue `plan_hole_fills` +
`reduce_for_solve` pour inspecter packs/meta/slots/ringRotations).

## 4. Pièges ajoutés à AGENTS.md

- **#52** : BPP = repères partagés → tout post-pass poolé à travers les
  layouts est faux (le cas distinguant est le verrou).
- **#53** : coquille tx/ty `layoutAabb` JS — toute évolution d'AABB
  tournée se verrouille par T9 des deux côtés, parité chiffrée.

## 5. Fichiers

| Fichier | Rôle |
|---|---|
| `workers/nesting/core/residual.py` | pass bandes + compaction dernière tôle (nouveau) |
| `app/composables/residualClient.js` | miroir JS du pass (nouveau) |
| `workers/nesting/core/holefill.py` | `apply_hole_fill` scopé par tôle |
| `app/composables/localBridge.js` | wiring pass + `_fillOneSheetHoles` |
| `app/components/LiveNestingView.vue` | vue live multi-panneaux |
| `app/utils/sheetView.js` | `livePaneLayout` |
| `workers/nesting/core/main.py` | branchement pass (BPP, non-structurel) |
| `app/composables/structureClient.js` | exports lattice/rings (sans logique) |
| tests | `test_residual.py` (T1-T9), `residualClient.test.js`, `test_holefill_bpp.py`, `localBridge.test.js`, `sheetView.test.js` |
| banc | `seed_bpp_2sheets.py`, `analyze_bpp_2sheets.py`, `analyze_bpp_regions.py`, `inspect_plan.py`, `check_physical.py` (multi-tôles) |

Aucun Rust, aucun rebuild wasm (piège #33b) — le moteur n'est pas touché.
