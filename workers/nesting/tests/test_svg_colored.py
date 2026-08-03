"""Colored result SVG: built from transforms + input item rings (never from
the production DXF), one filled path per placed part."""
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from core.placement import Transform
from core.svg_colored import build_colored_sheet_svg

ITEMS = {
    0: {
        "id": 0,
        "coords": [[0, 0], [100, 0], [100, 50], [0, 50]],
        "holes": [],
        "color": "#2563EB",
    },
    1: {
        "id": 1,
        "coords": [[0, 0], [80, 0], [80, 80], [0, 80]],
        # Holed part: outer ring + interior ring -> evenodd path with 2 subpaths.
        "holes": [[[20, 20], [60, 20], [60, 60], [20, 60]]],
        "color": "#DC2626",
    },
}


def _transforms():
    return [
        Transform("a.dxf", ["1A"], 10.0, 20.0, 0.0, item_id=0, color="#2563EB"),
        Transform("b.dxf", ["2B"], 200.0, 100.0, math.radians(90), item_id=1, color="#DC2626"),
    ]


def test_one_filled_path_per_part_with_its_color():
    svg = build_colored_sheet_svg(_transforms(), ITEMS, 1000.0, 500.0)
    assert svg.count("<path") == 2
    assert 'fill="#2563EB"' in svg
    assert 'fill="#DC2626"' in svg
    assert 'fill-rule="evenodd"' in svg
    # Sheet frame is present, parts are filled (no longer stroke-only).
    assert "<rect" in svg and 'stroke="#3B82F6"' in svg


def test_holes_become_subpaths_of_the_same_path():
    svg = build_colored_sheet_svg(_transforms(), ITEMS, 1000.0, 500.0)
    holed = next(p for p in svg.split("<path") if "#DC2626" in p)
    assert holed.count("M") == 2  # outer + hole in ONE path


def test_transform_is_applied_in_sheet_frame():
    svg = build_colored_sheet_svg(_transforms(), ITEMS, 1000.0, 500.0)
    assert 'transform="translate(10.000 20.000) rotate(0.000)"' in svg
    assert 'transform="translate(200.000 100.000) rotate(90.000)"' in svg


def test_unit_scale_applies_to_frame_rings_and_translation():
    svg = build_colored_sheet_svg(_transforms(), ITEMS, 1000.0, 500.0,
                                  unit_scale=1 / 25.4, unit_attr="in")
    assert 'width="39.37007874015748in"' in svg
    assert "translate(0.394 0.787)" in svg
    assert "M0.000 0.000 L3.937 0.000" in svg or "M0.000 0.000 3.937" in svg or "3.937" in svg


def test_missing_color_falls_back():
    items = {0: {"id": 0, "coords": [[0, 0], [10, 0], [10, 10]], "holes": []}}
    transforms = [Transform("a.dxf", [], 0.0, 0.0, 0.0, item_id=0)]
    svg = build_colored_sheet_svg(transforms, items, 100.0, 100.0)
    assert "#2563EB" in svg  # FALLBACK_PART_COLOR
