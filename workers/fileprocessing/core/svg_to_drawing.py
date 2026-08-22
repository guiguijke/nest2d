"""SVG -> ezdxf Drawing conversion (import boundary).

The whole downstream pipeline only ever sees an ezdxf Drawing in canonical
mm ($INSUNITS=4, $MEASUREMENT=1) — polygonization, random part colors,
previews and the nesting engine are untouched.

Conventions:
  * svgelements normalizes everything (units, viewBox mapping, nested
    transforms) to CSS pixels at 96 dpi, so the scale is a single constant:
    mm = px * 25.4/96. Physical widths (mm/cm/in/pt) land on the same
    formula — verified against mm/in/px/viewBox-mismatched documents.
  * SVG is y-down, DXF is y-up: y is flipped so a mirrored part never
    reaches the cutting table.
  * Beziers/arcs are flattened at ~0.13 mm chord (0.5 px), clamped per
    segment, so ornate exports stay within the entity budget.
  * Raster images, text and gradients are skipped with a warning (same
    policy as TEXT/MTEXT on the DXF path); strokes are taken as center
    lines, never outlined — cutting convention.
"""
import math
import re
from io import BytesIO

import ezdxf
from svgelements import SVG, Path as SvgPath

from worker_common.logger import setup_logger

logger = setup_logger("svg_to_drawing")

MM_PER_PX = 25.4 / 96.0  # CSS reference pixel (96 dpi), see module docstring.

# Chord step when flattening curves, in px (~0.13 mm); a segment is never
# sampled beyond MAX_POINTS_PER_SEGMENT to keep ornate paths bounded.
FLATTEN_STEP_PX = 0.5
MAX_POINTS_PER_SEGMENT = 512

# Geometric shape types we convert (everything else is skipped).
_CONVERTIBLE = (
    "Path",
    "Rect",
    "Circle",
    "Ellipse",
    "Line",
    "Polyline",
    "Polygon",
)


def _segment_points(segment):
    """Samples one path segment. Straight lines contribute their endpoints
    only — sampling them like curves would inflate a plain rectangle to
    thousands of vertices (vertex budgets downstream are real, AGENTS.md
    trap #15). Curves are flattened at FLATTEN_STEP_PX (clamped)."""
    if type(segment).__name__ == "Line":
        return [segment.start, segment.end]
    try:
        length = segment.length()
    except Exception:
        length = 0.0
    n = max(2, min(MAX_POINTS_PER_SEGMENT, int(math.ceil(length / FLATTEN_STEP_PX)) + 1))
    return [segment.point(i / (n - 1)) for i in range(n)]


def _flatten_path(path):
    """Yields (points, closed) per subpath — points in SVG px, y-down."""
    for sub in path.as_subpaths():
        points = []
        closed = False
        for segment in sub.segments():
            seg_type = type(segment).__name__
            if seg_type == "Move":
                continue
            if seg_type == "Close":
                closed = True
                continue
            seg_pts = _segment_points(segment)
            # Skip the duplicated joint between consecutive segments.
            if points and seg_pts:
                seg_pts = seg_pts[1:]
            points.extend(seg_pts)
        if len(points) >= 2:
            yield points, closed


# Internal DTD entities ("billion laughs") expand in xml.etree before
# svgelements walks the tree (pentest H-4). External XXE is already
# impossible with ElementTree; this blocks the remaining memory bomb.
_ENTITY_RE = re.compile(br"<!ENTITY\b", re.IGNORECASE)


def svg_bytes_to_drawing(svg_bytes):
    """Parses SVG bytes into an ezdxf Drawing in canonical mm.

    Raises ValueError when no convertible geometry is found (the caller maps
    that to a clean file-processing error instead of a crash).
    """
    if _ENTITY_RE.search(svg_bytes or b""):
        raise ValueError("SVG DTD entities are not allowed")
    try:
        svg = SVG.parse(BytesIO(svg_bytes), reify=True)
    except Exception as e:
        raise ValueError(f"Unreadable SVG file: {e}") from e

    doc = ezdxf.new("R2010")
    # Canonical mm on every rebuilt document (ezdxf.new() declares METERS).
    doc.header["$INSUNITS"] = 4
    doc.header["$MEASUREMENT"] = 1
    msp = doc.modelspace()

    entity_count = 0
    for element in svg.elements():
        tag = type(element).__name__
        if tag in ("Group", "SVG", "Desc", "Title", "Defs", "Use", "Pattern", "Metadata"):
            continue
        if tag not in _CONVERTIBLE:
            logger.info("Skipping unsupported SVG element", extra={"type": tag})
            continue
        # Normalize every shape to a Path, then flatten subpaths.
        path = element if tag == "Path" else SvgPath(element.d())
        for points, closed in _flatten_path(path):
            mm_points = [
                (p.x * MM_PER_PX, -p.y * MM_PER_PX)  # y-down -> y-up flip
                for p in points
            ]
            msp.add_lwpolyline(mm_points, close=closed)
            entity_count += 1

    if entity_count == 0:
        raise ValueError("No convertible geometry found in SVG (paths/shapes only)")

    logger.info("SVG converted", extra={"entities": entity_count})
    return doc
