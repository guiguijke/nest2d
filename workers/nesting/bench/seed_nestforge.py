"""Extract the 4 demo part geometries from NestForge's output DXF and seed a
comparison job into the bench Mongo with THEIR sheet (600x400) and quantities
(bracket x2, disc x2, L-plate x2, cam x1). Prints our alternatives vs their
10.3% utilization for an apples-to-apples engine comparison.

    docker run --rm -i --network nest2d_nest2d \
        -e MONGO_URI=mongodb://mongo:27017/nest2d \
        -v <repo>/.zcode:/bench_in \
        nest2d-nesting-worker:dev python - < bench/seed_nestforge.py
"""
import io
import json
import math
import os
import sys
import time
from datetime import datetime

from pymongo import MongoClient

OWNER = "bench-user"
BUDGET_SEC = int(os.environ.get("BENCH_BUDGET", "30"))
DXF_JSON = os.environ.get("NESTFORGE_JSON", "/bench_in/nestforge_parts.json")

# ---------------------------------------------------------------- bulge math
def bulge_arc(p0, p1, b):
    """Sample the arc from p0 to p1 with bulge b (signed included angle
    theta = 4*atan(b), >0 = CCW). Radius r is SIGNED in the standard formula
    (negative for b<0): it must drive the center position (signed apothem)
    but only its ABSOLUTE value the point sampling — sampling with a signed
    radius mirrors the arc and produces self-intersecting rings."""
    if abs(b) < 1e-12:
        return [p1]
    (x0, y0), (x1, y1) = p0, p1
    dx, dy = x1 - x0, y1 - y0
    d = math.hypot(dx, dy)
    theta = 4.0 * math.atan(b)
    r = d / (2.0 * math.sin(theta / 2.0))      # signed
    h = r * math.cos(theta / 2.0)              # signed apothem
    mx, my = (x0 + x1) / 2.0, (y0 + y1) / 2.0
    px, py = -dy / d, dx / d                   # left normal of the chord
    cx, cy = mx + px * h, my + py * h
    radius = abs(r)
    a0 = math.atan2(y0 - cy, x0 - cx)
    steps = max(4, int(abs(theta) / (math.pi / 36)) + 1)  # ~5 deg steps
    return [
        (cx + radius * math.cos(a0 + theta * (i / steps)),
         cy + radius * math.sin(a0 + theta * (i / steps)))
        for i in range(1, steps + 1)
    ]


def ring_points(ent):
    """Entity (verts + bulges) -> sampled closed ring."""
    verts = [tuple(v) for v in ent["verts"]]
    ring = []
    n = len(verts)
    for i in range(n):
        p0 = verts[i]
        p1 = verts[(i + 1) % n]
        ring.append(p0)
        b = ent["bulges"].get(str(i), ent["bulges"].get(i, 0.0))
        if b:
            ring.extend(bulge_arc(p0, p1, b)[:-1])
    return ring


def centroid(ring):
    return (sum(p[0] for p in ring) / len(ring), sum(p[1] for p in ring) / len(ring))


def main():
    entities = json.load(open(DXF_JSON))
    parts_ents = [e for e in entities if e["layer"] == "PARTS"]

    # Group entities into parts: small full-circle entities (2 pts, |bulge|=1)
    # fully inside a bigger entity's bbox are that part's holes.
    rings = [(e, ring_points(e)) for e in parts_ents]

    def bbox(ring):
        xs = [p[0] for p in ring]
        ys = [p[1] for p in ring]
        return min(xs), min(ys), max(xs), max(ys)

    def is_circle(e):
        return len(e["verts"]) == 2 and all(abs(b) == 1.0 for b in e["bulges"].values())

    def contains_bb(outer_bb, inner_bb, eps=1e-6):
        x0, y0, x1, y1 = outer_bb
        ix0, iy0, ix1, iy1 = inner_bb
        return (ix0 >= x0 - eps and iy0 >= y0 - eps
                and ix1 <= x1 + eps and iy1 <= y1 + eps)

    # Parts = non-circle entities + circles contained in nothing larger.
    # Holes = circles strictly inside a larger part (smallest host wins).
    # Circles are processed largest-first so disc outers exist before bores.
    circles = sorted(
        [(e, r) for e, r in rings if is_circle(e)],
        key=lambda er: -( (bbox(er[1])[2]-bbox(er[1])[0]) * (bbox(er[1])[3]-bbox(er[1])[1]) ),
    )
    parts = [{"outer": r, "holes": [], "bbox": bbox(r)} for e, r in rings if not is_circle(e)]

    for e, ring in circles:
        bb = bbox(ring)
        host = None
        for p in parts:
            pb = p["bbox"]
            larger = (pb[2] - pb[0] > bb[2] - bb[0] + 1e-6) or (pb[3] - pb[1] > bb[3] - bb[1] + 1e-6)
            if larger and contains_bb(pb, bb):
                area = (pb[2] - pb[0]) * (pb[3] - pb[1])
                if host is None or area < (host["bbox"][2] - host["bbox"][0]) * (host["bbox"][3] - host["bbox"][1]):
                    host = p
        if host is None:
            parts.append({"outer": ring, "holes": [], "bbox": bb})
        else:
            host["holes"].append(ring)

    # Cluster parts by normalized shape signature (bbox dims + point count)
    # to recover the 4 unique types and their quantities.
    def signature(p):
        x0, y0, x1, y1 = p["bbox"]
        return (round(x1 - x0), round(y1 - y0), len(p["outer"]), len(p["holes"]))

    types = {}
    for p in parts:
        types.setdefault(signature(p), []).append(p)

    print(f"[nestforge] {len(parts)} parts, {len(types)} unique types:")
    unique = []
    for sig, group in sorted(types.items(), key=lambda kv: -len(kv[1])):
        rep = group[0]
        print(f"  {sig} x{len(group)}")
        unique.append({"outer": rep["outer"], "holes": rep["holes"], "qty": len(group)})

    # Normalize each unique type to the origin (translation only).
    for u in unique:
        x0 = min(p[0] for p in u["outer"])
        y0 = min(p[1] for p in u["outer"])
        u["outer"] = [(x - x0, y - y0) for x, y in u["outer"]]
        u["holes"] = [[(x - x0, y - y0) for x, y in h] for h in u["holes"]]

    # ------------------------------------------------------- seed bench job
    db = MongoClient(os.environ["MONGO_URI"]).get_default_database()
    db["users"].update_one({"id": OWNER}, {"$setOnInsert": {"id": OWNER}}, upsert=True)

    import ezdxf
    from worker_common.crypto import write_gridfs
    from worker_common.mongo import get_bucket

    bucket = get_bucket("validDxf")
    files = []
    for i, u in enumerate(unique):
        slug = f"nf-part{i}"
        doc = ezdxf.new("R2010")
        msp = doc.modelspace()
        handles = []
        handles.append(msp.add_lwpolyline(u["outer"], close=True).dxf.handle)
        for h in u["holes"]:
            handles.append(msp.add_lwpolyline(h, close=True).dxf.handle)
        buf = io.StringIO()
        doc.write(buf)
        write_gridfs(bucket, slug, buf.getvalue().encode("ascii", "ignore"), OWNER, None)
        db["user_dxf_files"].update_one(
            {"slug": slug},
            {"$set": {
                "slug": slug,
                "ownerId": OWNER,
                "polygonParts": [{
                    "coordinates": [[x, y] for x, y in u["outer"]],
                    "holes": [[[x, y] for x, y in h] for h in u["holes"]],
                    "handles": handles,
                }],
            }},
            upsert=True,
        )
        files.append({"slug": slug, "count": u["qty"], "rotations": [0, 90, 180, 270]})

    job_slug = f"bench-nestforge-{int(time.time())}"
    db["nesting_jobs"].insert_one({
        "slug": job_slug,
        "projectSlug": "bench-project",
        "ownerId": OWNER,
        "files": files,
        "params": {
            "sheets": [{"width": 600.0, "height": 400.0, "count": 1}],
            "width": 600.0, "height": 400.0, "sheetCount": 1,
            "space": 2.0, "addOutShape": False,
            "directions": ["left", "bottom", "balanced"],
            "vcores": 4, "timeBudgetSec": BUDGET_SEC, "alternativesCount": 3,
            "computeLevel": "standard",
        },
        "status": "pending", "priority": 20, "createdAt": datetime.now(),
    })
    print(f"[nestforge] job {job_slug} enqueued ({BUDGET_SEC}s, sheet 600x400)", flush=True)

    deadline = time.time() + BUDGET_SEC + 240
    while time.time() < deadline:
        doc = db["nesting_jobs"].find_one({"slug": job_slug})
        if doc.get("status") in ("done", "error", "cancelled"):
            break
        time.sleep(5)

    doc = db["nesting_jobs"].find_one({"slug": job_slug})
    print(f"[nestforge] final status: {doc.get('status')}", flush=True)
    if doc.get("status") != "done":
        print(f"[nestforge] ERROR: {doc.get('error') or doc.get('information')}")
        sys.exit(1)

    sheet_area = 600.0 * 400.0
    for i, alt in enumerate(doc.get("alternatives") or []):
        off = alt.get("offcut") or {}
        used = alt.get("usedSheetShare") or 0
        print(
            f"  #{i} {alt.get('strategy')!r}: used={used*100:.2f}% "
            f"(vs nestforge 10.30%) offcut={off.get('width', 0):.0f}x{off.get('height', 0):.0f} "
            f"density={alt.get('density'):.4f}",
            flush=True,
        )


if __name__ == "__main__":
    main()
