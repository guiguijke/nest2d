"""Tests for the racing orchestration (mocked solver)."""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

import core.racing as racing

TOTAL_ITEMS = 5


def _fake_solution(placed, cost=1, density=0.5):
    layouts = []
    if placed > 0:
        layouts = [
            {"container_id": 0, "placed_items": [{"item_id": 0}] * placed, "density": density}
        ]
    return {"solution": {"layouts": layouts, "density": density, "cost": cost}}


@pytest.fixture
def mock_lbf(monkeypatch):
    """Installs a fake run_lbf; `behavior(seed, n_samples)` -> placed count."""
    state = {"calls": [], "behavior": lambda seed, n: TOTAL_ITEMS}

    def fake_run_lbf(input_json):
        seed = input_json["config"].get("prng_seed")
        n = input_json["config"]["n_samples"]
        state["calls"].append({"seed": seed, "n_samples": n})
        placed = state["behavior"](seed, n)
        density = 0.4 + (seed % 10) / 100.0  # deterministic per-seed density
        return _fake_solution(placed, cost=1, density=density)

    monkeypatch.setattr(racing, "run_lbf", fake_run_lbf)
    return state


BINS = [{"id": 0, "cost": 1, "stock": 1, "shape": {"type": "polygon", "data": {"outer": [[0, 0]]}}}]
ITEMS = [{"id": 0, "demand": TOTAL_ITEMS, "shape": {"type": "simple_polygon", "data": [[0, 0]]}}]


class TestRaceSolve:
    def test_returns_ranked_finalists(self, mock_lbf):
        finals = racing.race_solve(BINS, ITEMS, n_samples=8000, n_alternatives=3,
                                   min_separation=None, total_requested=TOTAL_ITEMS)
        assert 1 <= len(finals) <= 3
        # All finalists placed everything.
        assert all(c["placed"] == TOTAL_ITEMS for c in finals)
        # Ranked best-density first (uniform cost).
        densities = [c["density"] for c in finals]
        assert densities == sorted(densities, reverse=True)

    def test_two_stage_budgets(self, mock_lbf):
        racing.race_solve(BINS, ITEMS, n_samples=8000, n_alternatives=2,
                          min_separation=None, total_requested=TOTAL_ITEMS)
        budgets = sorted({c["n_samples"] for c in mock_lbf["calls"]})
        # Coarse race budget first, full budget for refinement.
        assert budgets[0] == 1000  # 8000 // 8
        assert budgets[-1] == 8000

    def test_incomplete_runs_are_discarded(self, mock_lbf):
        # Only one seed manages to place everything.
        mock_lbf["behavior"] = lambda seed, n: TOTAL_ITEMS if seed % 7 == 0 else TOTAL_ITEMS - 1
        seeds_used = []
        orig = racing._fresh_seeds
        # Force deterministic seeds so seed % 7 == 0 happens for at least one.
        monkey_seeds = [7, 1, 2, 3, 4, 5, 6, 8]
        racing._fresh_seeds = lambda n, exclude=None: [s for s in monkey_seeds if s not in (exclude or set())][:n]
        try:
            finals = racing.race_solve(BINS, ITEMS, n_samples=8000, n_alternatives=2,
                                       min_separation=None, total_requested=TOTAL_ITEMS)
        finally:
            racing._fresh_seeds = orig
        assert len(finals) >= 1
        assert all(c["placed"] == TOTAL_ITEMS for c in finals)

    def test_escalation_when_nothing_places(self, mock_lbf):
        # Coarse budget never places; escalated budget does.
        mock_lbf["behavior"] = lambda seed, n: TOTAL_ITEMS if n > 8000 else 0
        finals = racing.race_solve(BINS, ITEMS, n_samples=8000, n_alternatives=2,
                                   min_separation=None, total_requested=TOTAL_ITEMS)
        assert len(finals) >= 1
        # Escalation ran at 4x the full budget.
        assert any(c["n_samples"] == 32000 for c in mock_lbf["calls"])

    def test_infeasible_returns_empty(self, mock_lbf):
        mock_lbf["behavior"] = lambda seed, n: 0
        finals = racing.race_solve(BINS, ITEMS, n_samples=8000, n_alternatives=2,
                                   min_separation=None, total_requested=TOTAL_ITEMS)
        assert finals == []
