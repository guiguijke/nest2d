"""Tests for the hole-relocation post-pass (mocked solver)."""
import math
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

from core.hole_relocation import (
    compact_into_holes,
    compute_used_sheet_share,
    relocate_into_holes,
    rescale_density,
)


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
        # The 50x50 square cannot fit in the r=35 hole, so the exact packer
        # fails and the lbf sub-solve receives the holes as bins.
        big_square = dict(SMALL_ITEM, coords=[[0, 0], [50, 0], [50, 50], [0, 50]])
        big = FakeTransform("big.dxf", ["A"], x=100, y=100, angle=math.pi / 2, item_id=0)
        small = FakeTransform("small.dxf", ["B"], x=5, y=5, angle=0.0, item_id=1)
        containers = [FakeContainer(1, [big]), FakeContainer(2, [small])]
        items = [SQUARE_WITH_HOLE, big_square]

        captured = {}

        def fake_run_lbf(input_json):
            captured["bins"] = input_json["instance"]["bins"]
            return {"solution": {"layouts": [], "density": 0.0, "cost": 0}}

        relocate_into_holes(containers, items, space=0, run_lbf_fn=fake_run_lbf)
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


def _quarter_wedge(radius=28.0, n=24):
    """Quarter-disk sector with apex at origin (tiles a disk 4x at 0/90/180/270)."""
    pts = [[0.0, 0.0]]
    pts += [
        [radius * math.cos(i * (math.pi / 2) / n), radius * math.sin(i * (math.pi / 2) / n)]
        for i in range(n + 1)
    ]
    return pts


WEDGE = {
    "id": 2,
    "file_slug": "wedge.dxf",
    "coords": _quarter_wedge(),
    "holes": [],
    "handles": ["C"],
    "count": 4,
    "rotations": [0.0, 90.0, 180.0, 270.0],
}


class TestCompactIntoHoles:
    """The reported production scenario: on a roomy 150x150 sheet, the solver
    stacks the 4 wedges along the top edge instead of using the square's
    r=35 hole. Compaction must move all 4 into the hole and shrink the used
    bounding box."""

    def _scenario(self):
        big = dict(SQUARE_WITH_HOLE)
        items = [big, WEDGE]
        square_t = FakeTransform("big.dxf", ["A"], x=55.0, y=55.0, angle=0.0, item_id=0)
        wedges = [
            FakeTransform("wedge.dxf", ["C"], x=5.0 + i * 25.0, y=120.0, angle=0.0, item_id=2)
            for i in range(4)
        ]
        container = FakeContainer(1, [square_t] + wedges, bin_width=150, bin_height=150)
        return [container], items

    def test_wedges_move_into_the_hole(self):
        containers, items = self._scenario()
        from shapely.geometry import Point, Polygon
        from shapely.affinity import rotate, translate

        before = containers[0].transforms
        bbox_before_y_max = max(
            rotate(Polygon(WEDGE["coords"]), 0, origin=(0, 0)).bounds[3] + t.y
            for t in before[1:]
        )

        moves = compact_into_holes(containers, items, space=0)

        assert moves == 4
        hole = Point(55.0, 55.0).buffer(35.0)
        sector = Polygon(WEDGE["coords"])
        for t in containers[0].transforms[1:]:
            placed = translate(
                rotate(sector, math.degrees(t.angle), origin=(0, 0)), t.x, t.y
            )
            assert hole.covers(placed), "compacted wedge escapes the hole"
        # Even distribution: the pinwheel uses 4 distinct orientations.
        orientations = {round(math.degrees(t.angle)) % 360 for t in containers[0].transforms[1:]}
        assert orientations == {0, 90, 180, 270}
        # Used bbox is now just the square's: y_max dropped from 120+ to 90.
        y_max_after = max(
            translate(
                rotate(sector, math.degrees(t.angle), origin=(0, 0)), t.x, t.y
            ).bounds[3]
            for t in containers[0].transforms[1:]
        )
        assert y_max_after < bbox_before_y_max - 20

    def test_no_holes_no_moves(self):
        containers, items = self._scenario()
        items[0] = dict(items[0], holes=[])
        assert compact_into_holes(containers, items, space=0) == 0

    def test_no_batch_no_gain_no_churn(self):
        # Wedges already inside the hole region: nothing on the frontier,
        # moving anything cannot shrink the bbox — positions must be kept.
        containers, items = self._scenario()
        for i, t in enumerate(containers[0].transforms[1:]):
            t.x, t.y, t.angle = 55.0, 55.0, math.radians(i * 90.0)
        snapshot = [(t.x, t.y, t.angle) for t in containers[0].transforms]
        compact_into_holes(containers, items, space=0)
        after = [(t.x, t.y, t.angle) for t in containers[0].transforms]
        assert after == snapshot

    def test_separation_respected_when_requested(self):
        containers, items = self._scenario()
        moves = compact_into_holes(containers, items, space=2.0)
        if moves:  # tighter fit may still succeed
            from shapely.geometry import Point, Polygon
            from shapely.affinity import rotate, translate
            hole_boundary = Point(55.0, 55.0).buffer(35.0).boundary
            sector = Polygon(WEDGE["coords"])
            for t in containers[0].transforms[1:]:
                placed = translate(
                    rotate(sector, math.degrees(t.angle), origin=(0, 0)), t.x, t.y
                )
                assert hole_boundary.distance(placed) >= 1.8

    def test_two_holes_nine_wedges(self):
        """The reported production case: 2 squares (one r=35 hole each) + 9
        wedges on a roomy sheet. 8 wedges must move (4 per hole), the 9th
        stays out, and the used bbox must shrink."""
        big_a = dict(SQUARE_WITH_HOLE, id=0)
        big_b = dict(SQUARE_WITH_HOLE, id=3, file_slug="big2.dxf", handles=["D"])
        wedge9 = dict(WEDGE, count=9)
        items = [big_a, big_b, wedge9]

        # Squares side by side at the bottom; wedges climbing the left edge,
        # so the top of the used bbox is defined by the wedges only.
        transforms = [
            FakeTransform("big.dxf", ["A"], x=55.0, y=55.0, angle=0.0, item_id=0),
            FakeTransform("big2.dxf", ["D"], x=165.0, y=55.0, angle=0.0, item_id=3),
        ]
        transforms += [
            FakeTransform("wedge.dxf", ["C"], x=5.0, y=110.0 + i * 25.0, angle=0.0, item_id=2)
            for i in range(9)
        ]
        container = FakeContainer(1, transforms, bin_width=300, bin_height=350)

        moves = compact_into_holes([container], items, space=0)

        assert moves == 8, f"expected 8 wedges moved (4 per hole), got {moves}"
        from shapely.geometry import Point, Polygon
        from shapely.affinity import rotate, translate
        holes = [Point(55.0, 55.0).buffer(35.0), Point(165.0, 55.0).buffer(35.0)]
        sector = Polygon(WEDGE["coords"])
        in_hole = 0
        for t in container.transforms[2:]:
            placed = translate(
                rotate(sector, math.degrees(t.angle), origin=(0, 0)), t.x, t.y
            )
            if any(h.covers(placed) for h in holes):
                in_hole += 1
        assert in_hole == 8

    def test_parts_already_in_hole_are_never_overpacked(self):
        """Regression for the offcut overlap bug: the solver had already
        nested one wedge in the hole; the ring template must NOT stack 4
        fresh wedges on top of it (the template only fires on empty holes,
        and hosted parts count as occupants)."""
        from shapely.geometry import Point, Polygon
        from shapely.affinity import rotate, translate

        items = [SQUARE_WITH_HOLE, WEDGE]
        hosted_angle = 0.0
        transforms = [
            FakeTransform("big.dxf", ["A"], x=55.0, y=55.0, angle=0.0, item_id=0),
            # Wedge already nested in the hole by the solver (apex at centre).
            FakeTransform("wedge.dxf", ["C"], x=55.0, y=55.0, angle=hosted_angle, item_id=2),
        ]
        # Three more wedges far on the frontier.
        transforms += [
            FakeTransform("wedge.dxf", ["C"], x=5.0, y=150.0 + i * 40.0, angle=0.0, item_id=2)
            for i in range(3)
        ]
        container = FakeContainer(1, transforms, bin_width=300, bin_height=350)

        moves = compact_into_holes([container], items, space=0)

        # The hosted wedge is left alone...
        hosted = container.transforms[1]
        assert (hosted.x, hosted.y, hosted.angle) == (55.0, 55.0, hosted_angle)

        # ...and NOTHING overlaps it: every wedge placed in the hole must be
        # disjoint from it and from each other.
        hole = Point(55.0, 55.0).buffer(35.0)
        sector = Polygon(WEDGE["coords"])
        placed_in_hole = []
        for t in container.transforms[1:]:
            poly = translate(
                rotate(sector, math.degrees(t.angle), origin=(0, 0)), t.x, t.y
            )
            if hole.covers(poly):
                placed_in_hole.append(poly)
        for i, a in enumerate(placed_in_hole):
            for b in placed_in_hole[i + 1:]:
                assert a.intersection(b).area < 1e-6, "overlapping parts in hole"

        # At most 3 more wedges fit next to the hosted one.
        assert moves <= 3

    def test_pareto_leftover_keeps_bbox_but_offcut_grows(self):
        """The screenshot case: 3 holes already host 8 wedges (1+4+3) and 5
        wedges zigzag outside. Only 4 more fit (3+1); the batch must be
        accepted (occupied-aware packing), and nothing may overlap."""
        from shapely.geometry import Point, Polygon
        from shapely.affinity import rotate, translate

        items = [SQUARE_WITH_HOLE, WEDGE]
        squares_x = [55.0, 165.0, 275.0]
        hosted_counts = [1, 4, 3]
        transforms = []
        hole_centres = []
        for sx, n_hosted in zip(squares_x, hosted_counts):
            transforms.append(
                FakeTransform("big.dxf", ["A"], x=sx, y=65.0, angle=0.0, item_id=0)
            )
            hole_centres.append((sx, 65.0))
            for k in range(n_hosted):
                # Hosted wedges as a proper pinwheel: apex at the hole centre.
                transforms.append(
                    FakeTransform(
                        "wedge.dxf", ["C"], x=sx, y=65.0,
                        angle=math.radians(k * 90.0), item_id=2,
                    )
                )
        for i in range(5):
            transforms.append(
                FakeTransform("wedge.dxf", ["C"], x=330.0,
                              y=20.0 + i * 30.0, angle=0.0, item_id=2)
            )
        container = FakeContainer(1, transforms, bin_width=560, bin_height=400)

        moves = compact_into_holes([container], items, space=0)

        assert moves == 4, f"expected 4 wedges moved into remaining hole capacity, got {moves}"
        sector = Polygon(WEDGE["coords"])
        for cx, cy in hole_centres:
            hole = Point(cx, cy).buffer(35.0)
            inside = []
            for t in container.transforms:
                if t.item_id != 2:
                    continue
                poly = translate(
                    rotate(sector, math.degrees(t.angle), origin=(0, 0)), t.x, t.y
                )
                if hole.covers(poly):
                    inside.append(poly)
            for i, a in enumerate(inside):
                for b in inside[i + 1:]:
                    assert a.intersection(b).area < 1e-6, "overlap inside a hole"


class TestUsedSheetShare:
    def test_compaction_lowers_consumed_share(self):
        containers, items = TestCompactIntoHoles()._scenario()
        before = compute_used_sheet_share(containers, items)
        moves = compact_into_holes(containers, items, space=0)
        after = compute_used_sheet_share(containers, items)
        assert moves == 4
        assert before is not None and after is not None
        assert after < before

    def test_share_is_used_bbox_over_sheet_area(self):
        # Square 100x100 (hole irrelevant for the bbox) alone on a 150x150
        # sheet: consumed share = square bbox / sheet area.
        containers, items = TestCompactIntoHoles()._scenario()
        containers[0].transforms = containers[0].transforms[:1]  # square only
        share = compute_used_sheet_share(containers, items)
        assert share == pytest.approx((100 * 100) / (150 * 150), rel=0.02)

    def test_empty_returns_none(self):
        assert compute_used_sheet_share([], []) is None
