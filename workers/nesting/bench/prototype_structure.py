"""Prototype du builder structurel (grille canonique + zones de fans) pour
mesurer largeur/qualité AVANT intégration. Layout construit :
  - k colonnes pleines de carrés (pitch exact 100+space, marges space),
  - colonne k+1 : remainder en bas, fans au-dessus (zone A),
  - zone B à droite : le reste des fans.
Convention : monde = R(rot)·local + translation ; le carré fixture est
CENTRÉ origine ([-50,50]²) → translation = centre du carré.
Validation shapely : zéro chevauchement (shapes érodées space/2), hors tôle.

    docker run --rm -i --network nestorcut_nest2d \
        -e MONGO_URI=mongodb://mongo:27017/nest2d \
        nest2d-nesting-worker:dev python - < bench/prototype_structure.py
"""
import os
import sys
import time

sys.path.insert(0, "/app")

from shapely.geometry import Polygon, box as shbox
from shapely.affinity import rotate as rrot, translate as rtr

SPACE = 0.1
W, H = 1000.0, 2000.0
SQ = 100.0
N_SQ = 100


def ring_polygon(coords, rot, tx, ty):
    return rtr(rrot(Polygon(coords), rot, origin=(0, 0)), tx, ty)


def main():
    from pymongo import MongoClient
    db = MongoClient(os.environ["MONGO_URI"]).get_default_database()
    doc = db["user_dxf_files"].find_one({"slug": "piece_fillx4"})
    filler_coords = doc["polygonParts"][0]["coordinates"]
    fpoly = Polygon(filler_coords)
    print(f"fan aire={fpoly.area:.1f} bbox={[round(b,1) for b in fpoly.bounds]}")

    from core.holefill import pack_hole

    pitch = SQ + SPACE
    per_col = int((H - 2 * SPACE - SQ) // pitch) + 1  # 19
    n_full = N_SQ // per_col
    remainder = N_SQ - n_full * per_col
    total_cols = n_full + (1 if remainder else 0)
    print(f"per_col={per_col} pleines={n_full} remainder={remainder}")

    placements = []
    polys = []

    # ---- grille (translation = centre) --------------------------------------
    def col_x(c):
        return SPACE + SQ / 2 + c * pitch

    for c in range(total_cols):
        n_here = per_col if c < n_full else remainder
        for r in range(n_here):
            cx, cy = col_x(c), SPACE + SQ / 2 + r * pitch
            placements.append((0, 0.0, cx, cy))
            polys.append(shbox(cx - SQ / 2, cy - SQ / 2, cx + SQ / 2, cy + SQ / 2))
    lattice_right = SPACE + total_cols * pitch  # bord droit + marge implicite

    # ---- zones ---------------------------------------------------------------
    last_col_top = SPACE + remainder * pitch
    zoneA = shbox(col_x(total_cols - 1) - SQ / 2, last_col_top,
                  col_x(total_cols - 1) + SQ / 2, H - SPACE) if remainder else None
    zoneB = shbox(lattice_right + SPACE, SPACE, W - SPACE, H - SPACE)

    fan_area = fpoly.area
    total_fans = 400
    print(f"zoneA={zoneA.bounds if zoneA else None} zoneB={zoneB.bounds}")

    def ring_of(rect):
        x0, y0, x1, y1 = rect.bounds
        return [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]

    t0 = time.time()
    cands = [{"id": 1, "coords": [list(p) for p in filler_coords],
              "rotations": [0, 90, 180, 270], "remaining": total_fans,
              "area": fan_area}]
    packsA = []
    if zoneA is not None and total_fans:
        capA = int(zoneA.area * 0.75 / fan_area)
        nA = min(total_fans, max(0, capA))
        packsA = pack_hole(ring_of(zoneA), [dict(c, remaining=nA) for c in cands],
                           SPACE, deadline=time.monotonic() + 6.0)
        print(f"zoneA: cap~{capA} demandé {nA} packé {len(packsA)} "
              f"({time.time()-t0:.1f}s)")
    left = total_fans - len(packsA)
    packsB = []
    if left > 0:
        t1 = time.time()
        packsB = pack_hole(ring_of(zoneB), [dict(c, remaining=left) for c in cands],
                           SPACE, deadline=time.monotonic() + 10.0)
        print(f"zoneB: demandé {left} packé {len(packsB)} ({time.time()-t1:.1f}s)")
    unplaced = total_fans - len(packsA) - len(packsB)
    print(f"NON PLACÉS: {unplaced}")

    for pk in packsA + packsB:
        placements.append((1, pk["rot"], pk["tx"], pk["ty"]))
        polys.append(ring_polygon(filler_coords, pk["rot"], pk["tx"], pk["ty"]))

    # ---- métriques ------------------------------------------------------------
    max_x = max(p.bounds[2] for p in polys)
    max_y = max(p.bounds[3] for p in polys)
    min_x = min(p.bounds[0] for p in polys)
    print(f"\nLARGEUR TOTALE = {max_x + SPACE:.2f} mm (bord gauche {min_x:.2f}) "
          f"hauteur {max_y:.1f}")

    # ---- validation -------------------------------------------------------------
    eroded = [p.buffer(-SPACE / 2 + 1e-6) for p in polys]
    from shapely.strtree import STRtree
    tree = STRtree(eroded)
    bad = 0
    for i, p in enumerate(eroded):
        for j in tree.query(p):
            if int(j) > i and p.intersects(eroded[int(j)]):
                if bad < 4:
                    print(f"  OVERLAP {i}-{int(j)} "
                          f"aire={p.intersection(eroded[int(j)]).area:.4f}")
                bad += 1
    print(f"chevauchements: {bad}")
    oob = [p for p in polys if p.bounds[0] < -1e-6 or p.bounds[1] < -1e-6
           or p.bounds[2] > W + 1e-6 or p.bounds[3] > H + 1e-6]
    print(f"hors tôle: {len(oob)}")


if __name__ == "__main__":
    main()
