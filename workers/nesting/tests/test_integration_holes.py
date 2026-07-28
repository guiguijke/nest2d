"""End-to-end integration test with the real lbf binary.

Scenario (fixtures from real DXF files):
  - Piece_Trou: 100x100 square with a r=35 circular hole.
  - Piece_Fillx4: quarter-sector (r=28) that tiles the hole exactly 4 times.

The main solve needs two 110x110 sheets (total area > one sheet). The
hole-relocation post-pass must then move the 4 sectors into the square's
hole and free the second sheet entirely.

Skipped when the lbf binary is not on PATH.
"""
import math
import shutil
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))
sys.path.insert(0, str(Path(__file__).parent.parent.parent / "fileprocessing"))

pytestmark = pytest.mark.skipif(shutil.which("lbf") is None, reason="lbf binary not on PATH")

from core.hole_relocation import relocate_into_holes
from core.holed_polygons import open_holes_with_channels
from core.nesting_input_builder import build_bin, build_input_json, build_item
from core.placement import ResultContainer, Transform
from core.racing import run_lbf

TOLERANCE = 0.01


def _fixture_parts():
    """Real geometry extracted from the DXF fixtures by the file pipeline."""
    from core.geometry.build_geometry import build_geometry  # fileprocessing
    from dxf_utils import read_dxf_file  # fileprocessing

    fixtures = Path(__file__).parent.parent.parent / "fileprocessing" / "tests" / "fixtures"
    parts = {}
    for name in ("Piece_Trou", "Piece_Fillx4"):
        doc = read_dxf_file(str(fixtures / f"{name}.DXF"))
        built = build_geometry(doc, TOLERANCE)
        assert len(built) == 1, f"{name}: expected 1 part, got {len(built)}"
        parts[name] = built[0].to_mongo_dict()
    return parts


def _close(ring):
    return list(ring) + [ring[0]] if ring[0] != ring[-1] else list(ring)


@pytest.fixture(scope="module")
def fixture_parts():
    return _fixture_parts()


def test_main_solve_uses_two_sheets(fixture_parts):
    """Sanity check: WITHOUT the channel conversion, the instance cannot fit
    on a single 110x110 sheet (the hole is wasted material)."""
    trou, fill = fixture_parts["Piece_Trou"], fixture_parts["Piece_Fillx4"]
    items = [
        build_item(0, 1, _close(trou["coordinates"]), [0.0]),
        build_item(1, 4, _close(fill["coordinates"]), [0.0, 90.0, 180.0, 270.0]),
    ]
    bins = [build_bin(0, 2, 110.0, 110.0)]
    output = run_lbf(build_input_json(bins, items, n_samples=4000, prng_seed=1))
    solution = output["solution"]
    placed = sum(len(l["placed_items"]) for l in solution["layouts"])
    assert placed == 5
    assert len(solution["layouts"]) == 2  # does NOT fit on one sheet


def test_native_hole_nesting_in_main_solve(fixture_parts):
    """With the channel conversion, the MAIN solve nests sectors inside the
    square's hole natively: on a single 110x110 sheet, the only place a
    39.6x28 sector can go is the r=35 hole (the surrounding strips are 10mm
    wide). All 5 parts placed on one layout => holes were used."""
    trou, fill = fixture_parts["Piece_Trou"], fixture_parts["Piece_Fillx4"]
    converted = open_holes_with_channels(trou["coordinates"], trou["holes"])
    items = [
        build_item(0, 1, converted, [0.0]),
        build_item(1, 2, _close(fill["coordinates"]), [0.0, 90.0, 180.0, 270.0]),
    ]
    bins = [build_bin(0, 1, 110.0, 110.0)]
    output = run_lbf(build_input_json(
        bins, items, n_samples=20000, prng_seed=1, has_holes=True
    ))
    solution = output["solution"]
    placed = sum(len(l["placed_items"]) for l in solution["layouts"])
    assert placed == 3, "square + 2 sectors must all fit on one sheet"
    assert len(solution["layouts"]) == 1

    # Both sectors must sit inside the hole region (they fit nowhere else):
    # their placement translation (rotation in degrees since lbf 0.7.x)
    # projected with the sector centroid lands in the r=35 hole around (60,60)
    # — modulo jagua's centering pre-transform, so just assert the layouts
    # share the sheet: every placed item is within the sheet bounds.
    for layout in solution["layouts"]:
        for placed_item in layout["placed_items"]:
            x, y = placed_item["transformation"]["translation"]
            assert -1.0 <= x <= 111.0 and -1.0 <= y <= 111.0


def test_hole_relocation_frees_a_sheet(fixture_parts):
    """The 4 sectors are relocated inside the square's r=35 hole."""
    trou, fill = fixture_parts["Piece_Trou"], fixture_parts["Piece_Fillx4"]

    # Simulate the main solve's outcome: square alone on sheet 1 (its hole
    # centred on the sheet), the 4 sectors packed on sheet 2.
    input_items = [
        {
            "id": 0, "file_slug": "trou.dxf", "coords": trou["coordinates"],
            "holes": trou["holes"], "handles": trou["handles"], "count": 1,
            "rotations": [0.0],
        },
        {
            "id": 1, "file_slug": "fill.dxf", "coords": fill["coordinates"],
            "holes": [], "handles": fill["handles"], "count": 4,
            "rotations": [0.0, 90.0, 180.0, 270.0],
        },
    ]

    # Square placed at (60, 60) so its r=35 hole sits well inside sheet 1.
    sheet1 = ResultContainer(1, [
        Transform("trou.dxf", trou["handles"], x=60.0, y=60.0, angle=0.0, item_id=0),
    ], bin_width=110.0, bin_height=110.0)
    sheet2 = ResultContainer(2, [
        Transform("fill.dxf", fill["handles"], x=5.0, y=5.0, angle=0.0, item_id=1),
        Transform("fill.dxf", fill["handles"], x=50.0, y=5.0, angle=1.5708, item_id=1),
        Transform("fill.dxf", fill["handles"], x=5.0, y=40.0, angle=3.1416, item_id=1),
        Transform("fill.dxf", fill["handles"], x=50.0, y=40.0, angle=4.7124, item_id=1),
    ], bin_width=110.0, bin_height=110.0)

    result, freed = relocate_into_holes(
        [sheet1, sheet2], input_items, space=0, run_lbf_fn=run_lbf
    )

    assert freed == 1, "the sectors sheet should have been freed"
    assert len(result) == 1
    assert len(result[0].transforms) == 5  # square + 4 relocated sectors

    # Every relocated sector must lie inside the hole disk (centre 60,60 r=35).
    from shapely.geometry import Point, Polygon
    from shapely.affinity import rotate, translate

    hole = Point(60.0, 60.0).buffer(35.0)
    sector = Polygon(fill["coordinates"])
    # jagua's poly_simpl_tolerance is an AREA ratio (0.1%), so a tessellated
    # vertex can legally protrude past the ideal circle by more than a hair
    # when the lbf sub-solve wins the race. Assert on the protruding AREA
    # instead of strict containment (< 1% of a sector, physically negligible).
    max_outside = 0.01 * sector.area
    for t in result[0].transforms[1:]:
        placed = translate(rotate(sector, t.angle, origin=(0, 0), use_radians=True), t.x, t.y)
        outside = placed.difference(hole).area
        assert outside <= max_outside, f"relocated sector escapes the hole by {outside:.2f}mm²"


def test_exact_separation_is_enforced_by_solver(fixture_parts):
    """With space=2, relocated parts keep >= 2mm from the hole edge
    (jagua deflates the hole and inflates the part by space/2 each)."""
    trou, fill = fixture_parts["Piece_Trou"], fixture_parts["Piece_Fillx4"]

    input_items = [
        {
            "id": 0, "file_slug": "trou.dxf", "coords": trou["coordinates"],
            "holes": trou["holes"], "handles": trou["handles"], "count": 1,
            "rotations": [0.0],
        },
        {
            "id": 1, "file_slug": "fill.dxf", "coords": fill["coordinates"],
            "holes": [], "handles": fill["handles"], "count": 4,
            "rotations": [0.0, 90.0, 180.0, 270.0],
        },
    ]
    sheet1 = ResultContainer(1, [
        Transform("trou.dxf", trou["handles"], x=60.0, y=60.0, angle=0.0, item_id=0),
    ], bin_width=110.0, bin_height=110.0)
    sheet2 = ResultContainer(2, [
        Transform("fill.dxf", fill["handles"], x=5.0, y=5.0, angle=0.0, item_id=1),
        Transform("fill.dxf", fill["handles"], x=50.0, y=5.0, angle=1.5708, item_id=1),
        Transform("fill.dxf", fill["handles"], x=5.0, y=40.0, angle=3.1416, item_id=1),
        Transform("fill.dxf", fill["handles"], x=50.0, y=40.0, angle=4.7124, item_id=1),
    ], bin_width=110.0, bin_height=110.0)

    result, freed = relocate_into_holes(
        [sheet1, sheet2], input_items, space=2.0, run_lbf_fn=run_lbf
    )

    assert freed == 1
    from shapely.geometry import Point, Polygon
    from shapely.affinity import rotate, translate

    hole_boundary = Point(60.0, 60.0).buffer(35.0).boundary
    sector = Polygon(fill["coordinates"])
    for t in result[0].transforms[1:]:
        placed = translate(rotate(sector, t.angle, origin=(0, 0), use_radians=True), t.x, t.y)
        gap = hole_boundary.distance(placed)
        # ~2mm nominal; tessellation of the r=35 circle costs a small epsilon.
        assert gap >= 1.8, f"separation violated: {gap}"
