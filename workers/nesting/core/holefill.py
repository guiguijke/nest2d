"""J-085 / D-MOT-16 — trou-filling à l'échelle (partagée serveur + client).

Ordre de solve : (1) remplir les trous en maximisant la surface, (2) nicher
les méta-pièces (hôtes fermés) + pièces restantes. Deux passes :

- **pre-pass** (`plan_hole_fills` / `expand_packs`) : packer générique
  (pinwheel même type + glouton aire-d'abord). Repli automatique sur le
  pinwheel J-085 historique (1 hôte + 1 filler, 4/4) si le packer lève,
  dépasse son budget, ou score moins bien. Hôtes avec au moins un filler
  → trous FERMÉS dans l'instance de solve (piège #3b).
- **post-pass** (`apply_hole_fill`) : après le solve, recomplète les trous
  restés vides avec le même packer (repli pinwheel 4).

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
import time

from shapely.geometry import Polygon
from shapely.affinity import rotate, translate

PINWHEEL = (0.0, 90.0, 180.0, 270.0)
CAPACITY = 4
# Bruit de mesure overlap (mm²) — en dessous c'est du contact, pas un
# chevauchement (aligné sur metrics.OVERLAP_EPS_MM2).
OVERLAP_EPS = 0.01
# Budget du glouton (repli pinwheel si dépassé — D-MOT-16 fallback perfs).
PACK_BUDGET_SEC = 0.4
PACK_GRID = 8
# Contact exact (dist == space) permis, comme l'inflation jagua.
_SPACE_EPS = 1e-6


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


def _violates_spacing_loose(cand, placed, space):
    """True si dist < space (le contact exact est permis — sémantique jagua)."""
    for q in placed:
        if space > 0:
            if cand.distance(q) + _SPACE_EPS < space:
                return True
        elif cand.intersection(q).area > OVERLAP_EPS:
            return True
    return False


def pack_hole(hole_ring, candidates, space, deadline=None):
    """Place le maximum d'aire de fillers dans un trou.

    `candidates` : [{id, coords, rotations, remaining, area}]. Ne mute pas
    le stock. Deux stratégies, on garde la meilleure : pinwheel même type
    (existant) puis glouton plus grande aire + grille. Budget `deadline`
    (time.monotonic) : au-delà on renvoie le pinwheel déjà calculé.
    """
    space = float(space or 0)
    hole = Polygon(hole_ring)
    inner = hole.buffer(-space) if space > 0 else hole
    if inner.is_empty:
        return []
    cx, cy = _centroid(hole_ring)

    def timed_out():
        return deadline is not None and time.monotonic() > deadline

    def try_pose(coords, rot, tx, ty, placed_polys):
        cand = translate(rotate(Polygon(coords), rot, origin=(0, 0)), tx, ty)
        if not inner.contains(cand):
            return None
        if _violates_spacing_loose(cand, placed_polys, space):
            return None
        return cand

    # --- stratégie 1 : meilleur pinwheel mono-type ---
    best, best_area = [], 0.0
    for cand in candidates:
        if cand.get("remaining", 0) <= 0:
            continue
        allowed = cand.get("rotations")
        allowed_set = set(allowed) if allowed else None
        rots = pinwheel_capacity(hole_ring, cand["coords"], space, allowed=allowed_set)
        n = min(len(rots), int(cand["remaining"]))
        if n <= 0:
            continue
        area = n * float(cand["area"])
        if area > best_area:
            best_area = area
            best = [
                {"fillId": cand["id"], "rot": float(rots[i]), "lx": cx, "ly": cy, "area": float(cand["area"])}
                for i in range(n)
            ]

    if timed_out():
        return best
    active_types = [c for c in candidates if int(c.get("remaining") or 0) > 0]
    if len(active_types) <= 1 and best:
        return best

    # --- stratégie 2 : glouton aire-d'abord + grille ---
    stock = {c["id"]: int(c.get("remaining") or 0) for c in candidates}
    order = sorted(candidates, key=lambda c: -float(c.get("area") or 0))
    greedy, greedy_polys = [], []
    minx, miny, maxx, maxy = inner.bounds

    def positions():
        yield cx, cy
        if maxx > minx and maxy > miny:
            for i in range(PACK_GRID):
                for j in range(PACK_GRID):
                    tx = minx + (i + 0.5) * (maxx - minx) / PACK_GRID
                    ty = miny + (j + 0.5) * (maxy - miny) / PACK_GRID
                    yield tx, ty

    progressed = True
    while progressed and not timed_out():
        progressed = False
        for cand in order:
            if stock.get(cand["id"], 0) <= 0:
                continue
            rots = cand.get("rotations") or list(PINWHEEL)
            placed_one = False
            for rot in rots:
                for tx, ty in positions():
                    poly = try_pose(cand["coords"], rot, tx, ty, greedy_polys)
                    if poly is None:
                        continue
                    greedy.append({
                        "fillId": cand["id"],
                        "rot": float(rot),
                        "lx": float(tx),
                        "ly": float(ty),
                        "area": float(cand["area"]),
                    })
                    greedy_polys.append(poly)
                    stock[cand["id"]] -= 1
                    placed_one = True
                    progressed = True
                    break
                if placed_one or timed_out():
                    break
            if timed_out():
                break

    greedy_area = sum(p["area"] for p in greedy)
    if greedy_area > best_area + 1e-9:
        return greedy
    return best


def _fill_candidates(fill_items, stock):
    out = []
    for it in fill_items:
        rem = int(stock.get(it["id"], 0))
        if rem <= 0:
            continue
        coords = it.get("coords") or it.get("coordinates") or []
        out.append({
            "id": it["id"],
            "coords": coords,
            "rotations": it.get("rotations") or list(PINWHEEL),
            "remaining": rem,
            "area": _part_area(it),
        })
    return out


def _plan_legacy_full_pinwheel(input_items, space):
    """Repli J-085 : 1 hôte + 1 filler, pinwheel 4/4 seulement."""
    hosts = [i for i in input_items if i.get("holes")]
    fills = [i for i in input_items if not i.get("holes")]
    if len(hosts) != 1 or len(fills) != 1:
        return None
    host, fill = hosts[0], fills[0]
    fill_rotations = set(fill.get("rotations") or PINWHEEL)
    allowed = [r for r in PINWHEEL if r in fill_rotations]
    ring_rotations = [
        pinwheel_capacity(ring, fill["coords"], space, allowed=fill_rotations)
        for ring in (host.get("holes") or [])
    ]
    capacity = sum(len(rr) for rr in ring_rotations)
    full = bool(ring_rotations) and all(len(rr) == len(allowed) for rr in ring_rotations)
    if not (capacity and full):
        return None
    slots, _remaining = meta_slots(input_items, host["id"], fill["id"], capacity)
    area = _part_area(fill)
    packs = []
    for k in slots:
        poses = []
        left = k
        for ring, rots in zip(host.get("holes") or [], ring_rotations):
            if left <= 0:
                break
            cx, cy = _centroid(ring)
            for rot in rots:
                if left <= 0:
                    break
                poses.append({"fillId": fill["id"], "rot": float(rot), "lx": cx, "ly": cy, "area": area})
                left -= 1
        packs.append({"hostId": host["id"], "fills": poses})
    return packs if any(p["fills"] for p in packs) else None


def _plan_generic(input_items, space, deadline):
    hosts = [i for i in input_items if i.get("holes")]
    fills = [i for i in input_items if not i.get("holes")]
    if not hosts or not fills:
        return None
    stock = {i["id"]: int(i.get("count") or 0) for i in fills}
    packs = []
    for host in hosts:
        for _ in range(int(host.get("count") or 0)):
            poses = []
            for ring in (host.get("holes") or []):
                if deadline is not None and time.monotonic() > deadline:
                    break
                cands = _fill_candidates(fills, stock)
                if not cands:
                    break
                for pose in pack_hole(ring, cands, space, deadline=deadline):
                    fid = pose["fillId"]
                    if stock.get(fid, 0) <= 0:
                        continue
                    stock[fid] -= 1
                    poses.append(pose)
            packs.append({"hostId": host["id"], "fills": poses})
    return packs if any(p["fills"] for p in packs) else None


def _packs_area(packs):
    return sum(float(f.get("area") or 0) for p in (packs or []) for f in p.get("fills") or [])


def plan_hole_fills(input_items, space, budget_sec=PACK_BUDGET_SEC):
    """Plan de remplissage (packs) ou None. Jamais d'exception vers l'appelant.

    Compare packer générique et repli J-085 ; on garde le plus d'aire. Si le
    générique lève ou dépasse `budget_sec`, le repli seul est utilisé.
    """
    if not input_items:
        return None
    deadline = time.monotonic() + max(0.05, float(budget_sec))
    generic = None
    try:
        generic = _plan_generic(input_items, space, deadline)
    except Exception:
        generic = None
    try:
        legacy = _plan_legacy_full_pinwheel(input_items, space)
    except Exception:
        legacy = None
    g_area = _packs_area(generic)
    l_area = _packs_area(legacy)
    if l_area > g_area + 1e-9:
        return legacy
    return generic or legacy


def reduce_for_solve(input_items, jaguar_items, packs, space=0):
    """Instance réduite + meta {packs, idMap} (+ clés legacy si 1+1)."""
    used = {}
    closed = set()
    for pack in packs or []:
        if pack.get("fills"):
            closed.add(pack["hostId"])
        for f in pack.get("fills") or []:
            used[f["fillId"]] = used.get(f["fillId"], 0) + 1
    reduced, id_map = [], []
    for it, ji in zip(input_items, jaguar_items):
        d = int(ji.get("demand") or 0) - int(used.get(it["id"], 0))
        if d <= 0:
            continue
        entry = {**ji, "demand": d, "id": len(reduced)}
        if it["id"] in closed:
            entry["shape"] = {"type": "simple_polygon", "data": it["coords"]}
        reduced.append(entry)
        id_map.append(it["id"])
    hosts = {p["hostId"] for p in packs or []}
    fills = {f["fillId"] for p in packs or [] for f in p.get("fills") or []}
    if len(hosts) == 1 and len(fills) == 1:
        hid, fid = next(iter(hosts)), next(iter(fills))
        host = next(i for i in input_items if i["id"] == hid)
        fill = next(i for i in input_items if i["id"] == fid)
        allowed = set(fill.get("rotations") or PINWHEEL)
        ring_rotations = [
            pinwheel_capacity(ring, fill.get("coords") or fill.get("coordinates") or [], space, allowed=allowed)
            for ring in (host.get("holes") or [])
        ]
        meta = {
            "host": hid,
            "fill": fid,
            "slots": [len(p.get("fills") or []) for p in packs],
            "ringRotations": ring_rotations,
            "idMap": id_map,
        }
    else:
        meta = {"packs": packs, "idMap": id_map}
    return meta, reduced


def expand_packs(items, packs, layouts):
    """Rattache les poses planifiées aux hôtes posés (ordre de conso par hostId)."""
    unused = [p for p in (packs or [])]
    out_layouts = []
    for layout in layouts:
        new_items = list(layout.get("placed_items", []))
        for pi in layout.get("placed_items", []):
            hid = pi["item_id"]
            idx = next((i for i, p in enumerate(unused) if p.get("hostId") == hid), None)
            if idx is None:
                continue
            pack = unused.pop(idx)
            tr = pi["transformation"]
            hrot = tr["rotation"]
            hx, hy = tr["translation"][0], tr["translation"][1]
            r = math.radians(hrot)
            cos_r, sin_r = math.cos(r), math.sin(r)
            for f in pack.get("fills") or []:
                lx, ly = float(f["lx"]), float(f["ly"])
                wx = cos_r * lx - sin_r * ly + hx
                wy = sin_r * lx + cos_r * ly + hy
                new_items.append({
                    "item_id": f["fillId"],
                    "transformation": {
                        "rotation": hrot + float(f["rot"]),
                        "translation": [wx, wy],
                    },
                })
        out_layouts.append({**layout, "placed_items": new_items})
    return out_layouts


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
    deadline = time.monotonic() + PACK_BUDGET_SEC

    def _apply_poses(hi, hw, poses):
        nonlocal recovered
        by_free = {}
        for e in free:
            by_free.setdefault(e[0]["id"], []).append(e)
        for pose in poses:
            pool = by_free.get(pose["fillId"]) or []
            if not pool:
                continue
            e = pool.pop(0)
            e[1], e[2], e[3] = pose["rot"], pose["lx"], pose["ly"]
            e[4] = _placed(e[0], pose["rot"], pose["lx"], pose["ly"])
            if e in free:
                free.remove(e)
                hole_members[hi].append(e)
                recovered += 1

    for hi, (_, hw) in enumerate(holes):
        if not free:
            break
        ring = list(hw.exterior.coords)
        stock = {}
        for e in free:
            stock[e[0]["id"]] = stock.get(e[0]["id"], 0) + 1
        cands = _fill_candidates([e[0] for e in free], stock)
        # dédupliquer par id (plusieurs entries du même type)
        seen, uniq = set(), []
        for c in cands:
            if c["id"] in seen:
                continue
            seen.add(c["id"])
            uniq.append(c)
        poses = pack_hole(ring, uniq, space, deadline=deadline) if uniq else []
        if poses:
            _apply_poses(hi, hw, poses)
            continue
        # Repli pinwheel historique (4 pièces, tout-ou-rien).
        cur = hole_members[hi]
        if len(cur) >= CAPACITY or len(free) < CAPACITY - len(cur):
            continue
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
            continue
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
        if meta.get("packs"):
            layouts = expand_packs(input_items, meta["packs"], layouts)
        else:
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
