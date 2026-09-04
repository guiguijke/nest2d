"""Constructeur de grille multi-tôles (plan 2026-09-05 §2.2b, partie 2).

En mono-tôle, l'utilisateur a deux propositions : la grille canonique et
le résultat moteur compact. En multi-tôles il n'en avait qu'une, HYBRIDE :
tôle 1 = moteur compact, tôle 2 = re-grillée par la compaction donneuse.
Ce module construit l'alternative « Grille » HOMOGÈNE sur toutes ses
tôles, sans moteur :

- tôles 1..N−1 = grille canonique PLEINE (hôtes au pas `w + s` ancrés
  `(s, s)`, petites pièces dans les trous des hôtes en pinwheel validé
  PUIS dans les bandes résiduelles autour du bloc d'hôtes via
  `small_lattice`) ;
- tôle N = colonnes d'hôtes depuis −X + lattice des petites derrière
  (construit puis compacté par `_compact_last_sheet(regrid=True)` —
  exactement la machinerie de la donneuse, rollback compris) ;
- style identique partout : hôtes TOUJOURS au pas `w + s` sur l'axe des
  colonnes, petites pièces TOUJOURS en lattice analytique.

Généricité (§5 du plan correctif 2) : la grille n'existe QUE si
`detect_structural_case` reconnaît le motif « classe rectangulaire
dominante + petite classe » (les autres géométries n'ont pas de grille
canonique). Tout-ou-rien : si la demande ne tient pas dans le stock, pas
d'alternative (None + erreur tracée) — JAMAIS une grille partielle.

Chaque tôle est validée physiquement (`_validate_batch` : anneaux à
`space − ε`, hors tôle interdit) ; l'invariant de sécurité est le
compte : le layout couvre exactement la demande ou n'existe pas.

Miroir JS : app/composables/structureMultiClient.js (parité chiffrée
verrouillée par tests : comptes par tôle, AABB à 1e-6).
"""
import logging
import math

from core.holefill import pinwheel_capacity
from core.residual import (
    _compact_last_sheet, _validate_batch, layout_aabb, residual_bands,
)
from core.structure import (
    _shoelace, detect_structural_case, layout_fits_sheet, small_lattice,
)

logger = logging.getLogger(__name__)


def _slot_list(sheets):
    """Stock aplati : [(format_id, w, h)] dans l'ordre déclaré, count fois."""
    slots = []
    for fmt_id, sh in enumerate(sheets or []):
        n = int(sh.get("count") or 0)
        for _ in range(n):
            slots.append((fmt_id, float(sh.get("width") or 0),
                          float(sh.get("height") or 0)))
    return slots


def host_grid_capacity(rect_bbox, sheet_w, sheet_h, space):
    """Capacité en hôtes d'une tôle PLEINE : grille au pas `w + s` ancrée
    `(s, s)` (orientation 0° uniquement, P-1 : la grille pose les
    rectangles à rotation 0). `floor((W − 2s − w)/(w+s)) + 1` par axe."""
    rx0, ry0, rx1, ry1 = rect_bbox
    w, h = rx1 - rx0, ry1 - ry0
    s = float(space or 0)
    if w <= 0 or h <= 0 or sheet_w <= 0 or sheet_h <= 0:
        return 0
    px, py = w + s, h + s
    cols = int((sheet_w - 2 * s - w) // px) + 1
    rows = int((sheet_h - 2 * s - h) // py) + 1
    if cols < 1 or rows < 1:
        return 0
    return cols * rows


def _host_grid_poses(rect, count, sheet_w, sheet_h, space):
    """Poses canoniques de `count` hôtes (grille complète, row-major,
    rotation 0). L'appelant garantit count ≤ capacité."""
    rx0, ry0, rx1, ry1 = rect["bbox"]
    w, h = rx1 - rx0, ry1 - ry0
    s = float(space or 0)
    px, py = w + s, h + s
    cols = int((sheet_w - 2 * s - w) // px) + 1
    ox, oy = s - rx0, s - ry0
    return [
        {"item_id": rect["id"],
         "transformation": {"rotation": 0.0,
                            "translation": (ox + c * px, oy + r * py)}}
        for k in range(int(count))
        for r, c in [(k // max(1, cols), k % max(1, cols))]
    ]


def _hole_fill_poses(host_pose, host_item, small, space, want):
    """Fans pinwheel dans les trous d'un hôte POSÉ (rotation 0) : chaque
    anneau érodé de `space` reçoit les rotations validées autour de son
    centroïde local (invariant par translation de l'hôte). Retourne
    (poses, consommé)."""
    if want <= 0:
        return [], 0
    tx, ty = host_pose["transformation"]["translation"]
    poses = []
    allowed = set(small.get("rotations") or [0.0])
    for ring in (host_item.get("holes") or []):
        if len(ring) < 3:
            continue
        rots = pinwheel_capacity(ring, small["coords"], space,
                                 allowed=allowed)
        n = min(len(rots), want - len(poses))
        if n <= 0:
            continue
        cx = sum(p[0] for p in ring) / len(ring)
        cy = sum(p[1] for p in ring) / len(ring)
        for i in range(n):
            poses.append({
                "item_id": small["id"],
                "transformation": {"rotation": float(rots[i]),
                                   "translation": (tx + cx, ty + cy)},
            })
        if len(poses) >= want:
            break
    return poses, len(poses)


def _band_fill_poses(small, bands, space, want):
    """Petites pièces en lattice analytique dans les bandes (ordre aire
    décroissante — tri de `residual_bands`). Retourne (poses, consommé)."""
    poses = []
    for band in bands:
        if len(poses) >= want:
            break
        got = small_lattice(small, space, band["rect"],
                            want=want - len(poses), axis=band.get("axis", "x"))
        if got:
            poses.extend(got)
    return poses, len(poses)


def _scatter_poses(small, count, x0, sheet_w, sheet_h, space):
    """Poses LÉGALES par construction pour les libres initiales de la
    dernière tôle (colonne(s) verticale(s) ancrées à droite, pas =
    bbox + space, wrap vers la gauche). Le compaction donneur les
    re-poserera en lattice derrière l'ancre."""
    coords = small["coords"]
    xs = [p[0] for p in coords]
    ys = [p[1] for p in coords]
    bx0, by0, bx1, by1 = min(xs), min(ys), max(xs), max(ys)
    w, h = bx1 - bx0, by1 - by0
    s = float(space or 0)
    ox = x0 - bx0
    oy = s - by0
    per_col = int((sheet_h - 2 * s - h) // (h + s)) + 1 if h + s > 0 else 0
    if per_col < 1:
        return None
    poses = []
    col = 0
    x = x0
    while len(poses) < count:
        if x + w > sheet_w - s + 1e-6:
            return None  # plus de place pour une colonne légale
        for k in range(per_col):
            if len(poses) >= count:
                break
            poses.append({
                "item_id": small["id"],
                "transformation": {"rotation": 0.0,
                                   "translation": (x, oy + k * (h + s))},
            })
        col += 1
        x = x0 - col * (w + s)
        if x < s - 1e-6:
            return None
    return poses


def build_grid_layouts_multi(input_items, geom_of, sheets, space, stats=None):
    """Construit l'alternative « Grille » multi-tôles (voir module).

    input_items : vue ORIGINALE (quantités complètes, ids d'origine).
    geom_of(id) -> {"coords", "rotations"} (anneau externe).
    sheets : [{width, height, count}] formats déclarés.
    Retourne [{container_id, placed_items}] couvrant TOUTE la demande,
    ou None (motif non reconnu / stock insuffisant / échec de style —
    erreur tracée dans stats['errors']).
    """
    if stats is None:
        stats = {}
    stats.setdefault("errors", [])
    # `input_items` du worker : quantités sous « count » ; la vue de test
    # porte « demand » — normaliser UNE fois ici (detect exige « demand »).
    solve_items = [{"id": it["id"],
                    "demand": int(it.get("demand", it.get("count")) or 0)}
                   for it in input_items]
    total_area = sum(_shoelace(geom_of(it["id"])["coords"]) * it["demand"]
                     for it in solve_items)
    case = detect_structural_case(solve_items, geom_of, total_area)
    if not case:
        return None
    rect, small = case["rect"], case["small"]
    items_by_id = {it["id"]: it for it in input_items}
    rect_item = items_by_id[rect["id"]]
    hosts_left = int(rect["demand"])
    smalls_left = int(small["demand"])
    slots = _slot_list(sheets)
    if not slots:
        stats["errors"].append({"stage": "grid-multi",
                                "message": "aucune tôle déclarée"})
        return None

    layouts = []
    for k, (fmt_id, w, h) in enumerate(slots):
        is_last = (k == len(slots) - 1)
        if not is_last and hosts_left <= 0 and smalls_left <= 0:
            break
        if is_last:
            if hosts_left > 0 or smalls_left > 0:
                poses = _build_last_sheet(rect, rect_item, small, w, h,
                                          space, hosts_left, smalls_left,
                                          stats)
                if poses is None:
                    return None
                layouts.append({"container_id": fmt_id,
                                "placed_items": poses})
                hosts_left = 0
                smalls_left = 0
            break
        # Tôle pleine : hôtes en grille au pas, trous puis bandes.
        cap = host_grid_capacity(rect["bbox"], w, h, space)
        n_hosts = min(hosts_left, cap)
        host_poses = _host_grid_poses(rect, n_hosts, w, h, space)
        small_poses = []
        for hp in host_poses:
            if smalls_left - len(small_poses) <= 0:
                break
            got, _ = _hole_fill_poses(hp, rect_item, small, space,
                                      smalls_left - len(small_poses))
            small_poses.extend(got)
        if host_poses and smalls_left - len(small_poses) > 0:
            used = layout_aabb({"placed_items": host_poses}, items_by_id)
            bands = residual_bands(used, w, h, float(space or 0))
            got, _ = _band_fill_poses(small, bands, space,
                                      smalls_left - len(small_poses))
            small_poses.extend(got)
        elif not host_poses and smalls_left > 0:
            # Plus d'hôtes : la tôle entière est une bande (les petites
            # continuent de se remplir séquentiellement, même style).
            s2 = float(space or 0)
            got, _ = _band_fill_poses(
                small,
                [{"name": "full", "rect": (s2, s2, w - s2, h - s2),
                  "axis": "x", "area": (w - 2 * s2) * (h - 2 * s2)}],
                space, smalls_left)
            small_poses.extend(got)
        # Tout-ou-rien : la tôle doit être physiquement valide.
        if host_poses and not _validate_batch(
                host_poses, {"container_id": fmt_id, "placed_items": []},
                items_by_id, w, h, space):
            stats["errors"].append({"stage": "grid-multi",
                                    "message": f"grille hôtes invalide (tôle {k + 1})"})
            return None
        if small_poses and not _validate_batch(
                small_poses,
                {"container_id": fmt_id, "placed_items": host_poses},
                items_by_id, w, h, space):
            stats["errors"].append({"stage": "grid-multi",
                                    "message": f"small lattice invalide (tôle {k + 1})"})
            return None
        layouts.append({"container_id": fmt_id,
                        "placed_items": host_poses + small_poses})
        hosts_left -= n_hosts
        smalls_left -= len(small_poses)

    if hosts_left > 0 or smalls_left > 0:
        stats["errors"].append({
            "stage": "grid-multi",
            "message": (f"stock insuffisant : reste {hosts_left} hôtes + "
                        f"{smalls_left} petites — pas d'alternative grille "
                        f"(jamais une grille partielle)")})
        logger.info("grid-multi: stock insuffisant (hôtes %d, petites %d)",
                    hosts_left, smalls_left)
        return None

    # Filet final : compte ET appartenance à la tôle, toutes tôles.
    total = sum(it["demand"] for it in solve_items)
    placed_total = sum(len(l["placed_items"]) for l in layouts)
    if placed_total != total:
        stats["errors"].append({"stage": "grid-multi",
                                "message": f"compte {placed_total} != demande {total}"})
        return None
    for k, l in enumerate(layouts):
        if not layout_fits_sheet(l, geom_of, slots[k][1], slots[k][2]):
            stats["errors"].append({"stage": "grid-multi",
                                    "message": f"pièce hors tôle (tôle {k + 1})"})
            return None
    return layouts


def _build_last_sheet(rect, rect_item, small, w, h, space,
                      hosts_left, smalls_left, stats):
    """Tôle N : colonnes d'hôtes depuis −X (une colonne, au pas py) +
    fans pinwheel nichées + petites restantes compactées derrière
    l'ancre par `_compact_last_sheet` (re-grille + relay, rollback
    compris). Sans hôtes restants : lattice pleine tôle. Tout le reste
    doit tenir — sinon None (l'alternative n'existe pas)."""
    s = float(space or 0)
    if hosts_left <= 0:
        if smalls_left <= 0:
            return []
        got, n = _band_fill_poses(
            small, [{"name": "full", "rect": (s, s, w - s, h - s),
                     "axis": "x", "area": (w - 2 * s) * (h - 2 * s)}],
            space, smalls_left)
        if n < smalls_left:
            stats["errors"].append({
                "stage": "grid-multi",
                "message": (f"dernière tôle sans hôte : {n}/{smalls_left} "
                            f"petites — stock insuffisant")})
            return None
        return got
    # Hôtes en UNE colonne depuis −X (le style « colonnes depuis −X » ;
    # pour plusieurs colonnes le compaction re-grille au pas).
    rx0, ry0, rx1, ry1 = rect["bbox"]
    pitch_y = (ry1 - ry0) + s
    per_col = int((h - 2 * s - (ry1 - ry0)) // pitch_y) + 1
    if per_col < 1:
        stats["errors"].append({"stage": "grid-multi",
                                "message": "hôte ne tient pas sur la dernière tôle"})
        return None
    cols = math.ceil(hosts_left / per_col)
    pitch_x = (rx1 - rx0) + s
    if s + cols * pitch_x > w + 1e-6:
        stats["errors"].append({"stage": "grid-multi",
                                "message": "colonnes d'hôtes hors dernière tôle"})
        return None
    host_poses = []
    for k in range(hosts_left):
        c, r = k // per_col, k % per_col
        host_poses.append({
            "item_id": rect["id"],
            "transformation": {"rotation": 0.0,
                               "translation": (s - rx0 + c * pitch_x,
                                               s - ry0 + r * pitch_y)},
        })
    # Fans nichées dans les trous (hélices rigides), petites restantes
    # dispersées LÉGALEMENT à droite puis compactées derrière l'ancre.
    nested = []
    for hp in host_poses:
        if smalls_left - len(nested) <= 0:
            break
        got, _ = _hole_fill_poses(hp, rect_item, small, space,
                                  smalls_left - len(nested))
        nested.extend(got)
    free_left = smalls_left - len(nested)
    free_poses = []
    if free_left > 0:
        xs = [p[0] for p in small["coords"]]
        ys = [p[1] for p in small["coords"]]
        sw_, sh_ = max(xs) - min(xs), max(ys) - min(ys)
        x0 = max(w - s - sw_, s + cols * pitch_x + s)
        free_poses = _scatter_poses(small, free_left, x0, w, h, space)
        if free_poses is None:
            stats["errors"].append({
                "stage": "grid-multi",
                "message": ("petites restantes sans pose légale initiale "
                            "(dernière tôle)")})
            return None
    poses = host_poses + nested + free_poses
    items_by_id = {rect_item["id"]: rect_item,
                   small["id"]: small}
    if not _validate_batch(
            nested + free_poses,
            {"container_id": 0, "placed_items": host_poses},
            items_by_id, w, h, space):
        stats["errors"].append({"stage": "grid-multi",
                                "message": "état initial dernière tôle invalide"})
        return None
    if free_poses:
        # Style « lattice derrière l'ancre » : le compaction donneur
        # (re-grille des colonnes + relay des libres, §2.2a profil grid).
        layout = {"container_id": 0, "placed_items": poses}
        cstats = {}
        moved = _compact_last_sheet([layout], 0, items_by_id,
                                    {0: (w, h)}, space, stats=cstats,
                                    regrid=True)
        if cstats.get("compactRollback"):
            stats["errors"].append({
                "stage": "grid-multi",
                "message": ("compaction dernière tôle roulée back "
                            f"({cstats.get('compactRollbackReason')})")})
            return None
        if not moved:
            # Rien déplacé alors qu'il y a des libres à compacter : le
            # style « derrière l'ancre » n'est pas atteint.
            stats["errors"].append({
                "stage": "grid-multi",
                "message": "libres non compactées derrière l'ancre (style non atteint)"})
            return None
        return layout["placed_items"]
    return poses
