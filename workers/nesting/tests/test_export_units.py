"""Result DXF export unit tests: build_part converts at the export boundary.

Geometry is computed in canonical mm; output_unit='inch' must scale the
whole modelspace by 1/25.4 (full precision) and set $INSUNITS=1 +
$MEASUREMENT=0. 'mm' keeps numbers untouched with $INSUNITS=4 +
$MEASUREMENT=1.
"""
import sys
from pathlib import Path

import ezdxf
import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

# core.main imports worker_common.mongo, which demands MONGO_URI at import
# time. The pymongo client is lazy — no connection is ever attempted by the
# test (GridFS access is monkeypatched away).
import os

os.environ.setdefault("MONGO_URI", "mongodb://localhost:27017/nest2d")

from core.main import build_part
from core.placement import Transform
import core.main as core_main

IN = 25.4


def _source_doc():
    """A 100x50 mm rectangle standing in for a cleaned (mm) source file."""
    doc = ezdxf.new()
    doc.header["$INSUNITS"] = 4
    msp = doc.modelspace()
    return doc, msp.add_lwpolyline(
        [(0, 0), (100, 0), (100, 50), (0, 50)], close=True,
        dxfattribs={"layer": "0"},
    )


def _patched_entities(monkeypatch):
    doc, rect = _source_doc()
    handle = rect.dxf.handle
    monkeypatch.setattr(
        core_main,
        "get_entities_from_dxf_file",
        lambda file_slug, handles, owner_id=None, dek=None: (doc, [rect]),
    )
    return handle


def _find_boundary(doc):
    return next(
        e for e in doc.modelspace()
        if e.dxftype() == "LWPOLYLINE" and e.dxf.layer == "BIN_BOUNDARY"
    )


def _find_part(doc):
    return next(
        e for e in doc.modelspace()
        if e.dxftype() == "LWPOLYLINE" and e.dxf.layer != "BIN_BOUNDARY"
    )


def test_export_mm_keeps_geometry_and_headers(monkeypatch):
    handle = _patched_entities(monkeypatch)
    t = Transform("file.dxf", [handle], x=10.0, y=20.0, angle=0.0)

    doc = build_part([t], bin_width=1000, bin_height=2000, output_unit="mm")

    part = _find_part(doc)
    xs = [p[0] for p in part.get_points()]
    assert max(xs) == pytest.approx(110)  # 100 mm part translated by 10
    boundary = _find_boundary(doc)
    bxs = [p[0] for p in boundary.get_points()]
    bys = [p[1] for p in boundary.get_points()]
    assert max(bxs) == pytest.approx(1000)
    assert max(bys) == pytest.approx(2000)
    assert doc.header["$INSUNITS"] == 4
    assert doc.header["$MEASUREMENT"] == 1


def test_export_inch_scales_geometry_and_headers(monkeypatch):
    handle = _patched_entities(monkeypatch)
    t = Transform("file.dxf", [handle], x=10.0, y=20.0, angle=0.0)

    doc = build_part([t], bin_width=1000, bin_height=2000, output_unit="inch")

    part = _find_part(doc)
    xs = [p[0] for p in part.get_points()]
    ys = [p[1] for p in part.get_points()]
    # Full-precision conversion: part spans 10..110 mm -> inches.
    assert min(xs) == pytest.approx(10 / IN)
    assert max(xs) == pytest.approx(110 / IN)
    assert min(ys) == pytest.approx(20 / IN)
    # Sheet boundary follows the same conversion.
    boundary = _find_boundary(doc)
    bxs = [p[0] for p in boundary.get_points()]
    bys = [p[1] for p in boundary.get_points()]
    assert max(bxs) == pytest.approx(1000 / IN)
    assert max(bys) == pytest.approx(2000 / IN)
    # Headers agree with the numbers so any CAM reads inches.
    assert doc.header["$INSUNITS"] == 1
    assert doc.header["$MEASUREMENT"] == 0


def test_export_default_unit_is_mm(monkeypatch):
    # Legacy jobs (no outputUnit persisted) must keep exporting mm.
    handle = _patched_entities(monkeypatch)
    t = Transform("file.dxf", [handle], x=0.0, y=0.0, angle=0.0)

    doc = build_part([t])

    part = _find_part(doc)
    xs = [p[0] for p in part.get_points()]
    assert max(xs) == pytest.approx(100)
    assert doc.header["$INSUNITS"] == 4
