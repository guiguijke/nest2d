"""Manuels M3/M4 (plan P/Q audit 2026-08-31) : la garde de faisabilité
`w + 2·space` (Q-1) en e2e.

  M3 : 1 pièce 998×998, tôle 1000×1000, space 2 → job ERROR propre avec le
       message « Part(s) too large… », worker VIVANT (avant le fix :
       panique SPP lbf.rs « strip-width is running away », panic=abort).
  M4 : 1 pièce 100×100, tôle 1000×2000, space 2 → done 1/1 (contrôle
       négatif : la garde ne rejette pas ce qui rentre VRAIMENT).

Env BENCH_CASE=reject|control (défaut : reject).

Usage :
    docker run --rm -i --network nestorcut_nest2d \
        -e MONGO_URI=mongodb://mongo:27017/nest2d \
        nest2d-nesting-worker:dev python - < bench/seed_near_fit.py
"""
import io
import os
import time
from datetime import datetime

from pymongo import MongoClient

OWNER = "bench-user"


def main():
    case = os.environ.get("BENCH_CASE", "reject")
    if case == "reject":
        # M3 : 998 + 2×2 = 1002 > 1000 → rejet attendu (message, pas de crash)
        part = 998.0
        sheet = {"width": 1000.0, "height": 1000.0, "count": 1}
    else:
        # M4 : 100 + 2×2 = 104 ≤ 1000 → nest normal
        part = 100.0
        sheet = {"width": 1000.0, "height": 2000.0, "count": 1}

    mongo = MongoClient(os.environ["MONGO_URI"])
    db = mongo.get_default_database()
    from worker_common.crypto import write_gridfs
    from worker_common.mongo import get_bucket

    import ezdxf
    ring = [[0.0, 0.0], [part, 0.0], [part, part], [0.0, part], [0.0, 0.0]]
    doc = ezdxf.new("R2010")
    msp = doc.modelspace()
    handles = [msp.add_lwpolyline(ring, close=True).dxf.handle]
    buf = io.StringIO()
    doc.write(buf)
    dxf_bytes = buf.getvalue().encode("ascii", "ignore")

    slug = f"m{3 if case == 'reject' else 4}_carre"
    bucket = get_bucket("validDxf")
    db["users"].update_one({"id": OWNER}, {"$setOnInsert": {"id": OWNER}}, upsert=True)
    write_gridfs(bucket, slug, dxf_bytes, OWNER, None)
    db["user_dxf_files"].update_one(
        {"slug": slug},
        {"$set": {
            "slug": slug,
            "ownerId": OWNER,
            "polygonParts": [{
                "coordinates": [[x, y] for x, y in ring],
                "holes": [],
                "handles": handles,
            }],
        }},
        upsert=True,
    )

    job_slug = f"bench-m{3 if case == 'reject' else 4}-nearfit-{int(time.time())}"
    db["nesting_jobs"].insert_one({
        "slug": job_slug,
        "projectSlug": "bench-project",
        "ownerId": OWNER,
        "files": [{"slug": slug, "count": 1, "rotations": [0]}],
        "params": {
            "sheets": [sheet],
            "width": sheet["width"], "height": sheet["height"],
            "sheetCount": 1,
            "space": 2.0, "addOutShape": False,
            "directions": ["left"],
            "vcores": 2, "timeBudgetSec": 20, "alternativesCount": 1,
            "computeLevel": "standard",
        },
        "status": "pending", "priority": 20, "createdAt": datetime.now(),
    })
    print(f"JOB {job_slug}")


if __name__ == "__main__":
    main()
