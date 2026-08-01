"""Tests for the result metrics (used sheet share, largest empty rectangle)."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from core.metrics import compute_used_sheet_share, largest_empty_rectangle
from core.placement import ResultContainer, Transform


def _square_item(size=10.0, item_id=0):
    return {
        "id": item_id,
        "coords": [[0, 0], [size, 0], [size, size], [0, size], [0, 0]],
    }


class TestUsedSheetShare:
    def test_empty_sheet_is_zero(self):
        container = ResultContainer(1, [], bin_width=100.0, bin_height=100.0)
        assert compute_used_sheet_share([container], []) == 0.0

    def test_quarter_coverage(self):
        item = _square_item(50.0)
        container = ResultContainer(
            1, [Transform("f", ["h"], 0.0, 0.0, 0.0, item_id=0)],
            bin_width=100.0, bin_height=100.0,
        )
        share = compute_used_sheet_share([container], [item])
        assert abs(share - 0.25) < 1e-6

    def test_no_bin_dims_returns_none(self):
        container = ResultContainer(1, [])
        assert compute_used_sheet_share([container], []) is None


class TestLargestEmptyRectangle:
    def test_empty_sheet_is_full_sheet(self):
        container = ResultContainer(1, [], bin_width=100.0, bin_height=60.0)
        rect = largest_empty_rectangle([container], [])
        assert rect == {"width": 100.0, "height": 60.0, "area": 6000.0}

    def test_part_in_corner_leaves_l_shaped_free_space(self):
        item = _square_item(50.0)
        container = ResultContainer(
            1, [Transform("f", ["h"], 0.0, 0.0, 0.0, item_id=0)],
            bin_width=100.0, bin_height=100.0,
        )
        rect = largest_empty_rectangle([container], [item])
        # Best rectangles: right band 50x100 or top band 100x50 (both 5000).
        assert rect["area"] >= 5000.0 - 1e-6

    def test_full_sheet_returns_small_or_none(self):
        item = _square_item(100.0)
        container = ResultContainer(
            1, [Transform("f", ["h"], 0.0, 0.0, 0.0, item_id=0)],
            bin_width=100.0, bin_height=100.0,
        )
        rect = largest_empty_rectangle([container], [item])
        assert rect is None or rect["area"] < 1.0


class TestBandOffcut:
    def test_many_parts_uses_band_approximation(self):
        # 70+ parts triggers the O(n) band path (exact scan would be quadratic)
        items = [_square_item(10.0, item_id=0)]
        transforms = [
            Transform("f", ["h"], float((i % 8) * 11), float((i // 8) * 11), 0.0, item_id=0)
            for i in range(70)
        ]
        container = ResultContainer(1, transforms, bin_width=400.0, bin_height=560.0)
        rect = largest_empty_rectangle([container], items)
        # used bbox: x in [0, 87], y in [0, 98] -> right band 313x560 = 175280
        assert rect is not None
        assert rect["area"] >= 313.0 * 560.0 - 1e-6

    def test_small_layout_still_exact(self):
        item = _square_item(50.0)
        container = ResultContainer(
            1, [Transform("f", ["h"], 0.0, 0.0, 0.0, item_id=0)],
            bin_width=100.0, bin_height=100.0,
        )
        rect = largest_empty_rectangle([container], [item])
        assert rect["area"] >= 5000.0 - 1e-6


class TestVertexThreshold:
    def test_ornate_few_parts_uses_band_path(self):
        # Few parts but ornate geometry (many vertices) must take the O(n)
        # band path: the exact scan is quadratic in free-space vertices.
        import math
        import time

        # Dense ornate-like ring: many vertices, valid geometry.
        ornate = [
            [50.0 + 40.0 * math.cos(i * math.tau / 400),
             50.0 + 40.0 * math.sin(i * math.tau / 400)]
            for i in range(400)
        ]
        ornate.append(ornate[0])
        items = [{"id": 0, "coords": ornate}]
        # 8 parts x 400 vertices = 3200 > EXACT_OFFCUT_MAX_VERTICES.
        transforms = [
            Transform("f", ["h"], float((i % 3) * 90), float((i // 3) * 110), 0.0, item_id=0)
            for i in range(8)
        ]
        container = ResultContainer(1, transforms, bin_width=400.0, bin_height=560.0)
        t0 = time.time()
        rect = largest_empty_rectangle([container], items)
        assert time.time() - t0 < 5.0, "band path must be fast on ornate geometry"
        assert rect is not None


from core.metrics import verify_layout


def _holed_item(item_id=1):
    return {
        "id": item_id,
        "coords": [[0, 0], [40, 0], [40, 40], [0, 40], [0, 0]],
        "holes": [[[15, 15], [25, 15], [25, 25], [15, 25], [15, 15]]],
    }


class TestVerifyLayout:
    def test_clean_layout_all_badges_ok(self):
        item = _square_item(10.0, 0)
        container = ResultContainer(
            1,
            [
                Transform("f", ["h"], 5.0, 5.0, 0.0, item_id=0),
                Transform("f", ["h"], 20.0, 5.0, 0.0, item_id=0),
            ],
            bin_width=100.0, bin_height=100.0,
        )
        report = verify_layout([container], [item], space=2.0)
        assert report["overlapFree"] is True
        assert report["insideSheet"] is True
        assert report["spacingOk"] is True
        assert abs(report["smallestGapMm"] - 5.0) < 1e-6
        assert report["holesFilled"] == 0

    def test_overlap_detected(self):
        item = _square_item(10.0, 0)
        container = ResultContainer(
            1,
            [
                Transform("f", ["h"], 0.0, 0.0, 0.0, item_id=0),
                Transform("f", ["h"], 5.0, 0.0, 0.0, item_id=0),
            ],
            bin_width=100.0, bin_height=100.0,
        )
        report = verify_layout([container], [item])
        assert report["overlapFree"] is False

    def test_outside_sheet_detected(self):
        item = _square_item(10.0, 0)
        container = ResultContainer(
            1, [Transform("f", ["h"], 95.0, 0.0, 0.0, item_id=0)],
            bin_width=100.0, bin_height=100.0,
        )
        report = verify_layout([container], [item])
        assert report["insideSheet"] is False

    def test_spacing_below_requested_is_ko(self):
        item = _square_item(10.0, 0)
        container = ResultContainer(
            1,
            [
                Transform("f", ["h"], 5.0, 5.0, 0.0, item_id=0),
                Transform("f", ["h"], 16.0, 5.0, 0.0, item_id=0),
            ],
            bin_width=100.0, bin_height=100.0,
        )
        report = verify_layout([container], [item], space=2.0)
        assert report["spacingOk"] is False
        assert abs(report["smallestGapMm"] - 1.0) < 1e-6

    def test_part_in_hole_counted(self):
        host = _holed_item(1)
        filler = _square_item(6.0, 2)
        container = ResultContainer(
            1,
            [
                Transform("f", ["h"], 0.0, 0.0, 0.0, item_id=1),
                # Filler square 6x6 centred on the host's hole (20, 20).
                Transform("f", ["h"], 17.0, 17.0, 0.0, item_id=2),
                # Another one clearly outside the hole.
                Transform("f", ["h"], 60.0, 60.0, 0.0, item_id=2),
            ],
            bin_width=100.0, bin_height=100.0,
        )
        report = verify_layout([container], [host, filler])
        assert report["holesTotal"] == 1
        assert report["holesFilled"] == 1
