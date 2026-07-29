"""ESICUP benchmark harness for the nest-engine (slow — run on demand).

Validates the engine against the public reference instances, with quality
thresholds taken from the literature (see .zcode/nesting-recherche.md):
  - shirts  ~86-88 %   (Burke et al. 2006 and successors)
  - swim    ~72-74 %
  - albano  ~85-87 %

Thresholds are set a couple points below the literature means to avoid
flakiness; the point of the gate is to catch REGRESSIONS, not to beat records.

Run with:  pytest benchmarks/test_benchmarks.py -m slow
Skipped automatically when the nest-engine binary is not available.
"""
import os
import shutil
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

ENGINE_BIN = os.environ.get("NEST_ENGINE_BIN", "nest-engine")
pytestmark = [
    pytest.mark.slow,
    pytest.mark.skipif(
        shutil.which(ENGINE_BIN) is None and not Path(ENGINE_BIN).exists(),
        reason="nest-engine binary not found",
    ),
]

from core.engine import run_engine
from core.nesting_input_builder import build_engine_config, deterministic_seed

INSTANCES = Path(__file__).parent / "instances"
# 60s: at 30s the seed variance on these instances is +/-3pts of density,
# which makes thresholds flaky; 60s keeps them comfortably above the gate.
BUDGET_SEC = int(os.environ.get("NEST_BENCH_BUDGET", "60"))


def _density(instance_name, budget=BUDGET_SEC, seed_payload=None):
    import json

    with open(INSTANCES / f"{instance_name}.json") as f:
        instance = json.load(f)
    config = build_engine_config(
        budget,
        deterministic_seed(seed_payload or {"bench": instance_name}),
        n_alternatives=1,
    )
    alternatives = run_engine(instance, config, "spp")
    return alternatives[0]["metrics"]


def test_shirts_density():
    metrics = _density("shirts")
    assert metrics["density"] >= 0.84, f"shirts: {metrics['density']:.3f} < 0.84"


def test_swim_density():
    metrics = _density("swim")
    assert metrics["density"] >= 0.70, f"swim: {metrics['density']:.3f} < 0.70"


def test_albano_density():
    metrics = _density("albano")
    assert metrics["density"] >= 0.82, f"albano: {metrics['density']:.3f} < 0.82"


def test_seed_replay_is_stable():
    """Same seed replays the same search trajectory; the wall-clock cutoff
    may vary slightly under load, so results must be CLOSE, not identical
    (and never wildly different — the chaos of lbf is what we replaced)."""
    small_budget = max(8, BUDGET_SEC // 3)
    w1 = _density("shirts", budget=small_budget, seed_payload={"replay": 1})["strip_width"]
    w2 = _density("shirts", budget=small_budget, seed_payload={"replay": 1})["strip_width"]
    assert abs(w1 - w2) / w1 < 0.03, f"seed replay diverged: {w1} vs {w2}"


def test_incumbent_never_regresses_with_budget():
    """More time must not produce a (meaningfully) worse incumbent."""
    short = _density("shirts", budget=max(6, BUDGET_SEC // 4))["strip_width"]
    long = _density("shirts", budget=BUDGET_SEC)["strip_width"]
    assert long <= short * 1.01, f"longer run regressed: {short} -> {long}"
