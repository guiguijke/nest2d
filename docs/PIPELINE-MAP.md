# PIPELINE-MAP — Cartographie du pipeline géométrique (Phase 0, mission v2)

Date : 2026-08-05 · Référence vérité pour le portage Rust dual-target.
Sources lues : tout `workers/fileprocessing/`, `workers/nesting/core/` (metrics,
holed_polygons, svg_colored, main), `workers/common/` (geometry, worker_loop,
refund, compute_tokens, crypto), `server/utils/entitlement.js`, specs 00/10/20/
30/70 + `spike/VERDICT.md`, ezdxf 1.4.4 (implémentations lues dans le site-packages).

## 1. Chaîne actuelle (Python), étape par étape

### 1.1 Import fichier (fileprocessing worker)

```
upload → Mongo user_dxf_files (status pending)
  → worker_loop claim → process_file(doc) :
    1. _make_dxf_copy(doc)           # frontière de normalisation
       - detect_format(bytes)        # SIGNATURE CONTENU (AC10xx → dwg, "<svg" → svg), jamais l'extension
       - svg → svg_bytes_to_drawing  # (§1.2)
       - dwg → dwgread (LibreDWG subprocess) → DXF bytes → read_dxf   # SERVEUR ONLY (mission v2)
       - dxf → read_dxf              # (§1.3)
       → écrit copie dans GridFS validDxf (DXF mm canonique, $INSUNITS=4, $MEASUREMENT=1)
    2. _set_valid_entity_count       # len(modelspace) ; > MAX_ENTITY_LIMIT (env, défaut 999) → worker_tag="1k_entity_count", return False (retry)
    3. _close_polygon_from_dxf       # build_geometry (§1.4) → polygonParts (coords+holes+handles+color)
    4. _make_svg_file                # preview SVG (svg_generator.py — rendu simple, app)
```

### 1.2 SVG → Drawing (svg_to_drawing.py)

- `svgelements.SVG.parse(reify=True)` : tout normalisé en **px CSS 96 dpi**
  (unités, viewBox, transforms imbriquées). `mm = px × 25.4/96`.
- Éléments convertis : Path, Rect, Circle, Ellipse, Line, Polyline, Polygon
  (le reste skip avec warning ; strokes = center lines, jamais d'outline).
- Aplatissement : segments droits = 2 points ; courbes → `n = clamp(2, ceil(length/0.5px)+1, 512)`
  points uniformes — **`segment.length()` est une approximation adaptative
  svgelements** (risque parité Phase 2, §4.3).
- y inversé (SVG y-down → DXF y-up) ; doc écrit `$INSUNITS=4/$MEASUREMENT=1`.
- Aucune géométrie convertible → ValueError → erreur fichier propre.

### 1.3 DXF → Drawing (dxf_utils.py + worker_common/geometry/)

`read_dxf_file(path, normalize_units=True)` :
1. `ezdxf.recover.readfile` (répare les erreurs mineures ; DXFStructureError → None).
2. **Suppression** TEXT/MTEXT/IMAGE/SOLID.
3. `recursive_decompose(msp)` : INSERT (blocs, y compris imbriqués) → primitives
   modelspace ; HATCH conservé puis converti en lignes via `hatch_entity`
   (boundary → segments droits).
4. **Decompose PUIS scale** : `$INSUNITS` → facteur mm (1:25.4, 2:304.8, 4:1,
   5:10, 6:1000, 8:2.54e-5, 9:0.0254 ; 0/inconnu → 1.0 + warning).
   `Matrix44.scale` uniforme sur chaque entité. Copie validDxf = mm canonique
   (relue avec normalize_units=False — jamais re-normaliser, AGENTS #27).
5. Traceability : `sourceUnits` (code $INSUNITS source) sur le doc.

`convert_entity_to_shapely(entity, tol)` (dxf_parser.py) — **le subset réel** :
| Entité | Tessellation | Détail exact |
|---|---|---|
| LINE | 2 points | start/end |
| LWPOLYLINE | sommets seuls | `get_points(format="xy")` — **bulges ignorés (D-IMP-8)** ; closed → +1er point |
| POLYLINE | sommets seuls | idem (`is_closed`) |
| ARC | `flattening(sagitta=tol)` | count = ceil(span/α), α = 2·asin(chord/2r), chord = 2·√(2r·s−s²) ; angles uniformes linspace(start, stop, count+1) ; rayon < tol → vide |
| CIRCLE | idem | span 2π, count+1 points, premier=dernier |
| ELLIPSE | `flattening(distance=tol)` | adaptatif récursif, segments min 8 (ezdxf.math.ConstructionEllipse) |
| SPLINE | `flattening(distance=tol)` | adaptatif récursif, segments min 4 (ezdxf.math.BSpline) |
| POINT | 1 point | footprint uniquement |
| autres (3DFACE, MLINE, PROXY…) | skip warning | pts vides → ignorés |

`tol` = `doc["flattening"]` (0.01 pour la démo) ; clamp min 0.001. Fermeture :
premier/dernier < tol → Polygon sinon LineString.

### 1.4 Polygonisation (build_geometry.py) — DXF → polygonParts

1. Linework = anneaux fermés (ext seuls) + segments ouverts ;
   `unary_union` → `set_precision(GRID_SIZE=1e-4)` → `unary_union` (noding)
   → `polygonize` → faces.
2. **Even-odd** (D-IMP interne) : profondeur de containment via cycles uniques
   (clé = frozenset coords arrondies 1e-4) ; impair = matière, pair = trou.
3. `buffer(0)` (réparation self-intersections) → `unary_union(grid_size=1e-4)`
   → corps disjoints.
4. `_merge_near_polygons(0.1)` : union-find sur distances ; weld =
   `buffer(+0.1, mitre 5.0)` → `buffer(−0.1, mitre 5.0)` (trous préservés).
5. Attachement handles : encre = boundary ; `body.buffer(tol).intersects`,
   meilleure mesure (longueur sinon aire) ; sinon plus petite silhouette
   contenant le centroïde.
6. `to_mongo_dict` : drop si bbox < 0.1 mm ; **reduce_ring** (point gardé si
   Δx ou Δy > 0.01) ; holes ≥ 3 points ; `width/height` = bbox ; couleur
   (palette, assignée par l'appelant — D-COL-1).

### 1.5 Pré-traitement nesting (nesting worker, main.py)

- `has_holes` si fillHoles ET `channels_usable(space)` (channel_width = min(max(0.01, space+0.1), 2.5) > space) ; sinon trous scellés (D-MOT-2).
- Canal capillaire (`holed_polygons.open_holes_with_channels`) :
  `nearest_points(trou, extérieur)` → segment allongé (±2·width) →
  `buffer(width/2, cap=flat)` = rectangle → **une seule** `difference(unary_union)`
  (fallback set_precision 1e-6) → `make_valid` si dégénéré (plus grand morceau).
  `narrow_concavity_cutoff: null` dans la config moteur (D-MOT-1).
- D-MOT-16 : remplir les trous **avant** le solve (`plan_hole_fills` :
  pinwheel même type + glouton aire-d'abord, pièces mixtes ; repli J-085
  1+1). Hôtes remplis → trous fermés, ids réindexés 0..n-1 + `idMap`.
- Instance jagua : items (id, demand, allowed_orientations, simple_polygon),
  SPP si 1 format, aire ≤ 80 %, ET (`stock === 1` OU –X seul) ; sinon BPP.
  Seed = SHA-256(instance+space+budget) tronqué 63 bits.
- Config : time_budget, workers, biases, plateau, min_item_separation=space.

### 1.6 Exports + rapport

- DXF résultat (main.py:240-310) : **entités d'origine** copiées via xref.Loader
  (couches/couleurs intactes, P6), transformées par placement (rotation+translation
  exactes) ; BIN_BOUNDARY (couche 5 bleu) toujours ; OUT_SHAPE (couche 1 rouge)
  si demandé ; échelle export mm→unité (`output_scale_and_headers` : inch =
  ×1/25.4 exact, $INSUNITS=1, $MEASUREMENT=0 ; sinon $INSUNITS=4, $MEASUREMENT=1).
- `svg_colored.build_colored_sheet_svg` : rendu couleur par pièce,
  `translate(x, H−y) scale(1,−1) rotate(θ)` (D-COL-5, flip obligatoire),
  fill-opacity 0.35 (D-COL-3), evenodd.
- Rapport (metrics.py) : `_placed_polygon` (anneau moins trous, rotation
  radians autour de (0,0) puis translation) ; per_sheet aires VRAIES ;
  densité mesurée = partsArea/sheetArea (0,1 pt) ; offcut = plus grand
  rectangle vide GARANTI : scan exact (budget 60 pièces/600 sommets/
  grille 40 000) sinon repli bande ; `reusable = min(w,h) ≥ 100 mm`
  (OFFCUT_REUSABLE_MIN_MM).

### 1.7 Infra worker_common (à reproduire à l'identique en Phase 6)

- `worker_loop.py` : claim atomique `find_one_and_update` (pending→processing),
  heartbeat `update_ts` 10 s, SIGTERM → job re-pending ; statuts :
  fileprocessing = `processingStatus` pending/processing/completed/error
  (`result_based_completion` : résultat falsy → re-pending) ; nesting =
  `status` pending/processing/done/error/cancelled (+ `priority` sort).
  Jetons compute (pool 16, lease heartbeat 10 s, reaper 60 s) pour le nesting.
- Progression live (nesting) : `progress {stage,label,done,total,elapsed_sec,
  evals}` écrit ≤ 1/2 s + heartbeat 2 s ; `liveLayout` ≤ 1/2 s ; stages :
  preparing → solving → exporting → finalizing (libellés i18n app).
- Erreurs (nesting) : "Not all items could be placed…", spacing trop grand,
  "Part(s) too large…", cancelled → `information` surfacée au client.
- `refund.py` : free → freeNestingUsed−1 ($gt:0) ; demo → demoNestingUsed−1 ;
  grant/subscription → rien ; `charge.refunded` marqueur idempotent.
- GridFS : buckets userDxf/validDxf/userDxfFilesSvg/results ; vault DEK
  (get_dek → session ; resolve_polygon_parts déchiffre si vault).

## 2. Choix de crates (figés)

| Besoin | Choix | Motif |
|---|---|---|
| **DXF read** | **parser minimal maison** (`nest-import`) — **tranché après prototype (2026-08-06)** | La parité exigée est avec le COMPORTEMENT d'ezdxf (recover tolérant, décomposition INSERT récursive, formules de tessellation, $INSUNITS) — aucune crate ne le fournit. Prototype `dxf` 0.6.1 : couvre le subset (LINE/LWPOLYLINE/POLYLINE+VERTEX/ARC/CIRCLE/ELLIPSE/SPLINE/POINT/INSERT ; **pas de HATCH**), fidélité f64 identique (même parse IEEE) — mais parsing strict (pas de recover : fichier mineur-cassé = échec total, là où ezdxf répare), 12 dépendances, et la couche sémantique (decompose/recover/tessellation/unités) reste maison de toute façon. La crate n'épargne qu'un tokenizer de ~150 lignes. **Choix : parser maison.** |
| Tessellation | réplication ezdxf exacte (arc/circle : sagitta formule ; ellipse/spline : adaptatif récursif min 8/4 segments) | Parité bit-exacte documentée par harnais. Transcendantales via `libm` (règle AGENTS #14b — msvcrt/glibc/wasm sinon divergent). |
| Polygonisation (noding/polygonize/even-odd/union) | **réplication maison sur planaire arrangement exact** OU `geo`+`i_overlay` | Point de décision Phase 1 — voir §4.2 : shapely(GEOS) ≠ i_overlay bit-à-bit sur les intersections. Stratégie : mesurer ; si divergence, algorithme partagé maison (snap 1e-4 + polygonize déterministe) appliqué DES DEUX CÔTÉS (amendement spec requis si ça change la prod Python — à valider au harnais). |
| SVG | **réplique svgelements maison** (feature `svg`), PAS usvg — **amendement 2026-08-07 (J-064)** | usvg convertit arcs/ellipses en Béziers cubiques → longueurs/échantillonnage différents → parité bit-exacte structurellement impossible. La réplique (tokenizer + longueurs + d()-roundtrip + Matrix) passe le gate SVG 100 %. Feature `svg` par défaut ; bundle léger via `--no-default-features`. Poids : docs/PR2-POIDS.md. |
| Booléens (canaux) | **arrangement maison (difference)** — ring-splice ÉCARTÉ — **amendement 2026-08-07 (J-067)** | Tranché au harnais `channels.py` : difference 0 défaut qualité (7 identiques + 6 delta + 4 metrics-ok), splice 14/17 défauts (auto-intersections + trous encore enfermés sur anneaux courbes). difference = même sémantique GEOS que la prod → aucun amendement Python requis. |
| **Exports DXF** (`nest-export`, PR3) | writer DXF ASCII sémantique build_part (J-069/070) : entités source préservées (bulges/couleur/closed), BIN_BOUNDARY(5)/OUT_SHAPE(1), scale unité + headers AC1027 | Parité **sémantique** : ezdxf parse les 2 sorties, canonise, 1e-9 mm (OUT_SHAPE exclus = bbox ezdxf approx). Lisible par ezdxf ET dxf_parser app. |
| **Exports SVG** (`nest-export`, PR3) | tôle colorée + preview, réplique formatage Python (pyfloat) | Parité **byte-level** SHA-256 tol. 0 (J-071). |
| **Rapport** (`nest-report`, PR3) | réplique metrics.py (per_sheet/totals/used_share/offcut/verify_layout) | Parité **valeurs** 1e-6 ; offcut exact-scan comparé en régime band (J-072). |
| **Bundle navigateur** (`nest-geometry-wasm`, PR4) | une instantiation wasm (import+preprocess+export+report) servie à `/geometry/*`, lazy + worker réutilisé (J-073) | Diff **client/serveur** bloquant en CI (`client_server_diff.py`, J-074) : SVG byte-level, rapport 1e-6, import = golden. Flag OFF en prod. |
| WASM glue | wasm-bindgen + wasm-opt | Reproduit spike (349 Ko moteur). |
| ZIP client | fflate (JS) | Acté hors Rust. |

## 3. Contrat d'interface (natif + WASM)

```
nest-import :
  import_dxf(bytes, flatten_tol_mm) -> { parts: [ { coordinates, holes[],
      widthMm, heightMm, sourceUnits, entityCount } ], warnings: [] }
  import_svg(bytes) -> idem (y inversé, px→mm)          [Phase 2]
nest-preprocess (Phase 2) :
  open_holes(outer, holes[], space_mm) -> simple_polygon | fallback_outer
nest-export (Phase 3) :
  result_dxf(placements, source_entities, layers, out_unit) -> bytes
  report_metrics(containers, items) -> report JSON (sheets[]/totals{})
```

Natif = lib Rust (workers Phase 6) ; WASM = même crate compilée
wasm32-unknown-unknown (client Phase 4). **Aucune API browser-only.**

## 4. Risques et réponses (registre)

### 4.1 Gate de parité recalibré (amendement 2026-08-06 — remplace le gate 1e-9 binaire)

Faits : (1) le pipeline snappe déjà à 1e-4 (`set_precision`) — après snap,
les divergences ulp GEOS vs i_overlay disparaissent sauf aux sommets tombés
sur une frontière de grille ; la mesure = **taux de divergence POST-SNAP**,
pas 1e-9 brut. (2) La promesse utilisateur est INTRA-pipeline (même fichier
+ même mode = même layout, via la seed déterministe) ; la parité cross
client/serveur est un outil QA / exigence dual-run Phase 6, pas une promesse
publique. (3) 1e-4 mm = 0,1 µm — un kerf réel fait ~1,5 mm.

**Seuils d'acceptation (figés AVANT mesure)** :
- ≥ 99 % des fichiers du corpus **bit-identiques après snap 1e-4** → GO ;
- fichiers divergents : comparaison sur métriques (densité, holesFilled,
  usedSheetShare) à tolérance 1e-3, documentée au harnais ;
- divergence structurelle (> 1 %) → alors seulement l'option « arrangement
  partagé maison porté DES DEUX CÔTÉS (amendement spec, la prod Python
  change) » se justifie, avec entrée J au journal.

**Le gate Phase 4 devient : seuils ci-dessus validés au harnais.**

1. **Parité polygonize** : mesurer le taux post-snap (seuils §4.1) avant
   toute réécriture lourde.
2. **Canaux** : ring-splice = **candidat principal** (arithmétique pure,
   zéro booléen, topologiquement équivalent au canal capillaire) —
   prototypé CONTRE i_overlay ; le harnais tranche (parité + holesFilled +
   D-MOT-2). Si le splice gagne et remplace la différence GEOS côté prod
   Python, amendement D-MOT-1 requis (la prod change).
3. **SVG length()** : approximation adaptative svgelements — répliquer son
   quadrature exactement ou admettre une tolérance (décision Phase 2 au
   harnais ; les exports SVG sont rarement des pièces de précision… à mesurer).
4. **Poids wasm** : parser DXF maison ≈ 50-100 Ko ; usvg ~1-2 Mo brut en
   **chunk lazy** (bundle principal moteur+DXF ≈ 450 Ko gz attendus ;
   budget total +2 Mo gz) ; i_overlay ~100 Ko.
5. **Couverture entités** : jamais moins que le subset §1.3 ; toute entité
   inconnue = skip + warning (parité du comportement, pas de crash).
6. **Phase 6** : dual-run obligatoire, statuts/progression identiques,
   refund sémantique exacte (tests dédiés), taxonomie d'erreurs portée
   explicitement (liste §1.7).
7. **MAX_ENTITY_LIMIT côté client (amendement 2026-08-06)** : en prod
   Python, le dépassement déclenche un retry worker ; dans un navigateur il
   n'y a pas de worker — Phase 4 spécifie une **erreur UI propre (i18n
   EN+FR) proposant le mode serveur** (qui, lui, a le retry), jamais un
   échec silencieux.

## 5. Corpus du harnais de parité (permanent, CI)

- `workers/fileprocessing/tests/fixtures/` : Piece_Trou.DXF, Piece_Fillx4.DXF
  (trous), sample_shapes.svg, fixture_dwg_test.dwg (DWG = serveur only, contrôle).
- `server/seed/demo/marine_lpl_001..024.dxf` (arcs réels, trous, ~304 pièces).
- DXF cassés représentatifs : duplicate handles (recover), $INSUNITS variés
  (1/2/4/5/6/9), unitless, bulges (ignorés), HATCH, blocs imbriqués, zéro
  entité, texte seul, > MAX_ENTITY_LIMIT. Générés par `corpus/build_corpus.py`.
- Golden files : JSON produit par le pipeline Python (référence), comparé au
  sortie Rust à 1e-9. **Toute divergence = échec CI.**

## 6. Ce que Phase 6 réutilise (checklist worker binaire Rust)

Polling Mongo (claim atomique, heartbeat, SIGTERM→re-pending), statuts EXACTS
(§1.7), progression live (throttles 2 s/1 s, champs progress/liveLayout/evals),
GridFS buckets + vault (session DEK, wrap/unwrap master key), compute pool
(16 jetons, acquire atomique, leases 60 s), refund exact, dwgread subprocess,
taxonomie d'erreurs, couleurs palette 24 + fallback sha1 (D-COL-1/2), unités
(outputUnit), exports DXF/SVG/zip.
