"""Seed sweep for the trou100 SPP defect (100x100mm squares, space 2,
strip 1000x2000, bias left).

Replays the bench config (workers/nesting/bench/out_trou100/config.json)
with different prng_seed values and looks for the production defect
signature: pieces shifted by ~one cell (102 mm) inside a column, leaving
an internal air gap (~104 mm between neighbors) and a step at the top.

Usage (from repo root):
    python workers/nesting/bench/out_trou100_defect/sweep_seeds.py SEED [SEED...]
    python workers/nesting/bench/out_trou100_defect/sweep_seeds.py --base 8578442985024929237 --count 15

Each run goes to workers/nesting/bench/out_trou100_defect/seed_<N>/run/.
A run is DEFECTIVE if any column has an internal y-gap deviating from the
2 mm pitch by more than 0.5 mm, or any piece sits off the 102 mm x/y
lattice by more than 0.5 mm.
"""
import argparse
import json
import math
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
BENCH = ROOT.parent / "out_trou100"
ENGINE = Path(__file__).resolve().parents[2] / "engine" / "target" / "release" / "nest-engine.exe"
PITCH = 102.0  # 100 mm cell + 2 mm separation
SPACE = 2.0
TOL = 0.5


class _RemoveKeyType:
    pass


_RemoveKey = _RemoveKeyType()


def run_engine(seed, extra=None, tag=None):
    run_dir = ROOT / f"seed_{seed}"
    suffix = f"_{tag}" if tag else ""
    out = run_dir / f"run{suffix}"
    out.mkdir(parents=True, exist_ok=True)
    config = json.loads((BENCH / "config.json").read_text())
    config["prng_seed"] = seed
    if extra:
        for key, val in extra.items():
            if val is _RemoveKey:
                config.pop(key, None)
            else:
                config[key] = val
    cfg_path = run_dir / f"config{suffix}.json"
    cfg_path.write_text(json.dumps(config, indent=2))
    shutil.copy(BENCH / "instance.json", run_dir / "instance.json")
    cmd = [
        str(ENGINE),
        "-i", str(run_dir / "instance.json"),
        "-c", str(cfg_path),
        "-s", str(out),
        "-p", "spp",
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=600)
    (run_dir / f"stdout{suffix}.log").write_text(proc.stdout)
    if proc.returncode != 0:
        (run_dir / f"stderr{suffix}.log").write_text(proc.stderr)
        return None
    return out / "sol_instance.json"


def analyze(sol_path):
    doc = json.loads(sol_path.read_text())
    shape = doc["items"][0]["shape"]["data"]
    ring = shape["outer"] if isinstance(shape, dict) else shape
    pts = [(float(p[0]), float(p[1])) for p in ring]
    sol = doc["solution"]
    placed = sol["layout"]["placed_items"]
    boxes = []
    for pi in placed:
        t = pi["transformation"]
        rad = math.radians(t["rotation"])
        c, s = math.cos(rad), math.sin(rad)
        xs = [x * c - y * s + t["translation"][0] for x, y in pts]
        ys = [x * s + y * c + t["translation"][1] for x, y in pts]
        boxes.append((min(xs), min(ys), max(xs), max(ys)))

    used_w = max(b[2] for b in boxes)
    # Columns: cluster by x_min (1 mm tolerance).
    cols = []
    for b in sorted(boxes, key=lambda b: (b[0], b[1])):
        if cols and abs(b[0] - cols[-1][0][0]) <= 1.0:
            cols[-1].append(b)
        else:
            cols.append([b])

    holes = []       # (col_idx, gap_mm, y_below_top, y_above_bottom)
    col_summaries = []
    for i, col in enumerate(cols):
        ivals = sorted((b[1], b[3]) for b in col)
        gaps = [b0 - a1 for (a0, a1), (b0, b1) in zip(ivals, ivals[1:])]
        bad = [(g, a1, b0) for g, (a0, a1), (b0, b1)
               in zip(gaps, ivals, ivals[1:]) if abs(g - SPACE) > TOL]
        for g, top_below, bot_above in bad:
            holes.append((i, g, top_below, bot_above))
        col_summaries.append({
            "x_min": min(b[0] for b in col),
            "n": len(col),
            "top": max(b[3] for b in col),
            "gap_min": min(gaps) if gaps else None,
            "gap_max": max(gaps) if gaps else None,
        })

    # Lattice check: pieces off the 102 mm pitch (x or y) by > TOL.
    ox = min(b[0] for b in boxes)
    oy = min(b[1] for b in boxes)

    def off_lattice(v, origin):
        r = (v - origin) % PITCH
        return min(r, PITCH - r)

    shifted = [
        (round(b[0], 2), round(b[1], 2),
         round(off_lattice(b[0], ox), 2), round(off_lattice(b[1], oy), 2))
        for b in boxes
        if off_lattice(b[0], ox) > TOL or off_lattice(b[1], oy) > TOL
    ]

    return {
        "n": len(boxes),
        "used_w": used_w,
        "density": sol.get("density"),
        "n_cols": len(cols),
        "cols": col_summaries,
        "holes": holes,
        "shifted": shifted,
        "defective": bool(holes) or bool(shifted),
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("seeds", nargs="*", type=int)
    ap.add_argument("--base", type=int)
    ap.add_argument("--count", type=int, default=15)
    ap.add_argument("--raw", action="store_true",
                    help="disable post-passes (gravity/column_fill/two_phase)")
    ap.add_argument("--no-postpass", action="store_true",
                    help="disable only gravity/column_fill (keep two_phase search)")
    ap.add_argument("--set", dest="overrides", action="append", default=[],
                    metavar="KEY=JSON",
                    help="config override, repeatable (e.g. --set n_workers=3)")
    args = ap.parse_args()
    seeds = list(args.seeds)
    if args.base is not None:
        seeds += [args.base + k for k in range(args.count)]
    if not seeds:
        ap.error("no seeds given")

    extra = None
    tag = None
    if args.raw:
        extra = {"gravity": False, "column_fill": False, "two_phase": False}
        tag = "raw"
    elif args.no_postpass:
        extra = {"gravity": False, "column_fill": False}
        tag = "nopost"
    if args.overrides:
        extra = dict(extra or {})
        for ov in args.overrides:
            key, _, val = ov.partition("=")
            parsed = json.loads(val)
            if parsed is None:
                extra[key] = _RemoveKey
            else:
                extra[key] = parsed
        tag = (tag + "_" if tag else "") + "custom"

    for seed in seeds:
        sol = run_engine(seed, extra, tag)
        if sol is None:
            print(f"seed={seed}  ENGINE FAILURE (see seed_{seed}/stderr.log)")
            continue
        r = analyze(sol)
        counts = "/".join(str(c["n"]) for c in r["cols"])
        status = "DEFECT" if r["defective"] else "clean "
        print(f"seed={seed}  {status}  used_w={r['used_w']:.3f}  "
              f"cols={r['n_cols']} [{counts}]  density={r['density']:.4f}")
        if r["defective"]:
            for col, gap, yb, ya in r["holes"]:
                print(f"    hole: col {col} gap={gap:.2f} mm "
                      f"between y={yb:.2f} and y={ya:.2f}")
            for x, y, dx, dy in r["shifted"][:20]:
                print(f"    shifted piece at x_min={x} y_min={y} "
                      f"(off-lattice dx={dx} dy={dy})")
            if len(r["shifted"]) > 20:
                print(f"    ... and {len(r['shifted']) - 20} more shifted pieces")


if __name__ == "__main__":
    main()
