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


def _exact_pack_into_holes(hole_polys, relo_items, space):
    """Deterministic exact-geometry fallback packer.

    The lbf sub-solve is great in open sheets, but its corner-seeking loss is
    structurally weak inside small round holes (e.g. tiling 4 wedges in a
    disk). For a handful of parts, an exact shapely search is both cheap and
    reliable: dock each part's reference points (centroid, bbox centre, sharp
    vertices) against hole anchors (centroid, pole, coarse grid), validating
    with exact geometry. Separation mirrors jagua's semantics: the hole is
    deflated and the parts inflated by space/2 (rounded joins).

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
    # we explore candidates best-first and backtrack on dead ends.
    placements = {}
    placed_per_bin = {bin_id: [] for bin_id, _safe, _anchors in safe_holes}
    nodes = [0]

    def backtrack(idx):
        if idx == len(ordered):
            return True
        if nodes[0] >= EXACT_PACK_NODE_BUDGET:
            return False
        entry = ordered[idx]
        for _spread, bin_id, angle, dx, dy, candidate in candidates_per_item[idx]:
            nodes[0] += 1
            already = placed_per_bin[bin_id]
            if any(
                candidate.intersection(other).area > OVERLAP_EPSILON
                for other in already
            ):
                continue
            already.append(candidate)
            placements[entry["relo_id"]] = (bin_id, angle, dx, dy)
            if backtrack(idx + 1):
                return True
            already.pop()
            del placements[entry["relo_id"]]
            if nodes[0] >= EXACT_PACK_NODE_BUDGET:
                return False
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

        input_json = build_input_json(
            hole_bins, relo_items,
            n_samples=RELOCATION_SAMPLES, prng_seed=None,
            min_separation=space,
        )

        try:
            output = run_lbf_fn(input_json)
            solution = output.get("solution") or {}
            placed = sum(
                len(layout.get("placed_items", [])) for layout in solution.get("layouts", [])
            )
            if placed == len(relo_items):
                placements = {}
                for layout in solution.get("layouts", []):
                    bin_id = layout.get("container_id", 0)
                    for placed_item in layout.get("placed_items", []):
                        transformation = placed_item["transformation"]
                        x, y = transformation["translation"]
                        # lbf 0.7.x reports rotations in degrees.
                        placements[placed_item["item_id"]] = (
                            bin_id, math.radians(transformation["rotation"]), x, y,
                        )
        except Exception as e:
            logger.error("Relocation sub-solve failed",
                         extra={"error": str(e)})

        if placements is None:
            # lbf's corner-seeking loss is weak inside small holes: fall back
            # to the exact deterministic packer for small part counts.
            placements = _exact_pack_into_holes(hole_polys, relo_items, space)
            if placements is not None:
                placements = {
                    relo_id: (bin_id, math.radians(angle), x, y)
                    for relo_id, (bin_id, angle, x, y) in placements.items()
                }
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
