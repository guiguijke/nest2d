"""Repro: run nesting_process in-process inside the worker image and spy on
the engine config actually sent to nest-engine.

    docker run --rm -i --network nest2d_nest2d \
        -e MONGO_URI=mongodb://mongo:27017/nest2d \
        nest2d-nesting-worker:dev python - < bench/repro_pipeline.py
"""
import io
import os
import sys
import time
from datetime import datetime

sys.path.insert(0, "/app")

import ezdxf
from pymongo import MongoClient

OWNER = "bench-user"
SHEET = {"width": 1500.0, "height": 1000.0, "count": 1}
BUDGET_SEC = int(os.environ.get("BENCH_BUDGET", "10"))

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

    from worker_common.crypto import write_gridfs
    from worker_common.mongo import get_bucket

    bucket = get_bucket("validDxf")
    db["users"].update_one({"id": OWNER}, {"$setOnInsert": {"id": OWNER}}, upsert=True)

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

    job_slug = f"bench-repro-{int(time.time())}"
    doc = {
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
        "status": "processing",
        "priority": 20,
        "createdAt": datetime.now(),
    }
    res = db["nesting_jobs"].insert_one(doc)
    doc["_id"] = res.inserted_id

    # Spy on the engine config actually passed to run_engine.
    import core.main as m

    orig_run_engine = m.run_engine
    captured = {}

    def spy(instance, engine_config, *args, **kwargs):
        captured["config"] = engine_config
        captured["problem_type"] = args[0] if args else kwargs.get("problem_type")
        # Dump for manual engine replay (diagnostics).
        import json as _json
        with open("/tmp/spy_instance.json", "w") as f:
            _json.dump(instance, f)
        with open("/tmp/spy_config.json", "w") as f:
            _json.dump(engine_config, f)
        return orig_run_engine(instance, engine_config, *args, **kwargs)

    m.run_engine = spy

    m.nesting_process(doc)

    cfg = captured.get("config") or {}
    print(f"[repro] problem_type={captured.get('problem_type')}")
    print(f"[repro] config keys={sorted(cfg.keys())}")
    print(f"[repro] biases={cfg.get('biases')} n_workers={cfg.get('n_workers')} "
          f"plateau={cfg.get('plateau_patience_sec')}")

    final = db["nesting_jobs"].find_one({"_id": res.inserted_id})
    for i, alt in enumerate(final.get("alternatives") or []):
        print(f"[repro] alt#{i} strategy={alt.get('strategy')!r} density={alt.get('density'):.4f}")


if __name__ == "__main__":
    main()
