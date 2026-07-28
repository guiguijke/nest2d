"""Hole-relocation post-pass.

jagua-rs treats every item as a solid silhouette (it has no native support
for holed items), so the interior cutouts of placed parts are wasted space
during the main solve. This post-pass wins it back:

  1. Take the least-filled sheet of the best solution.
  2. Collect the holes (interior rings) of every part placed on the OTHER
     sheets, transformed to absolute coordinates.
  3. Re-run lbf with the holes as bins and the target sheet's parts as items
     (`min_item_separation` deflates the holes and inflates the parts by
     half the gap, so the exact requested spacing is preserved).
  4. If — and only if — every part of the target sheet fits inside holes,
     the placements are merged into the sheets owning the holes and the
     target sheet is dropped. Otherwise the original solution is kept.

The pass repeats (last sheet towards the first) until no full sheet can be
freed, with a hard round cap. All-or-nothing per sheet: a partial relocation
saves no material, so it is never applied.
"""

import math

from shapely import prepare
from shapely.affinity import rotate, translate
from shapely.geometry import Point, Polygon

try:
    from shapely import polylabel  # shapely 2.x
except ImportError:  # shapely 1.8
    from shapely.ops import polylabel

from core.nesting_input_builder import build_input_json
from core.placement import Transform
from core.racing import run_lbf
from utils.logger import setup_logger

logger = setup_logger("hole_relocation")

# A hole must be at least this much larger than the biggest part we try to
# fit into it (post-separation the hole shrinks and the part grows).
HOLE_AREA_SAFETY_RATIO = 1.2
# Hard cap on relocation rounds (each round frees at most one sheet).
MAX_RELOCATION_ROUNDS = 3
# Up to this many parts, relocation tries the exact packer first: it is
# deterministic and produces evenly distributed placements, whereas lbf's
# corner-seeking loss clumps parts in a corner of the hole.
EXACT_FIRST_MAX_ITEMS = 8

# Sample budget for the relocation sub-solve (small instances → cheap).
RELOCATION_SAMPLES = 5000
# Above this many parts on the donor sheet, the exact fallback packer is
# skipped (its candidate search is quadratic-ish; LBF alone is used).
EXACT_PACK_MAX_ITEMS = 20
# Candidate placements whose overlap with an already placed part is below
# this area are considered touching (allowed when no separation is required).
OVERLAP_EPSILON = 1e-6
# Static candidates kept per part (coverage-filtered, before pairwise checks)
# and recursion budget for the backtracking search.
EXACT_PACK_MAX_CANDIDATES = 200
EXACT_PACK_NODE_BUDGET = 50000


def _sharp_vertices(ring_coords, max_interior_deg=150.0):
    """Convex corners of a ring — the natural docking points of a part
    (e.g. the apex of a wedge). Arc tessellation points are skipped."""
    pts = list(ring_coords)
    if len(pts) > 1 and pts[0] == pts[-1]:
        pts = pts[:-1]
    n = len(pts)
    if n < 3:
        return []
    # Ring orientation: interior is on the left for CCW rings.
    signed_area = sum(
        pts[i][0] * pts[(i + 1) % n][1] - pts[(i + 1) % n][0] * pts[i][1]
        for i in range(n)
    )
    ccw = signed_area > 0
    sharp = []
    cos_limit = -math.cos(math.radians(180.0 - max_interior_deg))
    for i in range(n):
        ax, ay = pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]
        bx, by = pts[(i + 1) % n][0] - pts[i][0], pts[(i + 1) % n][1] - pts[i][1]
        la, lb = math.hypot(ax, ay), math.hypot(bx, by)
        if la < 1.0 or lb < 1.0:
            continue  # tessellation point on a smooth curve
        cross = ax * by - ay * bx
        is_convex = (cross > 0) == ccw
        if not is_convex:
            continue
        cos_turn = -(ax * bx + ay * by) / (la * lb)
        if cos_turn > cos_limit:
            sharp.append(pts[i])
    return sharp


def _hole_anchors(hole_poly):
    """Reference positions inside a hole: centroid, pole of inaccessibility
    and a coarse interior grid (for slack holes where parts float freely)."""
    anchors = [(hole_poly.centroid.x, hole_poly.centroid.y)]
    try:
        pole = polylabel(hole_poly, tolerance=0.5)
        anchors.append((pole.x, pole.y))
    except Exception:
        pass
    min_x, min_y, max_x, max_y = hole_poly.bounds
    step = max(2.0, min(max_x - min_x, max_y - min_y) / 8.0)
    x = min_x
    while x <= max_x:
        y = min_y
        while y <= max_y:
            if hole_poly.covers(Point(x, y)):
                anchors.append((x, y))
            y += step
        x += step
    return anchors


def _item_references(item_poly):
    """Points of the part to dock against the anchors. Sharp convex vertices
    come FIRST: docking a corner (e.g. a wedge apex) against the hole centre
    is what makes tight tilings possible; centroid/bbox-centre references are
    fallbacks for slack holes. A centroid-first order greedily parks the part
    in the middle of the hole and blocks every subsequent part."""
    refs = _sharp_vertices(list(item_poly.exterior.coords))
    refs.append((item_poly.centroid.x, item_poly.centroid.y))
    min_x, min_y, max_x, max_y = item_poly.bounds
    refs.append(((min_x + max_x) / 2.0, (min_y + max_y) / 2.0))
    return refs


def _exact_pack_into_holes(hole_polys, relo_items, space, occupied=None):
    """Deterministic exact-geometry fallback packer.

    The lbf sub-solve is great in open sheets, but its corner-seeking loss is
    structurally weak inside small round holes (e.g. tiling 4 wedges in a
    disk). For a handful of parts, an exact shapely search is both cheap and
    reliable: dock each part's reference points (centroid, bbox centre, sharp
    vertices) against hole anchors (centroid, pole, coarse grid), validating
    with exact geometry. Separation mirrors jagua's semantics: the hole is
    deflated and the parts inflated by space/2 (rounded joins).

    `occupied` optionally seeds each hole with parts already placed there
    (bin_id -> list of polygons), so incremental moves account for them.

    Returns {relo_id: (bin_id, angle_deg, x, y)} on full success, else None.
    """
    if len(relo_items) > EXACT_PACK_MAX_ITEMS:
        return None

    half = (space or 0) / 2.0
    safe_holes = []  # (bin_id, safe_poly, anchors)
    for bin_id, hole_poly in hole_polys:
        safe = hole_poly.buffer(-half) if half > 0 else hole_poly
        if safe.is_empty:
            continue
        prepare(safe)
        safe_holes.append((bin_id, safe, _hole_anchors(safe)))

    if not safe_holes:
        return None

    # Largest parts first — they are the hardest to fit.
    ordered = sorted(relo_items, key=lambda entry: Polygon(entry["coords"]).area, reverse=True)

    # Precompute the static candidates per part: every (anchor, reference,
    # rotation) placement that fits inside a hole, scored by compactness
    # (spread around the hole centre, then edge contact potential). The
    # pairwise overlap filter depends on what is already placed, so it runs
    # during the backtracking search itself.
    candidates_per_item = []
    for entry in ordered:
        item_poly = Polygon(entry["coords"])
        safe_item = item_poly.buffer(half) if half > 0 else item_poly
        rotations = entry.get("rotations") or [0.0]
        refs = _item_references(item_poly)

        candidates = []
        for bin_id, safe_hole, anchors in safe_holes:
            hole_center = safe_hole.centroid
            for angle in rotations:
                rotated = rotate(safe_item, angle, origin=(0, 0))
                rotated_refs = [
                    rotate(Point(rx, ry), angle, origin=(0, 0)) for (rx, ry) in refs
                ]
                for ref in rotated_refs:
                    for (ax, ay) in anchors:
                        dx, dy = ax - ref.x, ay - ref.y
                        candidate = translate(rotated, dx, dy)
                        if not safe_hole.covers(candidate):
                            continue
                        spread = max(
                            hole_center.distance(Point(vx, vy))
                            for vx, vy in candidate.exterior.coords
                        )
                        candidates.append((spread, bin_id, angle, dx, dy, candidate))

        if not candidates:
            return None
        candidates.sort(key=lambda c: c[0])
        candidates_per_item.append(candidates[:EXACT_PACK_MAX_CANDIDATES])

    # Backtracking search: local scoring alone greedily parks parts in
    # positions that globally block tight packings (a wedge pointing at the
    # hole centre is individually compact but prevents the 4-apex tiling), so
    # we explore candidates and backtrack on dead ends.
    #
    # Candidate ranking is re-evaluated at every node for placement QUALITY,
    # not just feasibility: maximise the clearance to the hole boundary, then
    # the clearance to the parts already in the hole, then compactness. The
    # result is centred, evenly distributed placements (pinwheel for tiling
    # sectors, equal margins for slack holes) instead of a clumped pile.
    hole_boundaries = {bin_id: safe.boundary for bin_id, safe, _a in safe_holes}

    placements = {}
    occupied = occupied or {}
    placed_per_bin = {
        bin_id: list(occupied.get(bin_id, [])) for bin_id, _safe, _anchors in safe_holes
    }
    nodes = [0]

    def backtrack(idx):
        if idx == len(ordered):
            return True
        if nodes[0] >= EXACT_PACK_NODE_BUDGET:
            return False
        entry = ordered[idx]
        ranked = []
        for spread, bin_id, angle, dx, dy, candidate in candidates_per_item[idx]:
            already = placed_per_bin[bin_id]
            if any(
                candidate.intersection(other).area > OVERLAP_EPSILON
                for other in already
            ):
                continue
            d_boundary = hole_boundaries[bin_id].distance(candidate)
            d_others = min(
                (candidate.distance(other) for other in already),
                default=float("inf"),
            )
            ranked.append(((-d_boundary, -d_others, spread), bin_id, angle, dx, dy, candidate))
        ranked.sort(key=lambda r: r[0])
        for _score, bin_id, angle, dx, dy, candidate in ranked:
            nodes[0] += 1
            if nodes[0] >= EXACT_PACK_NODE_BUDGET:
                return False
            placed_per_bin[bin_id].append(candidate)
            placements[entry["relo_id"]] = (bin_id, angle, dx, dy)
            if backtrack(idx + 1):
                return True
            placed_per_bin[bin_id].pop()
            del placements[entry["relo_id"]]
        return False

    if not backtrack(0):
        return None

    return placements


def _transform_ring(ring, angle_rad, tx, ty):
    """Rotate a ring by `angle_rad` about the origin, then translate."""
    cos_a = math.cos(angle_rad)
    sin_a = math.sin(angle_rad)
    return [
        [x * cos_a - y * sin_a + tx, x * sin_a + y * cos_a + ty]
        for (x, y) in ring
    ]


def _close_ring(ring):
    """jagua-rs rings are explicitly closed (last point == first point)."""
    if ring and (ring[0] != ring[-1]):
        return list(ring) + [ring[0]]
    return list(ring)


def _sheet_fill_area(container, items_by_id):
    """Sum of the part areas placed on a sheet (fill indicator)."""
    area = 0.0
    for transform in container.transforms:
        item = items_by_id.get(getattr(transform, "item_id", None))
        if item is not None:
            area += Polygon(item["coords"]).area
    return area


def relocate_into_holes(containers, input_items, space, run_lbf_fn=run_lbf):
    """Tries to free sheets by relocating their parts into holes.

    `containers` are the ResultContainers of the best alternative (their
    Transforms carry `item_id`). Returns (containers, freed_sheets): the
    possibly shortened container list and how many sheets were freed. On any
    solver failure the original containers are returned untouched.
    """
    if len(containers) <= 1:
        return containers, 0

    items_by_id = {item["id"]: item for item in input_items}
    # Nothing to do if no placed part actually has holes.
    if not any(item.get("holes") for item in input_items):
        return containers, 0

    containers = list(containers)
    freed = 0

    for _round in range(MAX_RELOCATION_ROUNDS):
        if len(containers) <= 1:
            break

        # Least-filled sheet is the relocation donor.
        target = min(containers, key=lambda c: _sheet_fill_area(c, items_by_id))
        donors = [c for c in containers if c is not target]

        target_transforms = [
            t for t in target.transforms
            if getattr(t, "item_id", None) is not None and t.item_id in items_by_id
        ]
        if not target_transforms:
            break

        largest_part_area = max(
            Polygon(items_by_id[t.item_id]["coords"]).area for t in target_transforms
        )

        # Collect usable holes from the donor sheets (absolute coordinates).
        hole_bins = []
        hole_polys = []  # (bin_id, Polygon) in absolute coordinates
        hole_owner = {}  # bin_id -> donor container
        for donor in donors:
            for transform in donor.transforms:
                item = items_by_id.get(getattr(transform, "item_id", None))
                if item is None:
                    continue
                for hole_ring in item.get("holes") or []:
                    hole_poly = Polygon(hole_ring)
                    if hole_poly.area < largest_part_area * HOLE_AREA_SAFETY_RATIO:
                        continue
                    abs_ring = _close_ring(
                        _transform_ring(hole_ring, transform.angle, transform.x, transform.y)
                    )
                    bin_id = len(hole_bins)
                    hole_bins.append({
                        "id": bin_id,
                        "cost": 1,
                        "stock": 1,
                        "shape": {"type": "polygon", "data": {"outer": abs_ring}},
                    })
                    hole_polys.append((bin_id, Polygon(abs_ring)))
                    hole_owner[bin_id] = donor

        if not hole_bins:
            logger.info("No suitable holes found, stopping relocation")
            break

        # One lbf item per placed part on the target sheet (demand 1 each).
        relo_items = []
        relo_item_map = {}  # relo item id -> original transform
        for relo_id, transform in enumerate(target_transforms):
            item = items_by_id[transform.item_id]
            relo_items.append({
                "id": relo_id,
                "relo_id": relo_id,
                "coords": item["coords"],
                "rotations": item.get("rotations", [0.0]),
                "demand": 1,
                "allowed_orientations": item.get("rotations", [0.0]),
                "shape": {"type": "simple_polygon", "data": _close_ring(item["coords"])},
            })
            relo_item_map[relo_id] = transform

        # Placements are collected as {relo_id: (bin_id, angle_rad, x, y)}.
        placements = None

        def exact_pack():
            found = _exact_pack_into_holes(hole_polys, relo_items, space)
            if found is None:
                return None
            return {
                relo_id: (bin_id, math.radians(angle), x, y)
                for relo_id, (bin_id, angle, x, y) in found.items()
            }

        def lbf_pack():
            input_json = build_input_json(
                hole_bins, relo_items,
                n_samples=RELOCATION_SAMPLES, prng_seed=None,
                min_separation=space,
            )
            try:
                output = run_lbf_fn(input_json)
            except Exception as e:
                logger.error("Relocation sub-solve failed",
                             extra={"error": str(e)})
                return None
            solution = output.get("solution") or {}
            placed = sum(
                len(layout.get("placed_items", [])) for layout in solution.get("layouts", [])
            )
            if placed != len(relo_items):
                return None
            found = {}
            for layout in solution.get("layouts", []):
                bin_id = layout.get("container_id", 0)
                for placed_item in layout.get("placed_items", []):
                    transformation = placed_item["transformation"]
                    x, y = transformation["translation"]
                    # lbf 0.7.x reports rotations in degrees.
                    found[placed_item["item_id"]] = (
                        bin_id, math.radians(transformation["rotation"]), x, y,
                    )
            return found

        # Small batches: the exact packer goes first (deterministic, evenly
        # distributed placements). Larger batches: lbf first (faster), exact
        # packer as fallback for the tilings lbf cannot find.
        if len(relo_items) <= EXACT_FIRST_MAX_ITEMS:
            placements = exact_pack() or lbf_pack()
            if placements is not None:
                logger.info("Exact packer relocated all parts")
        else:
            placements = lbf_pack()
            if placements is None:
                placements = exact_pack()
                if placements is not None:
                    logger.info("Exact fallback packer relocated all parts")

        if placements is None:
            logger.info(
                "Sheet cannot be fully relocated into holes",
                extra={"required": len(relo_items), "holes": len(hole_bins)},
            )
            break

        # All parts fit inside holes: merge them into the donor sheets.
        for relo_id, (bin_id, angle_rad, x, y) in placements.items():
            original = relo_item_map[relo_id]
            owner = hole_owner[bin_id]
            owner.transforms.append(Transform(
                original.file_slug, original.handles, x, y,
                angle_rad, item_id=original.item_id,
            ))

        containers.remove(target)
        freed += 1
        logger.info(
            "Sheet freed by hole relocation",
            extra={"freed": freed, "remaining_sheets": len(containers)},
        )

    # Re-sequence container ids so result file names stay contiguous.
    for seq_id, container in enumerate(containers, start=1):
        container.container_id = seq_id

    return containers, freed


def rescale_density(density, containers_before, containers_after):
    """Density is placed-area / used-sheet-area; placed area is unchanged by
    relocation, so it rescales with the total sheet area ratio."""
    if not density:
        return density
    area_before = sum(
        (c.bin_width or 0) * (c.bin_height or 0) for c in containers_before
    )
    area_after = sum(
        (c.bin_width or 0) * (c.bin_height or 0) for c in containers_after
    )
    if area_after <= 0 or area_before <= 0:
        return density
    return density * (area_before / area_after)


def _placed_polygon(item, transform, half=0.0):
    """The item's geometry at its placement (optionally inflated)."""
    poly = Polygon(item["coords"])
    if half > 0:
        poly = poly.buffer(half)
    return translate(
        rotate(poly, math.degrees(transform.angle), origin=(0, 0)),
        transform.x, transform.y,
    )


def _used_bbox_area(container, input_items_by_id, skip=None):
    """Area of the bounding box covering every part placed on a sheet —
    the footprint the customer actually pays for. The remainder of the
    sheet is the reusable offcut: the smaller the bbox, the cleaner it is."""
    min_x = min_y = float("inf")
    max_x = max_y = float("-inf")
    for transform in container.transforms:
        if skip is not None and transform is skip:
            continue
        item = input_items_by_id.get(getattr(transform, "item_id", None))
        if item is None:
            continue
        bx = _placed_polygon(item, transform).bounds
        min_x, min_y = min(min_x, bx[0]), min(min_y, bx[1])
        max_x, max_y = max(max_x, bx[2]), max(max_y, bx[3])
    if min_x == float("inf"):
        return 0.0
    return (max_x - min_x) * (max_y - min_y)


def compute_used_sheet_share(containers, input_items):
    """Fraction of the sheet area actually consumed by the layout
    (used bounding box / sheet area, per sheet, summed).

    Lower is better: everything outside the used bounding box is a clean,
    reusable rectangular offcut. Unlike the solver's density (placed area /
    sheet area — identical for every alternative using the same sheets),
    this score rewards compaction: parts moved inside cutouts shrink the
    used bbox, so the consumed share visibly drops.
    """
    items_by_id = {item["id"]: item for item in input_items}
    bbox_total = sum(_used_bbox_area(c, items_by_id) for c in containers)
    sheet_total = sum(
        (c.bin_width or 0) * (c.bin_height or 0) for c in containers
    )
    if sheet_total <= 0:
        return None
    return min(1.0, bbox_total / sheet_total)


# A compaction move must shrink the used bbox by at least this much (mm²) —
# below that, the move is churn, not compaction.
COMPACTION_MIN_GAIN = 0.5
# Hard cap on moves per job (each move strictly improves, so this only
# guards against pathological anchor distributions).
COMPACTION_MAX_MOVES_FACTOR = 3


def compact_into_holes(containers, input_items, space):
    """Compaction post-pass: on every sheet, move parts into the holes of
    other placed parts whenever doing so shrinks the sheet's used bounding
    box.

    The main solve has no incentive to use holes on roomy sheets (its loss
    only minimises the bottom-right corner) and hole relocation only acts
    when a whole sheet can be freed. Compaction covers the everyday case:
    parts stacked along an edge move inside cutouts, and the leftover sheet
    becomes a clean rectangular offcut — reusable, resalable material —
    instead of a jagged strip.

    Returns the number of parts moved.
    """
    items_by_id = {item["id"]: item for item in input_items}
    if not any(item.get("holes") for item in input_items):
        return 0

    half = (space or 0) / 2.0
    total_transforms = sum(len(c.transforms) for c in containers)
    max_moves = COMPACTION_MAX_MOVES_FACTOR * max(1, total_transforms)
    moves = 0

    for container in containers:
        # Usable holes on this sheet, in absolute coordinates.
        hole_polys = []  # (bin_id, Polygon)
        for transform in container.transforms:
            item = items_by_id.get(getattr(transform, "item_id", None))
            if item is None:
                continue
            for hole_ring in item.get("holes") or []:
                abs_ring = _close_ring(
                    _transform_ring(hole_ring, transform.angle, transform.x, transform.y)
                )
                hole_polys.append((len(hole_polys), Polygon(abs_ring)))

        if not hole_polys:
            continue

        occupied = {}   # bin_id -> [polygons] already hosted in the hole
        moved_ids = set()

        # Batches: moving 3 of 4 edge-stacked parts does not shrink the bbox
        # yet (the 4th still defines the frontier), so moves are evaluated as
        # a group — commit only if the whole batch strictly improves the used
        # bounding box.
        while moves < max_moves:
            bbox_before = _used_bbox_area(container, items_by_id)

            def frontier_key(transform):
                item = items_by_id.get(getattr(transform, "item_id", None))
                if item is None:
                    return -1.0
                bx = _placed_polygon(item, transform).bounds
                return bx[2] + bx[3]  # x_max + y_max

            movers = [
                t for t in container.transforms
                if id(t) not in moved_ids
                and not (items_by_id.get(getattr(t, "item_id", None)) or {}).get("holes")
            ]
            movers.sort(key=frontier_key, reverse=True)

            # Tentative batch: pack the frontier movers together. The packer
            # backtracks across items — packing them one at a time would let
            # the first part's locally-best placement block the rest.
            batch = []  # (mover, bin_id, angle_deg, dx, dy, safe_poly)
            candidates = movers[:EXACT_PACK_MAX_ITEMS]
            placements = None
            # Shrink the candidate set from the least-frontier end until the
            # packer finds a complete packing (a hole may not fit them all).
            for cut in range(len(candidates), max(0, len(candidates) - 4), -1):
                trial = candidates[:cut]
                entries = [
                    {
                        "relo_id": i,
                        "coords": items_by_id[m.item_id]["coords"],
                        "rotations": items_by_id[m.item_id].get("rotations", [0.0]),
                    }
                    for i, m in enumerate(trial)
                ]
                placements = _exact_pack_into_holes(
                    hole_polys, entries, space, occupied=occupied
                )
                if placements is not None:
                    for i, m in enumerate(trial):
                        bin_id, angle_deg, dx, dy = placements[i]
                        item = items_by_id[m.item_id]
                        base = Polygon(item["coords"])
                        safe_poly = translate(
                            rotate(
                                base.buffer(half) if half > 0 else base,
                                angle_deg, origin=(0, 0),
                            ),
                            dx, dy,
                        )
                        batch.append((m, bin_id, angle_deg, dx, dy, safe_poly))
                    break

            if not batch:
                break

            # Tentative application, then commit only on a real bbox gain.
            olds = [(m.x, m.y, m.angle) for m, *_ in batch]
            for mover, _bin_id, angle_deg, dx, dy, _poly in batch:
                mover.x, mover.y, mover.angle = dx, dy, math.radians(angle_deg)
            bbox_after = _used_bbox_area(container, items_by_id)

            if bbox_after < bbox_before - COMPACTION_MIN_GAIN:
                for mover, bin_id, _angle, _dx, _dy, safe_poly in batch:
                    occupied.setdefault(bin_id, []).append(safe_poly)
                    moved_ids.add(id(mover))
                moves += len(batch)
                logger.info(
                    "Parts compacted into holes",
                    extra={"batch": len(batch), "bbox_gain": bbox_before - bbox_after},
                )
            else:
                for (mover, *_), (ox, oy, oa) in zip(batch, olds):
                    mover.x, mover.y, mover.angle = ox, oy, oa
                break

    if moves:
        logger.info("Compaction finished", extra={"moves": moves})
    return moves
