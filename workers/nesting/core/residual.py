"""Post-pass BPP « remplissage des bandes résiduelles » (D-MOT-19).

Constat (2026-08-31, docs/PLAN-bpp-remplissage-residuel.md) : en
multi-tôles, le constructif place chaque petite pièce là où la croissance
marginale de bbox est minimale → elles s'empilent toutes sur la DERNIÈRE
tôle et les bandes libres (~80-100 mm) des tôles précédentes restent
vides ; le recuit ne backfill pas (remnant MOYEN : chaque déplacement
individuel est non améliorant — optimum local structurel).

Ce pass — APRÈS apply_hole_fill, AVANT reveal/artefacts — prend les
pièces LIBRES de la tôle la moins remplie et les pose au lattice
(`small_lattice`, déjà calibré) dans les bandes vides des tôles plus
remplies : 4 côtés clippés à l'AABB + coin haut-droit, inset `space`.
Objectif produit : remplir les tôles précédentes, garder la dernière
comme chute réutilisable propre.

Contrats :
- déterministe (lattice analytique, tri stables) ;
- hôtes (pièces à trous) et pièces nichées dans un trou : JAMAIS déplacés ;
- compte global de placed_items invariant (le part-loss guard reste le
  filet final) ;
- toute exception ou batch invalide → rollback, alternative intacte
  (même contrat que apply_hole_fill / pass grille) ;
- < 2 layouts → no-op (SPP, BPP 1 tôle).

Miroir JS : app/composables/residualClient.js.
"""

import copy
import logging
import os

from core.structure import _bbox, _rotated_bbox, _shoelace, small_lattice

logger = logging.getLogger(__name__)

# Le moteur garantit l'espacement sur les anneaux SIMPLIFIÉS (même env que
# main.py SIMPLIFY_MM / structure.py LATTICE_SIMPLIFY_MM) : en ring brut,
# les layouts préexistants tombent à ~0,005 mm sous space et une validation
# exacte rejeterait TOUT batch (no-op silencieux — constaté au banc).
_SIMPLIFY_MM = float(os.environ.get("NEST_SIMPLIFY_MM", "0.05"))

# Bornes anti-boucle : au-delà, les bandes restantes sont trop petites
# pour intéresser qui que ce soit (mesuré : 2 itérations suffisent sur le
# corpus 100+800 ; 4 couvre les retraits en cascade de la tôle last).
N_ITER = 4
_EPS = 1e-6


def _placed_poly(item, rot, tx, ty, simplify=True):
    from shapely.affinity import rotate, translate
    from shapely.geometry import Polygon
    # Pièce AVEC ses trous (un hôte sans ses trous intersecte ses propres
    # fillers nichés) et SIMPLIFIÉE : le moteur solve sur anneaux
    # simplifiés — c'est à cette échelle que l'espacement est garanti.
    # simplify=False : anneau BRUT — le test de couverture tôle l'exige
    # (le simplify peut plonger un sommet de ~0,05 sous un bord touché
    # exactement, cf. compaction ancre au bord, 2026-09-02).
    poly = Polygon(item["coords"], item.get("holes") or [])
    poly = translate(rotate(poly, float(rot), origin=(0, 0)), float(tx), float(ty))
    if simplify:
        poly = poly.simplify(_SIMPLIFY_MM, preserve_topology=True)
    return poly


def layout_aabb(layout, items_by_id):
    """AABB EXTERNE des placements (translation externe + bbox tournée —
    piège #48). None si le layout est vide."""
    minx = miny = float("inf")
    maxx = maxy = float("-inf")
    for pi in layout.get("placed_items", []):
        it = items_by_id[pi["item_id"]]
        tr = pi["transformation"]
        bb = _rotated_bbox(_bbox(it["coords"]), float(tr["rotation"]))
        tx, ty = tr["translation"][0], tr["translation"][1]
        minx = min(minx, tx + bb[0])
        miny = min(miny, ty + bb[1])
        maxx = max(maxx, tx + bb[2])
        maxy = max(maxy, ty + bb[3])
    if minx == float("inf"):
        return None
    return (minx, miny, maxx, maxy)


def residual_bands(used, sheet_w, sheet_h, space):
    """5 rectangles libres autour du bloc utilisé (4 côtés CLIPPÉS à
    l'AABB + coin haut-droit), inset `space` des deux bords (AABB et
    tôle) — sans inset la 1re colonne est à distance 0 des hôtes et la
    validation rejette tout le batch (no-op silencieux).

    Pas de bande pleine tôle (elle tuerait la bande adjacente dès la
    1re pièce posée) et PAS de L (small_lattice exige un rectangle).
    Tri : aire décroissante, tie-break nom (déterminisme).
    """
    minx, miny, maxx, maxy = used
    defs = (
        ("corner", (maxx + space, maxy + space, sheet_w - space, sheet_h - space), "y"),
        ("right", (maxx + space, miny, sheet_w - space, maxy), "x"),
        ("top", (minx, maxy + space, maxx, sheet_h - space), "y"),
        ("left", (space, miny, minx - space, maxy), "x"),
        ("bottom", (minx, space, maxx, miny - space), "y"),
    )
    out = []
    for name, rect, axis in defs:
        w = rect[2] - rect[0]
        h = rect[3] - rect[1]
        if w > _EPS and h > _EPS:
            out.append({"name": name, "rect": rect, "axis": axis, "area": w * h})
    out.sort(key=lambda b: (-b["area"], b["name"]))
    return out


def _fill_ratio(layout, items_by_id, bin_dims):
    """Taux de remplissage en AIRES OUTER (pas AABB) — un ratio, pas une
    aire absolue, sinon une 2000×3000 à moitié vide gagne toujours."""
    w, h = bin_dims[layout["container_id"]]
    if w <= 0 or h <= 0:
        return 0.0
    area = sum(_shoelace(items_by_id[pi["item_id"]]["coords"])
               for pi in layout.get("placed_items", []))
    return area / (w * h)


def _free_pis(layout, items_by_id):
    """Pièces LIBRES du layout : item sans trous ET dont le centroïde
    n'est dans aucun trou d'un hôte du MÊME layout (miroir du nested_hole
    d'apply_hole_fill, restreint au layout — les coords trous sont locales
    à leur tôle). Les hôtes ne bougent JAMAIS (leur hélice les suit)."""
    from shapely.affinity import rotate as sh_rotate, translate as sh_translate
    from shapely.geometry import Polygon

    entries = []
    for idx, pi in enumerate(layout.get("placed_items", [])):
        it = items_by_id[pi["item_id"]]
        tr = pi["transformation"]
        entries.append((idx, pi, it,
                        _placed_poly(it, tr["rotation"],
                                     tr["translation"][0], tr["translation"][1])))
    hole_polys = []
    for _idx, pi, it, _poly in entries:
        if not (it.get("holes") or []):
            continue
        tr = pi["transformation"]
        for h in it["holes"]:
            hole_polys.append(sh_translate(
                sh_rotate(Polygon(h), float(tr["rotation"]), origin=(0, 0)),
                tr["translation"][0], tr["translation"][1]))
    free = []
    for idx, pi, it, poly in entries:
        if it.get("holes"):
            continue
        c = poly.centroid
        if any(hp.contains(c) for hp in hole_polys):
            continue
        free.append(pi)
    return free


def _pick_class(free_pis, items_by_id, band_w, band_h):
    """Classe la plus nombreuse dont UNE rotation permise tient dans la
    bande (bbox tournée, piège #48). Pas de cap « 50 % de la bande »
    (D3 : le corpus Fillx4 / 81 mm ≈ 51 % serait exclu). Tie : id croissant."""
    counts = {}
    for pi in free_pis:
        counts[pi["item_id"]] = counts.get(pi["item_id"], 0) + 1
    best = None
    for cls_id in sorted(counts):
        it = items_by_id[cls_id]
        bb = _bbox(it["coords"])
        fits = False
        for r in (it.get("rotations") or [0.0, 90.0, 180.0, 270.0]):
            rb = _rotated_bbox(bb, float(r))
            if (rb[2] - rb[0] <= band_w + _EPS
                    and rb[3] - rb[1] <= band_h + _EPS):
                fits = True
                break
        if fits and (best is None or counts[cls_id] > counts[best]):
            best = cls_id
    return best


def _validate_batch(new_pis, layout, items_by_id, sheet_w, sheet_h, space):
    """Ceinture du BATCH : chaque pièce AJOUTÉE doit être couverte par la
    tôle et à distance ≥ space de TOUTES les pièces du layout (y compris
    entre nouvelles). Les paires PRÉEXISTANTES ne sont pas re-jugées : un
    défaut amont (constaté au banc 2026-08-31 : les poses pinwheel
    d'expand_meta à space > 0 se touchent — jumeaux distance 0 sur la
    tôle la moins remplie) ne doit pas paralyser le pass. Le retrait de
    pièces de la tôle source, lui, ne peut jamais créer de violation."""
    from shapely.geometry import Polygon
    from shapely.strtree import STRtree

    all_polys = []
    for pi in layout.get("placed_items", []):
        it = items_by_id[pi["item_id"]]
        tr = pi["transformation"]
        all_polys.append((pi, _placed_poly(it, tr["rotation"],
                                           tr["translation"][0],
                                           tr["translation"][1])))
    sheet = Polygon([(0, 0), (sheet_w, 0), (sheet_w, sheet_h), (0, sheet_h)])
    new_set = [p for p in new_pis]
    for pi in new_set:
        it = items_by_id[pi["item_id"]]
        tr = pi["transformation"]
        poly = _placed_poly(it, tr["rotation"], tr["translation"][0],
                            tr["translation"][1])
        # Couverture tôle sur l'anneau BRUT et par bornes ±_EPS (miroir
        # exact du bbox-check JS) : le simplify peut plonger un sommet sous
        # un bord exactement touché, et le lattice cale ses rangées au
        # bord avec un bruit flottant (ty=-2.8000000000000007 → y_min
        # = -6.7e-16) — `covers` strict refusait les deux (2026-09-02).
        raw = _placed_poly(it, tr["rotation"], tr["translation"][0],
                           tr["translation"][1], simplify=False)
        bminx, bminy, bmaxx, bmaxy = raw.bounds
        if (bminx < -_EPS or bminy < -_EPS
                or bmaxx > sheet_w + _EPS or bmaxy > sheet_h + _EPS):
            return False
        for other_pi, other in all_polys:
            if other_pi is pi:
                continue
            if poly.distance(other) < space - _EPS:
                return False
    return True


def _fill_one_batch(layouts, dst_i, src_i, items_by_id, bin_dims, space,
                    free=None):
    """Un batch : une bande de layouts[dst_i] remplie depuis les libres de
    layouts[src_i]. Retourne le nombre de pièces déplacées (0 = plus rien
    à faire sur cette tôle). Rollback du batch si la validation échoue.
    `free` surcharge la liste des donneuses (compaction : donneuses
    détachées, src == dst)."""
    dst = layouts[dst_i]
    src = layouts[src_i]
    sw, sh = bin_dims[dst["container_id"]]
    used = layout_aabb(dst, items_by_id)
    if used is None:
        return 0
    if free is None:
        free = _free_pis(src, items_by_id)
    if not free:
        return 0

    for band in residual_bands(used, sw, sh, space):
        x0, y0, x1, y1 = band["rect"]
        cls_id = _pick_class(free, items_by_id, x1 - x0, y1 - y0)
        if cls_id is None:
            continue
        it = items_by_id[cls_id]
        # P-m.1 : jamais de rotations vides au lattice (P-1 en dépend).
        small = {"id": cls_id, "coords": it["coords"],
                 "rotations": it.get("rotations") or [0.0, 90.0, 180.0, 270.0]}
        donors = [pi for pi in free if pi["item_id"] == cls_id]
        lat = small_lattice(small, space, band["rect"], want=len(donors),
                            axis=band["axis"])
        if not lat or len(lat) < 2:
            continue
        take = min(len(lat), len(donors))
        # Donors anti-compacts d'abord (plus excentrés du centre de la
        # tôle source) : la bbox du last se rétracte au fil des batchs.
        used_src = layout_aabb(src, items_by_id)
        if used_src:
            cx = (used_src[0] + used_src[2]) / 2
            cy = (used_src[1] + used_src[3]) / 2
        else:
            cx, cy = sw / 2, sh / 2
        order = sorted(
            donors,
            key=lambda pi: -(((pi["transformation"]["translation"][0] - cx) ** 2
                              + (pi["transformation"]["translation"][1] - cy) ** 2)),
        )
        batch = list(zip(order[:take], lat[:take]))
        saved = [(pi, dict(pi["transformation"])) for pi, _ in batch]
        for pi, lp in batch:
            tr = lp["transformation"]
            pi["transformation"] = {"rotation": tr["rotation"],
                                    "translation": tuple(tr["translation"])}
            # Compaction (src == dst) : la donneuse est détachée, le
            # remove par valeur la lèverait — l'identité suffit.
            try:
                src["placed_items"].remove(pi)
            except ValueError:
                pass
            dst["placed_items"].append(pi)
        if _validate_batch([pi for pi, _ in batch], dst, items_by_id,
                           sw, sh, space):
            return take
        # Rollback de CE batch : transformation d'origine + retour au src.
        for pi, old_tr in saved:
            dst["placed_items"].remove(pi)
            pi["transformation"] = old_tr
            src["placed_items"].append(pi)
    return 0


class _CompactRollback(Exception):
    """Compaction avortée : restauration complète de la tôle (no-op)."""


def _helix_units_and_free(layout, items_by_id):
    """Classe la tôle en unités RIGIDES : une hélice = hôte (item à trous)
    + les fans dont le centroïde est dans UN de ses trous (classification
    miroir de _free_pis, mais groupée par hôte). Retourne
    (units [{host, fans}], free)."""
    from shapely.affinity import rotate as sh_rotate, translate as sh_translate
    from shapely.geometry import Polygon

    hosts = []      # [(pi, hole_polys_world)]
    others = []     # [(pi, poly)]
    for pi in layout.get("placed_items", []):
        it = items_by_id[pi["item_id"]]
        tr = pi["transformation"]
        poly = _placed_poly(it, tr["rotation"],
                            tr["translation"][0], tr["translation"][1],
                            simplify=False)
        if it.get("holes"):
            hp = []
            for h in it["holes"]:
                q = sh_translate(sh_rotate(Polygon(h), tr["rotation"],
                                           origin=(0, 0)),
                                 tr["translation"][0], tr["translation"][1])
                hp.append(q)
            hosts.append((pi, hp))
        else:
            others.append((pi, poly))
    units = []
    free = []
    for pi, poly in others:
        c = poly.centroid
        unit = None
        for host_pi, hp in hosts:
            if any(h.covers(c) for h in hp):
                unit = host_pi
                break
        if unit is None:
            free.append(pi)
        else:
            for u in units:
                if u["host"] is unit:
                    u["fans"].append(pi)
                    break
            else:
                units.append({"host": unit, "fans": [pi]})
    for host_pi, _hp in hosts:
        if not any(u["host"] is host_pi for u in units):
            units.append({"host": host_pi, "fans": []})
    return units, free


def _regrid_helices(last, units, items_by_id, sw, sh, space):
    """Phase 1 de la compaction : les hélices re-grillées en colonnes
    DEPUIS le bord gauche (−X) par small_lattice (validation STRtree sur
    anneaux réels ; rotations permises seulement). Les fans nichées
    suivent en TRANSFORMATION RIGIDE (rotation relative + translation
    conservées) — elles vivent dans le polygone externe de leur hôte,
    leur distance aux autres unités est celle des hôtes. Tout-ou-rien :
    si une classe d'hôtes ne tient pas entièrement, aucun hôte ne bouge.
    Retourne le nombre de pièces déplacées."""
    from math import cos, radians, sin

    by_cls = {}
    for u in units:
        by_cls.setdefault(u["host"]["item_id"], []).append(u)
    saved = [(u, dict(u["host"]["transformation"]),
              [dict(f["transformation"]) for f in u["fans"]])
             for u in units]
    x_from = space
    moved = 0
    for cls in sorted(by_cls, key=lambda c: (-len(by_cls[c]), c)):
        group = by_cls[cls]
        it = items_by_id[cls]
        small = {"id": cls, "coords": it["coords"],
                 "rotations": it.get("rotations") or [0.0]}
        rect = (x_from, space, sw - space, sh - space)
        lat = small_lattice(small, space, rect, want=len(group), axis="x")
        if not lat or len(lat) < len(group):
            # Ne tient pas : restauration complète des hôtes (tout-ou-rien).
            for u, host_tr, fan_trs in saved:
                u["host"]["transformation"] = host_tr
                for f, ft in zip(u["fans"], fan_trs):
                    f["transformation"] = ft
            return 0
        order = sorted(group, key=lambda u: (
            u["host"]["transformation"]["translation"][0],
            u["host"]["transformation"]["translation"][1]))
        cls_maxx = 0.0
        for u, lp in zip(order, lat):
            new = lp["transformation"]
            old = u["host"]["transformation"]
            dr = float(new["rotation"]) - float(old["rotation"])
            r = radians(dr)
            ox, oy = old["translation"]
            nx, ny = new["translation"]
            u["host"]["transformation"] = {
                "rotation": new["rotation"],
                "translation": (nx, ny)}
            for f in u["fans"]:
                ft = f["transformation"]
                fx, fy = ft["translation"]
                dx, dy = fx - ox, fy - oy
                f["transformation"] = {
                    "rotation": ft["rotation"] + dr,
                    "translation": (nx + cos(r) * dx - sin(r) * dy,
                                    ny + sin(r) * dx + cos(r) * dy)}
            bb = _rotated_bbox(_bbox(it["coords"]), float(new["rotation"]))
            cls_maxx = max(cls_maxx, nx + bb[2])
            moved += 1 + len(u["fans"])
        x_from = cls_maxx + space
    return moved


def _compact_last_sheet(layouts, sheet_i, items_by_id, bin_dims, space):
    """Compaction −X de la tôle donneuse (constats 2026-09-02). Le moteur
    BPP ne compacte PAS la dernière tôle (coût = tôles + remnant, pas la
    direction par tôle) : v1 re-posait seulement les libres derrière
    l'ancre — les hôtes restaient épars et le principe « tout au bord
    −X » n'était pas appliqué. v2 :

    1. les HÉLICES (hôte + fans nichées, groupe rigide) sont re-grillées
       en colonnes depuis le bord gauche (_regrid_helices, tout-ou-rien) ;
    2. les LIBRES sont détachées puis re-posées en lattice derrière la
       grille des hélices (bandes autour de l'ancre = AABB des non-libres)
       — colonnes depuis l'ancre, chute rectangulaire unique ; les
       non-placées retournent à leur pose d'origine VALIDÉE, sinon
       restauration complète (no-op sur les libres)."""
    last = layouts[sheet_i]
    sw, sh = bin_dims[last["container_id"]]
    units, free = _helix_units_and_free(last, items_by_id)
    if not units and not free:
        return 0
    moved = _regrid_helices(last, units, items_by_id, sw, sh, space)
    if not free:
        return moved
    free_ids = {id(pi) for pi in free}
    anchor = [pi for pi in last.get("placed_items", []) if id(pi) not in free_ids]
    if not anchor:
        return moved
    saved_poses = {id(pi): dict(pi["transformation"]) for pi in free}
    fans_snapshot = copy.deepcopy(last.get("placed_items", []))
    try:
        for pi in free:
            last["placed_items"] = [x for x in last["placed_items"]
                                    if x is not pi]
        while True:
            remaining = [pi for pi in free
                         if not any(x is pi for x in last["placed_items"])]
            if not remaining:
                break
            n = _fill_one_batch(layouts, sheet_i, sheet_i, items_by_id,
                                bin_dims, space, free=remaining)
            if not n:
                break
            moved += n
        # Libres non replacées (capacité < donneuses) : retour à la pose
        # d'origine — validé contre le layout final, les nouvelles colonnes
        # ont pu recouvrir leur ancienne position.
        restore = [pi for pi in free
                   if not any(x is pi for x in last["placed_items"])]
        for pi in restore:
            pi["transformation"] = saved_poses[id(pi)]
            last["placed_items"].append(pi)
        if restore and not _validate_batch(restore, last, items_by_id,
                                           sw, sh, space):
            raise _CompactRollback()
        return moved
    except _CompactRollback:
        # Rollback des LIBRES uniquement : la grille des hélices reste
        # (validée par small_lattice indépendamment).
        last["placed_items"] = fans_snapshot
        return moved


def fill_residual_bands(layouts, input_items, bin_dims, space):
    """Mutate layouts in place. Retourne le nombre de pièces déplacées
    (0 = no-op). Voir le module docstring pour le contrat complet."""
    if not layouts or len(layouts) < 2:
        return 0
    items_by_id = {i["id"]: i for i in input_items}
    if any(pi["item_id"] not in items_by_id
           for l in layouts for pi in l.get("placed_items", [])):
        return 0
    space = float(space or 0)
    snapshot = copy.deepcopy(layouts)
    try:
        moved = 0
        for _round in range(N_ITER):
            ratios = [_fill_ratio(l, items_by_id, bin_dims) for l in layouts]
            last = min(range(len(layouts)), key=lambda i: (ratios[i], -i))
            order = sorted((i for i in range(len(layouts)) if i != last),
                           key=lambda i: (-ratios[i], i))
            progress = False
            for i in order:
                while True:
                    n = _fill_one_batch(layouts, i, last, items_by_id,
                                        bin_dims, space)
                    if not n:
                        break
                    moved += n
                    progress = True
            # Tôle source entièrement vidée de ses libres : on la retire
            # (layoutCount-- = une tôle de moins à couper). Seule `last`
            # peut se vider — par sécurité, retire tout layout vide.
            before = len(layouts)
            layouts[:] = [l for l in layouts if l.get("placed_items")]
            if len(layouts) < 2 or not progress:
                break
        # Compaction de la tôle la moins remplie (la donneuse — ses libres
        # non consommées par les bandes des tôles précédentes) : le moteur
        # BPP ne la compacte pas dans la direction d'optimisation, la
        # « chute » y serait un amas dispersé à front dentelé (constat
        # user 2026-09-02 : « pas optimisé −X »). Uniquement s'il reste
        # PLUSIEURS tôles : une tôle unique = la donneuse a été vidée et
        # retirée, rien à compacter (contrat T8). Miroir JS :
        # residualClient._compactLastSheet.
        if len(layouts) >= 2:
            ratios = [_fill_ratio(l, items_by_id, bin_dims) for l in layouts]
            last = min(range(len(layouts)), key=lambda i: (ratios[i], -i))
            moved += _compact_last_sheet(layouts, last, items_by_id,
                                         bin_dims, space)
        return moved
    except Exception as e:
        # Filet : l'alternative reste INTACTE (contrat apply_hole_fill).
        layouts[:] = snapshot
        logger.warning("residual-band pass failed, layouts restored",
                       extra={"error": str(e)})
        return 0
