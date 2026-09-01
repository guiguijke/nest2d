"""Localisation précise du remplissage BPP (constat user 2026-09-01,
2 tôles 1000x1000, 100 trous + 800 fans, space 0.1) :
  - classification des fans : dans-trou (pré-pass) vs libres (pass résiduel
    ou moteur) ;
  - carte d'occupation 10x10 par tôle (où sont les vides ?) ;
  - paires en chevauchement : catégories + positions ;
  - bande AABB / coins : pourquoi le coin TR est vide.
Usage : docker run --rm -i --network nestorcut_nest2d \
    -e MONGO_URI=... -e SPACE=0.1 -e SHEET_W=1000 -e SHEET_H=1000 \
    nest2d-nesting-worker:dev python - < bench/analyze_bpp_regions.py <slug>
"""
import math
import os
import re
import sys

sys.path.insert(0, "/app")
from pymongo import MongoClient
from shapely import affinity
from shapely.geometry import Polygon, Point
from shapely.strtree import STRtree

from bench.seed_user_repro import FILLER_RING, host_geometry

SPACE = float(os.environ.get("SPACE", "0.1"))
SHEET_W = float(os.environ.get("SHEET_W", "1000"))
SHEET_H = float(os.environ.get("SHEET_H", "1000"))
SIMPLIFY = 0.05

db = MongoClient(os.environ["MONGO_URI"]).get_default_database()
job = db["nesting_jobs"].find_one({"slug": sys.argv[1]})
alt = job["alternatives"][0]

outer, holes = host_geometry()
SHEET = Polygon([(0, 0), (SHEET_W, 0), (SHEET_W, SHEET_H), (0, SHEET_H)])


def parse_svg(svg):
    """-> list of dicts {kind, poly(world, y-up), tx, ty, rot}"""
    out = []
    for m in re.finditer(r'<path d="([^"]+)"([^>]*)>', svg):
        d, attrs = m.group(1), m.group(2)
        tm = re.search(r"translate\(([-\d.]+) ([\-.\d]+)\)", attrs)
        rm = re.search(r"rotate\(([-\d.]+)", attrs)
        if not tm:
            continue
        tx, ty = float(tm.group(1)), float(tm.group(2))
        rot = float(rm.group(1)) if rm else 0.0
        if d.startswith("M50.000 -50"):
            kind = "square"
            base = Polygon([(x, y) for x, y in outer],
                           [[(x, y) for x, y in h] for h in holes])
        elif d.startswith("M-19"):
            kind = "fan"
            base = Polygon([(x, y) for x, y in FILLER_RING])
        else:
            continue
        base = base.simplify(SIMPLIFY, preserve_topology=True)
        q = affinity.rotate(base, rot, origin=(0, 0))
        # SVG : monde = T . S(1,-1) . R(rot)
        q = affinity.affine_transform(q, [1, 0, 0, -1, 0, 0])
        q = affinity.translate(q, tx, ty)
        out.append({"kind": kind, "poly": q, "tx": tx, "ty": ty, "rot": rot})
    return out


for si, fname in enumerate(alt["svg_files"]):
    f = db["nestSvg.files"].find_one({"filename": fname})
    data = b"".join(c["data"] for c in
                    db["nestSvg.chunks"].find({"files_id": f["_id"]}).sort("n", 1))
    parts = parse_svg(data.decode("utf-8", "replace"))
    squares = [p for p in parts if p["kind"] == "square"]
    fans = [p for p in parts if p["kind"] == "fan"]
    print(f"\n=== TÔLE {si + 1} : {len(squares)} carrés + {len(fans)} fans ===")

    # hole rings (world) of this sheet's hosts
    hole_polys = []
    for sq in squares:
        for h in holes:
            hp = Polygon([(x, y) for x, y in h])
            hp = affinity.rotate(hp, sq["rot"], origin=(0, 0))
            hp = affinity.affine_transform(hp, [1, 0, 0, -1, 0, 0])
            hp = affinity.translate(hp, sq["tx"], sq["ty"])
            hole_polys.append(hp)

    in_hole = 0
    free_fans = []
    for fan in fans:
        c = fan["poly"].centroid
        if any(h.covers(Point(c)) for h in hole_polys):
            in_hole += 1
        else:
            free_fans.append(fan)
    print(f"fans dans un trou : {in_hole} | libres : {len(free_fans)}")

    # AABB des pièces pré-pass (carrés) et de tout
    def aabb(items):
        xs1 = ys1 = xs2 = ys2 = None
        for it in items:
            b = it["poly"].bounds
            xs1 = b[0] if xs1 is None else min(xs1, b[0])
            ys1 = b[1] if ys1 is None else min(ys1, b[1])
            xs2 = b[2] if xs2 is None else max(xs2, b[2])
            ys2 = b[3] if ys2 is None else max(ys2, b[3])
        return (xs1, ys1, xs2, ys2)

    if squares:
        a = aabb(squares)
        print(f"AABB carrés (pré-pass moteur) : x[{a[0]:.1f},{a[2]:.1f}] "
              f"y[{a[1]:.1f},{a[3]:.1f}]")
    if parts:
        a = aabb(parts)
        print(f"AABB toutes pièces : x[{a[0]:.1f},{a[2]:.1f}] y[{a[1]:.1f},{a[3]:.1f}]")

    # carte d'occupation 10x10 (centre de cellule couvert par une pièce ?)
    N = 10
    grid = [[0] * N for _ in range(N)]
    tree = STRtree([p["poly"] for p in parts])
    polys = [p["poly"] for p in parts]
    for gy in range(N):
        for gx in range(N):
            cx = (gx + 0.5) * SHEET_W / N
            cy = (gy + 0.5) * SHEET_H / N
            pt = Point(cx, cy)
            near = tree.query(pt.buffer(SPACE + 60))
            cov = any(polys[int(j)].covers(pt) for j in near)
            grid[gy][gx] = "#" if cov else "."
    print("carte occupation (haut=tête de tôle y élevé) :")
    for row in reversed(grid):
        print("   " + "".join(row))

    # positions des fans libres (pour voir les bandes)
    if free_fans:
        xs = sorted(round(f["poly"].centroid.x) for f in free_fans)
        ys = sorted(round(f["poly"].centroid.y) for f in free_fans)
        print(f"fans libres x[{xs[0]}..{xs[-1]}] y[{ys[0]}..{ys[-1]}]")

    # chevauchements : catégories + positions (vrais chevauchements d'aire,
    # pas la distance — les paires à space près sont le bruit simplify)
    overlaps = []
    for i, p in enumerate(polys):
        for j in tree.query(p.buffer(1.0)):
            j = int(j)
            if j <= i:
                continue
            inter = p.intersection(polys[j]).area
            if inter > 0.01:
                ka = parts[i]["kind"]
                kb = parts[j]["kind"]
                ca = parts[i]["poly"].centroid
                cb = parts[j]["poly"].centroid
                in_a = any(h.covers(Point(ca)) for h in hole_polys)
                in_b = any(h.covers(Point(cb)) for h in hole_polys)
                overlaps.append((ka, kb, round(inter, 1),
                                 "inHole" if in_a else "free",
                                 "inHole" if in_b else "free",
                                 (round(ca.x), round(ca.y)),
                                 (round(cb.x), round(cb.y))))
    print(f"paires en chevauchement (aire > 0.01) : {len(overlaps)}")
    for o in overlaps[:15]:
        print("   ", o)

    # poses EXACTEMENT dupliquées (rot, tx, ty) — signature d'un double-
    # attachement (expand ×2) plutôt que d'une collision d'optimisation
    from collections import defaultdict
    bypose = defaultdict(list)
    for p in parts:
        if p["kind"] != "fan":
            continue
        bypose[(round(p["rot"]), round(p["tx"], 1), round(p["ty"], 1))].append(p)
    dups = {k: v for k, v in bypose.items() if len(v) > 1}
    print(f"poses fan dupliquées à l'identique : {len(dups)}")
    for k, v in list(dups.items())[:8]:
        centres = [tuple(vv) for vv in v]
        # pose = trou plein ? (coïncide avec centre d'un trou)
        on_hole = any(
            any(abs(h.centroid.x - k[1]) < 2 and abs(h.centroid.y - k[2]) < 2
                for h in hole_polys) for _ in [0])
        print(f"    rot={k[0]} t=({k[1]},{k[2]}) × {len(v)} | sur centre de trou: {on_hole}")
    # multiplicité par trou : nb de fans dont le centroïde est dans CHAQUE trou
    per_hole = []
    for h in hole_polys:
        n = sum(1 for fan in fans if h.covers(Point(fan["poly"].centroid)))
        per_hole.append(n)
    print(f"fans par trou : {per_hole}")
