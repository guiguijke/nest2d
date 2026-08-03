"""Conversion of polygons with holes into simple (hole-free) polygons.

jagua-rs has no native holed-item support: `SPolygon` is a single ring and the
collision engine only knows solid shapes. The upstream-endorsed workaround
(jagua-rs issue #5) is to open every hole to the exterior with a degenerate
hairline channel, turning the part into one simply-connected polygon:

  * the channel is CHANNEL_WIDTH mm wide by default — far below any real part
    dimension, so no other part can ever pass through it, and its area cost is
    negligible;
  * the part remains a single piece (exactly what cutting requires);
  * the hole region becomes ordinary free space, so the MAIN solve can nest
    small parts inside cutouts instead of wasting them;
  * the channel only exists in the collision geometry — result DXFs are
    rebuilt from the original DXF entities, untouched by this conversion.

IMPORTANT (min_item_separation interaction): jagua-rs enforces the requested
gap by INFLATING every item by space/2. An inflation larger than half the
channel width seals the channel shut, making holes unreachable again. When a
separation `space` is requested, the channel must therefore be widened to
space + margin (see `channel_width_for_space`). Trade-off: a part edge can
then approach the material along the channel path within ~space/2 — a sliver
of a few mm², only along the channel, vs. holes completely unusable.

Requires the `narrow_concavity_cutoff` fix from jagua-rs 0.7.0 (#73/#74) and
concavity closing disabled for holed instances (see build_engine_config),
otherwise the channel would be sealed shut again.
"""

from shapely import set_precision, unary_union
from shapely.geometry import LineString, Polygon, box
from shapely.ops import nearest_points
import math

from worker_common.logger import setup_logger

logger = setup_logger("holed_polygons")

# Width of the channel connecting a hole to the part's exterior. Must stay
# above the solver's poly_simpl_tolerance (0.001) to survive simplification,
# and far below any real feature size so it never admits another part.
CHANNEL_WIDTH = 0.01

# Extra clearance added to the channel width when a separation is requested:
# jagua inflates items by space/2 on EACH side, so a channel of exactly
# `space` would still be sealed; the margin keeps it open.
CHANNEL_SEPARATION_MARGIN = 0.1

# Hard cap on the channel width. The channel is SUBTRACTED from the
# collision polygon: parts may legitimately be placed over it, intruding
# into real material by up to half its width. Wide channels also mutilate
# ornate parts (severed arms) and can create degenerate self-intersecting
# rings that jagua's importer rejects. When the requested spacing exceeds
# (cap - margin), the channel simply gets sealed by the separation
# inflation — holes go unused, which is a safe degradation, never a
# correctness risk.
CHANNEL_MAX_WIDTH = 2.5


def channel_width_for_space(space):
    """Channel width surviving jagua's min_item_separation inflation.

    Items are inflated by space/2 on both sides of the slit, so the channel
    closes by `space` in total: it must be strictly wider than `space` to
    stay usable — but never wider than CHANNEL_MAX_WIDTH (see above).
    """
    space = float(space or 0)
    return min(max(CHANNEL_WIDTH, space + CHANNEL_SEPARATION_MARGIN), CHANNEL_MAX_WIDTH)


def channels_usable(space):
    """Whether hole channels survive the separation inflation at all.

    Above ~2.4 mm of spacing the width cap kicks in and the inflation seals
    the channel shut — and the crushed ring breaks the jagua import
    (duplicate vertices / empty offset). Callers MUST leave holes closed in
    that case (the safe degradation: holes go unused, never a broken job).
    """
    return channel_width_for_space(space) > float(space or 0)


def open_holes_with_channels(outer_ring, hole_rings, channel_width=None):
    """Returns the exterior ring of `outer_ring` with every hole connected to
    the outside by a narrow channel (a simple polygon, as a point list).

    Each channel is a thin rectangle subtracted from the material along the
    SHORTEST path from the hole to the part's exterior (nearest boundary
    points). A straight horizontal cut (the previous implementation) crosses
    ornate contours several times, and the resulting ring self-intersects in
    ways jagua's importer strictly rejects — the shortest path crosses the
    material exactly once, which is both less destructive and robust.

    channel_width: defaults to CHANNEL_WIDTH; pass channel_width_for_space(s)
    when the job enforces a separation s (see module docstring).
    """
    width = float(channel_width) if channel_width else CHANNEL_WIDTH

    if not hole_rings:
        return [list(p) for p in outer_ring]

    poly = Polygon(outer_ring, hole_rings)
    if poly.is_empty:
        logger.warning("Holed polygon is empty, falling back to outer ring")
        return [list(p) for p in outer_ring]

    channels = []
    for ring in hole_rings:
        hole_poly = Polygon(ring)
        p_in, p_out = nearest_points(hole_poly.exterior, poly.exterior)
        dx, dy = p_out.x - p_in.x, p_out.y - p_in.y
        length = math.hypot(dx, dy)
        if length < 1e-9:
            continue
        ux, uy = dx / length, dy / length
        # Extend the cut beyond both ends so it genuinely connects the hole
        # to the outside (boundary touches alone do not open the ring).
        ext = width * 2.0
        seg = LineString([
            (p_in.x - ux * ext, p_in.y - uy * ext),
            (p_out.x + ux * ext, p_out.y + uy * ext),
        ])
        channels.append(seg.buffer(width / 2.0, cap_style="flat"))

    if not channels:
        return [list(p) for p in outer_ring]

    # A single difference: sequential cuts through narrow slivers hit
    # GEOS precision limits ("free hole" TopologyException).
    try:
        poly = poly.difference(unary_union(channels))
    except Exception:
        # Robustness retry on a snapped grid (grid << channel width).
        poly = set_precision(poly, 1e-6).difference(set_precision(unary_union(channels), 1e-6))

    # jagua's importer is stricter than shapely: a channel through ornate
    # geometry can leave a degenerate (self-touching/self-intersecting)
    # ring that shapely still calls valid. Repair those, or the whole job
    # dies at engine import with an opaque geometry error.
    if not poly.is_valid or poly.geom_type != "Polygon":
        from shapely.validation import make_valid
        repaired = make_valid(poly)
        pieces = [
            geom for geom in getattr(repaired, "geoms", [repaired])
            if geom.geom_type == "Polygon" and not geom.is_empty
        ]
        if pieces:
            poly = max(pieces, key=lambda geom: geom.area)
            logger.warning("Channel conversion required geometry repair")

    if poly.geom_type != "Polygon":
        # A pathological channel split the part (e.g. zero-width bridge in the
        # source geometry): take the largest remaining piece rather than
        # crashing the job, and let the coverage warning surface it.
        pieces = [
            geom for geom in getattr(poly, "geoms", [])
            if geom.geom_type == "Polygon" and not geom.is_empty
        ]
        if not pieces:
            logger.warning("Channel conversion destroyed the part, using outer ring")
            return [list(p) for p in outer_ring]
        poly = max(pieces, key=lambda geom: geom.area)
        logger.warning("Channel conversion split a part, kept the largest piece")

    return [[x, y] for x, y in poly.exterior.coords]
