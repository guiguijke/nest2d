"""Strategy "max offcut": pack the parts into the narrowest possible band of
the sheet so the remainder is one clean, rectangular, reusable offcut.

The default solver minimises the bottom-right corner of the layout, which
produces L-shaped remainders — technically dense, practically useless. Band
mode instead restricts the bin to [0, W'] x [0, H] (or [0, W] x [0, H']) and
binary-searches the smallest feasible band, guaranteeing a rectangular
offcut of (W - W') x H (or W x (H - H')).

Also provides `largest_empty_rectangle`, the metric that makes the strategy
visible to the user ("offcut: 48 × 150").
"""

from shapely.geometry import Polygon
from shapely.affinity import rotate, translate

from core.nesting_input_builder import build_input_json
from core.racing import run_lbf
from utils.logger import setup_logger

logger = setup_logger("offcut")

# Binary search iterations per orientation (each costs one coarse lbf run).
BAND_SEARCH_STEPS = 5
# Coarse samples for search runs; the winning band is re-solved at full
# budget by the caller.
BAND_SEARCH_SAMPLES = 4000


def _band_bin(bin_id, stock, width, height):
    return {
        "id": bin_id,
        "cost": 1,
        "stock": stock,
        "shape": {
            "type": "polygon",
            "data": {
                "outer": [
                    [0.0, 0.0], [width, 0.0], [width, height], [0.0, height], [0.0, 0.0]
                ]
            },
        },
    }


def _fits(bins, jaguar_items, n_samples, min_separation, has_holes, total_requested, seed):
    output = run_lbf(build_input_json(
        bins, jaguar_items, n_samples=n_samples, prng_seed=seed,
        min_separation=min_separation, has_holes=has_holes,
    ))
    solution = output.get("solution") or {}
    placed = sum(len(l.get("placed_items", [])) for l in solution.get("layouts", []))
    return placed == total_requested, output


def solve_band(bins, jaguar_items, n_samples, min_separation, has_holes,
               total_requested, seed=7):
    """Binary-searches the narrowest band (vertical or horizontal) that holds
    every part, then re-solves the winner at the full sample budget.

    Only single-bin-type jobs are supported (banding one type among several
    makes little sense). Returns (output, band) where band = (axis, size) —
    axis 'x' means parts live in [0, size] x [0, H] — or (None, None) when
    even the full sheet barely fits (band mode brings nothing).
    """
    if len(bins) != 1:
        return None, None
    stock_bin = bins[0]
    outer = stock_bin["shape"]["data"]["outer"]
    xs = [p[0] for p in outer]
    ys = [p[1] for p in outer]
    sheet_w, sheet_h = max(xs), max(ys)
    stock = stock_bin.get("stock", 1)

    best = None  # (band_size, axis)

    for axis, lo_max in (("x", sheet_w), ("y", sheet_h)):
        # Lower bound: the band must at least hold the total part area.
        total_area = sum(
            Polygon(i["shape"]["data"]).area * i.get("demand", 1) for i in jaguar_items
        )
        other = sheet_h if axis == "x" else sheet_w
        lo = min(lo_max, max(1.0, total_area / other * 0.9))
        hi = lo_max
        feasible_hi, _ = _fits(
            bins,  # full sheet: banding is pointless if even this fails
            jaguar_items, BAND_SEARCH_SAMPLES, min_separation, has_holes,
            total_requested, seed,
        )
        if not feasible_hi:
            # Even the full sheet struggles at coarse budget — band mode
            # cannot help here.
            continue
        for _step in range(BAND_SEARCH_STEPS):
            mid = (lo + hi) / 2.0
            w = mid if axis == "x" else sheet_w
            h = mid if axis == "y" else sheet_h
            ok, _ = _fits(
                [_band_bin(0, stock, w, h)], jaguar_items,
                BAND_SEARCH_SAMPLES, min_separation, has_holes,
                total_requested, seed,
            )
            if ok:
                hi = mid
            else:
                lo = mid
        size = hi
        if best is None or size < best[0]:
            best = (size, axis)

    if best is None:
        return None, None

    size, axis = best
    # No point proposing a band that consumes (nearly) the whole sheet.
    full = sheet_w if axis == "x" else sheet_h
    if size >= full * 0.98:
        return None, None

    w = size if axis == "x" else sheet_w
    h = size if axis == "y" else sheet_h
    output = run_lbf(build_input_json(
        [_band_bin(0, stock, w, h)], jaguar_items,
        n_samples=n_samples, prng_seed=seed,
        min_separation=min_separation, has_holes=has_holes,
    ))
    solution = output.get("solution") or {}
    placed = sum(len(l.get("placed_items", [])) for l in solution.get("layouts", []))
    if placed != total_requested:
        logger.warning("Band re-solve at full budget lost parts, discarding band")
        return None, None

    return output, (axis, size)


def largest_empty_rectangle(containers, input_items):
    """Largest axis-aligned rectangle of free space across all sheets.

    Computed exactly on the free-space polygon: candidate rectangle edges
    are the sheet edges and every free-space vertex coordinate (a maximal
    rectangle always has its sides on those lines). Returns
    {width, height, area} of the best rectangle, or None.
    """
    items_by_id = {item["id"]: item for item in input_items}
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
            poly = Polygon(item["coords"])
            placed_polys.append(translate(
                rotate(poly, transform.angle, origin=(0, 0), use_radians=True),
                transform.x, transform.y,
            ))

        from shapely.geometry import box
        from shapely.ops import unary_union

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
        ys = sorted(ys)

        # For each x-pair, the tallest clear vertical span inside the strip.
        for i in range(len(xs)):
            for j in range(i + 1, len(xs)):
                x1, x2 = xs[i], xs[j]
                strip = box(x1, 0, x2, sheet_h)
                inter = free.intersection(strip)
                if inter.is_empty:
                    continue
                # Free y-intervals: scan sorted y coords, test segment midpoints.
                span = 0.0
                current = 0.0
                from shapely.geometry import Point
                for k in range(len(ys) - 1):
                    mid_y = (ys[k] + ys[k + 1]) / 2.0
                    if inter.covers(Point((x1 + x2) / 2.0, mid_y)):
                        current += ys[k + 1] - ys[k]
                        span = max(span, current)
                    else:
                        current = 0.0
                area = (x2 - x1) * span
                if area > 0 and (best is None or area > best["area"]):
                    best = {"width": x2 - x1, "height": span, "area": area}

    return best
