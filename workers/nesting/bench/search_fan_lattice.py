"""Recherche du lattice le plus dense pour la fan (quarter-pie, espacement 0.1).
Sous-réseaux à centroïdes, orientations alternées par parité."""
import math, sys
sys.path.insert(0, "/app")
from shapely.geometry import Polygon
from shapely import affinity
from bench.seed_user_repro import FILLER_RING

FAN = Polygon([(x, y) for x, y in FILLER_RING]).buffer(0)
AREA = FAN.area
C0 = FAN.centroid

def rotc(p, deg):
    r = math.radians(deg)
    c, s = math.cos(r), math.sin(r)
    q = affinity.affine_transform(p, [c, s, -s, c, 0, 0])
    return q, affinity.translate(q, C0.x - q.centroid.x, C0.y - q.centroid.y)

FANS = {}
for d in (0, 90, 180, 270):
    _, f = rotc(FAN, d)
    FANS[d] = f

def min_dist(ps):
    m = 1e9
    for i in range(len(ps)):
        for j in range(i + 1, len(ps)):
            d = ps[i].distance(ps[j])
            if d < m:
                m = d
    return m

def build(pair, px, py, dx, dy):
    ps = []
    for j in range(3):
        for i in range(4):
            if (i + j) % 2 == 0:
                ps.append(affinity.translate(FANS[pair[0]], i * px, j * py))
            else:
                ps.append(affinity.translate(FANS[pair[1]], i * px + dx, j * py + dy))
    return ps

def feasible(pair, px, py, dx, dy):
    return min_dist(build(pair, px, py, dx, dy)) >= 0.1 - 1e-9

def search(pair, label):
    best = None
    # passe grossière : px/py au pas de 2, offsets au pas de 0.2
    px = 20.0
    while px <= 46.0:
        py = 20.0
        while py <= 36.0:
            fx = -0.4
            while fx <= 0.41:
                fy = -0.4
                while fy <= 0.41:
                    if feasible(pair, px, py, px * fx, py * fy):
                        dens = 2 * AREA / (px * py)
                        if best is None or dens > best[0]:
                            best = (dens, px, py, px * fx, py * fy)
                    fy += 0.2
                fx += 0.2
            py += 2.0
        px += 2.0
    # raffinement local autour du meilleur
    if best:
        _, px0, py0, dx0, dy0 = best
        step = 0.8
        while step > 0.06:
            improved = True
            while improved:
                improved = False
                for ddx in (-step, 0, step):
                    for ddy in (-step, 0, step):
                        for dpx in (-step, 0, step):
                            for dpy in (-step, 0, step):
                                if ddx == ddy == dpx == dpy == 0:
                                    continue
                                cand = (px0 + dpx, py0 + dpy, dx0 + ddx, dy0 + ddy)
                                if cand[0] <= 0 or cand[1] <= 0:
                                    continue
                                if feasible(pair, *cand):
                                    dens = 2 * AREA / (cand[0] * cand[1])
                                    if dens > best[0] + 1e-9:
                                        best = (dens, *cand)
                                        px0, py0, dx0, dy0 = cand
                                        improved = True
            step /= 2
    print(f"{label}: " + (f"densité {best[0]:.1%} px={best[1]:.2f} py={best[2]:.2f} dx={best[3]:.2f} dy={best[4]:.2f}" if best else "aucun"), flush=True)

search((0, 180), "alternance 0/180 (damier)")
search((90, 270), "alternance 90/270 (damier)")
search((0, 90), "alternance 0/90")
search((0, 270), "alternance 0/270")
# simple : une seule orientation (référence colonnes)
best1 = None
for px10 in range(397, 460, 3):
    px = px10 / 10
    for py10 in range(281, 360, 3):
        py = py10 / 10
        ps = [affinity.translate(FANS[0], i * px, j * py) for j in range(4) for i in range(5)]
        if min_dist(ps) >= 0.1 - 1e-9:
            dens = AREA / (px * py)
            if best1 is None or dens > best1[0]:
                best1 = (dens, px, py)
print("mono-orientation 0:", best1 and f"densité {best1[0]:.1%} px={best1[1]} py={best1[2]}")
