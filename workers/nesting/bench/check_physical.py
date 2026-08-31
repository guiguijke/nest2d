"""Vérification physique EXHAUSTIVE d'une alternative livrée (M1/M2 du plan
P/Q audit 2026-08-31) — adaptation paramétrée de verify_grid.py :
  - distances + chevauchements + hors tôle sur TOUTES les pièces (STRtree) ;
  - histogramme des ROTATIONS posées (verrou P-1 : rotations ∈ permises).

Usage (one-shot worker image) :
    docker run --rm -i --network nestorcut_nest2d \
        -e MONGO_URI=mongodb://mongo:27017/nest2d \
        -e SPACE=2 -e STRAT=grid \
        nest2d-nesting-worker:dev python - < bench/check_physical.py <slug>
"""
import math
import os
import re
import sys
from collections import Counter

sys.path.insert(0, "/app")
from pymongo import MongoClient
from shapely import affinity
from shapely.geometry import Polygon
from shapely.strtree import STRtree

from bench.seed_user_repro import FILLER_RING, host_geometry

SPACE = float(os.environ.get("SPACE", "2"))
STRAT = os.environ.get("STRAT", "grid")

db = MongoClient(os.environ["MONGO_URI"]).get_default_database()
job = db["nesting_jobs"].find_one({"slug": sys.argv[1]})
alts = [a for a in job["alternatives"] if a.get("strategy") == STRAT]
if not alts:
    print(f"VERDICT: PAS d'alternative '{STRAT}' (repli moteur) — statuts: "
          f"{[a.get('strategy') for a in job['alternatives']]}")
    sys.exit(0)
alt = alts[0]
f = db["nestSvg.files"].find_one({"filename": alt["svg_files"][0]})
data = b"".join(c["data"] for c in db["nestSvg.chunks"].find(
    {"files_id": f["_id"]}).sort("n", 1))
svg = data.decode("utf-8", "replace")

outer, holes = host_geometry()
SQ = Polygon([(x, y) for x, y in outer],
             [[(x, y) for x, y in h] for h in holes]).buffer(0)
FANP = Polygon([(x, y) for x, y in FILLER_RING]).simplify(0.05, True)
SHEET = Polygon([(0, 0), (1000, 0), (1000, 2000), (0, 2000)])

polys = []
n_sq = n_fan = 0
rots = Counter()
for m in re.finditer(r'<path d="([^"]+)"([^>]*)>', svg):
    d, attrs = m.group(1), m.group(2)
    tm = re.search(r'translate\(([-\d.]+) ([\-.\d]+)\)', attrs)
    rm = re.search(r'rotate\(([-\d.]+)', attrs)
    if not tm:
        continue
    tx, ty = float(tm.group(1)), float(tm.group(2))
    rot = float(rm.group(1)) if rm else 0.0
    if d.startswith("M50.000 -50"):
        base = SQ
        n_sq += 1
        rots[f"square:{rot % 360:.0f}"] += 1
    elif d.startswith("M-19"):
        base = FANP
        n_fan += 1
        rots[f"fan:{rot % 360:.0f}"] += 1
    else:
        continue
    q = affinity.rotate(base, rot, origin=(0, 0))
    q = affinity.affine_transform(q, [1, 0, 0, -1, 0, 0])
    q = affinity.translate(q, tx, ty)
    polys.append(q)

print(f"pièces : {n_sq} carrés + {n_fan} fans = {len(polys)}")
print(f"rotations posées : {dict(rots)}")

tree = STRtree(polys)
overlap = too_close = 0
mind = 1e9
for i, p in enumerate(polys):
    for j in tree.query(p.buffer(SPACE + 1.0)):
        j = int(j)
        if j <= i:
            continue
        d = p.distance(polys[j])
        mind = min(mind, d)
        if p.intersection(polys[j]).area > 0.01:
            overlap += 1
        elif d < SPACE - 1e-6:
            too_close += 1
outside = sum(1 for p in polys if not SHEET.covers(p))
print(f"chevauchements: {overlap} | trop près (<{SPACE}mm): {too_close} | "
      f"min-dist: {mind:.4f} | hors tôle: {outside}")
print(f"VERDICT: {'OK' if overlap == 0 and outside == 0 else 'ÉCHEC'} "
      f"(usedSheetShare={alt.get('usedSheetShare')}, "
      f"density={alt.get('density')})")
