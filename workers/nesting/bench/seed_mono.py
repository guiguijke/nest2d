"""Banc mono-tôle (vérif 2026-09-04, plan correctif étape finale) :
1 tôle 1000×1000, 50 Piece_Trou + 250 Piece_Fillx4, fillHoles ON.

Deux modes (BENCH_MODE) :
- spp  : directions ['left'] → SPP (bande, single sheet, ratio aire OK).
         Exerce le solveur SPP + pré-passe meta + hole-fill + ALTERNATIVE
         GRILLE structurelle (SPP-only) — chemin non couvert par le banc
         2 tôles depuis le début du chantier multi-tôles.
- bpp  : directions ['left','bottom'] → BPP stock 1. Exerce les gardes
         mono-tôle du post-pass BPP : fill_residual_bands no-op (< 2
         layouts, contrat T8), compaction receveuse/donneuse skip.

Usage :
    docker run --rm -i --network nestorcut_nest2d \
        -e MONGO_URI=mongodb://mongo:27017/nest2d \
        -e BENCH_SPACE=0.1 -e BENCH_BUDGET=90 -e BENCH_MODE=spp \
        nest2d-nesting-worker:dev python - < bench/seed_mono.py
"""
import os
import sys
import time
from datetime import datetime

from pymongo import MongoClient

OWNER = "bench-user"
SHEET = {"width": 1000.0, "height": 1000.0, "count": 1}
BUDGET_SEC = int(os.environ.get("BENCH_BUDGET", "90"))
SPACE = float(os.environ.get("BENCH_SPACE", "0.1"))
MODE = os.environ.get("BENCH_MODE", "spp")
HOST_QTY = int(os.environ.get("BENCH_TRO_QTY", "50"))
FILLER_QTY = int(os.environ.get("BENCH_FILL_QTY", "250"))

sys.path.insert(0, "/app")
from bench.seed_user_repro import (  # noqa: E402
    filler_geometry, host_geometry, make_dxf,
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

    directions = ["left"] if MODE == "spp" else ["left", "bottom"]
    job_slug = f"bench-mono-{MODE}-{int(SPACE*10)}-{int(time.time())}"
    db["nesting_jobs"].insert_one({
        "slug": job_slug,
        "projectSlug": "bench-project",
        "ownerId": OWNER,
        "files": files,
        "params": {
            "sheets": [SHEET],
            "space": SPACE, "addOutShape": False, "fillHoles": True,
            "directions": directions,
            "vcores": 4, "timeBudgetSec": BUDGET_SEC, "alternativesCount": 1,
            "computeLevel": "standard",
        },
        "status": "pending", "priority": 20, "createdAt": datetime.now(),
    })
    print(f"JOB {job_slug}")


if __name__ == "__main__":
    main()
