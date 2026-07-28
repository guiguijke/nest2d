"""Tests for the offcut strategy (band solve + largest empty rectangle)."""
import math
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

from core.offcut import largest_empty_rectangle
from core.placement import ResultContainer, Transform


class _Item(dict):
    pass


def _container_with_square():
    # One 40x40 square in the bottom-left of a 100x100 sheet.
    item = {
        "id": 0,
        "coords": [[0, 0], [40, 0], [40, 40], [0, 40]],
        "holes": [],
        "file_slug": "sq.dxf",
        "handles": ["A"],
    }
    container = ResultContainer(
        1, [Transform("sq.dxf", ["A"], x=0, y=0, angle=0.0, item_id=0)],
        bin_width=100, bin_height=100,
    )
    return container, [item]


class TestLargestEmptyRectangle:
    def test_clean_band_offcut(self):
        container, items = _container_with_square()
        rect = largest_empty_rectangle([container], items)
        assert rect is not None
        # The right strip (60x100) is the largest clean rectangle.
        assert rect["area"] == pytest.approx(60 * 100, rel=0.01)

    def test_full_sheet_is_free(self):
        container, items = _container_with_square()
        container.transforms = []
        rect = largest_empty_rectangle([container], items)
        assert rect["area"] == pytest.approx(100 * 100, rel=0.01)

    def test_empty_containers(self):
        assert largest_empty_rectangle([], []) is None


@pytest.mark.skipif(
    __import__("shutil").which("lbf") is None, reason="lbf binary not on PATH"
)
class TestBandSolve:
    def test_band_narrower_than_sheet(self):
        from core.offcut import solve_band
        from core.nesting_input_builder import build_bin, build_item

        # Four 40x40 squares: they fit in a 40-wide band of the 100x100 sheet.
        square = [[0.0, 0.0], [40.0, 0.0], [40.0, 40.0], [0.0, 40.0], [0.0, 0.0]]
        items = [build_item(0, 4, square, [0.0])]
        bins = [build_bin(0, 1, 100.0, 100.0)]

        output, band = solve_band(
            bins, items, n_samples=4000, min_separation=None,
            has_holes=False, total_requested=4, seed=3,
        )
        assert band is not None
        axis, size = band
        # 4 squares of 40x40 in a 100x100 sheet need a 2x2 arrangement:
        # minimum band is 80 — the search must land close to it, well
        # below the full 100mm sheet.
        assert 75.0 <= size <= 90.0
        solution = output["solution"]
        placed = sum(len(l["placed_items"]) for l in solution["layouts"])
        assert placed == 4
