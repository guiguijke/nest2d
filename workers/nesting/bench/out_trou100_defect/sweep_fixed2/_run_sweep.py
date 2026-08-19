"""Parallel seed sweep with the FIXED nest-engine binary (trou100 case).

Runs the bench config (out_trou100/config.json, 30 s mono-walk SPP) over
50 seeds: the 21 seeds of the original sweep + 29 new ones
(1000000000000000000+i, i=0..28). 4 runs in parallel (each mono-thread).

Output: sweep_fixed/seed_<N>/{config.json, instance.json, run/, stdout.log}
"""
import json
import shutil
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor

from pathlib import Path

ROOT = Path(__file__).resolve().parent            # sweep_fixed/
DEFECT = ROOT.parent                              # out_trou100_defect/
BENCH = DEFECT.parent / "out_trou100"
ENGINE = DEFECT.parents[1] / "engine" / "target" / "release" / "nest-engine.exe"

ORIG_SEEDS = [
    2806985829419873653,
    2906316077741002638,
    4300774645335997184,
    5594320138289656320,
    5846177572521037030,
    8181061267952900837,
] + [8578442985024929237 + k for k in range(15)]
NEW_SEEDS = [1000000000000000000 + k for k in range(29)]
SEEDS = ORIG_SEEDS + NEW_SEEDS


def run_one(seed):
    run_dir = ROOT / f"seed_{seed}"
    out = run_dir / "run"
    out.mkdir(parents=True, exist_ok=True)
    config = json.loads((BENCH / "config.json").read_text())
    config["prng_seed"] = seed
    cfg = run_dir / "config.json"
    cfg.write_text(json.dumps(config, indent=2))
    inst = run_dir / "instance.json"
    shutil.copy(BENCH / "instance.json", inst)
    cmd = [
        str(ENGINE),
        "-i", str(inst),
        "-c", str(cfg),
        "-s", str(out),
        "-p", "spp",
    ]
    t0 = time.time()
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=900)
    except subprocess.TimeoutExpired:
        return (seed, False, time.time() - t0, "TIMEOUT")
    dt = time.time() - t0
    (run_dir / "stdout.log").write_text(proc.stdout)
    if proc.returncode != 0:
        (run_dir / "stderr.log").write_text(proc.stderr)
        return (seed, False, dt, f"rc={proc.returncode}")
    return (seed, True, dt, "")


def main():
    seeds = [int(s) for s in sys.argv[1:]] or SEEDS
    print(f"sweeping {len(seeds)} seeds, 4 parallel, engine={ENGINE}")
    t0 = time.time()
    ok = fail = 0
    with ThreadPoolExecutor(max_workers=4) as ex:
        for seed, success, dt, err in ex.map(run_one, seeds):
            if success:
                ok += 1
                print(f"seed={seed}  done in {dt:5.1f}s", flush=True)
            else:
                fail += 1
                print(f"seed={seed}  FAILED ({err}) after {dt:5.1f}s", flush=True)
    print(f"total: {ok} ok, {fail} failed, wall {time.time() - t0:.0f}s")


if __name__ == "__main__":
    main()
