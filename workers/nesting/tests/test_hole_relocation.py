"""Tests for the hole-relocation post-pass (mocked solver)."""
import math
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

from core.hole_relocation import relocate_into_holes, rescale_density


class FakeTransform:
    def __init__(self, file_slug, handles, x, y, angle, item_id=None):
        self.file_slug = file_slug
        self.handles = handles
        self.x = x
        self.y = y
        self.angle = angle
        self.item_id = item_id


class FakeContainer:
    def __init__(self, container_id, transforms, bin_width=100, bin_height=100):
        self.container_id = container_id
        self.transforms = transforms
        self.bin_width = bin_width
        self.bin_height = bin_height


# A 100x100 square with a r=35 hole, and a small 10x10 square item.
SQUARE_WITH_HOLE = {
    "id": 0,
    "file_slug": "big.dxf",
    "coords": [[-50, -50], [50, -50], [50, 50], [-50, 50]],
    "holes": [[
        [35 * math.cos(i * math.pi / 8), 35 * math.sin(i * math.pi / 8)]
        for i in range(16)
    ]],
    "handles": ["A"],
    "count": 1,
    "rotations": [0.0, 90.0, 180.0, 270.0],
}
SMALL_ITEM = {
    "id": 1,
    "file_slug": "small.dxf",
    "coords": [[0, 0], [10, 0], [10, 10], [0, 10]],
    "holes": [],
    "handles": ["B"],
    "count": 1,
    "rotations": [0.0],
}
INPUT_ITEMS = [SQUARE_WITH_HOLE, SMALL_ITEM]


def _two_sheet_solution():
    big = FakeTransform("big.dxf", ["A"], x=50, y=50, angle=0.0, item_id=0)
    small = FakeTransform("small.dxf", ["B"], x=5, y=5, angle=0.0, item_id=1)
    return [
        FakeContainer(1, [big]),
        FakeContainer(2, [small]),
    ]


class TestRelocateIntoHoles:
    def test_sheet_freed_when_everything_fits(self):
        containers = _two_sheet_solution()

        def fake_run_lbf(input_json):
            # One hole bin, one small item: pretend it fits.
            return {"solution": {"layouts": [
                {"container_id": 0, "placed_items": [
                    {"item_id": 0, "transformation": {"rotation": 0.0, "translation": [45.0, 45.0]}}
                ]}
            ], "density": 0.9, "cost": 1}}

        result, freed = relocate_into_holes(containers, INPUT_ITEMS, space=0, run_lbf_fn=fake_run_lbf)
        assert freed == 1
        assert len(result) == 1
        # The small part was merged into the big part's sheet.
        assert len(result[0].transforms) == 2
        moved = result[0].transforms[-1]
        assert moved.item_id == 1
        assert (moved.x, moved.y) == (45.0, 45.0)

    def test_partial_fit_keeps_original(self):
        # A 50x50 square cannot fit in a r=35 hole (diagonal ~70.7 > 70):
        # neither lbf nor the exact fallback may relocate it.
        big_square = dict(SMALL_ITEM, coords=[[0, 0], [50, 0], [50, 50], [0, 50]])
        containers = _two_sheet_solution()
        items = [SQUARE_WITH_HOLE, big_square]

        def fake_run_lbf(input_json):
            # Nothing placed: the hole cannot take the item.
            return {"solution": {"layouts": [], "density": 0.0, "cost": 0}}

        result, freed = relocate_into_holes(containers, items, space=0, run_lbf_fn=fake_run_lbf)
        assert freed == 0
        assert len(result) == 2

    def test_no_holes_short_circuits(self):
        containers = _two_sheet_solution()
        items = [dict(SQUARE_WITH_HOLE, holes=[]), SMALL_ITEM]

        def fail_if_called(_input):
            raise AssertionError("solver must not run without holes")

        result, freed = relocate_into_holes(containers, items, space=0, run_lbf_fn=fail_if_called)
        assert freed == 0
        assert len(result) == 2

    def test_single_sheet_untouched(self):
        containers = _two_sheet_solution()[:1]
        result, freed = relocate_into_holes(containers, INPUT_ITEMS, space=0)
        assert freed == 0
        assert len(result) == 1

    def test_hole_transformed_with_part_placement(self):
        # Big part placed rotated 90° at (100, 100): its hole must move along.
        big = FakeTransform("big.dxf", ["A"], x=100, y=100, angle=math.pi / 2, item_id=0)
        small = FakeTransform("small.dxf", ["B"], x=5, y=5, angle=0.0, item_id=1)
        containers = [FakeContainer(1, [big]), FakeContainer(2, [small])]

        captured = {}

        def fake_run_lbf(input_json):
            captured["bins"] = input_json["instance"]["bins"]
            return {"solution": {"layouts": [], "density": 0.0, "cost": 0}}

        relocate_into_holes(containers, INPUT_ITEMS, space=0, run_lbf_fn=fake_run_lbf)
        hole_ring = captured["bins"][0]["shape"]["data"]["outer"]
        xs = [p[0] for p in hole_ring]
        ys = [p[1] for p in hole_ring]
        # Hole centre must be at the part's placement, (100, 100).
        assert (max(xs) + min(xs)) / 2 == pytest.approx(100.0, abs=0.01)
        assert (max(ys) + min(ys)) / 2 == pytest.approx(100.0, abs=0.01)
        # Radius preserved by the rotation.
        assert (max(xs) - min(xs)) / 2 == pytest.approx(35.0, abs=0.01)


class TestRescaleDensity:
    def test_density_grows_when_sheet_freed(self):
        before = [FakeContainer(1, []), FakeContainer(2, [])]  # 2 x 100x100
        after = [FakeContainer(1, [])]
        assert rescale_density(0.62, before, after) == pytest.approx(1.24)

    def test_zero_density_passthrough(self):
        assert rescale_density(0, [], []) == 0
