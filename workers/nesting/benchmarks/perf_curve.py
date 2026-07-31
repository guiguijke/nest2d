"""Performance curve harness: quality vs compute budget.

Runs the engine on the given instances at escalating time budgets and plots
the quality curve (strip density for SPP, bin cost + density for BPP), with
the "knee" — the smallest budget reaching >=98% of the best observed
quality. This is the data used to size the compute tiers (simple / normal /
advanced) on realistic jobs.

Usage:
    NEST_ENGINE_BIN=/path/to/nest-engine python benchmarks/perf_curve.py \
        [--instances shirts swim albano] [--budgets 5,10,15,30,45,60,90,120] \
        [--out benchmarks/perf]

Instance names refer to benchmarks/instances/<name>.json; a path to a custom
JSON instance also works.
"""
import argparse
import json
import os
import subprocess
import sys
import tempfile
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from core.nesting_input_builder import build_engine_config, deterministic_seed

ENGINE_BIN = os.environ.get("NEST_ENGINE_BIN", "nest-engine")
INSTANCES_DIR = Path(__file__).parent / "instances"


def run_once(instance_path, problem_type, budget, seed, extra_config=None):
    with tempfile.TemporaryDirectory(prefix="perf_") as tmp:
        cfg = build_engine_config(budget, seed, 1)
        if extra_config:
            cfg.update(extra_config)
        cfg_path = Path(tmp) / "cfg.json"
        cfg_path.write_text(json.dumps(cfg))
        out_dir = Path(tmp) / "out"
        t0 = time.time()
        proc = subprocess.run(
            [ENGINE_BIN, "-i", str(instance_path), "-c", str(cfg_path),
             "-s", str(out_dir), "-p", problem_type],
            capture_output=True, text=True, timeout=budget + 180,
        )
        wall = time.time() - t0
        if proc.returncode != 0:
            return {"budget": budget, "ok": False, "wall": wall,
                    "error": proc.stderr.strip()[-200:]}
        sol = json.loads((out_dir / "sol_instance.json").read_text())["solution"]
        if problem_type == "spp":
            return {"budget": budget, "ok": True, "wall": wall,
                    "quality": sol["density"], "strip_width": sol["strip_width"]}
        return {"budget": budget, "ok": True, "wall": wall,
                "quality": sol["density"], "cost": sol["cost"],
                "layouts": len(sol["layouts"])}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--instances", nargs="+", default=["shirts", "swim"])
    ap.add_argument("--budgets", default="5,10,15,30,45,60,90,120,180")
    ap.add_argument("--problem", default="spp", choices=["spp", "bpp"])
    ap.add_argument("--out", default="benchmarks/perf")
    args = ap.parse_args()

    budgets = [int(b) for b in args.budgets.split(",")]
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    report = {}
    for name in args.instances:
        path = Path(name) if name.endswith(".json") else INSTANCES_DIR / f"{name}.json"
        if not path.exists():
            print(f"!! instance not found: {path}")
            continue
        results = []
        for budget in budgets:
            seed = deterministic_seed({"perf": name, "budget": budget})
            r = run_once(path, args.problem, budget, seed)
            results.append(r)
            mark = f"{r['quality']:.4f}" if r["ok"] else f"FAIL {r['error'][:60]}"
            print(f"  {name} @{budget:>3}s -> {mark} (wall {r['wall']:.0f}s)")

        ok = [r for r in results if r["ok"]]
        if not ok:
            continue
        best_q = max(r["quality"] for r in ok)
        knee = next((r["budget"] for r in ok if r["quality"] >= 0.98 * best_q), None)
        report[name] = {"results": results, "best": best_q, "knee_sec": knee}
        print(f"=> {name}: best {best_q:.4f}, 98% knee at {knee}s")

        # Per-instance curve
        fig, ax = plt.subplots(figsize=(6, 4))
        ax.plot([r["budget"] for r in ok], [r["quality"] for r in ok], "o-")
        ax.set_xlabel("time budget (s)")
        ax.set_ylabel("density" if args.problem == "spp" else "quality")
        ax.set_title(f"{name} — quality vs budget (knee: {knee}s)")
        ax.grid(True, alpha=0.3)
        fig.savefig(out_dir / f"curve_{name}.png", dpi=110, bbox_inches="tight")
        plt.close(fig)

    (out_dir / "report.json").write_text(json.dumps(report, indent=2))
    print(f"\nreport: {out_dir / 'report.json'}")
    for name, r in report.items():
        print(f"  {name}: 98% of best at {r['knee_sec']}s (best {r['best']:.4f})")


if __name__ == "__main__":
    main()
