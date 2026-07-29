"""Tests for the nest-engine input builder."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from core.nesting_input_builder import (
    build_bin,
    build_bpp_instance,
    build_engine_config,
    build_item,
    build_spp_instance,
    deterministic_seed,
)


class TestBuildEngineConfig:
    def test_budget_seed_alternatives(self):
        config = build_engine_config(45, 42, 3, min_separation=3.0)
        assert config["time_budget_sec"] == 45
        assert config["prng_seed"] == 42
        assert config["n_alternatives"] == 3
        assert config["min_item_separation"] == 3.0

    def test_zero_or_none_separation_disables_constraint(self):
        assert build_engine_config(10, 1, 1, min_separation=0)["min_item_separation"] is None
        assert build_engine_config(10, 1, 1, min_separation=None)["min_item_separation"] is None

    def test_holes_disable_concavity_closing(self):
        assert build_engine_config(10, 1, 1, has_holes=True)["narrow_concavity_cutoff"] is None
        assert build_engine_config(10, 1, 1, has_holes=False)["narrow_concavity_cutoff"] == [0.01, 0.01]

    def test_max_strip_width_only_for_spp(self):
        assert build_engine_config(10, 1, 1, max_strip_width=560.0)["max_strip_width"] == 560.0
        assert "max_strip_width" not in build_engine_config(10, 1, 1)


class TestDeterministicSeed:
    def test_same_payload_same_seed(self):
        payload = {"instance": {"items": [1, 2, 3]}, "space": 0.1}
        assert deterministic_seed(payload) == deterministic_seed(payload)

    def test_key_order_irrelevant(self):
        a = {"b": 2, "a": 1}
        b = {"a": 1, "b": 2}
        assert deterministic_seed(a) == deterministic_seed(b)

    def test_different_payloads_differ(self):
        assert deterministic_seed({"x": 1}) != deterministic_seed({"x": 2})

    def test_seed_fits_signed_63_bit(self):
        seed = deterministic_seed({"anything": "goes"})
        assert 0 <= seed < 2**63


class TestInstances:
    def test_spp_instance(self):
        items = [build_item(0, 2, [[0, 0], [1, 0], [1, 1], [0, 0]], [0.0])]
        instance = build_spp_instance(items, 400.0, 560.0, name="job")
        assert instance["strip_height"] == 560.0
        assert instance["items"] == items
        assert "bins" not in instance

    def test_bpp_instance(self):
        items = [build_item(0, 2, [[0, 0], [1, 0], [1, 1], [0, 0]], [0.0])]
        bins = [build_bin(0, 5, 400.0, 560.0), build_bin(1, 2, 600.0, 400.0)]
        instance = build_bpp_instance(items, bins, name="job")
        assert instance["bins"] == bins
        assert instance["bins"][0]["stock"] == 5
        assert instance["bins"][1]["cost"] == 1
