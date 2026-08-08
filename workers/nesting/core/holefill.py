"""J-085 — post-pass « hole-fill » déterministe (partagée serveur + client).

À l'échelle, le solve laisse des fillers empilés hors des trous alors que la
capacité existe (4 secteurs/trou) : l'exploration n'a aucune incitation à
finir de remplir (la hauteur est dominée par la colonne d'hôtes). Ce pass,
appliqué APRÈS le solve (rien ne peut le défaire), complète chaque trou en
pinwheel (rotations 0/90/180/270 autour du centre monde du trou), avec
validation exacte (dans le trou avec marge, spacing entre fillers, dans la
tôle). La convention de transform est celle de parse_result_containers :
monde = R(rot)·local + translation, appliquée AS-IS au repère d'origine —
le secteur a son centre d'arc en (0,0), donc translation = centre du trou.

Miroir navigateur : app/composables/localBridge.js (applyHoleFillPostPass).
"""
import math

from shapely.geometry import Polygon
from shapely.affinity import rotate, translate

PINWHEEL = (0.0, 90.0, 180.0, 270.0)
CAPACITY = 4
WALL_MARGIN = 1.0   # marge paroi du trou (mm)
FILLER_GAP = 2.0    # spacing entre fillers d'un même trou (mm)


def _placed(item, rot_deg, tx, ty):
    return translate(rotate(Polygon(item["coords"]), rot_deg, origin=(0, 0)), tx, ty)


def _centroid(ring):
    xs = [p[0] for p in ring]
    ys = [p[1] for p in ring]
    return (sum(xs) / len(xs), sum(ys) / len(ys))


def apply_hole_fill(input_items, layouts, space):
    """Rewrite in-place les transforms des fillers libres replacés en
    pinwheel dans un trou ayant de la place. Renvoie le nb de fillers
    relocalisés. Déterministe : ordre de parcours des layouts/placements. """
    by_id = {i["id"]: i for i in input_items}
    placed = []  # [layout][k] = (item, rot, tx, ty, poly)
    for layout in layouts:
        row = []
        for pi in layout.get("placed_items", []):
            it = by_id[pi["item_id"]]
            tr = pi["transformation"]
            row.append([it, tr["rotation"], tr["translation"][0], tr["translation"][1],
                        _placed(it, tr["rotation"], tr["translation"][0], tr["translation"][1])])
        placed.append(row)

    def holes_world(entry):
        it, rot, tx, ty, _ = entry
        out = []
        for h in (it["holes"] or []):
            out.append(translate(rotate(Polygon(h), rot, origin=(0, 0)), tx, ty))
        return out

    hosts = [e for row in placed for e in row if e[0]["holes"]]
    holes = [(h_entry, hw) for h_entry in hosts for hw in holes_world(h_entry)]

    def nested_hole(poly):
        c = poly.centroid
        for idx, (_, hw) in enumerate(holes):
            if hw.contains(c):
                return idx
        return None

    free = []
    hole_members = {hi: [] for hi in range(len(holes))}
    for row in placed:
        for e in row:
            if e[0]["holes"]:
                continue
            hi = nested_hole(e[4])
            if hi is None:
                free.append(e)
            else:
                hole_members[hi].append(e)

    recovered = 0
    for hi, (_, hw) in enumerate(holes):
        cur = hole_members[hi]
        if len(cur) >= CAPACITY or len(free) < CAPACITY - len(cur):
            continue  # déjà plein, ou pas assez de fillers libres
        inner = hw.buffer(-WALL_MARGIN)
        cx, cy = hw.centroid.x, hw.centroid.y
        pool = cur + free[: CAPACITY - len(cur)]
        new_polys = []
        ok = True
        for rot, e in zip(PINWHEEL, pool):
            cand = _placed(e[0], rot, cx, cy)
            if not inner.contains(cand):
                ok = False
                break
            if any(cand.buffer(FILLER_GAP / 2).intersects(q.buffer(FILLER_GAP / 2)) for q in new_polys):
                ok = False
                break
            new_polys.append(cand)
        if not ok:
            continue  # rollback : on garde les transforms d'origine
        for rot, e, cand in zip(PINWHEEL, pool, new_polys):
            e[1], e[2], e[3] = rot, cx, cy
            e[4] = cand
            if e in free:
                free.remove(e)
                recovered += 1
    if recovered:
        _write_back(layouts, placed)
    return recovered


def meta_slots(input_items, host_id, fill_id, capacity=CAPACITY):
    """Répartition des fillers en meta-pièces : chaque hôte reçoit jusqu'à
    `capacity` fillers figés dans son trou. Renvoie (liste des k par position
    d'hôte, fillers restants) — liste pour être BSON/JSON-serialisable."""
    host_qty = next(i["count"] for i in input_items if i["id"] == host_id)
    fill_qty = next(i["count"] for i in input_items if i["id"] == fill_id)
    per = []
    remaining = fill_qty
    for _h in range(host_qty):
        k = min(capacity, remaining)
        per.append(k)
        remaining -= k
    return per, remaining


def expand_meta(items, host_id, fill_id, slots, layouts):
    """Attache les fillers figés (pinwheel) aux hôtes posés. Convention AS-IS :
    monde = R(rot)·local + t. La rotation/translation de l'hôte entraîne les
    fillers : world_f = R(hrot+frot)·x + (R(hrot)·C + ht). Déterministe."""
    by_id = {i["id"]: i for i in items}
    host = by_id[host_id]
    hole_rings = host["holes"] or []
    out_layouts = []
    hi = 0
    for layout in layouts:
        new_items = list(layout.get("placed_items", []))
        for pi in layout.get("placed_items", []):
            if pi["item_id"] != host_id:
                continue
            tr = pi["transformation"]
            hrot, hx, hy = tr["rotation"], tr["translation"][0], tr["translation"][1]
            k = slots[hi] if hi < len(slots) else 0
            hi += 1
            for s in range(k):
                # répartition des slots par trou (4 pinwheel par trou max)
                ring = hole_rings[s // len(PINWHEEL)] if hole_rings else None
                if ring is None:
                    continue
                c = _centroid(ring)
                frot = PINWHEEL[s % len(PINWHEEL)]
                # R(hrot)·C + (hx,hy)
                r = math.radians(hrot)
                rx = math.cos(r) * c[0] - math.sin(r) * c[1] + hx
                ry = math.sin(r) * c[0] + math.cos(r) * c[1] + hy
                new_items.append({
                    "item_id": fill_id,
                    "transformation": {"rotation": hrot + frot, "translation": [rx, ry]},
                })
        out_layouts.append({**layout, "placed_items": new_items})
    return out_layouts


def _write_back(layouts, placed):
    for layout, row in zip(layouts, placed):
        for pi, e in zip(layout.get("placed_items", []), row):
            pi["transformation"]["rotation"] = e[1]
            pi["transformation"]["translation"] = [e[2], e[3]]
