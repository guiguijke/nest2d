"""Essais −Y seul et Mixed pour valider la logique du pass structurel
partout (demande user 2026-08-28). Réutilise les fixtures de seed_user_repro.

    docker run --rm -i --network nestorcut_nest2d \
        -e MONGO_URI=mongodb://mongo:27017/nest2d \
        -e BENCH_BUDGET=90 -e BENCH_SPACE=0.1 \
        nest2d-nesting-worker:dev python - < bench/seed_directions.py
"""
import os
import sys

sys.path.insert(0, "/app")
# Réutilise le seeding de seed_user_repro (exécuté via stdin, pas d'import).
IMPORTED = {}


def main():
    import json
    import time
    from datetime import datetime
    from pymongo import MongoClient

    OWNER = "bench-user"
    SHEET = {"width": 1000.0, "height": 2000.0, "count": 1}
    BUDGET = int(os.environ.get("BENCH_BUDGET", "90"))
    SPACE = float(os.environ.get("BENCH_SPACE", "0.1"))

    # Geometry fixtures inline (identiques à .testparts).
    exec(open("/dev/stdin").read() if False else "pass")

    import math
    import io
    import ezdxf

    FILLER_RING = json.loads(os.environ.get("BENCH_FILLER_RING", "null"))
    if FILLER_RING is None:
        # relancé via seed_user_repro pour l'amorçage ; ici on relit les
        # docs mongo seedés par un précédent seed_user_repro.
        pass

    db = MongoClient(os.environ["MONGO_URI"]).get_default_database()

    def seed_job(tag, directions):
        files = [
            {"slug": "piece_trou", "count": 100, "rotations": [0, 90, 180, 270]},
            {"slug": "piece_fillx4", "count": 800, "rotations": [0, 90, 180, 270]},
        ]
        job_slug = f"bench-dirs-{tag}-{int(time.time())}"
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
                "directions": directions,
                "vcores": 4, "timeBudgetSec": BUDGET,
                "alternativesCount": max(1, len(directions)),
                "computeLevel": "standard",
            },
            "status": "pending", "priority": 20, "createdAt": datetime.now(),
        })
        return job_slug

    def wait(job_slug):
        deadline = time.time() + BUDGET + 600
        while time.time() < deadline:
            doc = db["nesting_jobs"].find_one({"slug": job_slug})
            if doc.get("status") in ("done", "error", "cancelled"):
                return doc
            time.sleep(5)
        return db["nesting_jobs"].find_one({"slug": job_slug})

    for tag, dirs in [("bottom", ["bottom"]),
                      ("mixed", ["left", "bottom", "balanced"])]:
        slug = seed_job(tag, dirs)
        print(f"[{tag}] {slug} dirs={dirs}", flush=True)
        doc = wait(slug)
        print(f"=== {tag}: status={doc.get('status')} placed={doc.get('placed')}", flush=True)
        if doc.get("status") != "done":
            print("  info:", doc.get("information"), flush=True)
            continue
        for i, a in enumerate(doc.get("alternatives") or []):
            print(f"  #{i} {a.get('strategy')}: usedShare={a.get('usedSheetShare', 0)*100:.1f}% "
                  f"density={a.get('density')}", flush=True)


if __name__ == "__main__":
    main()
