# Plan d’implémentation — bugs moteur audit 2026-08-31 (§P Python, §Q Rust)

Handoff pour un agent qui n’a **pas** le contexte de session.  
Source des constats : `docs/AUDIT-2026-08-31.md` §P, §Q, §S, §T.  
§R (UI) est **déjà livré** (`24af38c`, AUDIT §W) — ne pas y revenir, ne pas le revert.

**Ne commence pas CLC / kerf.** Ne touche pas l’isolation live (piège #47).  
Ne change pas le nom du wasm (`public/engine/nest_wasm_bg.wasm`).

---

## 0. Briefing (lire avant d’ouvrir un fichier)

### Point de départ

- Branche : `main`. HEAD attendu au moment du plan : `24af38c` (`fix(app,server): correctifs audit UI 2026-08-31 §W`).
- Si HEAD a bougé : `git log --oneline 24af38c..HEAD` — n’écrase rien de §W.
- Working tree : plein d’untracked **à ne pas committer** (`.qa-pw/`, `.testparts/`, `bench/`, `spike/`, `docs/PLAN-coupe-commune.md`, scripts QA, SVG `workers/nesting/bench/out_*`).

### Ce qui est déjà vrai en prod (ne pas casser)

| Fait | Conséquence |
|---|---|
| Pass grille D-MOT-17 livré (`55632c7`) | Lattice = poseur **par défaut** des zones A/C/B (moteur = fallback). Rang 0 si `STRUCT_TOL`. |
| Défaut UI `rotationCount: 4` → `[0,90,180,270]` | P-1 est **invisible** sur le banc phare, **critique** dès `rotationCount=1`. |
| Défaut `directions: ['left']` | Objectif grille `x`. P-3 (bbox –Y) n’est **pas** sur le chemin par défaut. |
| Banc phare | 1 tôle 1000×2000, 100 Trou + 800 Fillx4 (`.testparts`), space 2, grille ~73,6 % ≈ –X moteur. |
| `rotatedBbox` 90° = `(-y, x)` (piège #48) | Ne **pas** « corriger » en `(y, −x)`. La bbox **transposée** B′ est un **autre** angle (R−90). |
| Vitest 348 / pytest nesting 104 (venv `.qa-pw`) | Toute PR doit rester ≥ ce socle. |
| Parité `structure.py` ↔ `structureClient.js` | **Chaque** fix géométrique se fait des **deux** côtés, avec un test par côté. |

### Docs à lire (dans cet ordre)

1. Ce fichier.
2. `docs/AUDIT-2026-08-31.md` §P, §Q, §S (pas besoin de §R).
3. `AGENTS.md` pièges **#2, #2b, #6, #33b, #41, #42, #45, #48**.
4. `workers/nesting/core/structure.py` (docstring + `small_lattice` + `plan_lattice` + `_zone_solve` + `build_structural_layout`).
5. `specs/90-decisions.md` D-MOT-17 (gitignored, local — y ajouter D-MOT-18 en livrant).

### Règles non négociables

- Miroir Python **et** JS pour tout ce qui touche lattice / bbox / rotations / garde tôle / garde 2×space.
- Pas de rebuild wasm **sauf** si tu touches `workers/nesting/engine/` (alors piège #33b : même commit, **même nom** `nest_wasm_bg.wasm`, Ctrl+Shift+R).
- Lots 1–3 = **Python + JS seulement**. Pas de Rust moteur, pas de `lbf.rs`.
- `specs/` gitignored : tu mets à jour `90-decisions.md` en local ; tu n’essaies pas de le push.
- Changelog public `data/changelog.js` : **une** entrée courte (garde pièces trop grandes + grille ne livre plus hors-tôle / mauvaise rotation). Ton utilisateur, pas l’audit.
- `AGENTS.md` : ajouter pièges **#49** (2×space) et **#50** (lattice ⊆ rotations permises + `insideSheet` bloquant). Ne pas réécrire 47/48.

---

## 1. Objectif et hors-scope

### Objectif

Le pass structurel et le pré-check SPP ne doivent plus livrer :

1. des pièces **hors tôle** en rang 0 (P-2, P-4) ;
2. des pièces dans une **rotation interdite** (P-1) ;
3. un **panic worker / wasm** sur une pièce quasi ajustée (Q-1) ;
4. un débordement –Y non détecté à cause d’une bbox au mauvais signe (P-3).

Tout échec du pass → **repli moteur silencieux** (déjà le contrat : `build_structural_layout` / `buildGridAlternative` → `None`). Jamais un layout illégal « mieux que rien ».

### Hors-scope (interdit dans cette PR)

- CLC / kerf / `docs/PLAN-coupe-commune.md`.
- Escalier –X `column_fill.rs`, gravité extra-cycle (D-MOT-12 amend, déjà en prod).
- Isolation live, snapshots F5, quota, registre, pool merge (§R / §W).
- Convertir `lbf.rs:74` en erreur (durcissement, wasm). Lot 5 optionnel, **après**.
- Suite cargo **debug** rouge (Q-m.1) — release seule est la gate.
- `ringDist` arête↔arête (R-m.3) — limite JS documentée, pas ce chantier (sauf si tu finis les lots 1–3 avec de la marge).
- Perf `viewBox` / `decorateLiveLayout`.
- Feature sparrow `simd`.

---

## 2. Découpage en lots (PRs possibles)

Un seul PR `fix(nesting): gardes tôle, rotations lattice, 2×space` est OK si ça reste < ~400 lignes nettes. Sinon 3 PRs dans l’ordre. **Ne pas** merger le lot 2 sans le lot 1 : le filet P-4 doit exister avant d’élargir les cas de test lattice.

| Lot | Constats | Pourquoi cet ordre |
|---|---|---|
| **1 — Filet + crash** | P-4, Q-1 | 3+2 lignes, transforme tout bug géométrique futur en repli / message clair. Zéro changement de pavage. |
| **2 — Légalité grille** | P-1, P-2, P-m.1, R-m.4 (`selfContained`) | Le lattice qu’on a généralisé pose 0/180/90/270 sans demander. |
| **3 — Mesure –Y** | P-3, P-m.2 | Chemin `directions=['bottom']` seulement. Math fragile, tests dédiés. |
| **4 — Hygiène** | P-m.3, P-m.7 + Q-m.3, Q-m.2, P-m.8, P-m.5 | Peut voyager avec 1–3 ou suivre. |
| **5 — Optionnel** | P-m.4 deadline, `lbf.rs` error, Q-m.1 debug_assert, Q-m.4 nest-report | Pas requis pour fermer l’audit produit. |

---

## 3. Lot 1 — Filet `insideSheet` + garde `2×space`

### 3.1 P-4 — alternative structurelle hors tôle = repli (pas un badge)

**Cause.** `_finalize_alternative` (`main.py` ~1386) ne jette que `n != total_requested_count`. `verify_layout` calcule déjà `insideSheet` (`metrics.py:361-362`) et ça finit en badge modal. JS : `buildGridAlternative` a le garde **compte** (`localJobPrivate.js:216-217`) mais pas la position.

**Python — `workers/nesting/core/main.py`**

Dans `_finalize_alternative` :

1. Après le garde `n != total_requested_count`, **avant** `build_result_dxf_files` (ne pas payer l’export d’un layout qu’on jette) :
   ```python
   verification = verify_layout(result_containers, input_items, space)
   if engine_alt.get("structural") and not verification.get("insideSheet"):
       logger.warning("structural alternative outside sheet, discarding",
                      extra={"strategy": strategy})
       return
   ```
2. Réutiliser ce `verification` plus bas (aujourd’hui il est calculé **après** le DXF — déplacer, ne pas appeler deux fois).
3. **Ne pas** jeter les alts moteur sur `insideSheet` (piège #6 : SPP peut dépasser `max_strip_width` ; le badge reste le contrat moteur). Filet = **structural seulement**.

**Python — filet amont (recommandé, 15 lignes, testable sans Mongo)**

Dans `structure.py`, nouvelle fonction :

```python
def layout_fits_sheet(layout, geom_of, sheet_w, sheet_h, eps=1e-3):
    """Bbox de chaque placement (rotation + translation externes) ⊆ [0,w]×[0,h]."""
```

Utiliser `_rotated_bbox(_bbox(coords), rot)` puis `tx+bx0 >= -eps` … `ty+by1 <= sheet_h+eps`.  
À la **fin** de `build_structural_layout`, si faux → `return None` (repli, même sémantique que zone B saturée).

**JS — miroir**

- `layoutFitsSheet` dans `structureClient.js` (même maths, `rotatedBbox`).
- `buildGridAlternative` (`localJobPrivate.js`) : après le garde compte, `if (!layoutFitsSheet(...)) return null`.
- Filet aval : dans `localBridge.js` `buildAlternativeArtifacts` (ou juste après, là où `report.verify` existe), si `alt.structural && report.verify.insideSheet === false` → cette alt est droppée (équivalent `_finalize_alternative`). Ne **pas** dropper une alt moteur.

**Piège.** `selfContained` / skip hole-fill (piège #41) : on droppe l’alt entière, on ne « répare » pas.

### 3.2 Q-1 — pré-check faisabilité `w + 2·space`

**Cause.** jagua offset `min_item_separation/2` sur **items et conteneur** (`jagua-rs/src/io/import.rs:37`). Un item tient ssi :

```
w + 2*space <= sheet_w  &&  h + 2*space <= sheet_h
```

Le garde actuel (`w + space <= sw`, `main.py:479` et `localPayloadBuilder.js:577`) laisse passer 8×8 / tôle 10 / space 2 → sparrow `lbf.rs:74` « strip-width is running away » → `panic = "abort"` (worker mort). BPP dégrade ; **seul SPP panique**.

**Fix (les deux gardes, même commentaire)**

```python
# jagua : inflation item space/2 ET déflation conteneur space/2
# → w + 2*space <= sw  (space=0 : w <= sw)
if w + 2 * space <= sw + 1e-6 and h + 2 * space <= sh + 1e-6:
```

Idem JS. `space === 0` : inchangé en pratique (`2*0`).

**Ne pas** toucher `lbf.rs` dans ce lot.

**Régression messages.** Le golden `EXTRA.tooLargeMessage` (`localPayloadBuilder.test.js`) reste valable (pièce 2000×50 sur 1500×1000). Le cas « 1200×800 @90 dans 1000×1500 space 2 » **passe encore** (`800+4 ≤ 1000`, `1200+4 ≤ 1500`). Ajouter un **nouveau** cas, ne pas recycler le golden.

### 3.3 Tests lot 1

**Python** (`workers/nesting/tests/test_structure.py`)

- `test_layout_fits_sheet_rejects_overflow` : 1 carré 100 traduit à x=950 sur tôle 1000 → False ; x=50 → True. Rotation 90° d’un rect 200×10 dont la bbox sort → False.
- `test_build_structural_returns_none_if_rects_off_sheet` : s’appuie sur P-2 **après** lot 2 ; en lot 1, tester le helper isolé suffit.

**Python** (`workers/nesting/tests/` — nouveau `test_feasibility_guard.py` **ou** étendre un test main existant si un helper est extractible)

Le pré-check vit dans `nesting_process` (lourd). **Extraire** 10 lignes dans une fonction pure :

```python
def part_fits_any_sheet(bounds_w, bounds_h, sheets, space) -> bool:
```

appelée par `main.py` **et** testée :

| w×h | sheet | space | attendu |
|---|---|---|---|
| 8×8 | 10×10 | 2 | False (repro audit) |
| 8×8 | 12×12 | 2 | True (pile `8+4=12`) |
| 8×8 | 11.9×12 | 2 | False |
| 998×10 | 1000×2000 | 2 | False (`998+4>1000`) |
| 100×100 | 1000×2000 | 2 | True (banc phare) |
| 1000×10 | 1000×2000 | 0 | True |

**JS** (`app/tests/structureClient.test.js`)

- `layoutFitsSheet` miroir des 2 cas carré.

**JS** (`app/tests/localPayloadBuilder.test.js`, bloc `feasibility pre-check`)

- `8×8 / sheet 10 / space 2` → throw `'Part(s) too large for the sheet'`.
- `8×8 / sheet 12 / space 2` → pas de throw.
- Garder les 2 tests existants (2000×50, 1200×800@90).

**Ne pas** lancer `cargo test` pour ce lot (pas de Rust).

### 3.4 Critère de sortie lot 1

- [ ] Pièce 8×8 / 10 / space 2 : message Python **et** JS, **pas** de panic.
- [ ] Alt `structural` avec une pièce à x > sheet_w : absente des `alternatives` (repli moteur).
- [ ] Alt moteur hors tôle : toujours exportée, badge `insideSheet=false` (piège #6).
- [ ] Banc phare non cassé (100×100 / 1000 / space 2 passe le garde).
- [ ] `npx vitest run` vert ; pytest `test_structure` + nouveau test garde vert.

---

## 4. Lot 2 — Rotations permises + grille rect dans la tôle

### 4.1 P-1 — le lattice ne pose que des angles demandés

**Cause.** `detect_structural_case` vérifie `rots ⊂ {0,90,180,270}`, **pas** que les angles **posés** y sont. Ensuite :

| Poseur | Angles posés | Fichier |
|---|---|---|
| `plan_lattice` | rectangles toujours `rotation: 0.0` | `structure.py:229` / JS `planLattice` |
| `_bbox_grid` / brick | `deg0 ∈ {0, 90}` | `small_lattice:400` |
| `_lattice_variant` | `deg0` et `deg0+180` | `:590` |
| `_lattice_rotated` | `src_deg+90` → 90/270 | `:535` |

Scénario : `rotationCount=1` → `rotations=[0]` (`nest.post.js:62-64`). Détection OK, sous-solve moteur OK, lattice pose 180° et 90°. Rang 0. **Les deux côtés.**

Défaut produit = 4 rotations : le banc 100+800 **n’échoue pas** aujourd’hui. Le bug est le client **fil matière / décor**. On l’a agrandi en faisant gagner le lattice sur le moteur.

**Fix — `small_lattice` / `smallLattice`**

1. Lire `allowed = {(float(r) % 360) for r in (small.get("rotations") or [0.0])}`.
2. **Ne pas générer** une variante dont **toutes** les poses ne sont pas ⊆ `allowed` :
   - bbox/brick `deg0` : seulement si `deg0 in allowed` ;
   - zigzag `deg0` : seulement si `{deg0, (deg0+180)%360} ⊆ allowed` (si seulement `deg0` : ne pas lancer le zigzag — la grille bbox couvre déjà 0°) ;
   - `_lattice_rotated` : seulement si `{90, 270} ⊆ allowed` (ou filtrer pièce par pièce **et** exiger que le variant restant soit non vide).
3. Filet dans `consider` : dropper tout placement `rot ∉ allowed` (ceinture).
4. Si **aucune** variante légale ne pose rien → `None` → tronçons moteur (qui reçoivent déjà `case["small"]["rotations"]`).

**Fix — rectangles `plan_lattice`**

- Si `0.0 not in rect["rotations"]` : `detect_structural_case` retourne `None` (pas de grille). **Ne pas** inventer une grille 90° dans cette PR.
- Ajouter le test dans `detect` : `if 0.0 not in rect["rotations"]: continue` (on essaie l’autre rôle small/rect).

**Fix — JS `detectStructuralCase`**

Aujourd’hui : `rots` vide → rejet (`structureClient.js:450`). Python : `or [0,90,180,270]` (`structure.py:134`). **Après P-m.1** les deux voient `[0]` pour `[]`. En lot 2, aligner detect Python sur « liste vide = pas de défaut all-quarters ici » : la normalisation se fait **à l’entrée job**, pas dans detect. Detect : si `rotations` manquant/`None` seulement, défaut `[0,90,180,270]` (rétrocompat tests). Si `[]` (après P-m.1 ça n’arrive plus) : traiter comme `[0]`.

**Ne pas** changer le score (max N, puis bord min). Ne pas recalculer px/py 90° (piège #48).

### 4.2 P-2 — `plan_lattice` refuse une grille plus large/haute que la tôle

**Cause.** `cols = n_full + (1 if remainder else 0)` sans borne vs `sheet_w`. Preuve audit : 310 lattes 510×10, tôle 1000×2000, space 1 → colonne 2 à x ∈ [512, 1022], 129 pièces hors tôle. Zone B inversée (`zw < 0` → `[]`). `STRUCT_TOL` 20 % laisse passer si le moteur déborde autant.

Dernière colonne, bord droit (translation externe) = `cols * pitch_x`. Il faut `cols * pitch_x <= sheet_w - space` i.e. `space + cols * pitch_x <= sheet_w` (c’est `lattice_right <= sheet_w`).

**Fix**

```python
# objective x, après calcul de cols :
if space + cols * pitch_x > sheet_w + 1e-6:
    return None
# objective y, après calcul de rows :
if space + rows * pitch_y > sheet_h + 1e-6:
    return None
```

Miroir JS `planLattice`. Le filet P-4 reste : si un futur bug passe, `_finalize_alternative` jette.

Banc 100 carrés 100 mm / 1000 / space 2 : `6 * 102 + 2 = 614 <= 1000` — **inchangé**.

### 4.3 P-m.1 — normaliser `rotations: []` à l’entrée

Trois sémantiques aujourd’hui : `main.py:471` (`or [0.0]`), `:561` (passé tel quel au moteur), `:1096` / `structure.py:134` (`or [0,90,180,270]`), JS detect rejette.

**Fix unique, en amont :**

- `nest.post.js` : après parse, si `!Array.isArray(rotations) || rotations.length === 0` → `globalRotations`. Rejet 400 si un angle n’est pas fini.
- `main.py` construction items : `rotations = item.get("rotations") or [0.0]` **partout** (y compris `allowed_orientations` ligne 561 et `_geom_of` ligne 1096 — plus de défaut 4 angles silencieux).
- `localPayloadBuilder.js` : déjà `item.rotations?.length ? item.rotations : [0]` (ligne 572) — vérifier le builder d’instance (ailleurs) et aligner sur `[0]` si vide.

### 4.4 R-m.4 — `selfContained: !!holePlan` (1 ligne, livrable divergents)

`localJobPrivate.js:249` : `selfContained: !!meta` vs Python `bool(hole_plan)` (`main.py:1233`). Un `meta` packs sans `hole_plan` → JS skip hole-fill, serveur l’applique.

**Fix.** `selfContained: Boolean(holePlan)` (la variable existe déjà dans `buildGridAlternative`). Test : meta packs, pas de holePlan → `selfContained === false`.

### 4.5 Tests lot 2

**Python `test_structure.py`**

1. `test_detect_rejects_rect_without_rot0` : `rect_rots=[90,270]` → `None`.
2. `test_small_lattice_rotations_0_only` : `small.rotations=[0]`, zone large. Tous les `placed.transformation.rotation % 360 ∈ {0}`. **Aucun** 90/180/270. Compte ≤ le compte à 4 rotations (peut être strictement inférieur).
3. `test_small_lattice_rotations_0_180` : zigzag 0/180 autorisé, **pas** de 90/270.
4. `test_plan_lattice_slats_off_sheet_returns_none` :  
   rect bbox `(0,0,510,10)`, demand 310, sheet 1000×2000, space 1 → `plan_lattice(...) is None`.
5. `test_plan_lattice_100_squares_still_fits` : cas existant 100 / 1000×2000 / 0.1 **reste vert**.

**JS `structureClient.test.js`** — les 4 mêmes (detect, lattice `[0]`, lattice `[0,180]`, lattes 510).

Le test lattice existant « quart-de-disque : >120 placements » utilise (implicite) 4 rotations — **ne pas** le casser. Lui passer `rotations: [0,90,180,270]` explicitement sur `small`.

**JS `localJobPrivate` / test dédié** si `buildGridAlternative` est testable ; sinon un test unitaire du flag `selfContained` extrait, ou assertion dans un test structure existant qui passe `holePlan`.

### 4.6 Critère de sortie lot 2

- [ ] `rotations=[0]` : zéro pièce lattice à 90/180/270, Python **et** JS.
- [ ] Lattes 510×10 ×310 / 1000×2000 / space 1 : `plan_lattice` None → pas de grille (moteur seul).
- [ ] 100 carrés 100 mm : grille identique (19/col, 6 cols, reste 5).
- [ ] `selfContained` suit `holePlan`, pas `meta`.
- [ ] `[]` rotations → `[0]` à l’enqueue, plus de « all quarters » silencieux dans le pass.

---

## 5. Lot 3 — Bbox transposée –Y + débordement gauche

### 5.1 P-3 — bbox de mesure B′ = R(−90), pas R(+90)

**Cause.** Instance zone B transposée : `main.py:1133` `[[y, -x] for x, y in small_coords]` = R(−90).  
Bbox posée : `structure.py:730` `(-sy1, sx0, -sy0, sx1)` = R(+90).  
JS : commentaire `transposedBbox` = `(x,y)→(y,−x)` **mais** code `[-y1, x0, -y0, x1]` = R(+90) (`structureClient.js:792-796`).  
Préexistant (9b9c890), **pas** une régression du fix piège #48.

Le check `used_w <= solve_w` (`structure.py:303`) mesure un bord imaginaire. Écart = 2×ordonnée du centroïde d’origine. Map-back `(x,y)→(x0+(zw−ty), y0+tx)` est **correct** — ne pas y toucher.

**Fix**

```python
# R(-90)·(x,y) = (y, −x)  — même formule que main.py:1133
small_solve = dict(case["small"], bbox=(sy0, -sx1, sy1, -sx0))
```

```js
function transposedBbox(bb) {
    const [x0, y0, x1, y1] = bb
    return [y0, -x1, y1, -x0]  // R(-90), identique au commentaire
}
```

**Piège #48.** `rotatedBbox(90)` reste `(-y1, x0, -y0, x1)`. `transposedBbox` = `rotatedBbox(270)` / branche 270, **pas** 90. Un test doit figer les deux.

Reachability : seulement `directions == ['bottom']` (`main.py:1119-1122`). Lot 3 n’est pas le chemin phare, mais c’est le premier job Y– seul qui débordera en rang 0.

### 5.2 P-m.2 — overflow gauche vs `solve_w`

```python
# structure.py:301-303 aujourd’hui
used_w = max(used_w, tx + bx1, -(tx + bx0))
ok = ... and used_w <= solve_w + 1e-3
```

`-(tx+bx0)` (magnitude du débordement **gauche**) est comparé à la **largeur** de zone : 5 mm hors zone A sur une bande de 200 mm passe.

**Fix**

```python
right = tx + bx1
left = tx + bx0
ok = bool(placements) and len(placements) >= n
    and right <= solve_w + 1e-3
    and left >= -1e-3
```

Miroir JS `zoneSolve` (chercher le `used_w` / `tx + bx1` équivalent dans `structureClient.js`).

### 5.3 Tests lot 3

1. **Cohérence bbox** (les deux côtés) :  
   `coords = FAN` (ou tout polygone y>0).  
   `got = transposedBbox(bbox(coords))`.  
   `expect = bbox([[y, -x] for x,y in coords])`.  
   `got == expect`.  
   Et `got != rotatedBbox(bbox, 90)` dès que le centroïde n’est pas 0.

2. **Rejet débordement réel après map-back** : ne **pas** passer une bbox ad hoc (le test actuel `test_zone_solve_transposed_map_back` le fait — il reste comme test de map-back). Nouveau test : bbox dérivée comme `main.py`, solveur qui place un item avec `tx` tel que map-back `y0+tx+height > sheet_h` → `_zone_solve` retourne `[]` (used_w trop grand). Avec l’**ancienne** bbox R+90 ce test serait vert à tort — c’est le verrou.

3. **Overflow gauche** : placement `tx + bx0 = -5`, `tx + bx1 < solve_w` → `[]` / shrink, plus `ok`.

4. Tests existants `TestObjectiveY` : recalculer les assertions numériques si la bbox de mesure change le shrink (le map-back du test `:324` ne dépend pas de la bbox de `small` pour le résultat, seulement `used_w`). Relancer et ajuster **uniquement** si un count d’encadrement bouge ; le map-back `(0.1+(99.8-20), 1202.3+10)` doit rester.

### 5.4 Critère de sortie lot 3

- [ ] `transposedBbox` = bbox des coords ` (y, −x) `, ≠ `rotatedBbox(90)` sur FAN.
- [ ] Commentaire JS et code d’accord.
- [ ] Débordement post map-back rejeté.
- [ ] Grille –X (objectif x) : **aucun** changement de nombres sur le banc 100/400 tests existants.

---

## 6. Lot 4 — Hygiène (grouper ou suivre)

Faire dans le même PR si ça reste petit. Sinon PR `fix(nesting): hygiène audit P-m / Q-m`.

| ID | Fix | Fichiers | Test |
|---|---|---|---|
| **P-m.3** | `LATTICE_SIMPLIFY_MM = SIMPLIFY_MM` (même env `NEST_SIMPLIFY_MM`, défaut 0,05). JS : lire la même constante (aujourd’hui 0,05 hardcodé — exporter depuis un module partagé **ou** commenter « garder sync avec `main.py:SIMPLIFY_MM` » + même défaut). | `structure.py:75`, `main.py:62`, `structureClient.js:49` | `assert LATTICE_SIMPLIFY_MM == 0.05` ; si env `NEST_SIMPLIFY_MM=0.2` (test isolé, pas casser l’import module déjà chargé — skip env si trop lourd). |
| **P-m.7 + Q-m.3** | `count` entier ≥ 1, plafond **total** 10 000 (démo déjà `DEMO_MAX_PARTS`). | `nest.post.js:56/103/111` (`Number.isInteger` + `Math.floor`, 400 si `count < 1` ou somme > 10000). Miroir local si le client envoie le payload sans passer par ce plafond — `localPayloadBuilder` doit 400/throw aussi. | Test serveur existant style `nest.post` si présent ; sinon test unitaire helper `normalizeCounts(files)`. |
| **Q-m.2** | `.max(1)` sur `separator_workers`. | `config.rs:191-193` **et** `nesting_input_builder.py` / `localPayloadBuilder.js:775` (`Math.max(1, …)`). ⚠ touche `nest-engine` → **rebuild wasm même commit** (piège #33b) **ou** ne clamp que Python/JS (chemin mort Rust, suffisant). **Préférer clamp JS+Python, ne pas ouvrir cargo.** | `separator_workers: 0` → config finale 1 (test `test_local_compute.py` / `localPool.test.js`). |
| **P-m.8** | `if should_cancel(): _finalize_cancelled(); raise JobCancelled` **juste avant** la boucle `_finalize_alternative` (`main.py:1461`) et avant l’écriture `done`. Une annulation pendant reveal (~2-15 s) ne doit plus finir en `done` sans refund. | `main.py` | Si un test d’annulation existe, l’étendre ; sinon commentaire + check manuel. |
| **P-m.5** | `dxf_document_cache.clear()` dans un `finally` de `nesting_process`, pas seulement au job suivant. | `main.py:349/397` | Pas de test (observabilité RAM). |

**P-m.6** shoelace ouvert : 3 lignes (`if coords[0] != coords[-1]: fermer`). Gratuit, à prendre. Test : anneau ouvert vs fermé, même aire que JS `polygonArea`.

**P-m.4** deadline mur : **lot 5**. Le lattice a déjà coupé le pire cas A/C/B sur le cas phare. Si tu le fais : `deadline = time.monotonic()+job_budget` passé à `build_structural_layout`, return `None` si dépassé.

---

## 7. Lot 5 — optionnel (ne pas commencer tant que 1–3 ne sont pas verts)

- `lbf.rs:74` assert → erreur remontée. **Wasm rebuild.** Seulement si Q-1 garde 2×space est en prod et tu veux un filet profond.
- Q-m.1 debug_assert quadtree : fixtures désalignées **ou** `#[cfg(debug_assertions)]` assoupli. Ne **pas** faire de `cargo test` debug une gate CI.
- Q-m.4 `nest-report` : `total_cmp` + `if ring.len() < 3 { return }`.
- R-m.3 `ringDist` concave : hors contrat ; si tu y vas, STRtree-like ou rejet des non-convexes vers le moteur.

---

## 8. Plan de test (commande + matrice)

### 8.1 Commandes (cwd = `Nestorcut/`)

```bash
# JS — socle + nouveaux
npx vitest run app/tests/structureClient.test.js app/tests/localPayloadBuilder.test.js
npx vitest run   # 348 + N, aucun fail

# Python — image CI / venv .qa-pw (shapely OBLIGATOIRE pour lattice)
# L’hôte sans shapely skip déjà certains tests : ce n’est PAS la gate.
cd workers/nesting
python -m pytest tests/test_structure.py tests/test_metrics.py tests/test_feasibility_guard.py -q
# si le fichier garde a un autre nom, l’adapter

# Ne PAS exiger cargo pour les lots 1–3.
# Si lot 4 a touché config.rs :
#   cargo test --release -p nest-engine
#   rebuild wasm, même filename, même commit (AGENTS #33b)
```

Windows : `;` pas `&&`. Pytest depuis `workers/nesting` avec `sys.path` déjà posé par `test_structure.py`.

### 8.2 Matrice d’acceptance (automatique)

| # | Cas | Attendu | Lot |
|---|---|---|---|
| T1 | 8×8, tôle 10×10, space 2 | throw « Part(s) too large » JS+PY, pas de panic | 1 |
| T2 | 8×8, tôle 12×12, space 2 | passe le garde | 1 |
| T3 | 100×100, tôle 1000×2000, space 2 | passe le garde | 1 |
| T4 | layout structural 1 pièce x=950, tôle 1000, pièce 100 | `layout_fits_sheet` False ; `build_*` None | 1 |
| T5 | `verify_layout` hors tôle **moteur** | `insideSheet` False, alt **conservée** | 1 |
| T6 | `small.rotations=[0]`, zone fans | toutes poses = 0° | 2 |
| T7 | `small.rotations=[0,180]` | poses ∈ {0,180}, pas 90/270 | 2 |
| T8 | `rect.rotations=[90,270]` | `detect_*` None | 2 |
| T9 | 310 × 510×10, 1000×2000, space 1 | `plan_lattice` None | 2 |
| T10 | 100 × 100×100, 1000×2000, space 0.1 | 19/col, 6 cols, reste 5 (nombres **existants**) | 2 |
| T11 | `transposedBbox(FAN)` vs bbox `(y,-x)` | égal ; ≠ `rotatedBbox(90)` | 3 |
| T12 | zone B′ solveur qui déborde après map-back | `_zone_solve` [] | 3 |
| T13 | placement `left < 0` | pas `ok` | 3 |
| T14 | `rotations: []` | traité `[0]` à l’entrée | 2 |
| T15 | `selfContained` sans holePlan | false | 2 |

### 8.3 Matrice manuelle (après lots 1–2, THIS DEVICE **et** serveur)

Projet **nouveau** (pas démo). Ctrl+Shift+R si wasm touché (lots 1–3 : non).

| # | Scénario | OK si |
|---|---|---|
| M1 | Banc phare : 100 Trou + 800 Fillx4, 1000×2000, space 2, –X, 4 rotations | Grille rang 0, ~73–74 %, `insideSheet` / `spacingOk` verts, **pas** de pièce hors tôle. Comparer visuellement à l’état actuel (silhouette rectangulaire, pas un L). |
| M2 | Même projet, `rotationCount=1` | Grille **soit** absente (repli moteur) **soit** présente avec **toutes** les pièces à 0°. Aucun fan tête-bêche. Option 1 = moteur si la grille a été rejetée. |
| M3 | 1 pièce 998×998, tôle 1000×1000, space 2 | Erreur claire « Part(s) too large… », job **error** propre, worker **vivant** (`docker compose ps`). |
| M4 | 1 pièce 100×100, tôle 1000×2000, space 2 | Nest normal (contrôle négatif de M3). |
| M5 | (lot 3) directions **seulement** –Y, 100+400 fans | Pas de pièce au-dessus de y=2000. Si pas de grille, moteur seul OK. |
| M6 | Isolation (non régression) : nest A, aller sur B pendant le live | B idle, A continue. Ne pas « retester tout §A », juste ce smoke. |
| M7 | Annulation pendant reveal (lot 4 / P-m.8) | Status `cancelled` + refund, pas `done`. |

M1 est le **veto** : si la grille phare casse ou sort de la tôle, rollback du lot 2 (le lot 1 seul ne doit pas changer le pavage).

### 8.4 Ce que tu ne relances pas (sauf doute)

- `determinism_lock.py` (lots 1–3 n’y touchent pas).
- Bench docker e2e complet.
- `cargo test` debug.
- Suites fileprocessing / strip.

---

## 9. Fichiers touchés (carte)

### Lots 1–3 (attendu)

| Fichier | Lots | Nature |
|---|---|---|
| `workers/nesting/core/structure.py` | 1, 2, 3 | `layout_fits_sheet`, rotations lattice, borne `plan_lattice`, bbox B′, `used_w` gauche |
| `workers/nesting/core/main.py` | 1, 2, 4 | `verify_layout` avant DXF + drop structural ; garde 2×space ; rotations `[0]` ; `should_cancel` avant finalize |
| `app/composables/structureClient.js` | 1, 2, 3 | miroir exact |
| `app/composables/localJobPrivate.js` | 1, 2 | `layoutFitsSheet` + `selfContained: Boolean(holePlan)` |
| `app/composables/localBridge.js` | 1 | drop alt structural si `!insideSheet` |
| `app/composables/localPayloadBuilder.js` | 1, 2 | garde 2×space ; rotations vides |
| `server/api/project/[slug]/nest.post.js` | 2, 4 | rotations `[]` ; counts entiers + plafond |
| `workers/nesting/tests/test_structure.py` | 1–3 | matrice T4, T6–T13 |
| `workers/nesting/tests/test_feasibility_guard.py` | 1 | **nouveau** (ou nom équivalent) |
| `app/tests/structureClient.test.js` | 1–3 | miroirs |
| `app/tests/localPayloadBuilder.test.js` | 1, 2 | T1, T2, T14 |
| `data/changelog.js` | 1 (ship) | 1 entrée, pas de jargon audit |
| `AGENTS.md` | 1–2 | pièges #49, #50 |
| `docs/ARCHITECTURE.md` | 1 | 1 phrase : garde 2×space + filet `insideSheet` structural |
| `specs/90-decisions.md` | 1–2 | **local** D-MOT-18 (gitignored) |
| `docs/AUDIT-2026-08-31.md` | ship | petit § « correctifs P/Q » en bas, comme §W — **ne pas** réécrire §P |

### Lot 4 selon items

`metrics.py` : **lecture seule** (P-4 s’en sert, ne pas changer la sémantique `insideSheet`).

### Jamais dans ce chantier

`gravity.rs`, `column_fill.rs`, `localSolverRegistry.js`, `files.js`, `LiveNestingView.vue`, `PLAN-coupe-commune.md`, wasm (lots 1–3).

---

## 10. Pièges AGENTS à ajouter (texte prêt à coller)

```
49. **Garde faisabilité = w + 2·space, pas w + space.** jagua offset
    space/2 sur l'item ET le conteneur (import.rs). w + space <= sw
    laisse passer 8×8 / tôle 10 / space 2 → panic SPP lbf.rs
    « strip-width is running away » (panic=abort). BPP dégrade.
    Verrou : test_feasibility_guard + localPayloadBuilder.test.js.
50. **Pass structurel : légalité, pas seulement le compte.** Le lattice
    ne pose que des angles ∈ rotations demandées (rotationCount=1 →
    pas de 180/90). plan_lattice return None si la grille rect sort
    de la tôle. Filet final : alt structural avec insideSheet=false
    → repli moteur (verify_layout déjà le savait, ce n'était qu'un
    badge). Ne PAS jeter les alts moteur hors tôle (piège #6).
    transposedBbox = R(-90)=(y,−x), distinct de rotatedBbox(90)=(-y,x).
```

**D-MOT-18** (`specs/90-decisions.md`, tête de journal) :

> `DÉCIDÉ` (date du commit) — Filets du pass grille : (1) lattice ⊆ rotations permises ; (2) `plan_lattice` refuse une emprise > tôle ; (3) `insideSheet` bloquant pour l’alt `structural` seulement ; (4) pré-check pièce `w+2·space`. Amendement D-MOT-17, pas un remplacement.

---

## 11. Ordre de travail recommandé (session unique)

1. Extraire `part_fits_any_sheet` + tests T1–T3 (Q-1). Brancher `main.py` + `localPayloadBuilder.js`. Relancer vitest payload + pytest garde.
2. `layout_fits_sheet` + tests T4. Brancher `build_structural_layout` / `buildGridAlternative` / `_finalize_alternative` (déplacer `verify_layout` avant DXF). Vitest structure + pytest structure.
3. P-1 + P-2 + tests T6–T10. **Relancer T10 tout de suite** (régression 19/6/5).
4. P-m.1 + R-m.4.
5. P-3 + P-m.2 + T11–T13. Vérifier que T10 n’a pas bougé.
6. Lot 4 si l’énergie le permet (P-m.8 en priorité : argent).
7. Changelog + AGENTS #49/#50 + D-MOT-18 local + phrase ARCHITECTURE.
8. `npx vitest run` complet. Pytest `workers/nesting/tests/` dans un env **avec shapely**.
9. Manuel M1 + M2 + M3.
10. Commit message :
    ```
    fix(nesting): filets tôle/rotations du pass grille et garde 2×space

    P-4/P-1/P-2/P-3/Q-1 (audit 2026-08-31). Repli moteur si la
    grille sort ou pose un angle interdit. Pré-check jagua w+2·space.
    ```
    Un ou deux commits si tu découpes lot 1 / lots 2–3.
11. **Ne push / CI / deploy que si l’utilisateur le demande.** Attendre le workflow **« Build and publish Docker images »** (pas seulement `app-ci`) avant `docker compose pull` (runbook `specs/infra/DEPLOY-HETZNER.md`).

---

## 12. Risques et non-régressions

| Risque | Mitigation |
|---|---|
| Q-1 rejette des pièces qui « rentraient » visuellement | C’est le but : elles ne rentraient pas pour jagua. Banc 100 mm / 1000 mm : marge énorme. M4 contrôle. |
| P-1 fait disparaître la grille en `rotationCount=1` | Acceptable : mieux un –X moteur légal qu’une grille illégale rang 0. M2. |
| P-2 fait disparaître la grille lattes larges | Acceptable : elle était hors tôle. |
| P-3 casse les nombres `TestObjectiveY` | Ajuster uniquement ce qui dépend de `used_w` ; map-back figé. |
| Double `verify_layout` (avant + après DXF) | Un seul appel, déplacé avant l’export. |
| Oublier le miroir JS | Review : `git diff --stat` doit montrer `structure.py` **et** `structureClient.js` pour lots 1–3. |
| Committer `.testparts` / spike / PLAN-coupe-commune | `.gitignore` ; `git status` avant commit. |
| Toucher `rotatedBbox(90)` en « corrigeant » P-3 | P-3 = **transposedBbox seulement**. Test T11 fige la distinction. |

---

## 13. Définition de « terminé »

- Lots **1 + 2** mergés, tests T1–T10 verts, manuel M1–M4 faits.
- Lot **3** mergé ou ticket ouvert avec T11 écrit (ne pas le « plus tard » sans test déjà rouge).
- Lot 4 : au minimum P-m.8 + P-m.7/Q-m.3, ou explicitement reporté.
- Changelog + AGENTS 49/50 + D-MOT-18 local.
- Aucun fichier CLC, aucun wasm dans le diff des lots 1–3.
- Vitest **≥ 348** et vert. Pytest nesting vert **avec shapely**.

Si tu dois t’arrêter : **livrer le lot 1 seul**. C’est déjà le filet qui transforme P-2/P-3 en repli, et Q-1 en message. Les lots 2–3 deviennent alors de la qualité, plus de la sécurité du livrable.
