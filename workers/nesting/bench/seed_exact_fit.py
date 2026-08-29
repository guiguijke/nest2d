"""Repro du cas utilisateur 2026-08-28 : 100 Piece_Trou + 800 Piece_Fillx4,
tôle 1000x2000, space 0.1 mm.

Deux jobs :
  A. directions ['left']     — le run local "THIS DEVICE" vu à 55.4 % (mauvais)
  B. directions ['left','bottom','balanced'] — le run multi vu à 88.1 % (bon)

Compare la qualité finale (usedSheetShare, densité, largeur de bande utilisée)
pour diagnostiquer pourquoi le run −X seul sort un agencement dégradé.

    docker run --rm -i --network nestorcut_nest2d \
        -e MONGO_URI=mongodb://mongo:27017/nest2d \
        nest2d-nesting-worker:dev python - < bench/seed_user_repro.py
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
BUDGET_SEC = int(os.environ.get("BENCH_BUDGET", "120"))
SPACE = float(os.environ.get("BENCH_SPACE", "0.1"))

HOST_QTY = int(os.environ.get("BENCH_HOSTS", "100"))
FILLER_QTY = int(os.environ.get("BENCH_FILLERS", "800"))

# Piece_Fillx4 fixture ring (même géométrie que .testparts/Piece_Fillx4.DXF).
FILLER_RING = [[-19.799,22.6274],[-19.4618,22.959],[-19.119,23.2848],[-18.7708,23.6048],[-18.4172,23.9189],[-18.0584,24.2269],[-17.6944,24.5289],[-17.3253,24.8246],[-16.9514,25.1141],[-16.5726,25.3972],[-16.189,25.6739],[-15.8009,25.9441],[-15.4082,26.2076],[-15.0111,26.4645],[-14.6098,26.7147],[-14.2043,26.958],[-13.7947,27.1945],[-13.3812,27.424],[-12.9639,27.6465],[-12.5429,27.8619],[-12.1183,28.0702],[-11.6903,28.2713],[-11.2589,28.4651],[-10.8243,28.6516],[-10.3866,28.8307],[-9.9459,29.0024],[-9.5025,29.1667],[-9.0563,29.3234],[-8.6075,29.4726],[-8.1563,29.6142],[-7.7027,29.7481],[-7.2469,29.8744],[-6.7891,29.9929],[-6.3293,30.1037],[-5.8678,30.2067],[-5.4045,30.3019],[-4.9398,30.3892],[-4.4736,30.4687],[-4.0061,30.5404],[-3.5375,30.6041],[-3.0679,30.6599],[-2.5974,30.7077],[-2.1261,30.7476],[-1.6543,30.7795],[-1.182,30.8035],[-0.7093,30.8194],[-0.2365,30.8274],[0.2365,30.8274],[0.7093,30.8194],[1.182,30.8035],[1.6543,30.7795],[2.1261,30.7476],[2.5974,30.7077],[3.0679,30.6599],[3.5375,30.6041],[4.0061,30.5404],[4.4736,30.4687],[4.9398,30.3892],[5.4045,30.3019],[5.8678,30.2067],[6.3293,30.1037],[6.7891,29.9929],[7.2469,29.8744],[7.7027,29.7481],[8.6075,29.4726],[9.0563,29.3234],[9.5025,29.1667],[9.9459,29.0024],[10.3866,28.8307],[10.8243,28.6516],[11.2589,28.4651],[11.6903,28.2713],[12.1183,28.0702],[12.5429,27.8619],[12.9639,27.6465],[13.3812,27.424],[13.7947,27.1945],[14.2043,26.958],[14.6098,26.7147],[15.0111,26.4645],[15.4082,26.2076],[15.8009,25.9441],[16.189,25.6739],[16.5726,25.3972],[16.9514,25.1141],[17.3253,24.8246],[17.6944,24.5289],[18.0584,24.2269],[18.4172,23.9189],[18.7708,23.6048],[19.119,23.2848],[19.4618,22.959],[19.799,22.6274],[0.0,2.8284],[-19.799,22.6274]]


def circle_ring(cx, cy, r, n=416):
    pts = [(cx + r * math.cos(2 * math.pi * i / n), cy + r * math.sin(2 * math.pi * i / n)) for i in range(n)]
    pts.append(pts[0])
    return pts


def host_geometry():
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


def seed_job(db, tag, directions):
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

    job_slug = f"bench-userrepro-{tag}-{int(time.time())}"
    db["nesting_jobs"].insert_one({
        "slug": job_slug,
        "projectSlug": "bench-project",
        "ownerId": OWNER,
        "files": files,
        "params": {
            "sheets": [SHEET],
            "width": SHEET["width"], "height": SHEET["height"], "sheetCount": SHEET["count"],
            "space": SPACE, "addOutShape": False,
            "directions": directions,
            "vcores": 4, "timeBudgetSec": BUDGET_SEC, "alternativesCount": 3,
            "computeLevel": "standard",
        },
        "status": "pending", "priority": 20, "createdAt": datetime.now(),
    })
    return job_slug


def wait_job(db, job_slug):
    deadline = time.time() + BUDGET_SEC + 420
    last_progress = None
    while time.time() < deadline:
        doc = db["nesting_jobs"].find_one({"slug": job_slug})
        prog = doc.get("progress") or {}
        key = (prog.get("stage"), prog.get("done"))
        if key != last_progress:
            last_progress = key
            print(f"  [{tag}] {prog.get('label') or key}", flush=True)
        if doc.get("status") in ("done", "error", "cancelled"):
            return doc
        time.sleep(3)
    return db["nesting_jobs"].find_one({"slug": job_slug})


def report(tag, doc):
    print(f"\n=== {tag}: status={doc.get('status')} placed={doc.get('placed')}/{doc.get('requested')}", flush=True)
    if doc.get("status") != "done":
        print(f"  information: {doc.get('information')}", flush=True)
        return
    for i, alt in enumerate(doc.get("alternatives") or []):
        r = alt.get("report") or {}
        print(
            f"  #{i} {alt.get('strategy')!r}: usedSheetShare={alt.get('usedSheetShare', 0)*100:.1f}% "
            f"density={alt.get('density')} overlapFree={r.get('overlapFree')} "
            f"spacingOk={r.get('spacingOk')} iters={r.get('iterations')}",
            flush=True,
        )
        for s in r.get("sheets") or []:
            print(f"    sheet: densityPct={s.get('densityPct')} partCount={s.get('partCount')}", flush=True)


if __name__ == "__main__":
    db = MongoClient(os.environ["MONGO_URI"]).get_default_database()
    import json
    dirs = json.loads(os.environ.get("BENCH_DIRS", '["left"]'))
    for tag, dirs in [("exact-fit", dirs)]:
        slug = seed_job(db, tag.lower().replace("-", ""), dirs)
        print(f"[{tag}] job {slug} seeded (space {SPACE}, budget {BUDGET_SEC}s, dirs {dirs})", flush=True)
        doc = wait_job(db, slug)
        report(tag, doc)
