"""Bench for the real user case PACKING-X-100-TROU: 100 hosts Piece_Trou
(100x100 mm square, circular hole r=35) + 400 fillers Piece_Fillx4 on a
1000x2000 sheet, space 2 mm, direction left only (SPP).

Geometry = the real DXF fixtures (workers/fileprocessing/tests/fixtures/
Piece_Trou.DXF, Piece_Fillx4.DXF): the filler is the annular quarter-sector
that pinwheel-tiles the r=35 hole exactly 4 times WITH the 2 mm spacing
(pinwheel_capacity = 4/4), so the D-MOT-16 pre-pass nests all 400 fillers
and the engine only sees 100 closed squares. It must then emit 6 compact
columns at 102 mm pitch with no internal hole, no tops inversion, band
width <= 614.03 mm and all 400 fillers in holes.

    docker run --rm -i --network nestorcut_nest2d \
        -e MONGO_URI=mongodb://mongo:27017/nest2d \
        nest2d-nesting-worker:dev python - < bench/seed_trou100.py

Exits non-zero when any assertion fails.
"""
import io
import json
import math
import os
import sys
import tempfile
import time
from datetime import datetime

import ezdxf
from pymongo import MongoClient

OWNER = "bench-user"
SHEET = {"width": 1000.0, "height": 2000.0, "count": 1}
BUDGET_SEC = int(os.environ.get("BENCH_BUDGET", "300"))
SPACE = 2.0

HOST_QTY = 100
FILLER_QTY = 400

PITCH = 102.0          # 100 mm cell + 2 mm separation
TOL = 0.5              # lattice / gap tolerance (mm)
MAX_INTERNAL_GAP = 2.5 # a closed cell: gap <= space + TOL
WIDTH_TARGET = 614.03  # 6*100 + 5*2 + 2 + 2 (bench floor + sheet margins)

# Piece_Fillx4 fixture ring (workers/fileprocessing/tests/fixtures/
# Piece_Fillx4.DXF via build_geometry): annular quarter-sector, outer
# r ~ 30.8, inner notch y = 2.83 — pinwheel-tiles the r=35 hole 4 times.
FILLER_RING = [[-19.799,22.6274],[-19.4618,22.959],[-19.119,23.2848],[-18.7708,23.6048],[-18.4172,23.9189],[-18.0584,24.2269],[-17.6944,24.5289],[-17.3253,24.8246],[-16.9514,25.1141],[-16.5726,25.3972],[-16.189,25.6739],[-15.8009,25.9441],[-15.4082,26.2076],[-15.0111,26.4645],[-14.6098,26.7147],[-14.2043,26.958],[-13.7947,27.1945],[-13.3812,27.424],[-12.9639,27.6465],[-12.5429,27.8619],[-12.1183,28.0702],[-11.6903,28.2713],[-11.2589,28.4651],[-10.8243,28.6516],[-10.3866,28.8307],[-9.9459,29.0024],[-9.5025,29.1667],[-9.0563,29.3234],[-8.6075,29.4726],[-8.1563,29.6142],[-7.7027,29.7481],[-7.2469,29.8744],[-6.7891,29.9929],[-6.3293,30.1037],[-5.8678,30.2067],[-5.4045,30.3019],[-4.9398,30.3892],[-4.4736,30.4687],[-4.0061,30.5404],[-3.5375,30.6041],[-3.0679,30.6599],[-2.5974,30.7077],[-2.1261,30.7476],[-1.6543,30.7795],[-1.182,30.8035],[-0.7093,30.8194],[-0.2365,30.8274],[0.2365,30.8274],[0.7093,30.8194],[1.182,30.8035],[1.6543,30.7795],[2.1261,30.7476],[2.5974,30.7077],[3.0679,30.6599],[3.5375,30.6041],[4.0061,30.5404],[4.4736,30.4687],[4.9398,30.3892],[5.4045,30.3019],[5.8678,30.2067],[6.3293,30.1037],[6.7891,29.9929],[7.2469,29.8744],[7.7027,29.7481],[8.6075,29.4726],[9.0563,29.3234],[9.5025,29.1667],[9.9459,29.0024],[10.3866,28.8307],[10.8243,28.6516],[11.2589,28.4651],[11.6903,28.2713],[12.1183,28.0702],[12.5429,27.8619],[12.9639,27.6465],[13.3812,27.424],[13.7947,27.1945],[14.2043,26.958],[14.6098,26.7147],[15.0111,26.4645],[15.4082,26.2076],[15.8009,25.9441],[16.189,25.6739],[16.5726,25.3972],[16.9514,25.1141],[17.3253,24.8246],[17.6944,24.5289],[18.0584,24.2269],[18.4172,23.9189],[18.7708,23.6048],[19.119,23.2848],[19.4618,22.959],[19.799,22.6274],[0.0,2.8284],[-19.799,22.6274]]


def circle_ring(cx, cy, r, n=416):
    pts = [(cx + r * math.cos(2 * math.pi * i / n), cy + r * math.sin(2 * math.pi * i / n)) for i in range(n)]
    pts.append(pts[0])
    return pts


def host_geometry():
    # Fixture ring order (Piece_Trou.DXF via build_geometry).
    outer = [[50.0, -50.0], [-50.0, -50.0], [-50.0, 50.0], [50.0, 50.0], [50.0, -50.0]]
    hole = circle_ring(0, 0, 35.0)
    return outer, [hole]


def filler_geometry():
    return [list(p) for p in FILLER_RING], []


def make_dxf(rings):
    doc = ezdxf.new("R2010")
    msp = doc.modelspace()
    handles = [msp.add_lwpolyline(r, close=True).dxf.handle for r in rings]
    buf = io.StringIO()
    doc.write(buf)
    return buf.getvalue().encode("ascii", "ignore"), handles


def analyze_dxf(dxf_bytes):
    """Parse the result DXF, return host boxes [(x0, y0, x1, y1), ...]."""
    with tempfile.NamedTemporaryFile(suffix=".dxf", delete=False) as tmp:
        tmp.write(dxf_bytes)
        tmp_path = tmp.name
    try:
        doc = ezdxf.readfile(tmp_path)
    finally:
        os.unlink(tmp_path)
    boxes = []
    for e in doc.modelspace().query("LWPOLYLINE"):
        pts = [(p[0], p[1]) for p in e.get_points()]
        if not pts:
            continue
        xs = [p[0] for p in pts]
        ys = [p[1] for p in pts]
        w = max(xs) - min(xs)
        h = max(ys) - min(ys)
        # Host outer ring: ~100x100 bbox (sheet boundary is 1000x2000, hole
        # rings are 70x70, fillers ~40x28).
        if abs(w - 100.0) <= 1.0 and abs(h - 100.0) <= 1.0:
            boxes.append((min(xs), min(ys), max(xs), max(ys)))
    return boxes


def main():
    db = MongoClient(os.environ["MONGO_URI"]).get_default_database()
    from worker_common.crypto import write_gridfs, read_gridfs
    from worker_common.mongo import get_bucket

    bucket = get_bucket("validDxf")
    db["users"].update_one({"id": OWNER}, {"$setOnInsert": {"id": OWNER}}, upsert=True)

    files = []
    for slug, (outer, holes), qty in [
        ("piece_trou", host_geometry(), HOST_QTY),
        ("piece_fillx4", filler_geometry(), FILLER_QTY),
    ]:
        rings = [outer] + holes
        dxf_bytes, handles = make_dxf(rings)
        write_gridfs(bucket, slug, dxf_bytes, OWNER, None)
        db["user_dxf_files"].update_one(
            {"slug": slug},
            {"$set": {
                "slug": slug,
                "ownerId": OWNER,
                "polygonParts": [{
                    "coordinates": [[x, y] for x, y in outer],
                    "holes": [[[x, y] for x, y in h] for h in holes],
                    "handles": handles,
                }],
            }},
            upsert=True,
        )
        files.append({"slug": slug, "count": qty, "rotations": [0, 90, 180, 270]})

    job_slug = f"bench-trou100-{int(time.time())}"
    db["nesting_jobs"].insert_one({
        "slug": job_slug,
        "projectSlug": "bench-project",
        "ownerId": OWNER,
        "files": files,
        "params": {
            "sheets": [SHEET],
            "width": SHEET["width"], "height": SHEET["height"], "sheetCount": SHEET["count"],
            "space": SPACE, "addOutShape": False,
            "directions": ["left"],
            "vcores": 4, "timeBudgetSec": BUDGET_SEC, "alternativesCount": 1,
            "computeLevel": "standard",
        },
        "status": "pending", "priority": 20, "createdAt": datetime.now(),
    })
    print(f"[trou100] job {job_slug} ({BUDGET_SEC}s, sheet {SHEET['width']}x{SHEET['height']}, "
          f"{HOST_QTY} hosts + {FILLER_QTY} fillers, space {SPACE}, left only)", flush=True)

    deadline = time.time() + BUDGET_SEC + 300
    while time.time() < deadline:
        doc = db["nesting_jobs"].find_one({"slug": job_slug})
        if doc.get("status") in ("done", "error", "cancelled"):
            break
        time.sleep(5)

    doc = db["nesting_jobs"].find_one({"slug": job_slug})
    print(f"[trou100] final status: {doc.get('status')}", flush=True)
    if doc.get("status") != "done":
        print(f"[trou100] ERROR: {doc.get('error') or doc.get('information')}")
        sys.exit(1)

    slots = HOST_QTY * 4
    failures = []
    for i, alt in enumerate(doc.get("alternatives") or []):
        r = alt.get("report") or {}
        print(
            f"  #{i} {alt.get('strategy')!r}: nested={r.get('holesFilled')}/{slots} "
            f"used={alt.get('usedSheetShare', 0)*100:.1f}% density={alt.get('density')} "
            f"gap={r.get('smallestGapMm')} overlapFree={r.get('overlapFree')} "
            f"spacingOk={r.get('spacingOk')} iters={r.get('iterations')}",
            flush=True,
        )
        sheets = r.get("sheets") or []
        for s in sheets:
            print(f"    sheet: densityPct={s.get('densityPct')} partCount={s.get('partCount')}", flush=True)

    alt = (doc.get("alternatives") or [])[0]
    report = alt.get("report") or {}

    # (e) all fillers nested in holes.
    if report.get("holesFilled") != slots:
        failures.append(f"holesFilled={report.get('holesFilled')} != {slots}")

    # (f) no overlap flagged (None = unverified above 250 parts/sheet, the
    # host-gap lattice check below is the evidence for the host level).
    if report.get("overlapFree") is False or report.get("spacingOk") is False:
        failures.append(
            f"report flags overlap/spacing: overlapFree={report.get('overlapFree')} "
            f"spacingOk={report.get('spacingOk')} gap={report.get('smallestGapMm')}")

    # (a)-(d) geometry from the final DXF.
    dxf_name = (alt.get("dxf_files") or [None])[0]
    boxes = analyze_dxf(read_gridfs(get_bucket("nestDxf"), dxf_name, OWNER))
    print(f"[trou100] hosts found in DXF: {len(boxes)}", flush=True)
    if len(boxes) != HOST_QTY:
        failures.append(f"hosts in DXF={len(boxes)} != {HOST_QTY}")
        print("[trou100] FAILURES: " + "; ".join(failures), flush=True)
        sys.exit(1)

    # Cluster columns by x_min (1 mm tolerance).
    cols = []
    for b in sorted(boxes, key=lambda b: (b[0], b[1])):
        if cols and abs(b[0] - cols[-1][0][0]) <= 1.0:
            cols[-1].append(b)
        else:
            cols.append([b])

    ox = min(b[0] for b in boxes)
    counts = [len(c) for c in cols]
    tops = [max(b[3] for b in c) for c in cols]
    used_w = max(b[2] for b in boxes) - ox
    print(f"[trou100] columns={len(cols)} counts={counts} "
          f"x_min={[round(min(b[0] for b in c), 2) for c in cols]}", flush=True)
    print(f"[trou100] tops={[round(t, 2) for t in tops]}", flush=True)
    print(f"[trou100] used_width={used_w:.3f} mm (target <= {WIDTH_TARGET})", flush=True)

    # (a) 6 columns at 102 mm pitch.
    if len(cols) != 6:
        failures.append(f"columns={len(cols)} != 6")
    for k, c in enumerate(cols):
        x0 = min(b[0] for b in c)
        if abs((x0 - ox) - k * PITCH) > TOL:
            failures.append(f"col {k} x_min={x0:.3f} off pitch (expected {ox + k * PITCH:.3f})")

    # (a2) couloirs équilibrés (balance_lane_tops) : écart de comptage ≤ 1
    # cellule — le moignon [19×5+5] est un défaut résolu, cible [17×4,16×2].
    if max(counts) - min(counts) > 1:
        failures.append(f"unbalanced lanes: counts={counts} (spread > 1)")

    # (b) no internal gap > 2.5 mm inside a column; spacing >= 2 - TOL.
    for k, c in enumerate(cols):
        ivals = sorted((b[1], b[3]) for b in c)
        gaps = [b0 - a1 for (a0, a1), (b0, b1) in zip(ivals, ivals[1:])]
        for g, (a0, a1) in zip(gaps, ivals):
            if g > MAX_INTERNAL_GAP:
                failures.append(f"col {k}: internal gap {g:.2f} mm above y={a1:.2f}")
            if g < SPACE - TOL:
                failures.append(f"col {k}: spacing violation {g:.2f} mm at y={a1:.2f}")
        if gaps:
            print(f"[trou100] col {k}: n={len(c)} gaps min/med/max="
                  f"{min(gaps):.2f}/{sorted(gaps)[len(gaps)//2]:.2f}/{max(gaps):.2f}", flush=True)

    # (c) no tops inversion: short columns are the rightmost ones.
    for k in range(len(tops) - 1):
        if tops[k] < tops[k + 1] - TOL:
            failures.append(f"tops inversion: col {k} top={tops[k]:.2f} < col {k+1} top={tops[k+1]:.2f}")

    # (d) band width.
    if used_w > WIDTH_TARGET + TOL:
        failures.append(f"used_width={used_w:.3f} > {WIDTH_TARGET}")

    if failures:
        print(f"[trou100] FAIL ({len(failures)}):", flush=True)
        for f in failures[:30]:
            print(f"  - {f}", flush=True)
        sys.exit(1)
    print("[trou100] PASS — 6 colonnes compactes au pas 102, zéro trou interne, "
          "tops monotone, largeur OK, 400/400 fillers, aucun overlap signalé", flush=True)


if __name__ == "__main__":
    main()
