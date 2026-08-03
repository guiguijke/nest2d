"""
DXF drawing-unit normalization ($INSUNITS).

The canonical internal unit is ALWAYS millimeters. Files authored in other
units are scaled at import time — decompose first (block INSERTs resolved
into flat primitives), then a uniform scale — so every downstream constant
(tolerances, channel widths, engine config) keeps its mm semantics.

$MEASUREMENT only toggles dimension-text units in CAD — ignored here.
"""

from worker_common.logger import setup_logger

logger = setup_logger("units")

# $INSUNITS code -> multiplication factor to millimeters.
INSUNITS_TO_MM = {
    1: 25.4,        # inches
    2: 304.8,       # feet
    4: 1.0,         # millimeters
    5: 10.0,        # centimeters
    6: 1000.0,      # meters
    8: 2.54e-5,     # microinches
    9: 0.0254,      # mils (thousandths of an inch)
}

INSUNITS_MM = 4
MEASUREMENT_METRIC = 1

MM_PER_INCH = 25.4


def output_scale_and_headers(output_unit: str):
    """
    (scale factor FROM mm, $INSUNITS, $MEASUREMENT) for result DXF export.

    Geometry is computed in canonical mm and converted only at this export
    boundary, full precision — never round geometry. Inches get
    $MEASUREMENT=0 (imperial) so both headers agree with the numbers.
    Unknown units fall back to mm (safe default for legacy jobs).
    """
    if output_unit == "inch":
        return 1.0 / MM_PER_INCH, 1, 0
    return 1.0, INSUNITS_MM, MEASUREMENT_METRIC


def insunits_code(doc) -> int:
    """Declared $INSUNITS of a DXF document (0 = unitless / missing)."""
    try:
        return int(doc.header.get("$INSUNITS", 0) or 0)
    except Exception:
        return 0


def insunits_to_mm(doc) -> float:
    """
    Multiplication factor converting the document's drawing units to mm.
    Unitless (0) or unknown codes fall back to 1.0 — i.e. treated as mm,
    which is the historical behaviour for every file uploaded so far.
    """
    code = insunits_code(doc)
    if code in (0, INSUNITS_MM):
        return 1.0
    factor = INSUNITS_TO_MM.get(code)
    if factor is None:
        logger.warning(f"Unknown $INSUNITS={code}; assuming millimeters.")
        return 1.0
    logger.info(f"DXF declared $INSUNITS={code} -> scaling geometry x{factor:g} to mm.")
    return factor
