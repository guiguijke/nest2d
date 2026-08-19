"""Prod-like sweep #2 (n_workers=3, budget 300 s) on the FIXED engine.

12 NEW seeds: 2000000000000000000+i, i=0..11. Config: the prod config of
sweep_fixed2/seed_1000000000000000010/config_prod.json with prng_seed
substituted. 3 runs in parallel (each run = 3 threads).

Output: sweep_fixed2/prod2_seed_<N>/{config.json, instance.json, run/, stdout.log}
"""
import json
import shutil
import subprocess
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parent            # sweep_fixed2/
DEFECT = ROOT.parent                              # out_trou100_defect/
BENCH = DEFECT.parent / "out_trou100"
ENGINE = DEFECT.parents[1] / "engine" / "target" / "release" / "nest-engine.exe"
REF_CFG = ROOT / "seed_1000000000000000010" / "config_prod.json"

SEEDS = [2000000000000000000 + k for k in range(12)]


def run_one(seed):
    run_dir = ROOT / f"prod2_seed_{seed}"
    out = run_dir / "run"
    out.mkdir(parents=True, exist_ok=True)
    config = json.loads(REF_CFG.read_text())
    config["prng_seed"] = seed
    cfg = run_dir / "config.json"
    cfg.write_text(json.dumps(config, indent=2))
    inst = run_dir / "instance.json"
    shutil.copy(BENCH / "instance.json", inst)
    cmd = [str(ENGINE), "-i", str(inst), "-c", str(cfg), "-s", str(out), "-p", "spp"]
    t0 = time.time()
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=900)
    except subprocess.TimeoutExpired:
        return (seed, False, time.time() - t0)
    dt = time.time() - t0
    (run_dir / "stdout.log").write_text(proc.stdout)
    if proc.returncode != 0:
        (run_dir / "stderr.log").write_text(proc.stderr)
        return (seed, False, dt)
    return (seed, True, dt)


def main():
    print(f"prod2 sweep: {len(SEEDS)} seeds, 3 parallel, engine={ENGINE}")
    t0 = time.time()
    with ThreadPoolExecutor(max_workers=3) as ex:
        for seed, ok, dt in ex.map(run_one, SEEDS):
            print(f"seed={seed}  {'done' if ok else 'FAILED'} in {dt:5.1f}s", flush=True)
    print(f"wall {time.time() - t0:.0f}s")


if __name__ == "__main__":
    main()
