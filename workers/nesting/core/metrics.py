"""Result quality metrics for nesting alternatives.

These are pure scoring helpers (no solver interaction): they grade the
layouts the engine produced, for ranking alternatives and for the UI.
"""
import math

from shapely.geometry import Polygon, box
from shapely.affinity import rotate, translate
from shapely.ops import unary_union


def _placed_polygon(item, transform):
    """The item's geometry at its placement."""
    poly = Polygon(item["coords"])
    return translate(
        rotate(poly, transform.angle, origin=(0, 0), use_radians=True),
        transform.x, transform.y,
    )


def _used_bbox_area(container, input_items_by_id):
    """Area of the bounding box covering every part placed on a sheet —
    the footprint the customer actually pays for. The remainder of the
    sheet is the reusable offcut: the smaller the bbox, the cleaner it is."""
    min_x = min_y = float("inf")
    max_x = max_y = float("-inf")
    for transform in container.transforms:
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
    this score rewards compaction.
    """
    items_by_id = {item["id"]: item for item in input_items}
    bbox_total = sum(_used_bbox_area(c, items_by_id) for c in containers)
    sheet_total = sum(
        (c.bin_width or 0) * (c.bin_height or 0) for c in containers
    )
    if sheet_total <= 0:
        return None
    return min(1.0, bbox_total / sheet_total)


def _band_offcut(containers, items_by_id):
    """Largest guaranteed-free band around the used bbox, across all sheets.

    The four bands (right/top/bottom/left of the used bounding box) are free
    BY CONSTRUCTION of the bbox — O(n), exact for the band-shaped offcuts
    that matter in practice (the remnant the user reuses).
    """
    best = None
    for container in containers:
        sheet_w, sheet_h = container.bin_width or 0, container.bin_height or 0
        if sheet_w <= 0 or sheet_h <= 0 or not container.transforms:
            continue
        min_x = min_y = float("inf")
        max_x = max_y = float("-inf")
        for transform in container.transforms:
            item = items_by_id.get(getattr(transform, "item_id", None))
            if item is None:
                continue
            bx = _placed_polygon(item, transform).bounds
            min_x, min_y = min(min_x, bx[0]), min(min_y, bx[1])
            max_x, max_y = max(max_x, bx[2]), max(max_y, bx[3])
        if min_x == float("inf"):
            continue
        for w, h in (
            (sheet_w - max_x, sheet_h),   # right band
            (sheet_w, sheet_h - max_y),   # top band
            (sheet_w, min_y),             # bottom band
            (min_x, sheet_h),             # left band
        ):
            area = w * h
            if w > 0 and h > 0 and (best is None or area > best["area"]):
                best = {"width": w, "height": h, "area": area}
    return best


# Above this many placed parts, the exact scan is quadratic in the number of
# free-space vertices and can take minutes — switch to the band offcut.
EXACT_OFFCUT_MAX_PARTS = 60


def largest_empty_rectangle(containers, input_items):
    """Largest axis-aligned rectangle of free space across all sheets.

    Small layouts (<= EXACT_OFFCUT_MAX_PARTS parts): computed exactly on the
    free-space polygon — candidate rectangle edges are the sheet edges and
    every free-space vertex coordinate (a maximal rectangle always has its
    sides on those lines). Large layouts: band offcut around the used bbox
    (see _band_offcut). Returns {width, height, area} or None.
    """
    items_by_id = {item["id"]: item for item in input_items}
    total_parts = sum(len(c.transforms) for c in containers)
    if total_parts > EXACT_OFFCUT_MAX_PARTS:
        return _band_offcut(containers, items_by_id)

    best = None

    for container in containers:
        sheet_w, sheet_h = container.bin_width or 0, container.bin_height or 0
        if sheet_w <= 0 or sheet_h <= 0:
            continue

        placed_polys = []
        for transform in container.transforms:
            item = items_by_id.get(getattr(transform, "item_id", None))
            if item is None:
                continue
            placed_polys.append(_placed_polygon(item, transform))

        sheet = box(0, 0, sheet_w, sheet_h)
        free = sheet if not placed_polys else sheet.difference(unary_union(placed_polys))
        if free.is_empty:
            continue

        xs = {0.0, sheet_w}
        ys = {0.0, sheet_h}
        geoms = list(getattr(free, "geoms", [free]))
        for geom in geoms:
            if geom.geom_type != "Polygon":
                continue
            for ring in [geom.exterior, *geom.interiors]:
                for x, y in ring.coords:
                    xs.add(x)
                    ys.add(y)
        xs = sorted(xs)

        # For each x-pair, the tallest vertical span of the strip that is
        # free across the strip's whole width: a placed part intersecting
        # the strip blocks its full y-range (exact for band layouts,
        # conservative elsewhere — the score never overestimates an offcut).
        for i in range(len(xs)):
            for j in range(i + 1, len(xs)):
                x1, x2 = xs[i], xs[j]
                if x2 - x1 <= 0:
                    continue
                strip = box(x1, 0, x2, sheet_h)
                blockers = []
                for poly in placed_polys:
                    inter = poly.intersection(strip)
                    if not inter.is_empty and inter.area > 1e-9:
                        blockers.append((poly.bounds[1], poly.bounds[3]))
                if not blockers:
                    span = sheet_h
                else:
                    blockers.sort()
                    merged = [list(blockers[0])]
                    for lo, hi in blockers[1:]:
                        if lo <= merged[-1][1]:
                            merged[-1][1] = max(merged[-1][1], hi)
                        else:
                            merged.append([lo, hi])
                    span = merged[0][0]  # below the first blocker
                    for k in range(len(merged) - 1):
                        span = max(span, merged[k + 1][0] - merged[k][1])
                    span = max(span, sheet_h - merged[-1][1])
                area = (x2 - x1) * span
                if area > 0 and (best is None or area > best["area"]):
                    best = {"width": x2 - x1, "height": span, "area": area}

    return best
