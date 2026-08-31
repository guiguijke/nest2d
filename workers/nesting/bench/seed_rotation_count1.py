"""Manuel M2 (plan P/Q audit 2026-08-31) : 100 Trou + 800 Fillx4, tôle
1000×2000, space 2, directions ['left'], rotations PAR FICHIER = [0]
(équivalent rotationCount=1). Après solve :
  - soit la grille est ABSENTE (repli moteur, légal) ;
  - soit elle est présente et TOUTE pose est à 0° (aucun fan tête-bêche).

Usage (worker image one-shot, cf. bench/README technique) :
    docker run --rm -i --network nestorcut_nest2d \
        -e MONGO_URI=mongodb://mongo:27017/nest2d \
        nest2d-nesting-worker:dev python - < bench/seed_rotation_count1.py
"""
import io
import math
import os
import sys
import time
from datetime import datetime

from pymongo import MongoClient

OWNER = "bench-user"
SHEET = {"width": 1000.0, "height": 2000.0, "count": 1}
BUDGET_SEC = int(os.environ.get("BENCH_BUDGET", "120"))
SPACE = 2.0

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
        ("m2_trou", host_geometry(), HOST_QTY),
        ("m2_fillx4", filler_geometry(), FILLER_QTY),
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
        # rotationCount=1 : uniquement 0° — le lattice ne doit JAMAIS poser
        # 180/90 ici (P-1).
        files.append({"slug": slug, "count": qty, "rotations": [0]})

    job_slug = f"bench-m2-rot0-{int(time.time())}"
    db["nesting_jobs"].insert_one({
        "slug": job_slug,
        "projectSlug": "bench-project",
        "ownerId": OWNER,
        "files": files,
        "params": {
            "sheets": [SHEET],
            "width": SHEET["width"], "height": SHEET["height"],
            "sheetCount": SHEET["count"],
            "space": SPACE, "addOutShape": False,
            "directions": ["left"],
            "vcores": 4, "timeBudgetSec": BUDGET_SEC, "alternativesCount": 3,
            "computeLevel": "standard",
        },
        "status": "pending", "priority": 20, "createdAt": datetime.now(),
    })
    print(f"JOB {job_slug}")


if __name__ == "__main__":
    main()
