"""Bench for the holed-parts case: 10 squares 100x100 with r=35 hole + 41
quarter-sector fillers r=28 on a 1000x2000 sheet, space 2mm — mirrors the
real user job. Asserts 3 directional alternatives and prints holesFilled
per class (target: every class nests most fillers, not just left).

    docker run --rm -i --network nest2d_nest2d \
        -e MONGO_URI=mongodb://mongo:27017/nest2d \
        nest2d-nesting-worker:dev python - < bench/seed_holes.py
"""
import io
import math
import os
import sys
import time
from datetime import datetime

import ezdxf
from pymongo import MongoClient

OWNER = "bench-user"
SHEET = {"width": 1000.0, "height": 2000.0, "count": 1}
BUDGET_SEC = int(os.environ.get("BENCH_BUDGET", "25"))
SPACE = 2.0

HOST_QTY = 10
FILLER_QTY = 41


def circle_ring(cx, cy, r, n=64):
    pts = [(cx + r * math.cos(2 * math.pi * i / n), cy + r * math.sin(2 * math.pi * i / n)) for i in range(n)]
    pts.append(pts[0])
    return pts


def host_geometry():
    outer = [(-50, -50), (-50, 50), (50, 50), (50, -50), (-50, -50)]
    hole = circle_ring(0, 0, 35.0)
    return outer, [hole]


def sector_geometry():
    pts = [(2.83, 2.83)]
    for i in range(9):
        a = math.pi / 2 * (i / 8.0)
        pts.append((28.0 * math.cos(a), 28.0 * math.sin(a)))
    pts.append((2.83, 2.83))
    return pts, []


def make_dxf(rings):
    doc = ezdxf.new("R2010")
    msp = doc.modelspace()
    handles = [msp.add_lwpolyline(r, close=True).dxf.handle for r in rings]
    buf = io.StringIO()
    doc.write(buf)
    return buf.getvalue().encode("ascii", "ignore"), handles


def main():
    db = MongoClient(os.environ["MONGO_URI"]).get_default_database()
    from worker_common.crypto import write_gridfs
    from worker_common.mongo import get_bucket

    bucket = get_bucket("validDxf")
    db["users"].update_one({"id": OWNER}, {"$setOnInsert": {"id": OWNER}}, upsert=True)

    files = []
    for slug, (outer, holes), qty in [
        ("piece_trou", host_geometry(), HOST_QTY),
        ("piece_fillx4", sector_geometry(), FILLER_QTY),
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

    job_slug = f"bench-holes-{int(time.time())}"
    db["nesting_jobs"].insert_one({
        "slug": job_slug,
        "projectSlug": "bench-project",
        "ownerId": OWNER,
        "files": files,
        "params": {
            "sheets": [SHEET],
            "width": SHEET["width"], "height": SHEET["height"], "sheetCount": SHEET["count"],
            "space": SPACE, "addOutShape": False,
            "directions": ["left", "bottom", "balanced"],
            "vcores": 4, "timeBudgetSec": BUDGET_SEC, "alternativesCount": 3,
            "computeLevel": "standard",
        },
        "status": "pending", "priority": 20, "createdAt": datetime.now(),
    })
    print(f"[holes] job {job_slug} ({BUDGET_SEC}s, sheet {SHEET['width']}x{SHEET['height']}, "
          f"{HOST_QTY} hosts + {FILLER_QTY} fillers, space {SPACE})", flush=True)

    deadline = time.time() + BUDGET_SEC + 240
    while time.time() < deadline:
        doc = db["nesting_jobs"].find_one({"slug": job_slug})
        if doc.get("status") in ("done", "error", "cancelled"):
            break
        time.sleep(5)

    doc = db["nesting_jobs"].find_one({"slug": job_slug})
    print(f"[holes] final status: {doc.get('status')}", flush=True)
    if doc.get("status") != "done":
        print(f"[holes] ERROR: {doc.get('error') or doc.get('information')}")
        sys.exit(1)

    slots = HOST_QTY * 4
    for i, alt in enumerate(doc.get("alternatives") or []):
        r = alt.get("report") or {}
        print(
            f"  #{i} {alt.get('strategy')!r}: nested={r.get('holesFilled')}/{slots} "
            f"used={alt.get('usedSheetShare', 0)*100:.1f}% gap={r.get('smallestGapMm')} "
            f"overlapFree={r.get('overlapFree')} spacingOk={r.get('spacingOk')} "
            f"iters={r.get('iterations')}",
            flush=True,
        )


if __name__ == "__main__":
    main()
