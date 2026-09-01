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


def _placed_poly(item, rot, tx, ty):
    from shapely.affinity import rotate, translate
    from shapely.geometry import Polygon
    # Pièce AVEC ses trous (un hôte sans ses trous intersecte ses propres
    # fillers nichés) et SIMPLIFIÉE : le moteur solve sur anneaux
    # simplifiés — c'est à cette échelle que l'espacement est garanti.
    poly = Polygon(item["coords"], item.get("holes") or [])
    poly = translate(rotate(poly, float(rot), origin=(0, 0)), float(tx), float(ty))
    return poly.simplify(_SIMPLIFY_MM, preserve_topology=True)


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
        if not sheet.covers(poly):
            return False
        for other_pi, other in all_polys:
            if other_pi is pi:
                continue
            if poly.distance(other) < space - _EPS:
                return False
    return True


def _fill_one_batch(layouts, dst_i, src_i, items_by_id, bin_dims, space):
    """Un batch : une bande de layouts[dst_i] remplie depuis les libres de
    layouts[src_i]. Retourne le nombre de pièces déplacées (0 = plus rien
    à faire sur cette tôle). Rollback du batch si la validation échoue."""
    dst = layouts[dst_i]
    src = layouts[src_i]
    sw, sh = bin_dims[dst["container_id"]]
    used = layout_aabb(dst, items_by_id)
    if used is None:
        return 0
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
            src["placed_items"].remove(pi)
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
        return moved
    except Exception as e:
        # Filet : l'alternative reste INTACTE (contrat apply_hole_fill).
        layouts[:] = snapshot
        logger.warning("residual-band pass failed, layouts restored",
                       extra={"error": str(e)})
        return 0
