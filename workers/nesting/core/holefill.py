"""J-085 — trou-filling à l'échelle (partagée serveur + client).

Deux passes complémentaires :
- **pre-pass meta-pièces** (`pinwheel_capacity` / `meta_slots` / `expand_meta`) :
  le solve ne porte que les hôtes (trous FERMÉS) + les fillers restants ; les
  fillers figés sont rattachés après le solve. La capacité du pinwheel est
  VALIDÉE géométriquement une fois en coords locales (invariante par
  rotation/translation de l'hôte posé) avec la sémantique exacte du moteur —
  jamais de filler attaché en chevauchement ;
- **post-pass** (`apply_hole_fill`) : après le solve (rien ne peut le
  défaire), recomplète en pinwheel les trous restés vides — filet de
  sécurité validé pour les jobs hors périmètre meta.

Validation d'ajustement (piège #3) : l'inflation jagua ±space/2 des DEUX
côtés impose filler ⊆ trou ⊖ space et distance ≥ space entre fillers. Toute
validation érode donc le trou de `space` en entier (pas space/2 : le
candidat est testé non-inflaté).

La convention de transform est celle de parse_result_containers :
monde = R(rot)·local + translation, appliquée AS-IS au repère d'origine —
le secteur a son centre d'arc en (0,0), donc translation = centre du trou.

Miroir navigateur : app/composables/localBridge.js (applyHoleFill/expandMeta).
"""
import math

from shapely.geometry import Polygon
from shapely.affinity import rotate, translate

PINWHEEL = (0.0, 90.0, 180.0, 270.0)
CAPACITY = 4
# Bruit de mesure overlap (mm²) — en dessous c'est du contact, pas un
# chevauchement (aligné sur metrics.OVERLAP_EPS_MM2).
OVERLAP_EPS = 0.01


def _placed(item, rot_deg, tx, ty):
    return translate(rotate(Polygon(item["coords"]), rot_deg, origin=(0, 0)), tx, ty)


def _centroid(ring):
    xs = [p[0] for p in ring]
    ys = [p[1] for p in ring]
    return (sum(xs) / len(xs), sum(ys) / len(ys))


def _violates_spacing(cand, placed, space):
    """True si cand est à moins de `space` d'un placement (ou le chevauche
    quand space == 0 — le contact y est permis)."""
    for q in placed:
        if space > 0:
            if cand.buffer(space / 2).intersects(q.buffer(space / 2)):
                return True
        elif cand.intersection(q).area > OVERLAP_EPS:
            return True
    return False


def pinwheel_capacity(hole_ring, filler_coords, space, allowed=None):
    """Rotations du pinwheel VALIDÉES pour un filler dans un trou, calculées
    une fois en coords LOCALES (la validité est invariante par la transform
    de l'hôte posé). Sémantique exacte du moteur : trou érodé de `space`,
    espacement ≥ `space` entre fillers (piège #3). `allowed` restreint aux
    orientations permises de l'item (défaut : les 4). Ordre pinwheel
    conservé ; [] si aucune rotation ne valide (trou trop petit, forme
    inadaptée) — l'appelant doit alors renoncer au pre-pass meta."""
    rots = [r for r in PINWHEEL if allowed is None or r in allowed]
    hole = Polygon(hole_ring)
    inner = hole.buffer(-float(space)) if space > 0 else hole
    if inner.is_empty:
        return []
    cx, cy = _centroid(hole_ring)
    filler = Polygon(filler_coords)
    valid, placed = [], []
    for rot in rots:
        cand = translate(rotate(filler, rot, origin=(0, 0)), cx, cy)
        if not inner.contains(cand):
            continue
        if _violates_spacing(cand, placed, space):
            continue
        valid.append(rot)
        placed.append(cand)
    return valid


def apply_hole_fill(input_items, layouts, space):
    """Rewrite in-place les transforms des fillers libres replacés en
    pinwheel dans un trou ayant de la place. Renvoie le nb de fillers
    relocalisés. Déterministe : ordre de parcours des layouts/placements.
    Validation exacte : trou érodé de `space`, spacing ≥ `space`."""
    by_id = {i["id"]: i for i in input_items}
    space = float(space or 0)
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
        inner = hw.buffer(-space) if space > 0 else hw
        if inner.is_empty:
            continue
        cx, cy = hw.centroid.x, hw.centroid.y
        pool = cur + free[: CAPACITY - len(cur)]
        new_polys = []
        ok = True
        for rot, e in zip(PINWHEEL, pool):
            cand = _placed(e[0], rot, cx, cy)
            if not inner.contains(cand):
                ok = False
                break
            if _violates_spacing(cand, new_polys, space):
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
    `capacity` fillers figés dans son trou — la capacité VALIDÉE
    (pinwheel_capacity), jamais la capacité théorique. Renvoie (liste des k
    par position d'hôte, fillers restants) — liste pour être
    BSON/JSON-serialisable."""
    host_qty = next(i["count"] for i in input_items if i["id"] == host_id)
    fill_qty = next(i["count"] for i in input_items if i["id"] == fill_id)
    per = []
    remaining = fill_qty
    for _h in range(host_qty):
        k = min(capacity, remaining)
        per.append(k)
        remaining -= k
    return per, remaining


def expand_meta(items, host_id, fill_id, slots, layouts, ring_rotations=None):
    """Attache les fillers figés (pinwheel validé) aux hôtes posés.
    Convention AS-IS : monde = R(rot)·local + t. La rotation/translation de
    l'hôte entraîne les fillers : world_f = R(hrot+frot)·x + (R(hrot)·C + ht).
    `ring_rotations[r]` = rotations validées pour l'anneau r
    (pinwheel_capacity) ; None = pinwheel plein (legacy/tests). Les slots
    d'un hôte sont distribués anneau par anneau dans l'ordre. Déterministe."""
    by_id = {i["id"]: i for i in items}
    host = by_id[host_id]
    hole_rings = host["holes"] or []
    if ring_rotations is None:
        ring_rotations = [list(PINWHEEL) for _ in hole_rings]
    out_layouts = []
    hi = 0
    for layout in layouts:
        new_items = list(layout.get("placed_items", []))
        for pi in layout.get("placed_items", []):
            if pi["item_id"] != host_id:
                continue
            tr = pi["transformation"]
            hrot, hx, hy = tr["rotation"], tr["translation"][0], tr["translation"][1]
            budget = slots[hi] if hi < len(slots) else 0
            hi += 1
            r = math.radians(hrot)
            cos_r, sin_r = math.cos(r), math.sin(r)
            for ring, rots in zip(hole_rings, ring_rotations):
                if budget <= 0:
                    break
                c = _centroid(ring)
                # R(hrot)·C + (hx,hy) — centre du trou en monde
                rx = cos_r * c[0] - sin_r * c[1] + hx
                ry = sin_r * c[0] + cos_r * c[1] + hy
                for frot in rots:
                    if budget <= 0:
                        break
                    new_items.append({
                        "item_id": fill_id,
                        "transformation": {"rotation": hrot + frot, "translation": [rx, ry]},
                    })
                    budget -= 1
        out_layouts.append({**layout, "placed_items": new_items})
    return out_layouts


def _write_back(layouts, placed):
    for layout, row in zip(layouts, placed):
        for pi, e in zip(layout.get("placed_items", []), row):
            pi["transformation"]["rotation"] = e[1]
            pi["transformation"]["translation"] = [e[2], e[3]]


def _ring_area(ring):
    if not ring or len(ring) < 3:
        return 0.0
    a = 0.0
    n = len(ring)
    for i in range(n):
        x1, y1 = ring[i]
        x2, y2 = ring[(i + 1) % n]
        a += x1 * y2 - x2 * y1
    return abs(a) * 0.5


def _part_area(item):
    coords = item.get("coords") or item.get("coordinates") or []
    holes = item.get("holes") or []
    return _ring_area(coords) - sum(_ring_area(h) for h in holes)


def decorate_live_items(items, input_items, space, meta=None, apply_fill=True, sheets=None):
    """Clone a live item list, attach J-085 fillers, then optional post-pass.

    Returns (items, stats) with holesFilled and measured density so the
    live view matches the result modal (expand + hole-fill). Never mutates
    the engine snapshot. Failures fall back to the original items.
    """
    if not items or not input_items:
        return items, {"holesFilled": 0, "density": None}
    is_bpp = any(isinstance(raw, (list, tuple)) and len(raw) >= 5 for raw in items)
    by_bin = {}
    for raw in items:
        raw = list(raw)
        if len(raw) >= 5:
            pid, bin_i, rot, x, y = raw[0], raw[1], raw[2], raw[3], raw[4]
        else:
            pid, rot, x, y = raw[0], raw[1], raw[2], raw[3]
            bin_i = 0
        if bin_i not in by_bin:
            by_bin[bin_i] = {"placed_items": []}
        by_bin[bin_i]["placed_items"].append({
            "item_id": pid,
            "transformation": {
                "rotation": rot,
                "translation": [x, y],
            },
        })
    layouts = [by_bin[b] for b in sorted(by_bin)]
    added = 0
    if meta:
        before = sum(len(layout["placed_items"]) for layout in layouts)
        layouts = expand_meta(
            input_items,
            meta["host"],
            meta["fill"],
            meta["slots"],
            layouts,
            meta.get("ringRotations"),
        )
        added = sum(len(layout["placed_items"]) for layout in layouts) - before
        for bin_i, layout in zip(sorted(by_bin), layouts):
            by_bin[bin_i] = layout
    recovered = 0
    if apply_fill:
        try:
            recovered = apply_hole_fill(input_items, layouts, space) or 0
        except Exception:
            recovered = 0
    out = []
    for bin_i in sorted(by_bin):
        for pi in by_bin[bin_i]["placed_items"]:
            t = pi.get("transformation") or {}
            tr = t.get("translation") or [0, 0]
            rot = t.get("rotation", 0)
            if is_bpp:
                out.append([pi.get("item_id"), bin_i, rot, tr[0], tr[1]])
            else:
                out.append([pi.get("item_id"), rot, tr[0], tr[1]])
    density = None
    if sheets:
        by_id = {i["id"]: i for i in input_items}
        parts_area = 0.0
        bins = set()
        for raw in out:
            it = by_id.get(raw[0])
            if it:
                parts_area += _part_area(it)
            if is_bpp and len(raw) >= 2:
                bins.add(raw[1])
        w, h = float(sheets[0][0]), float(sheets[0][1])
        n_sheets = max(1, len(bins) or 1)
        sheet_area = w * h * n_sheets
        if sheet_area > 0:
            density = parts_area / sheet_area
    return out, {"holesFilled": added + recovered, "density": density}
