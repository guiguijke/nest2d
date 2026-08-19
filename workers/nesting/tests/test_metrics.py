"""Tests for the result metrics (used sheet share, largest empty rectangle)."""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

from core.metrics import (
    OFFCUT_REUSABLE_MIN_MM,
    compute_used_sheet_share,
    enrich_offcut,
    largest_empty_rectangle,
    per_sheet_metrics,
    report_totals,
)
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

    def test_holes_filled_capped_at_pinwheel_capacity_with_overflow(self):
        # Cas trou600 : 8 fillers empilés au même endroit dans un trou prévu
        # pour 4 (capacité pinwheel validée) — le compte est plafonné à 4,
        # l'excédent part dans holesOverflow (champ additif).
        host = _holed_item(1)
        filler = _square_item(6.0, 2)
        container = ResultContainer(
            1,
            [Transform("f", ["h"], 0.0, 0.0, 0.0, item_id=1)]
            + [Transform("f", ["h"], 17.0, 17.0, 0.0, item_id=2) for _ in range(8)],
            bin_width=100.0, bin_height=100.0,
        )
        report = verify_layout([container], [host, filler])
        assert report["holesTotal"] == 1
        assert report["holesFilled"] == 4
        assert report["holesOverflow"] == 4

    def test_holes_filled_normal_case_has_no_overflow(self):
        host = _holed_item(1)
        filler = _square_item(6.0, 2)
        container = ResultContainer(
            1,
            [Transform("f", ["h"], 0.0, 0.0, 0.0, item_id=1)]
            + [Transform("f", ["h"], 17.0, 17.0, 0.0, item_id=2) for _ in range(4)],
            bin_width=100.0, bin_height=100.0,
        )
        report = verify_layout([container], [host, filler])
        assert report["holesFilled"] == 4
        assert report["holesOverflow"] == 0


class TestEnrichOffcut:
    def test_none_stays_none(self):
        assert enrich_offcut(None) is None

    def test_adds_mm_keys_and_area(self):
        enriched = enrich_offcut({"width": 950.0, "height": 2000.0, "area": 1_900_000.0})
        assert enriched["widthMm"] == 950.0
        assert enriched["heightMm"] == 2000.0
        assert enriched["areaMm2"] == 1_900_000.0
        assert enriched["reusable"] is True

    def test_reusable_threshold(self):
        # Just under the 100 mm minimum on the SMALLEST dimension: scrap.
        below = enrich_offcut({
            "width": OFFCUT_REUSABLE_MIN_MM - 1.0,
            "height": 500.0,
            "area": (OFFCUT_REUSABLE_MIN_MM - 1.0) * 500.0,
        })
        assert below["reusable"] is False
        # Exactly at the threshold: reusable.
        at = enrich_offcut({
            "width": OFFCUT_REUSABLE_MIN_MM,
            "height": 500.0,
            "area": OFFCUT_REUSABLE_MIN_MM * 500.0,
        })
        assert at["reusable"] is True


def _quoting_job():
    """Synthetic 2-sheet mixed-format job with exact, hand-computed areas.

    Sheet 1 (2000x1000): a 50x50 square at (0,0) + a 40x40 host with a
    10x10 hole at (100,0) -> true placed area 2500 + 1500 = 4000.
    Sheet 2 (1000x500): a 50x50 square at (0,0) -> 2500.
    """
    square50 = _square_item(50.0, item_id=0)
    host = _holed_item(item_id=1)  # 40x40 minus 10x10 hole = 1500
    sheet1 = ResultContainer(
        1,
        [
            Transform("f", ["h"], 0.0, 0.0, 0.0, item_id=0),
            Transform("f", ["h"], 100.0, 0.0, 0.0, item_id=1),
        ],
        bin_width=2000.0, bin_height=1000.0,
    )
    sheet2 = ResultContainer(
        2,
        [Transform("f", ["h"], 0.0, 0.0, 0.0, item_id=0)],
        bin_width=1000.0, bin_height=500.0,
    )
    return [sheet1, sheet2], [square50, host]


class TestPerSheetMetrics:
    def test_two_sheet_job_measured(self):
        containers, items = _quoting_job()
        sheets = per_sheet_metrics(containers, items)
        assert len(sheets) == 2

        s1, s2 = sheets
        assert s1["index"] == 0 and s2["index"] == 1
        assert (s1["widthMm"], s1["heightMm"]) == (2000.0, 1000.0)
        assert (s2["widthMm"], s2["heightMm"]) == (1000.0, 500.0)

        # True polygon areas (hole subtracted), never bbox.
        assert s1["partsAreaMm2"] == pytest.approx(4000.0)
        assert s2["partsAreaMm2"] == pytest.approx(2500.0)
        assert s1["partCount"] == 2
        assert s2["partCount"] == 1

        assert s1["sheetAreaMm2"] == pytest.approx(2_000_000.0)
        assert s1["freeAreaMm2"] == pytest.approx(1_996_000.0)
        assert s1["densityPct"] == pytest.approx(0.2, abs=0.05)
        assert s2["densityPct"] == pytest.approx(0.5, abs=0.05)

        # Per-sheet offcut: sheet 1 keeps a full-width top band
        # (2000 x 950), sheet 2 a right band (950 x 500) — both reusable.
        assert s1["offcut"]["areaMm2"] == pytest.approx(1_900_000.0)
        assert s1["offcut"]["reusable"] is True
        assert s2["offcut"]["areaMm2"] == pytest.approx(475_000.0)
        assert s2["offcut"]["reusable"] is True

    def test_sheets_sum_matches_global_parts_area(self):
        containers, items = _quoting_job()
        sheets = per_sheet_metrics(containers, items)
        totals = report_totals(sheets)
        assert sum(s["partsAreaMm2"] for s in sheets) == pytest.approx(6500.0)
        assert totals["partsAreaMm2"] == pytest.approx(6500.0)


class TestReportTotals:
    def test_mixed_formats_aggregated_and_sorted(self):
        containers, items = _quoting_job()
        # Third sheet, same format as sheet 1 -> count aggregation.
        sheet3 = ResultContainer(
            3,
            [Transform("f", ["h"], 0.0, 0.0, 0.0, item_id=0)],
            bin_width=2000.0, bin_height=1000.0,
        )
        sheets = per_sheet_metrics([*containers, sheet3], items)
        totals = report_totals(sheets)

        assert totals["sheetCount"] == 3
        assert totals["formats"] == [
            {"widthMm": 2000.0, "heightMm": 1000.0, "count": 2},
            {"widthMm": 1000.0, "heightMm": 500.0, "count": 1},
        ]
        assert totals["sheetAreaMm2"] == pytest.approx(4_500_000.0)
        assert totals["partsAreaMm2"] == pytest.approx(9000.0)
        assert totals["freeAreaMm2"] == pytest.approx(4_491_000.0)
        assert totals["densityPct"] == pytest.approx(0.2, abs=0.05)

    def test_empty_job(self):
        totals = report_totals([])
        assert totals["sheetCount"] == 0
        assert totals["formats"] == []
        assert totals["densityPct"] is None
