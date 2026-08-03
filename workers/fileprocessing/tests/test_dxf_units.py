"""$INSUNITS import normalization: foreign-unit DXFs become canonical mm.

The block-INSERT case is the regression lock for the scaling ORDER:
recursive_decompose first (blocks resolved into flat primitives), THEN a
uniform scale — so a non-scaled block definition can never leak through.
"""
import sys
from pathlib import Path

import ezdxf
import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

from dxf_utils import read_dxf_file

IN = 25.4


def _write_flat_inch_dxf(path):
    doc = ezdxf.new()
    doc.header["$INSUNITS"] = 1
    msp = doc.modelspace()
    msp.add_lwpolyline([(0, 0), (10, 0), (10, 4), (0, 4)], close=True)  # 10x4 in
    doc.saveas(path)


def _write_block_inch_dxf(path):
    doc = ezdxf.new()
    doc.header["$INSUNITS"] = 1
    blk = doc.blocks.new(name="SQUARE")
    blk.add_lwpolyline([(0, 0), (1, 0), (1, 1), (0, 1)], close=True)  # 1x1 in
    msp = doc.modelspace()
    msp.add_blockref("SQUARE", (10, 10))
    doc.saveas(path)


def _write_unitless_dxf(path):
    doc = ezdxf.new()
    doc.header["$INSUNITS"] = 0
    msp = doc.modelspace()
    msp.add_lwpolyline([(0, 0), (100, 0), (100, 50), (0, 50)], close=True)
    doc.saveas(path)


def _write_mils_dxf(path):
    doc = ezdxf.new()
    doc.header["$INSUNITS"] = 9  # mils
    msp = doc.modelspace()
    msp.add_line((0, 0), (1000, 0))  # 1000 mils = 1 inch = 25.4 mm
    doc.saveas(path)


def _polyline_points(doc):
    for entity in doc.modelspace():
        if entity.dxftype() == "LWPOLYLINE":
            return [(p[0], p[1]) for p in entity.get_points()]
    raise AssertionError("no LWPOLYLINE found")


def test_flat_inch_dxf_scales_to_mm(tmp_path):
    path = tmp_path / "flat_in.dxf"
    _write_flat_inch_dxf(path)

    doc = read_dxf_file(str(path))

    pts = _polyline_points(doc)
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    assert max(xs) == pytest.approx(10 * IN)
    assert max(ys) == pytest.approx(4 * IN)
    assert doc.header["$INSUNITS"] == 4
    assert doc.header["$MEASUREMENT"] == 1
    assert doc.source_insunits == 1


def test_block_insert_inch_dxf_scales_to_mm(tmp_path):
    """INSERT point AND block content must both end up scaled — the order
    decompose-then-scale guarantees the block definition (never scaled
    itself) is resolved into primitives first."""
    path = tmp_path / "block_in.dxf"
    _write_block_inch_dxf(path)

    doc = read_dxf_file(str(path))

    pts = _polyline_points(doc)
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    # The 1x1 in square inserted at (10, 10) in must land at 254..279.4 mm.
    assert min(xs) == pytest.approx(10 * IN)
    assert max(xs) == pytest.approx(11 * IN)
    assert min(ys) == pytest.approx(10 * IN)
    assert max(ys) == pytest.approx(11 * IN)
    assert doc.source_insunits == 1


def test_unitless_dxf_stays_untouched(tmp_path):
    path = tmp_path / "unitless.dxf"
    _write_unitless_dxf(path)

    doc = read_dxf_file(str(path))

    pts = _polyline_points(doc)
    xs = [p[0] for p in pts]
    assert max(xs) == pytest.approx(100)
    assert doc.source_insunits == 0


def test_mils_dxf_scales_to_mm(tmp_path):
    path = tmp_path / "mils.dxf"
    _write_mils_dxf(path)

    doc = read_dxf_file(str(path))

    line = next(e for e in doc.modelspace() if e.dxftype() == "LINE")
    assert line.dxf.end.x == pytest.approx(IN)  # 1000 mils = 25.4 mm
