"""Tests for the accurate geometry builder (concavities + holes)."""
import math
import sys
from pathlib import Path

import ezdxf
import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

from core.geometry.build_geometry import build_geometry
from dxf_utils import read_dxf_file

FIXTURES = Path(__file__).parent / "fixtures"


def _build(path, tolerance=0.01):
    doc = read_dxf_file(str(path))
    parts = build_geometry(doc, tolerance)
    return [p.to_mongo_dict() for p in parts if p.to_mongo_dict() is not None]


def _make_dxf(path, entities):
    """entities: list of callables receiving the modelspace."""
    doc = ezdxf.new()
    # Fixtures are authored in mm — declare it, because ezdxf.new() defaults
    # to meters ($INSUNITS=6) and the importer normalizes units for real.
    doc.header["$INSUNITS"] = 4
    msp = doc.modelspace()
    for add in entities:
        add(msp)
    doc.saveas(path)
    return path


class TestFixtures:
    def test_piece_trou_has_one_hole(self):
        parts = _build(FIXTURES / "Piece_Trou.DXF")
        assert len(parts) == 1
        part = parts[0]
        assert part["width"] == pytest.approx(100.0, abs=0.1)
        assert part["height"] == pytest.approx(100.0, abs=0.1)
        # The r=35 circle must be detected as a hole, not filled.
        assert len(part["holes"]) == 1
        from shapely.geometry import Polygon
        hole_area = Polygon(part["holes"][0]).area
        assert hole_area == pytest.approx(math.pi * 35**2, rel=0.02)
        # All 6 entities travel with the part (4 lines + circle + point).
        assert len(part["handles"]) == 6

    def test_piece_fillx4_is_single_solid_part(self):
        parts = _build(FIXTURES / "Piece_Fillx4.DXF")
        assert len(parts) == 1
        part = parts[0]
        assert part["holes"] == []
        from shapely.geometry import Polygon
        area = Polygon(part["coordinates"]).area
        # Quarter disk r=28.
        assert area == pytest.approx(math.pi * 28**2 / 4, rel=0.02)


class TestConcavityPreserved:
    def test_l_shape_keeps_its_concavity(self, tmp_path):
        def draw(msp):
            # L-shape: 100x100 square missing its top-right 50x50 quadrant.
            pts = [(0, 0), (100, 0), (100, 50), (50, 50), (50, 100), (0, 100)]
            msp.add_lwpolyline(pts, close=True)

        path = _make_dxf(tmp_path / "lshape.dxf", [draw])
        parts = _build(path)
        assert len(parts) == 1
        from shapely.geometry import Polygon
        part = Polygon(parts[0]["coordinates"])
        # Area must be 7500 (concave), NOT 10000 (convex hull).
        assert part.area == pytest.approx(7500.0, rel=0.01)
        # 6 vertices = the concave corner survived.
        assert len(parts[0]["coordinates"]) >= 6

    def test_u_shape_keeps_both_concavities(self, tmp_path):
        def draw(msp):
            # U-shape outline.
            pts = [
                (0, 0), (100, 0), (100, 100), (80, 100), (80, 20),
                (20, 20), (20, 100), (0, 100),
            ]
            msp.add_lwpolyline(pts, close=True)

        path = _make_dxf(tmp_path / "ushape.dxf", [draw])
        parts = _build(path)
        assert len(parts) == 1
        from shapely.geometry import Polygon
        part = Polygon(parts[0]["coordinates"])
        expected = 100 * 100 - 60 * 80  # outer minus notch
        assert part.area == pytest.approx(expected, rel=0.01)


class TestEvenOddRule:
    def test_island_inside_hole_is_separate_part(self, tmp_path):
        from shapely.geometry import Polygon as P

        def draw(msp):
            msp.add_lwpolyline(
                [(0, 0), (100, 0), (100, 100), (0, 100)], close=True
            )
            msp.add_circle((50, 50), 30)   # hole
            msp.add_circle((50, 50), 10)   # island inside the hole -> own part

        path = _make_dxf(tmp_path / "island.dxf", [draw])
        parts = _build(path)
        assert len(parts) == 2
        by_area = sorted(
            parts, key=lambda p: P(p["coordinates"]).area, reverse=True
        )
        big, small = by_area[0], by_area[1]
        assert len(big["holes"]) == 1
        assert P(big["holes"][0]).area == pytest.approx(math.pi * 30**2, rel=0.02)
        assert P(small["coordinates"]).area == pytest.approx(math.pi * 10**2, rel=0.02)
        # The island keeps its own circle handle; the big part has square + hole circle.
        assert len(small["handles"]) == 1
        assert len(big["handles"]) == 2

    def test_open_linework_square_with_circle_hole(self, tmp_path):
        def draw(msp):
            # Square drawn as 4 independent LINEs (open linework).
            msp.add_line((0, 0), (100, 0))
            msp.add_line((100, 0), (100, 100))
            msp.add_line((100, 100), (0, 100))
            msp.add_line((0, 100), (0, 0))
            msp.add_circle((50, 50), 20)

        path = _make_dxf(tmp_path / "open_square.dxf", [draw])
        parts = _build(path)
        assert len(parts) == 1
        part = parts[0]
        assert len(part["holes"]) == 1
        # The 4 lines AND the circle attach to the part.
        assert len(part["handles"]) == 5


class TestMultiPart:
    def test_disjoint_parts_stay_separate(self, tmp_path):
        def draw(msp):
            msp.add_lwpolyline([(0, 0), (50, 0), (50, 50), (0, 50)], close=True)
            msp.add_lwpolyline([(200, 0), (250, 0), (250, 50), (200, 50)], close=True)

        path = _make_dxf(tmp_path / "two_parts.dxf", [draw])
        parts = _build(path)
        assert len(parts) == 2
        for part in parts:
            assert len(part["handles"]) == 1


class TestPartColor:
    def test_color_is_persisted_when_provided(self, tmp_path):
        def draw(msp):
            msp.add_lwpolyline([(0, 0), (50, 0), (50, 50), (0, 50)], close=True)

        path = _make_dxf(tmp_path / "colored.dxf", [draw])
        doc = read_dxf_file(str(path))
        closed = build_geometry(doc, 0.01)
        mongo_dict = closed[0].to_mongo_dict(color="#2563EB")
        assert mongo_dict["color"] == "#2563EB"

    def test_color_key_absent_without_argument(self, tmp_path):
        # Legacy call sites (and old tests) get the historical dict shape —
        # readers resolve the deterministic fallback color themselves.
        def draw(msp):
            msp.add_lwpolyline([(0, 0), (50, 0), (50, 50), (0, 50)], close=True)

        path = _make_dxf(tmp_path / "uncolored.dxf", [draw])
        doc = read_dxf_file(str(path))
        closed = build_geometry(doc, 0.01)
        assert "color" not in closed[0].to_mongo_dict()
