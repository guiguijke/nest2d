# Plan d’implémentation — BPP : remplissage des bandes résiduelles

Handoff pour un agent **sans** le contexte de session.  
Parent (constat + options) : `docs/PLAN-bpp-remplissage-residuel.md`.  
Revue 2026-08-31 : option A **GO**, avec les corrections §2 ci-dessous (inset `space`, pas de L comme cible, pas de cap 50 %).

**Ne commence pas CLC / kerf.** Pas de Rust, **pas de rebuild wasm**.  
Ne touche pas l’isolation live, la grille SPP, ni les lots P/Q (indépendants).

---

## 0. Briefing

### Point de départ

- Branche `main`. Working tree : ne **pas** committer `.qa-pw/`, `.testparts/`, `bench/`, `spike/`, `docs/PLAN-coupe-commune.md`, SVG `workers/nesting/bench/out_*`.
- `small_lattice` / `smallLattice` existent déjà et respectent P-1 (rotations permises). **Les réutiliser**, ne pas recopier le pavage.

### Le bug (repro chiffré)

2 tôles 1000×1000, 100 `Piece_Trou` + 800 `Piece_Fillx4`, fillHoles ON, −X, space 2 :

| Tôle | Contenu aujourd’hui |
|---|---|
| 1 | 81 carrés + 324 fans (= 81×4 **dans les trous**) + bande droite ~81 mm **vide** + bande haute |
| 2 | 19 carrés + 476 fans (76 dans les trous + **400 libres étalés**) |

Scripts : `workers/nesting/bench/seed_bpp_2sheets.py`, `analyze_bpp_2sheets.py`.

### Pourquoi le moteur ne le fera pas tout seul

1. Pré-passe D-MOT-16 : 400 fans extraits → instance = 100 carrés fermés + 400 fans. Voulu.
2. Constructif BPP (`HoleFillEvaluator`) : perte = **croissance marginale de bbox**. Séquence = gros d’abord → 100 hôtes puis fans. Après ~81 carrés, bbox tôle 1 ~918² vs tôle 2 ~200² → **tout fan va sur la tôle 2**. Ce n’est pas un tie : l’option « best-fit à perte égale » ne se déclenche jamais.
3. SA : permute une **séquence**, ne pose pas. Même avec un meilleur coût remnant, le constructif ne génère pas « fan dans la bande de la tôle 1 ».

Donc un **post-pass** (comme `apply_hole_fill`) est le bon fix. Pas de Rust.

### Décisions déjà tranchées (ne pas rouvrir)

| # | Décision |
|---|---|
| D1 | Remplir les tôles **précédentes**, maximiser la chute **propre de la dernière**. Pas d’équilibrage égalitaire. |
| D2 | v1 = bandes latérales **rectangulaires** seulement (pas de poches internes). |
| D3 | Toute pièce **libre** dont une rotation permise tient dans la bande. **Pas** de cap « bbox ≤ 50 % » (Fillx4 / 81 mm ≈ 51 % — ça exclurait le corpus). Hôtes et pièces **dans un trou** : jamais déplacés. |
| D4 | **Toutes** les alternatives BPP (cohérence du modal). |
| D5 | 5–6 fans/trou : **fermé**. Autre chantier. |

### Docs à lire

1. Ce fichier.
2. `docs/PLAN-bpp-remplissage-residuel.md` §1–2 (constat).
3. `AGENTS.md` pièges **#3, #6, #41, #42, #45, #48, #50**.
4. `workers/nesting/core/holefill.py` `apply_hole_fill` / `nested_hole` (détection « dans un trou » à **réutiliser**).
5. `structure.py` `small_lattice` + `structureClient.js` `smallLattice`.

---

## 1. Objectif et hors-scope

### Objectif

Après hole-fill, avant reveal / artefacts : si un layout BPP a **≥ 2 tôles utilisées**, prendre des pièces **libres** sur la tôle la moins remplie et les poser au lattice dans les bandes vides (hors AABB insetée de `space`) des tôles plus remplies.

Succès mesuré (space 2) :

- tôle 1 : **≥ 420 fans** (324 actuels + ≥ 96 hors trous dans les bandes) ;
- offcut tôle 2 **≥ 0,5 m²** (0,396 aujourd’hui) ;
- 0 overlap / 0 hors tôle / min-dist ≥ space ;
- comptes `item_id` inchangés ; hôtes immobiles.

### Hors-scope

- Rust / SA / wasm / option B ou C.
- CLC, grille SPP, P/Q filets (déjà un chantier à part).
- Packer 5–6/trou.
- Poches **intérieures** (v2).
- Compacter la tôle 2 au-delà du retrait des pièces de bord (pas de re-solve).
- Live pendant le search : restera « bandes vides » jusqu’au reveal (comme le hole-fill). Documenter, ne pas « fixer ».

---

## 2. Design v1 figé (corrections par rapport à la proposition)

### 2.1 Quand s’active

```
not structural
and len(layouts) >= 2
sinon return 0   # SPP, BPP 1 tôle, grille : no-op, zéro coût
```

Pas de test `is_spp` côté fonction : le **nombre de layouts** suffit (SPP = 1 layout). L’appelant Python peut quand même garder `if not is_spp` pour clarté.

### 2.2 Identité d’une tôle

Pour 2 tôles **du même format**, les deux layouts ont `container_id = 0` (index du **type** de tôle, `placement.py`). L’identité = **index dans `layouts[]`**, pas `container_id`.

Déplacer une pièce = la retirer de `layouts[src].placed_items` et l’appendre à `layouts[dst].placed_items` avec une **nouvelle** transformation. Ne pas toucher `container_id`.

Taille de la tôle i : `bin_dims[layout.container_id]` (Python) / `sheetDims(payload, container_id)` (JS).

### 2.3 « last » = moins remplie en **taux**

```
fill_ratio(i) = sum(aire_outer(item) for pi in layouts[i]) / (sheet_w * sheet_h)
last = argmin fill_ratio   # tie-break : plus grand index
```

Aire outer (`shoelace` / `polygonArea`), pas AABB. Un ratio, pas une aire libre absolue (sinon une 2000×3000 à moitié vide gagne toujours).

Si `last` se vide entièrement (plus aucun `placed_items`) : **supprimer** ce layout (bonus `layoutCount--`). Sur le corpus, 19 hôtes restent → 2 tôles.

### 2.4 Bandes — 4 côtés **clippés à l’AABB** + 1 coin, **inset `space`**

**Ne pas** utiliser des bandes pleine-tôle : après remplissage d’une bande droite pleine hauteur, l’AABB englobe (presque) toute la tôle et **efface** la bande haute au-dessus des hôtes.

**Ne pas** passer un L à `small_lattice` : un L n’est pas un rectangle ; son bbox recouvre la zone occupée.

AABB des placements **déjà** sur la tôle (translation externe + `_rotated_bbox`, piège #48) :

```
minx, miny, maxx, maxy
```

Cinq rectangles, côtés adjacents au bloc, **inset `space`** (jagua + distance aux hôtes ; sans inset, 1re colonne à dist 0 → STRtree KO → no-op) :

```
right  = (maxx + space, miny,           sheet_w - space, maxy)
top    = (minx,          maxy + space,  maxx,            sheet_h - space)
corner = (maxx + space,  maxy + space,  sheet_w - space, sheet_h - space)  # coin TR
left   = (space,         miny,          minx - space,    maxy)
bottom = (minx,          space,         maxx,            miny - space)
```

Garder un rect ssi `width > 0` et `height > 0` (tolérance 1e-6). Sur un pack bottom-left, `left`/`bottom` sont vides.

Ordre : **aire décroissante**, tie-break nom (`corner` < `right` < `top` < …) pour le déterminisme.

```
        sheet_w
   +------------------+
   |         top      | corner
   |    +--------+----++
   |    |  AABB  | r  ||
   |    |  hôtes | i  ||
   |    +--------+ g  ||
   |         bottom   | ht
   +------------------+
```

`small_lattice(..., axis=)` : `'x'` pour `right`/`left` (tasser vers les hôtes), `'y'` pour `top`/`bottom`/`corner`.

### 2.5 Pièces déplaçables

Sur `last`, une pièce est **libre** ssi :

1. l’item n’a **pas** de `holes` (un hôte ne bouge jamais, même si sa bbox tiendrait) ;
2. son centroïde n’est **dans aucun trou** d’un hôte **du même layout**.

Réutiliser la logique `nested_hole` de `apply_hole_fill` (`holefill.py:414-418`) : `hw.contains(centroid)`. Miroir JS : centroïde + winding / `pointInRing` existant s’il y en a un ; sinon même test que `applyHoleFill` (lire `localBridge.js`).

**Ne pas** inventer un flag : après `expand_meta` ce sont des `placed_items` ordinaires.

Classe candidate pour une bande : grouper les libres de `last` par `item_id` ; parmi celles dont **une** rotation permise a sa bbox qui tient dans la bande, prendre la plus nombreuse ; tie-break `item_id` croissant.

### 2.6 Algorithme (déterministe, par alternative)

```
fill_residual_bands(layouts, input_items, bin_dims, space) -> n_moved
  si len(layouts) < 2: return 0
  snapshot = deepcopy(layouts)          # filet exception
  try:
    moved = 0
    for _ in range(N_ITER):             # N_ITER = 4
      last = argmin fill_ratio
      progress = False
      for i in layouts sauf last, du plus rempli au moins:
        bands = residual_bands(AABB(i), sheet_i, space)
        for band in bands triées par aire desc:
          cls = pick_class(libres(last), band)
          if cls is None: continue
          lat = small_lattice(cls, space, band, want=n_dispo, axis=axis_of(band))
          if not lat or len(lat) < 2: continue
          take = min(len(lat), n_dispo)
          donors = libres(last, cls.id) triés anti-compact (far_x, far_y, idx) desc
          batch = apply_moves(donors[:take], lat[:take], src=last, dst=i)
          if not validate_sheet(i, space) or not validate_sheet(last, space):
            rollback(batch) ; continue
          moved += take
          progress = True
          # AABB(i) a changé : recasser la boucle bandes, recommencer i
          break
      si last.placed_items vide: layouts.remove(last)
      si not progress: break
    return moved
  except Exception:
    layouts[:] = snapshot
    log warning
    return 0
```

`apply_moves` : pour chaque couple (donor placed_item, lattice placement), copier `transformation` du lattice (déjà en coords tôle, la bande est en frame tôle), pop du src, append au dst.

**Validation d’un batch** (ceinture, l’inset rend l’overlap avec l’AABB théoriquement impossible) :

- Python : polygones posés, STRtree, `distance ≥ space - 1e-6`, `sheet.covers(poly)` (comme `verify_layout`).
- JS : bbox de chaque pose ⊆ tôle ; `ringDist` (déjà dans `structureClient`) ≥ space vs toutes les pièces du layout. Pas de shapely.

Toute exception / invalide → **rollback de CE batch**, bande suivante. L’alternative n’est jamais livrée illégale (contrat `apply_hole_fill` / pass grille).

### 2.7 Compte global

`sum(len(l.placed_items) for l in layouts)` invariant. Le part-loss guard de `_finalize_alternative` / `buildGridAlternative` reste le filet. Un test unitaire doit l’assert avant/après.

---

## 3. Fichiers

| Fichier | Nature |
|---|---|
| **NEW** `workers/nesting/core/residual.py` | `residual_bands`, `fill_residual_bands`, helpers AABB / libres / validate |
| `workers/nesting/core/main.py` | appel **après** `apply_hole_fill` (~1355), **avant** reveal ; skip `structural` ; log `n` |
| **NEW** `app/composables/residualClient.js` | miroir exact ; importe `smallLattice`, `rotatedBbox`, `bbox` depuis `structureClient` |
| `app/composables/localBridge.js` | après `applyHoleFill` (~812), **avant** la boucle SVG : `if ((payload.problem\|\|'spp') !== 'spp') fillResidualBands(parts, layouts, space, payload)` |
| **NEW** `workers/nesting/tests/test_residual.py` | matrice §5 |
| **NEW** `app/tests/residualClient.test.js` | miroir |
| `workers/nesting/bench/check_physical.py` | boucle **tous** `svg_files` ; tôle paramétrable (`SHEET_W`/`SHEET_H`, défaut 1000×2000 pour ne pas casser M1 SPP) |
| `data/changelog.js` | 1 entrée utilisateur (multi-tôles, chute de la dernière plus propre) |
| `AGENTS.md` | piège **#51** |
| `docs/ARCHITECTURE.md` | 1 phrase : post-pass BPP bandes résiduelles après hole-fill |
| `specs/90-decisions.md` | **local** D-MOT-19 (gitignored) |
| `docs/PLAN-bpp-remplissage-residuel.md` | statut → implémenté / lien vers ce fichier (quand tu livres) |

**Pas** de `structure.py` / `gravity.rs` / wasm / `localSolverRegistry`.

`small_lattice` Python : `from core.structure import small_lattice, _rotated_bbox, _bbox, _shoelace`.

---

## 4. Contrats d’API

### Python

```python
def fill_residual_bands(layouts, input_items, bin_dims, space) -> int:
    """Mutates layouts in place. Returns number of items moved (0 = no-op)."""

def residual_bands(used, sheet_w, sheet_h, space):
    """used = (minx, miny, maxx, maxy) -> list[{name, rect, axis, area}]"""
```

`layouts` : liste `{container_id, placed_items: [{item_id, transformation: {rotation, translation}}]}` — **la même** que `apply_hole_fill`.

`bin_dims` : `dict[int, (w, h)]` comme `main.py`.

### JS

```js
export function fillResidualBands(parts, layouts, space, payload) // -> nMoved
export function residualBands(used, sheetW, sheetH, space)
```

`parts` : comme `applyHoleFill` (`id`, `coords`, `holes`, `rotations` si dispo). Rotations : `part.rotations` ou `[0,90,180,270]` si absent (payload browser les porte souvent sur `instance.items[].allowed_orientations` — les **copier** sur le `small` passé à `smallLattice`).

### Point d’appel Python (`main.py`)

Juste après le bloc hole-fill, **pas** dans `_finalize_alternative` (trop tard : reveal + DXF). Skip structural (pas de BPP grille aujourd’hui ; défense).

```python
if not is_spp:
    from core.residual import fill_residual_bands
    for engine_alt in engine_alternatives:
        if engine_alt.get("structural"):
            continue
        sol = engine_alt.get("solution") or {}
        # normaliser layouts comme le bloc hole-fill
        n = fill_residual_bands(sol.get("layouts") or [], input_items, bin_dims, space)
        if n:
            logger.info("residual-band pass moved parts", extra={"n": n})
```

JS : `payload.problem === 'bpp'` **ou** `layouts.length >= 2` (plus robuste si `problem` manque). Skip `selfContained` structural.

---

## 5. Tests

### 5.1 Unitaires Python `test_residual.py`

Réutiliser `SQUARE` / `FAN` de `test_structure.py` (importer ou dupliquer les 2 anneaux, ne pas créer un couplage fragile si ça gêne).

`items` : id 0 hôte 100×100 trou (optionnel pour T3), id 1 fan.

| ID | Cas | Attendu |
|---|---|---|
| T1 | `residual_bands` AABB (2,2,920,920), tôle 1000, space 2 | `right` ≈ (922, 2, 998, 920) ; `top` ≈ (2, 922, 920, 998) ; `corner` ≈ (922, 922, 998, 998) ; `left`/`bottom` absents (largeur ≤ 0). **Aucun** rect ne recouvre (2,2,920,920). |
| T2 | bande droite 81×900 + `small_lattice` fan space 2 | ≥ 2 poses (viser ≥ 40), 0 conflit interne, toutes dans la bande inset. |
| T3 | 2 layouts : L0 = 4 hôtes (trous + 4 fans nichés), L1 = 20 fans libres. Bandes L0 assez larges | L0 gagne des fans ; L1 en perd **exactement** autant ; total `item_id=1` invariant ; **aucun** hôte (id 0) déplacé ; **aucun** fan dont le centroïde était dans un trou n’a bougé. |
| T4 | bande 10×10, fan 40×28 | no-op (classe ne tient pas). |
| T5 | `len(layouts)==1` | 0, layouts identiques. |
| T6 | overlap artificiel : lattice « validé » avec space 0 puis validate space 2 | batch rollback, layouts inchangés. (Si trop lourd : tester `validate_sheet` isolé avec 2 carrés à dist 0.) |
| T7 | `fill_ratio` : layout A 10 pièces 100² sur 1000² vs B 2 pièces → last = B. |
| T8 | last vidé de ses libres (pas d’hôtes) → layout retiré, `len(layouts)==1`. |

Shapely requis pour T2/T3 (comme `test_structure`). `pytest.skip` si import fail, **mais** la gate CI image a shapely.

### 5.2 Unitaires JS `residualClient.test.js`

Miroirs T1, T2 (si `smallLattice` dispo sans wasm — oui, pur JS), T3 allégé (2 layouts, fans libres, pas forcément trous), T4, T5.

### 5.3 Commandes (cwd `Nestorcut/`)

```bash
npx vitest run app/tests/residualClient.test.js
npx vitest run    # ≥ baseline, 0 fail

cd workers/nesting
python -m pytest tests/test_residual.py tests/test_structure.py -q
```

Windows : `;` pas `&&`.

### 5.4 Banc Docker (après unitaires verts)

```bash
# seed (space 2 puis 0.1)
docker run --rm -i --network nestorcut_nest2d \
  -e MONGO_URI=mongodb://mongo:27017/nest2d \
  -e BENCH_SPACE=2 -e BENCH_BUDGET=120 \
  nest2d-nesting-worker:dev python - < workers/nesting/bench/seed_bpp_2sheets.py
# attendre job done, puis
docker run --rm -i --network nestorcut_nest2d \
  -e MONGO_URI=mongodb://mongo:27017/nest2d \
  nest2d-nesting-worker:dev python - < workers/nesting/bench/analyze_bpp_2sheets.py <slug>
docker run --rm -i --network nestorcut_nest2d \
  -e MONGO_URI=mongodb://mongo:27017/nest2d \
  -e SPACE=2 -e STRAT=compact -e SHEET_W=1000 -e SHEET_H=1000 \
  nest2d-nesting-worker:dev python - < workers/nesting/bench/check_physical.py <slug>
```

`check_physical.py` aujourd’hui : 1 SVG, tôle 1000×2000, `STRAT=grid`. **Adapter** : boucler `alt["svg_files"]` ; `SHEET_W`/`SHEET_H` env (défaut 1000/2000 pour ne pas casser le banc SPP M1) ; si `STRAT` absent, prendre `alternatives[0]`.

Cibles space 2 : tôle 1 ≥ 400 fans (plan original ; **seuil de succès produit ≥ 420**) ; 0 overlap / hors tôle.

Non-régression SPP : **ne pas** relancer tout le banc phare 100+800 si le temps manque — le no-op T5 + `is_spp` / `len==1` suffit en unitaire. Manuel M1 P/Q seulement si tu as un doute d’avoir touché `structure.py` (tu ne dois pas).

### 5.5 Manuel

| # | Scénario | OK si |
|---|---|---|
| M1 | Constat user, THIS DEVICE **et** serveur, space 2 | Tôle 1 : fans dans la bande droite (et haute) ; tôle 2 : chute plus grande / plus rectangulaire. Captures avant/après. Ctrl+Shift+R inutile (pas de wasm). |
| M2 | Démo 304 pièces, 2 tôles | `layoutCount` inchangé ; pas d’overlap. Un split 278+26 qui bouge de 2–3 petites pièces vers tôle 1 est **OK**. Empirer le share / casser une tôle : KO. |
| M3 | Projet 1 tôle (SPP) 100+800 | Grille / –X **identiques** (no-op). |
| M4 | Isolation A nest BPP / aller sur B | Non-régression smoke, pas un retest §A. |

---

## 6. Pièges concrets pendant le code

1. **`container_id` ≠ index de tôle** (même format × stock 2). Toujours itérer `layouts[i]`.
2. **Inset `space`** sur le bord AABB **et** les bords de tôle. Oublier = no-op (validation échoue) ou `spacingOk=false`.
3. **Bandes clipées à l’AABB**, pas pleine tôle, sinon la 1re bande tue la 2e.
4. **Pas de L** passé à `small_lattice`.
5. **Deepcopy** avant l’alt ; rollback **par batch**.
6. Rotations du `small` : les passer explicitement (P-1 déjà dans le lattice). Si `part.rotations` manque, `[0,90,180,270]` — ne pas laisser `[]` (P-m.1).
7. JS : appeler **avant** `geoExportSvgSheet` / `geoComputeReport`, sinon le livrable navigateur ignore le pass.
8. Ne pas déplacer une pièce puis laisser un trou « double-compté » : on ne touche pas aux nichées.
9. `ringDist` JS est plus faible que STRtree sur L/U concaves — acceptable v1 (corpus = fan + carré). Python = vérité.
10. Ne pas attendre `layout_fits_sheet` du plan P/Q : AABB locale dans `residual.py` (15 lignes `_rotated_bbox`).

---

## 7. Ordre de travail (une session)

1. `residual_bands` + tests T1 (Python **et** JS). Relire les nombres à la main (920+2=922, 1000-2=998).
2. `validate_sheet` + T6 isolé.
3. Brancher `small_lattice` sur une bande fictive (T2).
4. `fill_residual_bands` complet : pick class, donors anti-compact, moves, rollback (T3–T5, T7–T8).
5. `main.py` + `localBridge.js`.
6. `npx vitest run` + pytest `test_residual` **avec shapely**.
7. Banc Docker space 2 (`seed` / `analyze` / `check_physical` multi-svg). Si tôle 1 < 400 fans : d’abord vérifier l’inset et que la classe fan n’est pas filtrée (pas de cap 50 %). Si lattice retourne None : dump de la bande (w, h) vs bbox fan.
8. Space 0,1 (même seed env).
9. Changelog + AGENTS #51 + D-MOT-19 local + 1 phrase ARCHITECTURE.
10. Manuel M1 (les deux modes) + M3.

Commit message :

```
fix(nesting): remplir les bandes vides des tôles BPP précédentes

Post-pass déterministe après hole-fill : lattice des pièces libres
de la dernière tôle vers les bandes AABB insetées des tôles plus
remplies. Pas de moteur. Repli silencieux si validation KO.
```

**Ne push / CI / deploy que si l’utilisateur le demande.** Images : attendre le workflow **« Build and publish Docker images »**, pas seulement `app-ci` (`specs/infra/DEPLOY-HETZNER.md`).

---

## 8. Texte prêt à coller

**AGENTS.md #51**

```
51. **BPP multi-tôles : le constructif ne backfill pas les bandes.**
    Perte = croissance de bbox ; séquence gros-d'abord → les petites
    pièces libres s'empilent sur la DERNIÈRE tôle (bbox encore petite)
    et laissent 80 mm vides sur les précédentes. Le SA permute une
    séquence, il ne pose pas — changer le coût remnant ne suffit pas.
    Post-pass `fill_residual_bands` (après hole-fill) : lattice dans
    5 rectangles (4 côtés clipés à l'AABB + coin), inset space.
    Identité tôle = index de `layouts[]`, pas `container_id` (stock
    N du même format = N layouts, même id). Hôtes et pièces dans un
    trou : immobiles. Échec → rollback batch, alt intacte.
    Verrou : test_residual.py / residualClient.test.js + banc
    seed_bpp_2sheets.py.
```

**D-MOT-19** (`specs/90-decisions.md`, tête de journal)

> `DÉCIDÉ` — BPP, une fois le nb de tôles optimal : remplir les tôles précédentes (lattice dans les bandes AABB insetées de `space`), garder la dernière comme chute réutilisable. Amendement de la lecture Falkenauer « remnant moyen » : le livrable atelier prime. Pas un changement du coût SA (v1).

**Changelog** (EN, ton existant)

> Multi-sheet jobs now pack leftover small parts into the empty side bands of earlier sheets, so the last sheet keeps a larger, cleaner reusable offcut.

---

## 9. Critère de « terminé »

> **LIVRÉ le 2026-09-01** (pass + correctifs satellite : voir
> `docs/LIVRAISON-BPP-2026-09-01.md`). Vitest 377/377, pytest 142,
> banc VERDICT OK, re-test navigateur user 85,2 % / chute 2,1 mm.

- [x] T1–T8 Python verts (shapely) ; miroirs JS verts. (+ T9 coin couvert, ajouté 2026-09-01)
- [x] Banc space 2 : tôle 1 ≥ 420 fans (474 à space 2, 510 à space 0,1) ; offcut tôle 2 ↑ ; `check_physical` 0 overlap / 0 hors tôle.
- [x] Comptes globaux invariants ; 0 hôte déplacé.
- [x] SPP 1 tôle : no-op (T5 + M3).
- [x] THIS DEVICE ≡ serveur (même pass, parité chiffrée moved/AABB après fix `layoutAabb`).
- [x] Aucun wasm dans le diff ; aucun fichier CLC.
- [x] Vitest baseline + N, 0 fail. Changelog + #51 + D-MOT-19 (+ pièges #52/#53).

Si tu dois t’arrêter : livrer `residual_bands` + T1 + le no-op `len<2` ne sert à rien tout seul. Le **minimum utile** = T3 + branchement `main.py` / `localBridge.js` + banc space 2.

---

## 10. Risques

| Risque | Mitigation |
|---|---|
| No-op silencieux (inset oublié) | T1 fige `maxx+space` ; T2 exige ≥ 2 poses dans 81 mm. |
| Cap 50 % réintroduit | Interdit §0 D3 ; T2 utilise Fillx4 / 81 mm. |
| AABB pleine tôle tue la bande haute | T1 : `right.maxy == used.maxy`, pas `sheet_h`. |
| `container_id` utilisé comme index | T3 : deux layouts `container_id: 0`. |
| Démo 278+26 « cassée » | M2 : layoutCount + physique, pas le split exact. |
| JS `ringDist` lâche sur concaves | v1 corpus convexe-ish ; Python STRtree = gate banc. |
| P/Q en parallèle sur `structure.py` | Ce chantier n’y touche pas ; `small_lattice` est un import. |
