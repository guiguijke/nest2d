"""Vérif physique générique : polygones lus depuis le `d` des <path> (sous-chemins M…Z :
1er = anneau externe, suivants = trous), transform translate(x y) scale(1 -1) rotate(deg).
Usage: python check_svg_dir2.py <dir> <space> <sheet_w> <sheet_h>"""
import os, re, sys
from shapely import affinity
from shapely.geometry import Polygon
from shapely.strtree import STRtree
d, SPACE, SHEET_W, SHEET_H = sys.argv[1], float(sys.argv[2]), float(sys.argv[3]), float(sys.argv[4])
SHEET = Polygon([(0, 0), (SHEET_W, 0), (SHEET_W, SHEET_H), (0, SHEET_H)])
num = r'-?\d+(?:\.\d+)?(?:e-?\d+)?'
def parse_d(dd):
    rings = []
    for sub in re.findall(r'M([^MZz]+)', dd):
        nums = [float(v) for v in re.findall(num, sub)]
        pts = list(zip(nums[0::2], nums[1::2]))
        if len(pts) >= 3: rings.append(pts)
    if not rings: return None
    return Polygon(rings[0], rings[1:]).buffer(0)
tot = ov_t = cl_t = out_t = 0
for fname in sorted(f for f in os.listdir(d) if f.endswith(".svg")):
    svg = open(os.path.join(d, fname), encoding="utf-8").read()
    polys = []; kinds = {}
    for m in re.finditer(r'<path d="([^"]+)"([^>]*)>', svg):
        dd, attrs = m.group(1), m.group(2)
        tm = re.search(r'translate\((' + num + r') (' + num + r')\)', attrs)
        rm = re.search(r'rotate\((' + num + r')', attrs)
        if not tm: continue
        base = parse_d(dd)
        if base is None or base.is_empty: continue
        tx, ty = float(tm.group(1)), float(tm.group(2))
        rot = float(rm.group(1)) if rm else 0.0
        q = affinity.rotate(base, rot, origin=(0, 0))
        q = affinity.affine_transform(q, [1, 0, 0, -1, 0, 0])
        q = affinity.translate(q, tx, ty)
        polys.append(q); k = round(base.area); kinds[k] = kinds.get(k, 0) + 1
    tree = STRtree(polys)
    overlap = close = 0; mind = 1e9; dup = 0; ex = []
    for i, p in enumerate(polys):
        for j in tree.query(p.buffer(SPACE + 1.0)):
            j = int(j)
            if j <= i: continue
            dist = p.distance(polys[j]); mind = min(mind, dist)
            a = p.intersection(polys[j]).area
            if a > 0.01:
                overlap += 1
                if a > 0.99 * min(p.area, polys[j].area): dup += 1
                if len(ex) < 5: ex.append((round(p.area), round(polys[j].area), round(a, 2), tuple(round(v, 1) for v in p.centroid.coords[0])))
            elif dist < SPACE - 1e-6:
                close += 1
    outside = sum(1 for p in polys if not SHEET.covers(p.buffer(-1e-6)))
    bs = [p.bounds for p in polys]
    aabb = (min(b[0] for b in bs), SHEET_H - max(b[3] for b in bs), max(b[2] for b in bs), SHEET_H - min(b[1] for b in bs)) if bs else None
    tot += len(polys); ov_t += overlap; cl_t += close; out_t += outside
    print(f"{fname}: {len(polys)} pièces {kinds} | chevauchements {overlap} (poses identiques {dup}) | trop près {close} | min-dist {mind if mind<1e9 else 0:.4f} | hors tôle {outside} | AABB y-up {tuple(round(v,1) for v in aabb) if aabb else None}")
    for e in ex: print("   ex overlap (aireA, aireB, inter, centroïde):", e)
print(f"TOTAL {tot} | chevauchements {ov_t} | trop près {cl_t} | hors tôle {out_t} | VERDICT {'OK' if ov_t==0 and out_t==0 else 'ÉCHEC'}")
