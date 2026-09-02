"""Validation physique des poses v2 (tôle 2 navigateur) — hélices + fans."""
import json
import math
import sys

sys.path.insert(0, "/app")
from shapely.affinity import rotate, translate
from shapely.geometry import Polygon
from shapely.strtree import STRtree
from bench.seed_user_repro import FILLER_RING, host_geometry

S = 0.1
outer, holes = host_geometry()
HOST_POLY = Polygon([(x, y) for x, y in outer],
                    [[(x, y) for x, y in h] for h in holes])
FAN_POLY = Polygon(FILLER_RING)

items = json.load(open("/tmp/v2items.json"))  # [kind, rot, tx, ty]
polys = []
for kind, rot, tx, ty in items:
    base = HOST_POLY if kind == 0 else FAN_POLY
    polys.append(translate(rotate(base, rot, origin=(0, 0)), tx, ty))

tree = STRtree(polys)
overlap = 0
too_close = 0
mind = 1e9
for i, p in enumerate(polys):
    for j in tree.query(p.buffer(S + 2)):
        j = int(j)
        if j <= i:
            continue
        d = p.distance(polys[j])
        mind = min(mind, d)
        if p.intersection(polys[j]).area > 0.005:
            overlap += 1
            if overlap <= 5:
                print(f"  CHEVAUCHEMENT {items[i]} vs {items[j]} aire={p.intersection(polys[j]).area:.2f}")
        elif d < S - 0.05:
            too_close += 1
print(f"pièces: {len(polys)} | chevauchements: {overlap} | trop près: {too_close} | min-dist: {mind:.4f}")
