"""Prod-like mini-sweep (n_workers=3, budget 300 s) on the FIXED engine.

Seeds: the sweep_fixed survivor + the 3 originally defective seeds + 2
originally clean ones. Output: sweep_fixed2/seed_<N>/run_prod/.

Usage (from repo root):
    python workers/nesting/bench/out_trou100_defect/sweep_fixed2/_run_prod.py [SEED...]
"""
import json
import shutil
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parent            # sweep_fixed2/
DEFECT = ROOT.parent                              # out_trou100_defect/
BENCH = DEFECT.parent / "out_trou100"
ENGINE = DEFECT.parents[1] / "engine" / "target" / "release" / "nest-engine.exe"

SEEDS = [
    1000000000000000010,   # survivant sweep_fixed
    5594320138289656320,   # 3 seeds défectueux d'origine
    8578442985024929247,
    2806985829419873653,
    8578442985024929237,   # 2 seeds propres d'origine
    2906316077741002638,
    8578442985024929248,   # forme [17×5,15] (à équilibrer)
    1000000000000000001,   # seeds variés du sweep 50
    1000000000000000002,
    1000000000000000011,
    1000000000000000018,
    1000000000000000026,
]


def run_one(seed):
    run_dir = ROOT / f"seed_{seed}"
    run_dir.mkdir(parents=True, exist_ok=True)
    out = run_dir / "run_prod"
    out.mkdir(exist_ok=True)
    # config prod-like : config_custom.json du dossier d'origine si présent,
    # sinon la prod du survivant avec le seed substitué.
    custom = DEFECT / f"seed_{seed}" / "config_custom.json"
    if custom.exists():
        config = json.loads(custom.read_text())
    else:
        config = json.loads(
            (DEFECT / "sweep_fixed" / "seed_1000000000000000010" / "config_prod.json").read_text()
        )
        config["prng_seed"] = seed
    cfg = run_dir / "config_prod.json"
    cfg.write_text(json.dumps(config, indent=2))
    inst = run_dir / "instance.json"
    shutil.copy(BENCH / "instance.json", inst)
    cmd = [str(ENGINE), "-i", str(inst), "-c", str(cfg), "-s", str(out), "-p", "spp"]
    t0 = time.time()
    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=900)
    dt = time.time() - t0
    (run_dir / "stdout_prod.log").write_text(proc.stdout)
    if proc.returncode != 0:
        (run_dir / "stderr_prod.log").write_text(proc.stderr)
        return (seed, False, dt)
    return (seed, True, dt)


def main():
    seeds = [int(s) for s in sys.argv[1:]] or SEEDS
    print(f"prod-like sweep: {len(seeds)} seeds, 3 parallel, engine={ENGINE}")
    t0 = time.time()
    with ThreadPoolExecutor(max_workers=3) as ex:
        for seed, ok, dt in ex.map(run_one, seeds):
            print(f"seed={seed}  {'done' if ok else 'FAILED'} in {dt:5.1f}s", flush=True)
    print(f"wall {time.time() - t0:.0f}s")


if __name__ == "__main__":
    main()
