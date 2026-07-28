#!/usr/bin/env python3
"""Manual smoke test for the lbf binary (jagua-rs 0.7.x CLI interface)."""
import json
import os
import subprocess
import sys
import tempfile

SAMPLE_INSTANCE = {
    "name": "Test",
    "items": [
        {
            "id": 0,
            "demand": 1,
            "allowed_orientations": [0.0, 180.0],
            "shape": {
                "type": "simple_polygon",
                "data": [[0.0, 0.0], [2.0, 0.0], [2.0, 2.0], [0.0, 2.0], [0.0, 0.0]],
            },
        }
    ],
    "bins": [
        {
            "id": 0,
            "cost": 1,
            "stock": 1,
            "shape": {
                "type": "polygon",
                "data": {"outer": [[0.0, 0.0], [100.0, 0.0], [100.0, 100.0], [0.0, 100.0]]},
            },
        }
    ],
}

SAMPLE_CONFIG = {
    "cde_config": {
        "quadtree_depth": 5,
        "cd_threshold": 16,
        "item_surrogate_config": {
            "n_pole_limits": [[100, 0.0], [20, 0.75], [10, 0.90]],
            "n_ff_poles": 2,
            "n_ff_piers": 0,
        },
    },
    "poly_simpl_tolerance": 0.001,
    "min_item_separation": None,
    "prng_seed": 0,
    "n_samples": 5000,
    "ls_frac": 0.2,
}


def test_lbf():
    with tempfile.TemporaryDirectory(prefix="lbf_test_") as tmpdir:
        instance_path = os.path.join(tmpdir, "instance.json")
        config_path = os.path.join(tmpdir, "config.json")
        out_dir = os.path.join(tmpdir, "out")

        with open(instance_path, "w") as f:
            json.dump(SAMPLE_INSTANCE, f)
        with open(config_path, "w") as f:
            json.dump(SAMPLE_CONFIG, f)

        try:
            result = subprocess.run(
                ["lbf", "-i", instance_path, "-s", out_dir,
                 "-c", config_path, "-p", "bpp", "-l", "warn"],
                capture_output=True,
                text=True,
                timeout=30,
            )
        except subprocess.TimeoutExpired:
            print("❌ lbf execution timed out")
            return
        except FileNotFoundError:
            print("❌ lbf binary not found. Make sure it's built and available in PATH")
            return

        if result.returncode != 0:
            print("❌ lbf failed with return code:", result.returncode)
            print("Error output:", result.stderr)
            return

        solution_path = os.path.join(out_dir, "sol_instance.json")
        with open(solution_path) as f:
            output = json.load(f)

        print("✅ lbf executed successfully!")
        print(json.dumps(output.get("solution"), indent=2)[:800])


if __name__ == "__main__":
    test_lbf()
