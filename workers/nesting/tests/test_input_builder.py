"""Tests for the lbf input builder (exact kerf via min_item_separation)."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from core.nesting_input_builder import build_config, build_input_json


class TestBuildConfig:
    def test_separation_is_passed_through(self):
        config = build_config(n_samples=1000, prng_seed=42, min_separation=3.0)
        assert config["min_item_separation"] == 3.0
        assert config["n_samples"] == 1000
        assert config["prng_seed"] == 42

    def test_zero_or_none_separation_disables_constraint(self):
        assert build_config(min_separation=0)["min_item_separation"] is None
        assert build_config(min_separation=None)["min_item_separation"] is None

    def test_no_seed_means_nondeterministic(self):
        assert "prng_seed" not in build_config()


class TestBuildInputJson:
    def test_full_structure(self):
        bins = [{
            "id": 0, "cost": 1, "stock": 2,
            "shape": {"type": "polygon", "data": {"outer": [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]}},
        }]
        items = [{
            "id": 0, "demand": 1, "allowed_orientations": [0.0],
            "shape": {"type": "simple_polygon", "data": [[0, 0], [1, 0], [1, 1], [0, 0]]},
        }]
        payload = build_input_json(bins, items, n_samples=500, prng_seed=7, min_separation=2.5)
        assert payload["problem_type"] == "bpp"
        assert payload["instance"]["bins"] == bins
        assert payload["instance"]["items"] == items
        assert payload["config"]["min_item_separation"] == 2.5
