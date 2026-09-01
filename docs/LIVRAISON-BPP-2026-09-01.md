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

## 3. Validation finale (tout appliqué)

| Vérification | Résultat |
|---|---|
| vitest (app) | **377/377** (31 fichiers) |
| pytest (worker image, monté) | **142 passed + 2 skipped** (3 erreurs `core.geometry` préexistantes : module du worker fileprocessing absent de l'image nesting) |
| Banc serveur 2×1000×1000 space 0,1 (`check_physical`) | **VERDICT OK** — 591 + 309 pièces, 0 chevauchement, 0 hors tôle, min-dist 0,0994-0,0996 (= bruit simplify/raw documenté), 0 pose dupliquée, in-hole = 4/trou exactement |
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
| `workers/nesting/core/residual.py` | pass bandes (nouveau) |
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
