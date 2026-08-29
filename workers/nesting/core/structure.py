"""Pass structurel (grille canonique) — SPP mono-tôle.

Cas cible : un item RECTANGULAIRE dominant en quantité (les hôtes fermés du
J-085 se réduisent exactement à ça) + des petites pièces. Le solveur SPP
minimise la largeur et est indifférent à la FORME (piège #14e) : à 0,1 mm
d'espacement il gagne ~10 mm en quinconçant les carrés AVEC les fans —
52 « colonnes » échelonnées, fans éclatés (mesuré 2026-08-28). Ce pass
construit le layout canonique :

  - k colonnes pleines de l'item rectangulaire, pitch exact (dim + space),
    marges space aux bords de tôle ;
  - colonne k+1 : le reste en bas, les petites pièces au-dessus (zone A) ;
  - zone B à droite de la grille : les petites pièces restantes.

Les petites pièces sont posées par SOUS-SOLVES moteur (« petites pièces
seules », strip = hauteur de zone, largeur plafonnée) via un callback
injecté : `run_engine` natif côté serveur, mini-pool wasm côté navigateur.
Le layout produit est une solution de l'instance RÉDUITE (ids de solve) :
l'expansion J-085 et le post-pass hole-fill s'appliquent ensuite à
l'identique. Garde de repli : tout échec renvoie None — JAMAIS de layout
invalide, le résultat moteur est livré tel quel.
"""

import math
import os

# Le layout structurel remplace le rang 0 si largeur ≤ meilleure moteur ×
# (1 + tol). Garde de sanité anti-absurde — PAS un budget serré : le packing
# wasm mono-walk des zones est plus lâche que le natif (constaté navigateur
# vs banc : ~750 vs ~729 pour 652 moteur).
STRUCT_TOL = float(os.environ.get("NEST_STRUCT_TOL", "0.20"))
# Densité de la demande INITIALE (le sous-solve valide ; la boucle de repli
# réduit si ça déborde — demander gros d'abord).
ZONE_A_DENSITY = 0.95
# Budgets des sous-solves (zone A étroite : converge vite ; zone B large :
# la densité du bloc en dépend directement).
ZONE_A_BUDGET_SEC = 30
ZONE_B_BUDGET_SEC = 45
ZONE_C_BUDGET_SEC = 25
# Encadrement par zone : borné en appels moteur (temps mur), rétrécir à
# l'échec (×0,6 tant que rien ne tient) puis REGONFLER au succès (+15 %) et
# bissecter entre le meilleur faisable et le premier infaisable — « compacter
# encore et encore » (demande user 2026-08-28 : remplir chaque zone à son
# vrai maximum, la bande de droite ne garde que l'incompressible).
ZONE_MAX_ATTEMPTS = 5
# « Rectangles successifs » (demande user 2026-08-29 : chaque zone = des
# rectangles PLEINS empilés, pas une bande à moitié vide). Mesuré : le solve
# plafonne à ~57-60 % sur une bande 100 mm ENTIÈRE, mais tient ~60 % PAR
# TRONÇON de 300-500 mm — 3×49 fans sur des pas de 500 vs 89 sur 1500 d'un
# coup. Les zones longues sont donc découpées en pas de ~ZONE_STEP_MM le
# long de leur grand axe, chaque pas rempli ENTIER avant le suivant.
ZONE_STEP_MM = 450.0
# Jamais de dernier tronçon rabougri : fusionné au précédent.
ZONE_STEP_MIN_MM = 150.0
# Abandon d'un tronçon (et des suivants) sous cette fraction du demandé —
# le plafond RÉEL mesuré par tronçon est ~0,57-0,60 du cap 0,95 : couper à
# 0,60 tuerait des tronçons au plafond.
ZONE_STEP_BREAK = 0.45
# Lattice analytique des petites pièces (« compression finale » user
# 2026-08-29 : largueur des blocs fans au plus près du physique). Familles
# de colonnes entrelacées rot0/rot180 (le quart-de-disque s'interpénètre en
# zigzag : pointes fines passant les flancs) — paramètres empiriquement
# validés sur le corpus (0 conflit, min-dist 0,113 à space 0,1) :
#   px = W/2 + space, py = 1.3·H, dy = -0.382·py, orientation = (i+j)%2.
# Bande étroite 100 mm : 67 % mesuré vs ~38-57 % moteur, INSTANTANÉ.
# La validation runtime (STRtree, paires ≥ space) garantit la sécurité :
# forme non compatible → None → repli tronçons moteur.
LATTICE_PY_RATIO = 1.3554
LATTICE_DY_RATIO = -0.378
# Marge de sécurité : le layout se calcule sur les anneaux SIMPLIFIÉS
# (tolérance NEST_SIMPLIFY_MM) mais le DXF exporté copie les courbes
# BRUTES — l'écart peut réduire la distance réelle de 2×tolérance. La
# validation exige donc space + 2×tolérance sur l'anneau simplifié
# (recalibré 2026-08-29 sur ring brut : min-dist 0,2 mesuré).
LATTICE_SIMPLIFY_MM = 0.05
_QUARTER_TURNS = (0.0, 90.0, 180.0, 270.0)


def _shoelace(coords):
    s = 0.0
    for i in range(len(coords) - 1):
        s += coords[i][0] * coords[i + 1][1] - coords[i + 1][0] * coords[i][1]
    return abs(s) / 2.0


def _bbox(coords):
    xs = [p[0] for p in coords]
    ys = [p[1] for p in coords]
    return min(xs), min(ys), max(xs), max(ys)


def is_axis_rect(coords):
    """Anneau externe = rectangle axis-aligné (4 sommets + fermeture)."""
    pts = list(coords)
    if pts and pts[0] == pts[-1]:
        pts = pts[:-1]
    if len(pts) != 4:
        return False
    xs = sorted({round(p[0], 6) for p in pts})
    ys = sorted({round(p[1], 6) for p in pts})
    if len(xs) != 2 or len(ys) != 2:
        return False
    got = {(round(p[0], 6), round(p[1], 6)) for p in pts}
    return got == {(x, y) for x in xs for y in ys}


def _rotated_bbox(bbox, rot_deg):
    """Bbox d'un anneau de bbox donnée tourné de rot (multiple de 90°)."""
    x0, y0, x1, y1 = bbox
    r = (rot_deg % 360 + 360) % 360
    if r in (0.0, 180.0):
        return (x0, y0, x1, y1) if r == 0.0 else (-x1, -y1, -x0, -y0)
    # 90/270 : (x, y) -> (y, -x)
    return (y0, -x1, y1, -x0) if r == 90.0 else (-y1, x0, -y0, x1)


def detect_structural_case(solve_items, geom_of, total_area):
    """Détecte le cas structurel sur l'instance de solve (RÉDUITE).

    `geom_of(item_id)` -> {"coords": [...], "rotations": [...]} (géométrie
    d'ORIGINE, anneaux externes). Conditions conservatrices :
    - exactement 2 classes ;
    - rotations permises des DEUX ∈ {0, 90, 180, 270} uniquement ;
    - la classe dominante : rectangle axis-aligné, aire ≥ 60 % du total ;
    - l'autre : plus grande dimension de bbox ≤ plus petit côté du rectangle.
    """
    if len(solve_items) != 2:
        return None
    infos = []
    for it in solve_items:
        geom = geom_of(it["id"])
        if not geom or not geom.get("coords"):
            return None
        rots = geom.get("rotations") or list(_QUARTER_TURNS)
        if any((float(r) % 360) not in _QUARTER_TURNS for r in rots):
            return None
        infos.append({
            "id": it["id"],
            "demand": int(it.get("demand") or 0),
            "coords": geom["coords"],
            "rotations": [float(r) for r in rots],
            "area": _shoelace(geom["coords"]),
            "bbox": _bbox(geom["coords"]),
        })
    a, b = infos
    for rect, small in ((a, b), (b, a)):
        if rect["demand"] < 8:
            continue
        if not is_axis_rect(rect["coords"]):
            continue
        if rect["area"] * rect["demand"] < 0.60 * total_area:
            continue
        rx0, ry0, rx1, ry1 = rect["bbox"]
        side = min(rx1 - rx0, ry1 - ry0)
        sx0, sy0, sx1, sy1 = small["bbox"]
        if max(sx1 - sx0, sy1 - sy0) > side + 1e-6:
            continue
        return {"rect": rect, "small": small}
    return None


def plan_lattice(case, sheet_w, sheet_h, space, objective="x"):
    """Grille canonique (translations EXTERNES de l'anneau d'origine).

    objective='x' (−X) : colonnes le long de Y, empilées depuis x=0 ; la
    largeur X est minimisée. objective='y' (−Y) : RANGÉES le long de X
    (ancrées gauche), empilées depuis y=0 ; la hauteur Y est minimisée —
    zones A'/C' à droite des rangées, bande B' AU-DESSUS (résolue en
    transposé par l'appelant pour minimiser la hauteur comme la classe
    BottomFirst du moteur).
    """
    rx0, ry0, rx1, ry1 = case["rect"]["bbox"]
    w, h = rx1 - rx0, ry1 - ry0
    pitch_x, pitch_y = w + space, h + space
    n = case["rect"]["demand"]
    ox = space - rx0
    oy = space - ry0

    if objective == "y":
        per_row = int((sheet_w - 2 * space - w) // pitch_x) + 1
        if per_row < 1:
            return None
        n_full, remainder = divmod(n, per_row)
        rows = n_full + (1 if remainder else 0)
        placements = []
        for r in range(rows):
            for c in range(per_row if r < n_full else remainder):
                placements.append({
                    "item_id": case["rect"]["id"],
                    "transformation": {
                        "rotation": 0.0,
                        "translation": (ox + c * pitch_x, oy + r * pitch_y),
                    },
                })
        lattice_top = space + rows * pitch_y
        zone_a = None
        if remainder:
            y0 = space + n_full * pitch_y
            zone_a = (space + remainder * pitch_x, y0, sheet_w - space, y0 + h)
        zone_c = None
        full_right = space + (per_row - 1) * pitch_x + w
        if n_full >= 1 and full_right + space < sheet_w - space:
            zone_c = (full_right + space, space, sheet_w - space,
                      space + n_full * pitch_y)
        zone_b = (space, lattice_top + space, sheet_w - space, sheet_h - space)
        return {
            "placements": placements,
            "lattice_extent": lattice_top,
            "zone_a": zone_a,
            "zone_b": zone_b,
            "zone_c": zone_c,
            "zone_b_transposed": True,
            "per_line": per_row,
            "lines": rows,
            "remainder": remainder,
        }

    per_col = int((sheet_h - 2 * space - h) // pitch_y) + 1
    if per_col < 1:
        return None
    n_full, remainder = divmod(n, per_col)
    cols = n_full + (1 if remainder else 0)
    placements = []
    for c in range(cols):
        for r in range(per_col if c < n_full else remainder):
            placements.append({
                "item_id": case["rect"]["id"],
                "transformation": {
                    "rotation": 0.0,
                    "translation": (ox + c * pitch_x, oy + r * pitch_y),
                },
            })
    lattice_right = space + cols * pitch_x
    zone_a = None
    if remainder:
        x0 = space + n_full * pitch_x
        zone_a = (x0, space + remainder * pitch_y, x0 + w, sheet_h - space)
    # Zone C — bande de fin de colonnes pleines : per_col items ne remplissent
    # JAMAIS exactement la hauteur (sinon per_col+1 tiendrait), il reste un
    # couloir horizontal au-dessus des colonnes pleines. Sans le remplir, le
    # layout montre une longue bande vide « pas naturelle » (constat user
    # 2026-08-28) — l'équivalent déterministe d'une gravité −X : les petites
    # pièces de la zone droite glissent dedans.
    zone_c = None
    full_cols_top = space + (per_col - 1) * pitch_y + h
    band_y0 = full_cols_top + space
    if n_full >= 1 and band_y0 < sheet_h - space:
        full_right = space + (n_full - 1) * pitch_x + w
        zone_c = (space, band_y0, full_right, sheet_h - space)
    zone_b = (lattice_right + space, space, sheet_w - space, sheet_h - space)
    return {
        "placements": placements,
        "lattice_extent": lattice_right,
        "zone_a": zone_a,
        "zone_b": zone_b,
        "zone_c": zone_c,
        "zone_b_transposed": False,
        "per_line": per_col,
        "lines": cols,
        "remainder": remainder,
    }


def _zone_solve(zone, small, space, want, solve_fn, budget_sec,
                transposed=False):
    """Remplit la zone au PLUS PRÈS de sa capacité réelle (encadrement).

    `solve_fn(count, strip_h, max_w, budget_sec, transposed)` -> liste de
    placements {transformation:{rotation, translation}} en repère LOCAL de
    zone (frame de solve : instance transposée (x,y)→(y,−x) si demandé), ou
    None (échec). Le sous-solve rend toute sa demande (bande SPP sans borne
    dure, piège #6) : on mesure la largeur réellement utilisée (bbox des
    transforms externes — `small['bbox']` DOIT être dans la frame de solve).
    Stratégie « compacter encore et encore » : rétrécir (×0,6) tant que rien
    ne tient, puis REGONFLER au succès (+15 %) et bissecter entre le meilleur
    compte faisable et le premier infaisable — borné à ZONE_MAX_ATTEMPTS
    appels moteur. Sans le regonfler, les zones restaient à ~60 % de leur
    capacité (mesuré 2026-08-28) et la bande de droite gardait l'excédent.

    `transposed=True` (bande du haut de la grille −Y) : le solve minimise la
    largeur du problème transposé = la HAUTEUR réelle de la zone ; map-back
    (x, y) → (zone_w − y, x), rotation inchangée (miroir de
    spp.rs::map_back_solution).
    """
    x0, y0, x1, y1 = zone
    zw, zh = x1 - x0, y1 - y0
    if zw <= 0 or zh <= 0 or want <= 0:
        return []
    solve_h = zw if transposed else zh
    solve_w = zh if transposed else zw
    best = None   # placements du meilleur compte faisable connu
    hi = None     # plus petit compte infaisable connu
    n = want
    for _ in range(ZONE_MAX_ATTEMPTS):
        placements = solve_fn(n, solve_h, solve_w, budget_sec, transposed)
        used_w = 0.0
        if placements:
            for p in placements:
                rot = float(p["transformation"]["rotation"])
                tx, _ty = p["transformation"]["translation"]
                bx0, _, bx1, _ = _rotated_bbox(small["bbox"], rot)
                used_w = max(used_w, tx + bx1, -(tx + bx0))
        ok = bool(placements) and len(placements) >= n and used_w <= solve_w + 1e-3
        if ok:
            best = placements
            if n >= want:
                break
            grow = max(1, int(n * 0.15))
            n = min(n + grow, want)
            if hi is not None:
                n = min(n, hi - 1)
            if n <= len(best):
                break
        else:
            hi = n if hi is None else min(hi, n)
            if best is None:
                if n <= 1:
                    return []
                n = max(1, int(n * 0.6))
                if hi is not None and hi > 1:
                    n = min(n, hi - 1)
                if n < 1:
                    return []
            else:
                gap = hi - len(best)
                if gap <= max(1, int(len(best) * 0.06)):
                    break
                n = len(best) + gap // 2
    if not best:
        return []

    def to_sheet(p):
        rot = p["transformation"]["rotation"]
        tx, ty = p["transformation"]["translation"]
        if transposed:
            sx, sy = x0 + (zw - ty), y0 + tx
        else:
            sx, sy = x0 + tx, y0 + ty
        return {
            "item_id": small["id"],
            "transformation": {"rotation": rot, "translation": (sx, sy)},
        }

    return [to_sheet(p) for p in best]


def small_lattice(small, space, rect):
    """Lattice entrelacé des petites pièces dans le rect (convention moteur :
    {rotation, translation} du repère PIÈCE). None si invalide.

    Génération par cellules (i, j) : centroïde placé en
    (cx0 + i·px, C0.y + j·py + [impair]·dy), orientation (i+j)%2 — le
    particule est CENTROÏDE-normalisée par rotation. La bbox entière doit
    vivre dans le rect inset de `space` (parois carrés/tôle). Validation :
    toutes paires proches ≥ space (STRtree).
    """
    try:
        from shapely.geometry import Polygon
        from shapely import affinity
        from shapely.strtree import STRtree
    except ImportError:
        return None
    coords = small.get("coords") or []
    if len(coords) < 3:
        return None
    base = Polygon(coords).buffer(0)
    if not base.is_valid or base.is_empty:
        return None
    area = base.area
    c0 = base.centroid
    bx0, by0, bx1, by1 = base.bounds
    w, h = bx1 - bx0, by1 - by0
    if w <= 0 or h <= 0:
        return None

    def _rot(deg):
        r = math.radians(deg)
        c, s = math.cos(r), math.sin(r)
        q = affinity.affine_transform(base, [c, s, -s, c, 0, 0])
        return affinity.translate(q, c0.x - q.centroid.x, c0.y - q.centroid.y)

    f0 = _rot(0)
    f180 = _rot(180)
    px = w / 2 + space
    py = LATTICE_PY_RATIO * h
    dy = LATTICE_DY_RATIO * py
    x0, y0, x1, y1 = rect
    ix0, iy0, ix1, iy1 = x0 + space, y0 + space, x1 - space, y1 - space
    if ix1 - ix0 < w or iy1 - iy0 < h:
        return None
    cx0 = ix0 + w / 2

    out = []
    i = 0
    while cx0 + i * px + w / 2 <= ix1 + 1e-9:
        cx = cx0 + i * px
        j = -40
        while j < 220:
            even = (i + j) % 2 == 0
            cy = c0.y + j * py + (0.0 if even else dy)
            if cy - h / 2 >= iy0 - 1e-9 and cy + h / 2 <= iy1 + 1e-9:
                p = f0 if even else f180
                p = affinity.translate(p, cx - c0.x, cy - c0.y)
                out.append((0.0 if even else 180.0, p))
            j += 1
        i += 1
    if not out:
        return None
    polys = [p for _d, p in out]
    threshold = space + 2 * LATTICE_SIMPLIFY_MM
    tree = STRtree(polys)
    for a, pa in enumerate(polys):
        for b in tree.query(pa.buffer(threshold)):
            b = int(b)
            if b <= a:
                continue
            if pa.distance(polys[b]) < threshold - 1e-9:
                return None  # forme non compatible : repli moteur
    # -> placements moteur : world = R·p + t  =>  t = centroid_monde - R·centroid_pièce
    placements = []
    for deg, p in out:
        cw = p.centroid
        if deg == 0.0:
            t = (cw.x - c0.x, cw.y - c0.y)
        else:
            t = (cw.x + c0.x, cw.y + c0.y)
        placements.append({
            "item_id": small.get("id"),
            "transformation": {"rotation": deg, "translation": (t[0], t[1])},
        })
    return placements


def _zone_steps(zone):
    """Découpe la zone en rectangles successifs le long de son grand axe
    (depuis l'origine : le côté ancré aux carrés pour A/C). Retourne la
    liste des rects ; une zone courte = un seul rect (elle-même)."""
    x0, y0, x1, y1 = zone
    w, h = x1 - x0, y1 - y0
    if w >= h:
        n = max(1, int(w / ZONE_STEP_MM + 0.5))
        step = w / n
        if step * (n - 1) < ZONE_STEP_MIN_MM:
            n = max(1, n - 1)
            step = w / n if n else w
        return [(x0 + i * step, y0, x0 + (i + 1) * step, y1)
                for i in range(max(1, n))]
    n = max(1, int(h / ZONE_STEP_MM + 0.5))
    step = h / n
    if step * (n - 1) < ZONE_STEP_MIN_MM:
        n = max(1, n - 1)
        step = h / n if n else h
    return [(x0, y0 + i * step, x1, y0 + (i + 1) * step)
            for i in range(max(1, n))]


def build_structural_layout(solve_items, geom_of, sheet_w, sheet_h, space,
                            solve_zone_fn, objective="x", hole_plan=None):
    """Layout canonique complet ou None (repli moteur).

    `solve_zone_fn(count, strip_h, max_w, budget_sec, transposed)` : cf.
    _zone_solve — l'appelant construit l'instance (coords transposées
    (x,y)→(y,−x) quand demandé). `objective='y'` : grille −Y (rangées le
    long de X, minimisée en hauteur). Retour : {"placed_items": [...],
    "case": {...}} — placements dans le repère tôle, ids de l'instance de
    solve.

    `hole_plan` (constat 2026-08-29 : « trous d'abord » J-085 absorbe les
    petites pièces à demande exacte → instance réduite à 1 classe, jamais
    de grille) : {"host_item", "fill_id", "ring_rotations"} — l'item hôte
    (trous compris), l'id du filler et les rotations pinwheel validées par
    anneau. L'appelant passe alors la vue ORIGINALE à 2 classes (ids
    d'origine) : les trous forment un 2e réservoir ENTRE les zones internes
    C et la zone B — la silhouette reste rectangulaire pleine (« compacter
    sur X- sur toute la longueur Y », demande user), et le layout est
    AUTO-SUFFISANT (l'aval saute remap idMap + expansion meta + post-pass
    hole-fill pour cette alternative : apply_hole_fill téléporterait les
    fillers des zones vers les trous restés vides).
    """
    total_area = sum(
        _shoelace(geom_of(it["id"])["coords"]) * int(it.get("demand") or 0)
        for it in solve_items
    )
    case = detect_structural_case(solve_items, geom_of, total_area)
    if case is None:
        return None
    lat = plan_lattice(case, sheet_w, sheet_h, space, objective=objective)
    if lat is None:
        return None
    placements = list(lat["placements"])
    n_small = case["small"]["demand"]
    # bbox de la petite pièce DANS LA FRAME DE SOLVE (zone B transposée :
    # les coords d'instance sont tournées, la bbox de mesure aussi).
    small_solve = case["small"]
    if lat["zone_b_transposed"]:
        sx0, sy0, sx1, sy1 = case["small"]["bbox"]
        small_solve = dict(case["small"], bbox=(-sy1, sx0, -sy0, sx1))

    def fill_zone(zone, want, budget, transposed=False):
        """Remplit la zone : LATTICE ANALYTIQUE d'abord (« compression
        finale », user 2026-08-29 : bloc fans au plus près du physique,
        déterministe et instantané — 67 % mesuré en bande étroite vs 38-57 %
        moteur), puis tronçons moteur pour le surplus."""
        if not zone or want <= 0:
            return 0
        got_total = 0
        if not transposed:
            lat = small_lattice(case["small"], space, zone)
            if lat:
                # TOUT-OU-RIEN : le sous-solve moteur ne voit PAS les pièces
                # déjà posées — un top-up dans la même zone les écraserait
                # (300 fans dans une zone qui en tient 231, mesuré
                # 2026-08-29). Le surplus va aux zones suivantes.
                take = lat[:want]
                placements.extend(take)
                return len(take)
        steps = _zone_steps(zone)
        for step_rect in steps:
            if got_total >= want:
                break
            zx0, zy0, zx1, zy1 = step_rect
            cap = int((zx1 - zx0) * (zy1 - zy0) * ZONE_A_DENSITY
                      / max(case["small"]["area"], 1e-6))
            want_step = min(want - got_total, max(0, cap))
            if not want_step:
                continue
            got = _zone_solve(step_rect, small_solve, space, want_step,
                              solve_zone_fn, budget, transposed=transposed)
            placements.extend(got)
            got_total += len(got)
            if len(got) < want_step * ZONE_STEP_BREAK:
                # tronçon saturé très loin sous sa demande : les suivants
                # (même forme) ne feront pas mieux.
                break
        return got_total

    # Ordre de remplissage : A puis C — toutes deux SANS coût sur l'axe
    # objectif — puis les trous des hôtes (gratuits, invisibles), puis B
    # (seule à étendre le layout sur cet axe).
    used_a = fill_zone(lat["zone_a"], n_small, ZONE_A_BUDGET_SEC)
    used_c = fill_zone(lat["zone_c"], n_small - used_a, ZONE_C_BUDGET_SEC)
    used = used_a + used_c

    hole_used = 0
    if hole_plan and used < n_small:
        from core.holefill import expand_meta
        per_host = sum(len(rr or []) for rr in hole_plan["ring_rotations"])
        n_hosts = len(lat["placements"])
        budget = min(n_small - used, per_host * n_hosts)
        if budget > 0:
            slots = []
            for _ in range(n_hosts):
                if budget <= 0:
                    break
                k = min(per_host, budget)
                slots.append(k)
                budget -= k
            layout = {"container_id": 0, "placed_items": placements}
            out = expand_meta([hole_plan["host_item"]], case["rect"]["id"],
                              hole_plan["fill_id"], slots, [layout],
                              hole_plan["ring_rotations"])
            placements = list(out[0]["placed_items"])
            hole_used = sum(slots)

    left = n_small - used - hole_used
    if left > 0:
        got = _zone_solve(lat["zone_b"], small_solve, space, left,
                          solve_zone_fn, ZONE_B_BUDGET_SEC,
                          transposed=lat["zone_b_transposed"])
        if len(got) < left:
            return None  # zone B saturée : repli moteur
        placements.extend(got)
    return {
        "placed_items": placements,
        "case": {"per_line": lat["per_line"], "lines": lat["lines"],
                 "remainder": lat["remainder"], "objective": objective,
                 "holes": hole_used},
    }


def layout_used_extent(layout, geom_of, space, axis="x"):
    """Étendue utilisée du layout structurel sur l'axe (bbox + marge)."""
    max_far = 0.0
    for p in layout["placed_items"]:
        geom = geom_of(p["item_id"])
        bb = _rotated_bbox(_bbox(geom["coords"]), float(p["transformation"]["rotation"]))
        if axis == "x":
            far = p["transformation"]["translation"][0] + bb[2]
        else:
            far = p["transformation"]["translation"][1] + bb[3]
        max_far = max(max_far, far)
    return max_far + space


def layout_used_width(layout, geom_of, space):
    """Largeur utilisée du layout structurel (bbox externe + marge droite)."""
    return layout_used_extent(layout, geom_of, space, axis="x")
