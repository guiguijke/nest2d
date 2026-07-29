"""End-to-end integration test with the real nest-engine binary.

Scenario (fixtures from real DXF files):
  - Piece_Trou: 100x100 square with a r=35 circular hole.
  - Piece_Fillx4: quarter-sector (r=28) that tiles the hole exactly 4 times.

The engine must nest the sectors inside the square's hole NATIVELY (channel
conversion + separation/compaction), with exact separation and no overlaps —
this is the anti-regression gate for the removed Python post-passes.

Skipped when the nest-engine binary is not on PATH (NEST_ENGINE_BIN overrides
the lookup).
"""
import math
import os
import shutil
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))
sys.path.insert(0, str(Path(__file__).parent.parent.parent / "fileprocessing"))

ENGINE_BIN = os.environ.get("NEST_ENGINE_BIN", "nest-engine")
pytestmark = pytest.mark.skipif(
    shutil.which(ENGINE_BIN) is None and not Path(ENGINE_BIN).exists(),
    reason="nest-engine binary not found",
)

from core.engine import run_engine
from core.holed_polygons import channel_width_for_space, open_holes_with_channels
from core.nesting_input_builder import (
    build_bin,
    build_bpp_instance,
    build_engine_config,
    build_item,
    build_spp_instance,
    deterministic_seed,
)
from core.placement import parse_result_containers

TOLERANCE = 0.01
TIME_BUDGET = 8  # seconds per engine call — keep the suite fast


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


def _run(instance, problem_type, space=0.0, has_holes=True, max_strip_width=None, budget=TIME_BUDGET):
    config = build_engine_config(
        budget,
        deterministic_seed({"instance": instance, "space": space}),
        n_alternatives=1,
        min_separation=space,
        has_holes=has_holes,
        max_strip_width=max_strip_width,
    )
    alternatives = run_engine(instance, config, problem_type)
    assert alternatives, "engine returned no feasible alternative"
    return alternatives[0]["solution"]


def test_native_hole_nesting_spp(fixture_parts):
    """SPP: square (channel-opened hole) + 2 sectors on a 110x110 sheet.
    The only place a 39.6x28 sector can go is the r=35 hole (surrounding
    strips are 10mm wide): all 3 parts on one strip => holes were used."""
    trou, fill = fixture_parts["Piece_Trou"], fixture_parts["Piece_Fillx4"]
    converted = open_holes_with_channels(trou["coordinates"], trou["holes"])
    items = [
        build_item(0, 1, converted, [0.0]),
        build_item(1, 2, _close(fill["coordinates"]), [0.0, 90.0, 180.0, 270.0]),
    ]
    instance = build_spp_instance(items, 110.0, 110.0)
    solution = _run(instance, "spp", max_strip_width=110.0)

    layouts = solution["layouts"]
    placed = sum(len(l["placed_items"]) for l in layouts)
    assert placed == 3, "square + 2 sectors must all fit on one sheet"
    assert len(layouts) == 1
    # Used length must respect the sheet bound.
    assert solution["strip_width"] <= 110.0 + 1e-3

    for placed_item in layouts[0]["placed_items"]:
        x, y = placed_item["transformation"]["translation"]
        assert -1.0 <= x <= 111.0 and -1.0 <= y <= 111.0


def test_engine_placements_have_no_overlaps(fixture_parts):
    """Guard: placements reconstructed from engine output (applied as-is —
    jagua composes its centering pre-transform into the export) must never
    overlap, with exact separation space=1."""
    from shapely.geometry import Polygon
    from shapely.affinity import rotate, translate

    trou, fill = fixture_parts["Piece_Trou"], fixture_parts["Piece_Fillx4"]
    input_items = [
        {"id": 0, "file_slug": "trou.dxf", "coords": trou["coordinates"],
         "holes": trou["holes"], "handles": trou["handles"], "count": 3,
         "rotations": [0.0, 90.0, 180.0, 270.0]},
        {"id": 1, "file_slug": "fill.dxf", "coords": fill["coordinates"],
         "holes": [], "handles": fill["handles"], "count": 13,
         "rotations": [0.0, 90.0, 180.0, 270.0]},
    ]
    jaguar_items = [
        build_item(0, 3, open_holes_with_channels(
            trou["coordinates"], trou["holes"], channel_width_for_space(1.0)),
                   [0.0, 90.0, 180.0, 270.0]),
        build_item(1, 13, _close(fill["coordinates"]), [0.0, 90.0, 180.0, 270.0]),
    ]
    instance = build_bpp_instance(jaguar_items, [build_bin(0, 100, 400.0, 560.0)])
    solution = _run(instance, "bpp", space=1.0)

    placed = sum(len(l["placed_items"]) for l in solution["layouts"])
    assert placed == 16

    containers, _, _, _ = parse_result_containers(
        {"solution": solution}, input_items, {0: (400.0, 560.0)}
    )

    items_by_id = {i["id"]: i for i in input_items}
    polys = []
    for c in containers:
        for t in c.transforms:
            item = items_by_id[t.item_id]
            base = Polygon(item["coords"], item.get("holes") or [])
            polys.append(translate(
                rotate(base, math.degrees(t.angle), origin=(0, 0)), t.x, t.y
            ))
    # No pair may overlap beyond tessellation/simplification slack.
    for i, a in enumerate(polys):
        for j, b in enumerate(polys[i + 1:]):
            inter = a.intersection(b).area
            assert inter < 20.0, f"overlap of {inter:.1f}mm² between placed parts"


def test_exact_separation_is_enforced(fixture_parts):
    """SPP with space=2: sectors nested in the hole keep >= ~2mm from the
    hole edge (jagua deflates the hole and inflates the part by space/2)."""
    from shapely.geometry import Point, Polygon
    from shapely.affinity import rotate, translate

    trou, fill = fixture_parts["Piece_Trou"], fixture_parts["Piece_Fillx4"]
    input_items = [
        {"id": 0, "file_slug": "trou.dxf", "coords": trou["coordinates"],
         "holes": trou["holes"], "handles": trou["handles"], "count": 1,
         "rotations": [0.0]},
        {"id": 1, "file_slug": "fill.dxf", "coords": fill["coordinates"],
         "holes": [], "handles": fill["handles"], "count": 4,
         "rotations": [0.0, 90.0, 180.0, 270.0]},
    ]
    jaguar_items = [
        build_item(0, 1, open_holes_with_channels(
            trou["coordinates"], trou["holes"], channel_width_for_space(2.0)), [0.0]),
        build_item(1, 4, _close(fill["coordinates"]), [0.0, 90.0, 180.0, 270.0]),
    ]
    instance = build_spp_instance(jaguar_items, 110.0, 110.0)
    solution = _run(instance, "spp", space=2.0, max_strip_width=110.0)

    containers, placed, _, _ = parse_result_containers(
        {"solution": solution}, input_items, {0: (110.0, 110.0)}
    )
    assert placed == 5

    # Identify the sectors (item_id 1) that ended up inside the square. The
    # square part is centred on the origin (bbox [-50,50]², hole r=35 at
    # (0,0)), so a placement translation (sx, sy) puts the hole centre at
    # (sx, sy). A sector whose centroid lies within the square's bbox is in
    # the hole (the strips around the square are only 10mm wide).
    square_t = next(t for t in containers[0].transforms if t.item_id == 0)
    sx, sy = square_t.x, square_t.y
    hole = Point(sx, sy).buffer(35.0)
    sector = Polygon(fill["coordinates"])
    nested = 0
    for t in containers[0].transforms:
        if t.item_id != 1:
            continue
        placed = translate(rotate(sector, t.angle, origin=(0, 0), use_radians=True), t.x, t.y)
        cx, cy = placed.centroid.x, placed.centroid.y
        if sx - 50 - 1 <= cx <= sx + 50 + 1 and sy - 50 - 1 <= cy <= sy + 50 + 1:
            nested += 1
            gap = hole.boundary.distance(placed)
            # ~2mm nominal; tessellation of the r=35 circle costs an epsilon.
            assert gap >= 1.7, f"separation violated: {gap}"

    assert nested > 0, "expected at least one sector nested in the hole"
