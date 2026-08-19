"""Analyze prod2 sweep results (sweep_fixed2/prod2_seed_<N>/run/sol_instance.json).

Per result:
  (a) x_min clustering (50 mm) -> lanes;
  (b) column tops in cells: round(top/102) -- exact distribution;
  (c) internal gaps > 2.5 mm (or overlap < -0.1);
  (d) off-lane pieces > 0.1 mm;
  (e) used width <= 613.

PERFECT = zero holes + zero off-lane + width OK + cell tops monotone
non-increasing with at most 2 distinct values (uniform body, single step
on the right). Anything else is non-perfect and gets a full geometric
signature dump (top y_max at um, last 3 pieces of each column).
"""
import json
import math
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent
PITCH = 102.0
SPACE = 2.0
TOL = 0.1
CLUSTER = 50.0
GAP_MAX = 2.5
W_MAX = 613.0


def load_boxes(sol_path):
    doc = json.loads(sol_path.read_text())
    shapes = {}
    for it in doc["items"]:
        data = it["shape"]["data"]
        ring = data["outer"] if isinstance(data, dict) else data
        shapes[it["id"]] = [(float(p[0]), float(p[1])) for p in ring]
    sol = doc["solution"]
    boxes = []
    for pi in sol["layout"]["placed_items"]:
        t = pi["transformation"]
        rad = math.radians(t["rotation"])
        c, s = math.cos(rad), math.sin(rad)
        pts = shapes[pi["item_id"]]
        xs = [x * c - y * s + t["translation"][0] for x, y in pts]
        ys = [x * s + y * c + t["translation"][1] for x, y in pts]
        boxes.append((min(xs), min(ys), max(xs), max(ys)))
    return boxes, sol


def analyze(sol_path):
    boxes, sol = load_boxes(sol_path)
    used_w = max(b[2] for b in boxes)

    # (a) columns: cluster by x_min, 50 mm threshold
    cols = []
    for b in sorted(boxes, key=lambda b: (b[0], b[1])):
        if cols and abs(b[0] - cols[-1][-1][0]) <= CLUSTER:
            cols[-1].append(b)
        else:
            cols.append([b])
    cols = [sorted(c, key=lambda b: b[1]) for c in cols]

    holes, off_lane, col_info = [], [], []
    for ci, col in enumerate(cols):
        xmins = [b[0] for b in col]
        lane_x = min(xmins)
        for b in col:
            if abs(b[0] - lane_x) > TOL:
                off_lane.append({"col": ci, "lane_x": round(lane_x, 3),
                                 "x_min": round(b[0], 3), "y_min": round(b[1], 3),
                                 "dx": round(b[0] - lane_x, 3)})
        ivals = [(b[1], b[3]) for b in col]
        for (a0, a1), (b0, b1) in zip(ivals, ivals[1:]):
            g = b0 - a1
            if g > GAP_MAX or g < -TOL:
                holes.append({"col": ci, "lane_x": round(lane_x, 3), "gap": round(g, 3),
                              "y_top_below": round(a1, 3), "y_bot_above": round(b0, 3)})
        top = max(b[3] for b in col)
        col_info.append({
            "col": ci, "lane_x": lane_x, "n": len(col), "top": top,
            "cells": round(top / PITCH),
            "last3": [{"y_min": round(b[1], 6), "y_max": round(b[3], 6),
                       "x_min": round(b[0], 6), "x_max": round(b[2], 6)}
                      for b in col[-3:]],
        })

    lanes = [round(c["lane_x"], 3) for c in col_info]
    lane_diffs = [round(b - a, 3) for a, b in zip(lanes, lanes[1:])]
    cells = [c["cells"] for c in col_info]

    # (b) staircase analysis on cell tops
    non_monotone = any(cells[j] > cells[i] for i in range(len(cells))
                       for j in range(i + 1, len(cells)))
    distinct = sorted(set(cells), reverse=True)
    multi_step = len(distinct) > 2 or non_monotone

    defects = []
    if holes:
        defects.append(f"{len(holes)} trou(s): " + "; ".join(
            f"col {h['col']} x={h['lane_x']:.2f} gap={h['gap']:.2f} "
            f"y={h['y_top_below']:.2f}->{h['y_bot_above']:.2f}" for h in holes))
    if off_lane:
        defects.append(f"{len(off_lane)} piece(s) hors-lane")
    if any(abs(d - PITCH) > TOL for d in lane_diffs):
        defects.append(f"lane grid broken: diffs={lane_diffs}")
    if used_w > W_MAX:
        defects.append(f"used width {used_w:.3f} > {W_MAX}")
    perfect = (not holes and not off_lane and used_w <= W_MAX and not multi_step)
    if not perfect and not defects:
        defects.append(f"escalier multi-marches: cells={cells}")

    return {
        "n": len(boxes), "used_w": round(used_w, 3), "density": sol.get("density"),
        "n_cols": len(cols), "lanes": lanes, "lane_diffs": lane_diffs,
        "cells": cells, "counts": [c["n"] for c in col_info],
        "holes": holes, "off_lane": off_lane,
        "non_monotone": non_monotone, "distinct_cells": distinct,
        "defects": defects, "perfect": perfect,
        "cols": col_info,
    }


def motif(r):
    tags = []
    if r["holes"]:
        tags.append(f"{len(r['holes'])} trou(s)")
    if r["off_lane"]:
        tags.append(f"{len(r['off_lane'])} hors-lane")
    if r["used_w"] > W_MAX:
        tags.append("hors-tôle")
    if r["non_monotone"]:
        tags.append("non-monotone")
    if len(r["distinct_cells"]) > 2:
        tags.append("multi-marches")
    if not tags:
        tags.append("corps uniforme 1 marche")
    return f"{r['cells']} " + "+".join(tags)


def main():
    dirs = sorted(ROOT.glob("prod2_seed_*"), key=lambda p: int(p.name.split("_")[-1]))
    rows = []
    for d in dirs:
        sol = d / "run" / "sol_instance.json"
        if not sol.exists():
            print(f"seed={d.name.split('_')[-1]}  NO SOLUTION")
            continue
        r = analyze(sol)
        r["seed"] = int(d.name.split("_")[-1])
        r["motif"] = motif(r)
        (d / "analysis.json").write_text(json.dumps(r, indent=2))
        rows.append(r)
        status = "PERFECT" if r["perfect"] else "NON-PARFAIT"
        print(f"seed={r['seed']}  {status}  used_w={r['used_w']:.3f}  "
              f"cells={r['cells']} counts={r['counts']}  {r['motif']}")
        for msg in r["defects"]:
            print(f"    {msg}")
        if not r["perfect"]:
            sig = {
                "seed": r["seed"], "motif": r["motif"], "used_w": r["used_w"],
                "cells": r["cells"], "counts": r["counts"], "lanes": r["lanes"],
                "holes": r["holes"], "off_lane": r["off_lane"],
                "columns": [{
                    "col": c["col"], "lane_x": round(c["lane_x"], 6),
                    "n": c["n"], "top_y_max": round(c["top"], 6),
                    "cells": c["cells"], "last3_pieces": c["last3"],
                } for c in r["cols"]],
            }
            (d / "signature.json").write_text(json.dumps(sig, indent=2))

    print("\n=== distribution des motifs ===")
    vec_count = Counter(tuple(r["cells"]) for r in rows)
    for vec, n in sorted(vec_count.items(), key=lambda kv: -kv[1]):
        tag = "PERFECT" if all(
            r["perfect"] for r in rows if tuple(r["cells"]) == vec) else "non-parfait"
        print(f"  cells={list(vec)}  x{n}  [{tag}]")
    n_perfect = sum(1 for r in rows if r["perfect"])
    body19 = sum(1 for r in rows if r["distinct_cells"] and max(r["distinct_cells"]) >= 19)
    esc = sum(1 for r in rows if r["non_monotone"] or len(r["distinct_cells"]) > 2)
    trou = sum(1 for r in rows if r["holes"])
    print(f"\n{len(rows)} seeds: {n_perfect} PERFECT, {len(rows) - n_perfect} non-parfaits "
          f"| corps>=19: {body19} | escaliers/multi-marches: {esc} | trous: {trou}")


if __name__ == "__main__":
    main()
