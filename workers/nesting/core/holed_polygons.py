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
from shapely.geometry import Polygon, box

from utils.logger import setup_logger

logger = setup_logger("holed_polygons")

# Width of the channel connecting a hole to the part's exterior. Must stay
# above the solver's poly_simpl_tolerance (0.001) to survive simplification,
# and far below any real feature size so it never admits another part.
CHANNEL_WIDTH = 0.01

# Extra clearance added to the channel width when a separation is requested:
# jagua inflates items by space/2 on EACH side, so a channel of exactly
# `space` would still be sealed; the margin keeps it open.
CHANNEL_SEPARATION_MARGIN = 0.1


def channel_width_for_space(space):
    """Channel width surviving jagua's min_item_separation inflation.

    Items are inflated by space/2 on both sides of the slit, so the channel
    closes by `space` in total: it must be strictly wider than `space`.
    """
    space = float(space or 0)
    return max(CHANNEL_WIDTH, space + CHANNEL_SEPARATION_MARGIN)


def open_holes_with_channels(outer_ring, hole_rings, channel_width=None):
    """Returns the exterior ring of `outer_ring` with every hole connected to
    the outside by a hairline channel (a simple polygon, as a point list).

    Each channel is a thin rectangle subtracted from the material, running
    horizontally from the hole's rightmost point to beyond the part's
    bounding box. Holes are processed right-to-left so a channel never has to
    cross a not-yet-opened hole (a channel crossing an already-opened hole
    just shares its exit, which is fine).

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

    half = width / 2.0
    beyond_x = poly.bounds[2] + width * 10.0

    # Rightmost hole first: its channel then cannot cross another hole.
    ordered_holes = sorted(
        hole_rings, key=lambda ring: max(p[0] for p in ring), reverse=True
    )
    channels = []
    for idx, ring in enumerate(ordered_holes):
        hx, hy = max(ring, key=lambda p: p[0])
        # Start the channel slightly INSIDE the hole: the rightmost point lies
        # on the boundary, and a channel starting exactly at hx only touches
        # the hole without opening it. 2× the channel width clears any
        # tessellation bulge while staying negligible for real holes. The tiny
        # per-hole y-jitter keeps collinear channels (aligned hole centres)
        # from degenerating the boolean cut.
        jitter = idx * width * 0.37
        channels.append(box(
            hx - width * 2.0, hy + jitter - half,
            beyond_x, hy + jitter + half,
        ))

    # A single difference: sequential cuts through the hairline slivers hit
    # GEOS precision limits ("free hole" TopologyException).
    try:
        poly = poly.difference(unary_union(channels))
    except Exception:
        # Robustness retry on a snapped grid (grid << channel width).
        poly = set_precision(poly, 1e-6).difference(set_precision(unary_union(channels), 1e-6))

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
