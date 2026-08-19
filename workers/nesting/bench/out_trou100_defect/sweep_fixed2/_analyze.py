"""Analyze sweep_fixed/seed_<N>/run/sol_instance.json against the post-fix
defect criteria (tolerance 0.1 mm):

  a. columns clustered by x_min (50 mm threshold); within a column every
     piece must share the lane x_min to +/-0.1 mm (no off-lane piece);
  b. lane x_min values form a regular grid: inter-lane delta ~102 mm
     (no lane shifted by +1 mm);
  c. within each column, internal gaps <= 2.5 mm (and no overlap < -0.1);
  d. column tops: no inversion (a shorter column left of a taller one)
     beyond 1 mm;
  e. used width <= 613 mm.

Writes analysis.json per seed, signature.json for defective seeds, and
prints a one-line status per seed.
"""
import json
import math
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
PITCH = 102.0   # 100 mm cell + 2 mm separation
SPACE = 2.0
TOL = 0.1
CLUSTER = 50.0
GAP_MAX = 2.5
TOP_TOL = 1.0
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

    # Columns: cluster by x_min with 50 mm threshold.
    cols = []
    for b in sorted(boxes, key=lambda b: (b[0], b[1])):
        if cols and abs(b[0] - cols[-1][-1][0]) <= CLUSTER:
            cols[-1].append(b)
        else:
            cols.append([b])
    cols = [sorted(c, key=lambda b: b[1]) for c in cols]

    defects = []
    col_info = []
    off_lane = []
    holes = []
    for ci, col in enumerate(cols):
        xmins = [b[0] for b in col]
        lane_x = min(xmins)
        spread = max(xmins) - min(xmins)
        # (a) off-lane pieces
        bad = [b for b in col if abs(b[0] - lane_x) > TOL]
        for b in bad:
            off_lane.append({
                "col": ci, "lane_x": round(lane_x, 3),
                "x_min": round(b[0], 3), "y_min": round(b[1], 3),
                "dx": round(b[0] - lane_x, 3),
            })
        if bad:
            defects.append(f"off-lane: col {ci} x={lane_x:.2f} "
                           f"spread={spread:.3f} mm ({len(bad)} pieces)")
        # (c) internal gaps
        ivals = [(b[1], b[3]) for b in col]
        gaps = []
        for (a0, a1), (b0, b1) in zip(ivals, ivals[1:]):
            g = b0 - a1
            gaps.append(round(g, 3))
            if g > GAP_MAX or g < -TOL:
                holes.append({
                    "col": ci, "lane_x": round(lane_x, 3),
                    "gap": round(g, 3),
                    "y_top_below": round(a1, 3), "y_bot_above": round(b0, 3),
                })
        if any(g["col"] == ci for g in holes):
            hs = [h for h in holes if h["col"] == ci]
            defects.append(f"hole: col {ci} x={lane_x:.2f} "
                           + "; ".join(f"gap={h['gap']:.2f} y={h['y_top_below']:.2f}->{h['y_bot_above']:.2f}"
                                       for h in hs))
        col_info.append({
            "col": ci, "lane_x": round(lane_x, 3), "n": len(col),
            "x_spread": round(spread, 4),
            "bottom": round(min(b[1] for b in col), 3),
            "top": round(max(b[3] for b in col), 3),
            "gaps": gaps,
        })

    # (b) lane grid
    lanes = [c["lane_x"] for c in col_info]
    lane_diffs = [round(b - a, 3) for a, b in zip(lanes, lanes[1:])]
    bad_lanes = [d for d in lane_diffs if abs(d - PITCH) > TOL]
    if bad_lanes:
        defects.append(f"lane grid broken: diffs={lane_diffs}")

    # (d) top inversions
    tops = [c["top"] for c in col_info]
    inversions = []
    for i in range(len(tops)):
        for j in range(i + 1, len(tops)):
            if tops[j] - tops[i] > TOP_TOL:
                inversions.append({
                    "left_col": i, "right_col": j,
                    "left_top": tops[i], "right_top": tops[j],
                    "delta": round(tops[j] - tops[i], 3),
                })
    if inversions:
        w = max(inversions, key=lambda v: v["delta"])
        defects.append(f"top inversion: col {w['left_col']} top={w['left_top']:.2f} "
                       f"< col {w['right_col']} top={w['right_top']:.2f} "
                       f"(+{w['delta']:.2f} mm, {len(inversions)} pairs)")

    # (e) used width
    if used_w > W_MAX:
        defects.append(f"used width {used_w:.3f} > {W_MAX}")

    return {
        "n": len(boxes),
        "used_w": round(used_w, 3),
        "density": sol.get("density"),
        "n_cols": len(cols),
        "lanes": lanes,
        "lane_diffs": lane_diffs,
        "cols": col_info,
        "holes": holes,
        "off_lane": off_lane,
        "inversions": inversions,
        "defects": defects,
        "defective": bool(defects),
    }


def classify(r):
    """Motif class vs the 3 known: trou N cellules / escalier / autre."""
    parts = []
    for h in r["holes"]:
        cells = round((h["gap"] - SPACE) / PITCH)
        parts.append(f"trou {h['gap']:.2f} mm (~{cells} cellule{'s' if cells > 1 else ''}) col x={h['lane_x']:.2f}")
    if r["off_lane"]:
        parts.append(f"{len(r['off_lane'])} piece(s) hors-lane")
    if r["inversions"]:
        parts.append("inversion tops")
    if r["used_w"] > W_MAX:
        parts.append("hors-tôle")
    return " + ".join(parts) if parts else "clean"


def main():
    dirs = sorted(ROOT.glob("seed_*"), key=lambda p: int(p.name.split("_")[1]))
    rows = []
    for d in dirs:
        sol = d / "run" / "sol_instance.json"
        if not sol.exists():
            print(f"seed={d.name.split('_')[1]}  NO SOLUTION")
            continue
        r = analyze(sol)
        r["seed"] = int(d.name.split("_")[1])
        r["motif"] = classify(r)
        (d / "analysis.json").write_text(json.dumps(r, indent=2))
        if r["defective"]:
            (d / "signature.json").write_text(json.dumps({
                "seed": r["seed"], "motif": r["motif"], "used_w": r["used_w"],
                "lanes": r["lanes"], "lane_diffs": r["lane_diffs"],
                "cols": r["cols"], "holes": r["holes"],
                "off_lane": r["off_lane"], "inversions": r["inversions"],
            }, indent=2))
        rows.append(r)
        status = "DEFECT" if r["defective"] else "clean "
        counts = "/".join(str(c["n"]) for c in r["cols"])
        print(f"seed={r['seed']}  {status}  used_w={r['used_w']:.3f}  "
              f"cols={r['n_cols']} [{counts}]  {r['motif']}")
        for msg in r["defects"]:
            print(f"    {msg}")
    n_def = sum(1 for r in rows if r["defective"])
    print(f"\n{len(rows)} seeds: {n_def} defective, {len(rows) - n_def} clean "
          f"(pre-fix reference: 3/21)")


if __name__ == "__main__":
    main()
