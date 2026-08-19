"""Result quality metrics for nesting alternatives.

These are pure scoring helpers (no solver interaction): they grade the
layouts the engine produced, for ranking alternatives and for the UI.
"""
import logging
import math

from shapely.geometry import LineString, Point, Polygon, box
from shapely.affinity import rotate, translate
from shapely.ops import unary_union

logger = logging.getLogger(__name__)


def _placed_polygon(item, transform):
    """The item's MATERIAL geometry at its placement (outer ring minus the
    holes). Using the outer ring alone would count the hole interiors as
    solid material: every part nested in a cutout would read as an overlap
    with a 0 gap."""
    poly = Polygon(item["coords"], item.get("holes") or [])
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
# free-space vertices — a few dozen simple parts are fine, but many parts OR
# ornate geometry (hundreds of vertices each) makes it take minutes. Above
# these budgets, switch to the band offcut.
# VERTEX budget kept low on purpose: the scan's cost is driven by the
# FREE-SPACE vertex count, which ornate rings (64-gon holes, sampled arcs)
# explode quadratically — 64-gon holed hosts at 10 copies took hours where
# the band offcut answers in milliseconds.
EXACT_OFFCUT_MAX_PARTS = 60
EXACT_OFFCUT_MAX_VERTICES = 600


def largest_empty_rectangle(containers, input_items):
    """Largest axis-aligned rectangle of free space across all sheets.

    Small/simple layouts: computed exactly on the free-space polygon —
    candidate rectangle edges are the sheet edges and every free-space
    vertex coordinate (a maximal rectangle always has its sides on those
    lines). Large or ornate layouts: band offcut around the used bbox
    (see _band_offcut). Returns {width, height, area} or None.
    """
    items_by_id = {item["id"]: item for item in input_items}
    total_parts = 0
    total_vertices = 0
    for c in containers:
        total_parts += len(c.transforms)
        for t in c.transforms:
            item = items_by_id.get(getattr(t, "item_id", None))
            if item is not None:
                # Holes count too: they are subtracted from the placed polys,
                # so their vertices land in the free-space polygon and drive
                # the exact scan's cost just as much as outer rings.
                total_vertices += len(item["coords"]) + sum(
                    len(h) for h in item.get("holes") or []
                )
    if total_parts > EXACT_OFFCUT_MAX_PARTS or total_vertices > EXACT_OFFCUT_MAX_VERTICES:
        return _band_offcut(containers, items_by_id)

    best = None
    bailed = False

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

        # The scan is O(len(xs)^2 x parts): ornate free-space geometry makes
        # it balloon well past what the input budget predicted — degrade to
        # the band offcut for this container instead of hanging the worker.
        if len(xs) * len(ys) > 40_000:
            bailed = True
            break

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

    if bailed:
        return _band_offcut(containers, items_by_id)
    return best


# An offcut whose SMALLEST dimension is below this (mm) is considered scrap:
# no realistic part nests into a sliver narrower than 100 mm. The flag is
# conservative by construction — the offcut is the largest GUARANTEED-free
# rectangle, so the real free-form remnant can only be bigger ("at least").
OFFCUT_REUSABLE_MIN_MM = 100.0


def enrich_offcut(offcut):
    """Enrich a {width, height, area} offcut rectangle for the nesting
    report: explicit mm-suffixed keys + a reusability flag (see
    OFFCUT_REUSABLE_MIN_MM). None stays None (no free rectangle found)."""
    if not offcut:
        return None
    w, h = offcut["width"], offcut["height"]
    return {
        "widthMm": round(w, 3),
        "heightMm": round(h, 3),
        "areaMm2": round(offcut["area"], 1),
        "reusable": min(w, h) >= OFFCUT_REUSABLE_MIN_MM,
    }


def per_sheet_metrics(containers, input_items):
    """Per-sheet MEASURED material accounting for the nesting report
    (the estimator's quoting numbers — never bbox, never engine-declared).

    One entry per container:
      {index, widthMm, heightMm, sheetAreaMm2, partsAreaMm2, freeAreaMm2,
       densityPct, partCount, offcut}
    partsAreaMm2 sums the TRUE areas of the placed polygons (outer ring
    minus the holes) on that sheet; densityPct = partsArea/sheetArea x 100,
    rounded to 0.1. The per-sheet offcut reuses the budgeted
    largest-empty-rectangle helper on the single container.
    """
    sheets = []
    items_by_id = {item["id"]: item for item in input_items}
    for index, container in enumerate(containers):
        sheet_w = container.bin_width or 0
        sheet_h = container.bin_height or 0
        sheet_area = sheet_w * sheet_h
        parts_area = 0.0
        part_count = 0
        for transform in container.transforms:
            item = items_by_id.get(getattr(transform, "item_id", None))
            if item is None:
                continue
            parts_area += _placed_polygon(item, transform).area
            part_count += 1
        sheets.append({
            "index": index,
            "widthMm": round(sheet_w, 3),
            "heightMm": round(sheet_h, 3),
            "sheetAreaMm2": round(sheet_area, 1),
            "partsAreaMm2": round(parts_area, 1),
            "freeAreaMm2": round(max(0.0, sheet_area - parts_area), 1),
            "densityPct": round(parts_area / sheet_area * 100, 1) if sheet_area > 0 else None,
            "partCount": part_count,
            "offcut": enrich_offcut(largest_empty_rectangle([container], input_items)),
        })
    return sheets


def report_totals(sheets):
    """Cross-sheet totals for the nesting report, incl. the material to
    buy: distinct sheet formats aggregated with their counts (mixed-format
    jobs), sorted by descending area. densityPct is the global MEASURED
    density (placed parts area / total sheet area)."""
    sheet_area = sum(s["sheetAreaMm2"] for s in sheets)
    parts_area = sum(s["partsAreaMm2"] for s in sheets)
    formats = {}
    for s in sheets:
        key = (s["widthMm"], s["heightMm"])
        formats[key] = formats.get(key, 0) + 1
    return {
        "sheetCount": len(sheets),
        "formats": [
            {"widthMm": w, "heightMm": h, "count": n}
            for (w, h), n in sorted(
                formats.items(), key=lambda kv: kv[0][0] * kv[0][1], reverse=True
            )
        ],
        "sheetAreaMm2": round(sheet_area, 1),
        "partsAreaMm2": round(parts_area, 1),
        "freeAreaMm2": round(max(0.0, sheet_area - parts_area), 1),
        "densityPct": round(parts_area / sheet_area * 100, 1) if sheet_area > 0 else None,
    }


# Above this many placed parts per sheet, the pairwise verification pass is
# skipped (None = unverified) — O(n^2) distances get too slow to be worth it.
VERIFY_MAX_PARTS_PER_SHEET = 250

# Intersection area below this counts as touching, not overlapping (the
# engine guarantees separation by construction; this is the measurement
# noise floor, mm²).
OVERLAP_EPS_MM2 = 0.01


def verify_layout(containers, input_items, space=0.0):
    """Physical verification of a layout — MEASURED, not declared.

    Computes, per job alternative:
      - smallest_gap_mm: min distance between any two placed parts, and
        parts to the sheet edge (the actually achieved spacing);
      - overlap_free: no two parts intersect beyond OVERLAP_EPS_MM2;
      - inside_sheet: every part fully within its sheet;
      - spacing_ok: smallest_gap >= requested space (minus epsilon);
      - holes_filled / holes_total: parts nested inside another part's
        cutout (centroid in hole ring), and total hole slots available.

    Returns a report dict; pairwise fields are None above
    VERIFY_MAX_PARTS_PER_SHEET parts on a sheet (unverified, not failed).
    """
    items_by_id = {item["id"]: item for item in input_items}
    report = {
        "smallestGapMm": None,
        "overlapFree": None,
        "insideSheet": True,
        "spacingOk": None,
        "holesFilled": 0,
        "holesTotal": 0,
        # Additif : fillers en trou au-delà de la capacité pinwheel validée
        # (0 en fonctionnement normal — un post-pass buggé a déjà empilé 8
        # fillers dans un trou prévu pour 4, cas trou600).
        "holesOverflow": 0,
    }

    smallest_gap = float("inf")
    overlap_free = True
    pair_checks_done = True

    for container in containers:
        sheet_w = container.bin_width or 0
        sheet_h = container.bin_height or 0
        sheet = box(0, 0, sheet_w, sheet_h)
        boundary = sheet.boundary

        placed = []       # outer rings at placement (collision geometry)
        holed_hosts = []  # (placed index of the host, hole ring at placement)
        for transform in container.transforms:
            item = items_by_id.get(getattr(transform, "item_id", None))
            if item is None:
                continue
            poly = _placed_polygon(item, transform)
            host_idx = len(placed)
            placed.append(poly)
            if not sheet.covers(poly):
                report["insideSheet"] = False
            for hole in item.get("holes") or []:
                hole_poly = translate(
                    rotate(Polygon(hole), transform.angle, origin=(0, 0), use_radians=True),
                    transform.x, transform.y,
                )
                holed_hosts.append((host_idx, hole_poly))

        # Part-in-part: centroid of ANOTHER placed part strictly inside a
        # hole ring (the host's own centroid sits in its hole by design).
        # Compte PLAFONNÉ par trou à la capacité pinwheel validée (CAPACITY) :
        # le brut 600/400 du cas trou600 (200 fillers dupliqués sur les poses
        # canoniques) passait silencieusement — l'excédent part dans
        # holesOverflow avec un warning au lieu de gonfler holesFilled.
        report["holesTotal"] += len(holed_hosts)
        occupants = [0] * len(holed_hosts)
        for idx, poly in enumerate(placed):
            c = poly.centroid
            for h_idx, (host_idx, hole_poly) in enumerate(holed_hosts):
                if host_idx != idx and hole_poly.contains(c):
                    occupants[h_idx] += 1
                    break
        from core.holefill import CAPACITY as HOLE_CAPACITY
        report["holesFilled"] += sum(min(n, HOLE_CAPACITY) for n in occupants)
        report["holesOverflow"] += sum(max(0, n - HOLE_CAPACITY) for n in occupants)

        # Pairwise checks (bounded).
        if len(placed) > VERIFY_MAX_PARTS_PER_SHEET:
            pair_checks_done = False
            continue
        for i, a in enumerate(placed):
            gap_to_edge = a.distance(boundary)
            if gap_to_edge < smallest_gap:
                smallest_gap = gap_to_edge
            for b in placed[i + 1:]:
                dist = a.distance(b)
                if dist < smallest_gap:
                    smallest_gap = dist
                if dist <= 0.0 and a.intersection(b).area > OVERLAP_EPS_MM2:
                    overlap_free = False

    if pair_checks_done and smallest_gap != float("inf"):
        report["smallestGapMm"] = round(smallest_gap, 3)
        report["overlapFree"] = overlap_free
        report["spacingOk"] = smallest_gap >= float(space or 0) - 0.01
    if report["holesOverflow"]:
        logger.warning(
            "holes overflow: %s filler(s) beyond validated pinwheel capacity "
            "(possible double-fill bug)", report["holesOverflow"],
        )
    return report
