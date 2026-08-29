"""Vérification physique EXHAUSTIVE du layout grille 100/800 (paires
skippées par verify_layout au-delà de 250 pièces) : distances + chevauch.
+ espace aux parois, sur les 900 pièces."""
import re, sys, math
sys.path.insert(0, "/app")
from pymongo import MongoClient
from bson import ObjectId
from shapely.geometry import Polygon
from shapely import affinity
from shapely.strtree import STRtree
from bench.seed_user_repro import FILLER_RING, host_geometry

db = MongoClient("mongodb://mongo:27017/nest2d").get_default_database()
job = db["nesting_jobs"].find_one({"slug": sys.argv[1]})
import os
alt = [a for a in job["alternatives"] if a.get("strategy") == os.environ.get("STRAT", "grid")][0]
f = db["nestSvg.files"].find_one({"filename": alt["svg_files"][0]})
data = b"".join(c["data"] for c in db["nestSvg.chunks"].find({"files_id": f["_id"]}).sort("n", 1))
svg = data.decode("utf-8", "replace")

outer, holes = host_geometry()
SQ = Polygon([(x, y) for x, y in outer], [[(x, y) for x, y in h] for h in holes]).simplify(0.05, True).buffer(0)
SQ = Polygon([(x, y) for x, y in outer], [[(x, y) for x, y in h] for h in holes]) if not SQ.is_valid else SQ
FANP = Polygon([(x, y) for x, y in FILLER_RING]).simplify(0.05, True)
SHEET = Polygon([(0, 0), (1000, 0), (1000, 2000), (0, 2000)])

polys = []
n_sq = n_fan = 0
for m in re.finditer(r'<path d="([^"]+)"([^>]*)>', svg):
    d, attrs = m.group(1), m.group(2)
    tm = re.search(r'translate\(([-\d.]+) ([\-.\d]+)\)', attrs)
    rm = re.search(r'rotate\(([-\d.]+)', attrs)
    if not tm: continue
    tx, ty = float(tm.group(1)), float(tm.group(2))
    rot = float(rm.group(1)) if rm else 0.0
    if d.startswith("M50.000 -50"):
        base = SQ; n_sq += 1
    elif d.startswith("M-19"):
        base = FANP; n_fan += 1
    else:
        continue
    # SVG : monde = T . S(1,-1) . R(rot) — reconstituer le polygone monde
    r = math.radians(rot)
    q = affinity.rotate(base, rot, origin=(0, 0))
    q = affinity.affine_transform(q, [1, 0, 0, -1, 0, 0])  # scale(1,-1)
    q = affinity.translate(q, tx, ty)
    polys.append(q)
print(f"pièces : {n_sq} carrés + {n_fan} fans = {len(polys)}")

tree = STRtree(polys)
S = 0.1
overlap = 0
too_close = 0
mind = 1e9
from collections import Counter
cats = Counter()
samples = []
for i, p in enumerate(polys):
    for j in tree.query(p.buffer(S + 1.0)):
        j = int(j)
        if j <= i: continue
        d = p.distance(polys[j])
        mind = min(mind, d)
        if p.intersection(polys[j]).area > 0.01:
            overlap += 1
        elif d < S - 1e-6:
            too_close += 1
            ka = "sq" if i < n_sq else "fan"
            kb = "sq" if j < n_sq else "fan"
            cats[f"{ka}-{kb}"] += 1
            if len(samples) < 6:
                b1 = p.bounds; b2 = polys[j].bounds
                samples.append((ka, kb, round(d, 4), [round(v,1) for v in b1], [round(v,1) for v in b2]))
print("catégories:", dict(cats))
for smp in samples:
    print("  ", smp)
outside = sum(1 for p in polys if not SHEET.covers(p))
print(f"chevauchements: {overlap} | trop près (<{S}mm): {too_close} | min-dist: {mind:.4f} | hors tôle: {outside}")
