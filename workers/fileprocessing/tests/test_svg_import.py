"""SVG import: svgelements-based conversion to a canonical-mm ezdxf Drawing
+ end-to-end polygonization through build_geometry (same path as DXF)."""
import sys
from pathlib import Path

import pytest
from shapely.geometry import Polygon

sys.path.insert(0, str(Path(__file__).parent.parent))

from core.format_detect import detect_format
from core.svg_to_drawing import MM_PER_PX, svg_bytes_to_drawing
from core.geometry.build_geometry import build_geometry


def _parts(doc, tolerance=0.01):
    parts = build_geometry(doc, tolerance)
    return [p.to_mongo_dict() for p in parts if p.to_mongo_dict() is not None]


def _wrap(inner, width='100mm', height='100mm', viewbox='0 0 100 100'):
    vb = f' viewBox="{viewbox}"' if viewbox is not None else ''
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}"{vb}>'
        + inner
        + '</svg>'
    ).encode()


class TestEntityBomb:
    def test_dtd_entity_is_rejected(self):
        bomb = (
            b'<?xml version="1.0"?>'
            b'<!DOCTYPE svg [<!ENTITY lol "lol"><!ENTITY lol2 "&lol;&lol;">]>'
            b'<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/></svg>'
        )
        with pytest.raises(ValueError, match="DTD entities"):
            svg_bytes_to_drawing(bomb)


class TestDetectFormat:
    def test_svg_signature(self):
        assert detect_format(b'<?xml version="1.0"?>\n<svg xmlns="..."><rect/></svg>') == 'svg'
        assert detect_format(b'\n  <svg viewBox="0 0 1 1"></svg>') == 'svg'

    def test_dwg_signature(self):
        assert detect_format(b'AC1027\x00\x01\x02binarygarbage') == 'dwg'

    def test_dxf_fallback(self):
        assert detect_format(b'0\nSECTION\n2\nHEADER\n') == 'dxf'
        assert detect_format(b'') == 'dxf'


class TestUnits:
    def test_mm_document_exact_scale(self):
        doc = svg_bytes_to_drawing(_wrap('<rect x="10" y="10" width="50" height="20"/>'))
        ent = list(doc.modelspace())[0]
        xs = [p[0] for p in ent.get_points()]
        ys = [p[1] for p in ent.get_points()]
        assert max(xs) - min(xs) == pytest.approx(50.0, abs=0.05)
        assert max(ys) - min(ys) == pytest.approx(20.0, abs=0.05)
        assert doc.header['$INSUNITS'] == 4
        assert doc.header['$MEASUREMENT'] == 1

    def test_inch_document(self):
        doc = svg_bytes_to_drawing(
            _wrap('<rect x="0" y="0" width="2" height="1"/>', width='2in', height='1in', viewbox='0 0 2 1')
        )
        ent = list(doc.modelspace())[0]
        xs = [p[0] for p in ent.get_points()]
        assert max(xs) - min(xs) == pytest.approx(50.8, abs=0.05)  # 2in in mm

    def test_px_document_uses_96dpi(self):
        doc = svg_bytes_to_drawing(
            _wrap('<rect x="0" y="0" width="96" height="96"/>', width='96', height='96', viewbox=None)
        )
        ent = list(doc.modelspace())[0]
        xs = [p[0] for p in ent.get_points()]
        assert max(xs) - min(xs) == pytest.approx(25.4, abs=0.05)  # 96px = 1in

    def test_viewbox_mismatch_keeps_physical_width(self):
        # 100mm wide paper showing 200 user units: 1 unit = 0.5mm.
        doc = svg_bytes_to_drawing(
            _wrap('<rect x="0" y="0" width="200" height="100"/>', width='100mm', height='50mm', viewbox='0 0 200 100')
        )
        ent = list(doc.modelspace())[0]
        xs = [p[0] for p in ent.get_points()]
        assert max(xs) - min(xs) == pytest.approx(100.0, abs=0.05)


class TestGeometry:
    def test_y_axis_is_flipped(self):
        doc = svg_bytes_to_drawing(_wrap('<rect x="0" y="10" width="10" height="10"/>'))
        ent = list(doc.modelspace())[0]
        ys = [p[1] for p in ent.get_points()]
        # SVG y-down (y=10..20) -> DXF y-up (y=-20..-10)
        assert min(ys) == pytest.approx(-20.0, abs=0.05)
        assert max(ys) == pytest.approx(-10.0, abs=0.05)

    def test_straight_segments_stay_two_points(self):
        # Vertex-budget lock (AGENTS.md trap #15): a rectangle must NOT be
        # sampled into thousands of vertices.
        doc = svg_bytes_to_drawing(_wrap('<rect x="0" y="0" width="80" height="80"/>'))
        ent = list(doc.modelspace())[0]
        assert len(list(ent.get_points())) <= 5

    def test_bezier_is_flattened(self):
        doc = svg_bytes_to_drawing(_wrap('<path d="M10 90 C 30 80, 70 100, 90 90"/>'))
        ent = list(doc.modelspace())[0]
        assert not ent.closed
        assert len(list(ent.get_points())) > 10

    def test_group_transform_is_applied(self):
        doc = svg_bytes_to_drawing(
            _wrap('<g transform="translate(10,0) scale(2)"><rect x="5" y="5" width="10" height="10"/></g>')
        )
        ent = list(doc.modelspace())[0]
        xs = [p[0] for p in ent.get_points()]
        # SVG list semantics (rightmost applies first): x' = x*2 + 10,
        # rect spans x=5..15 -> 20..40 mm.
        assert min(xs) == pytest.approx(20.0, abs=0.05)
        assert max(xs) == pytest.approx(40.0, abs=0.05)

    def test_nested_rects_become_part_with_hole(self):
        parts = _parts(svg_bytes_to_drawing(
            _wrap('<rect x="10" y="10" width="80" height="80"/><rect x="30" y="30" width="20" height="20"/>')
        ))
        assert len(parts) == 1
        assert len(parts[0]['holes']) == 1
        hole_area = Polygon(parts[0]['holes'][0]).area
        assert hole_area == pytest.approx(400.0, rel=0.02)

    def test_multi_shapes_become_multiple_parts_with_colors(self):
        from worker_common.colors import pick_colors
        doc = svg_bytes_to_drawing(
            _wrap('<rect x="0" y="0" width="50" height="50"/><circle cx="80" cy="80" r="10"/>')
        )
        closed = build_geometry(doc, 0.01)
        parts = [
            p.to_mongo_dict(color=c)
            for p, c in zip(closed, pick_colors(len(closed)))
            if p.to_mongo_dict() is not None
        ]
        assert len(parts) == 2
        for part in parts:
            assert part['color'].startswith('#')

    def test_open_and_closed_paths(self):
        doc = svg_bytes_to_drawing(
            _wrap('<path d="M0 0 L50 0"/><path d="M0 10 L50 10 L50 60 L0 60 Z"/>')
        )
        entities = list(doc.modelspace())
        assert len(entities) == 2
        closed_flags = sorted(e.closed for e in entities)
        assert closed_flags == [False, True]


class TestRejections:
    def test_unreadable_svg_raises(self):
        with pytest.raises(ValueError, match='Unreadable SVG'):
            svg_bytes_to_drawing(b'<svg><unclosed')

    def test_no_geometry_raises(self):
        with pytest.raises(ValueError, match='No convertible geometry'):
            svg_bytes_to_drawing(_wrap('<text x="10" y="10">hello</text>'))
