"""Local bench: seed a realistic nesting job (croix occitane-like parts) into
Mongo and watch the worker solve it end-to-end. Run INSIDE the worker image:

    docker run --rm -i --network nest2d_nest2d \
        -e MONGO_URI=mongodb://mongo:27017/nest2d \
        nest2d-nesting-worker:dev python - < bench/seed_job.py

Prints the final alternatives with their directional tag and offcut shape so
direction diversity is verifiable objectively (left -> tall right band,
bottom -> wide top band).
"""
import io
import os
import sys
import time
from datetime import datetime

import ezdxf
from pymongo import MongoClient

OWNER = "bench-user"
SHEET = {"width": 1500.0, "height": 1000.0, "count": 1}
BUDGET_SEC = int(os.environ.get("BENCH_BUDGET", "25"))

# Plus-shaped cross with beveled arms (60x60 base, scaled per part size).
BASE = [
    (-10, -30), (10, -30), (10, -10), (30, -10), (30, 10), (10, 10),
    (10, 30), (-10, 30), (-10, 10), (-30, 10), (-30, -10), (-10, -10),
]

PARTS = [("croix400", 400.0, 3), ("croix250", 250.0, 3), ("croix100", 100.0, 50)]


def scaled_cross(size):
    k = size / 60.0
    return [(x * k, y * k) for x, y in BASE]


def make_dxf(points):
    doc = ezdxf.new("R2010")
    msp = doc.modelspace()
    ent = msp.add_lwpolyline(points, close=True)
    buf = io.StringIO()
    doc.write(buf)
    return buf.getvalue().encode("ascii", "ignore"), ent.dxf.handle


def main():
    db = MongoClient(os.environ["MONGO_URI"]).get_default_database()

    sys.path.insert(0, "/app")
    from worker_common.crypto import write_gridfs
    from worker_common.mongo import get_bucket

    bucket = get_bucket("validDxf")

    db["users"].update_one(
        {"id": OWNER},
        {"$setOnInsert": {"id": OWNER, "name": "Bench", "email": "bench@local"}},
        upsert=True,
    )

    files = []
    for slug, size, count in PARTS:
        coords = scaled_cross(size)
        dxf_bytes, handle = make_dxf(coords)
        write_gridfs(bucket, slug, dxf_bytes, OWNER, None)
        db["user_dxf_files"].update_one(
            {"slug": slug},
            {"$set": {
                "slug": slug,
                "ownerId": OWNER,
                "polygonParts": [{
                    "coordinates": [[x, y] for x, y in coords],
                    "holes": [],
                    "handles": [handle],
                }],
            }},
            upsert=True,
        )
        files.append({"slug": slug, "count": count, "rotations": [0, 90, 180, 270]})

    job_slug = f"bench-croix-{int(time.time())}"
    db["nesting_jobs"].insert_one({
        "slug": job_slug,
        "projectSlug": "bench-project",
        "ownerId": OWNER,
        "files": files,
        "params": {
            "sheets": [SHEET],
            "width": SHEET["width"],
            "height": SHEET["height"],
            "sheetCount": SHEET["count"],
            "space": 2.0,
            "addOutShape": False,
            "directions": ["left", "bottom", "balanced"],
            "vcores": 4,
            "timeBudgetSec": BUDGET_SEC,
            "alternativesCount": 3,
            "computeLevel": "standard",
        },
        "status": "pending",
        "priority": 20,
        "createdAt": datetime.now(),
    })
    print(f"[bench] job {job_slug} enqueued ({BUDGET_SEC}s budget)", flush=True)

    deadline = time.time() + BUDGET_SEC + 240
    while time.time() < deadline:
        doc = db["nesting_jobs"].find_one({"slug": job_slug})
        status = doc.get("status")
        if status in ("done", "error", "cancelled"):
            break
        progress = doc.get("progress") or {}
        print(f"[bench] {status}: {progress.get('stage')} {progress.get('pct')}%", flush=True)
        time.sleep(5)

    doc = db["nesting_jobs"].find_one({"slug": job_slug})
    print(f"[bench] final status: {doc.get('status')}", flush=True)
    if doc.get("status") != "done":
        print(f"[bench] ERROR: {doc.get('error') or doc.get('information')}", flush=True)
        sys.exit(1)

    alts = doc.get("alternatives") or []
    print(f"[bench] {len(alts)} alternatives:", flush=True)
    for i, alt in enumerate(alts):
        off = alt.get("offcut") or {}
        print(
            f"  #{i} strategy={alt.get('strategy')!r} density={alt.get('density'):.4f} "
            f"usedSheetShare={alt.get('usedSheetShare'):.4f} layouts={alt.get('layoutCount')} "
            f"offcut={off.get('width', 0):.0f}x{off.get('height', 0):.0f}",
            flush=True,
        )
    tags = [a.get("strategy") for a in alts]
    assert len(alts) == 3, f"expected 3 alternatives, got {len(alts)}: {tags}"
    assert len(set(tags)) == 3, f"alternatives not distinct: {tags}"
    print("[bench] OK — 3 distinct directional alternatives", flush=True)


if __name__ == "__main__":
    main()
