"""Repro multi-tôles (constat user 2026-08-31) : 2 tôles 1000×1000 (stock 2
du même format), 100 Piece_Trou + 800 Piece_Fillx4, fillHoles ON → BPP.
Constat attendu : tôle 1 = hélices seules + bande L vide, tôle 2 = hélices
restantes + TOUS les fans restants.

Usage :
    docker run --rm -i --network nestorcut_nest2d \
        -e MONGO_URI=mongodb://mongo:27017/nest2d \
        -e BENCH_SPACE=2 -e BENCH_BUDGET=120 \
        nest2d-nesting-worker:dev python - < bench/seed_bpp_2sheets.py
"""
import os
import sys
import time
from datetime import datetime

from pymongo import MongoClient

OWNER = "bench-user"
SHEET = {"width": 1000.0, "height": 1000.0, "count": 2}
BUDGET_SEC = int(os.environ.get("BENCH_BUDGET", "120"))
SPACE = float(os.environ.get("BENCH_SPACE", "2"))

sys.path.insert(0, "/app")
from bench.seed_user_repro import (  # noqa: E402
    HOST_QTY, FILLER_QTY, filler_geometry, host_geometry, make_dxf,
)


def main():
    mongo = MongoClient(os.environ["MONGO_URI"])
    db = mongo.get_default_database()
    from worker_common.crypto import write_gridfs
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

    job_slug = f"bench-bpp2s-{int(SPACE*10)}-{int(time.time())}"
    db["nesting_jobs"].insert_one({
        "slug": job_slug,
        "projectSlug": "bench-project",
        "ownerId": OWNER,
        "files": files,
        "params": {
            "sheets": [SHEET],
            "space": SPACE, "addOutShape": False, "fillHoles": True,
            "directions": ["left"],
            "vcores": 4, "timeBudgetSec": BUDGET_SEC, "alternativesCount": 1,
            "computeLevel": "standard",
        },
        "status": "pending", "priority": 20, "createdAt": datetime.now(),
    })
    print(f"JOB {job_slug}")


if __name__ == "__main__":
    main()
