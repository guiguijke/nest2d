"""Channel harness: nest-channels-cli (Rust) vs golden_channels (Python prod
semantics), for BOTH prototypes (difference, splice).

Per file and method: ring count, then per ring (canonical rotation, like
compare.py): max abs delta, plus QUALITY metrics the mission cares about:
  - ring simple (no duplicate vertices / closed),
  - area removed vs golden (the channel swath),
  - effective part count.

Verdicts per (file, method): IDENTICAL / DELTA<=1e-9 / METRICS-OK / DIVERGENT
(+ quality report lines). The method decision (mission v2 PR2) is taken on
this report + holesFilled at the bench.

Run from repo root:
    python workers/geometry/parity/channels.py [golden_dir] [space]
"""
import json
import os
import subprocess
import sys

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
CLI = os.path.join(
    REPO, "workers", "geometry", "target", "release",
    "nest-channels-cli.exe" if os.name == "nt" else "nest-channels-cli",
)
GOLDEN_DIR_DEFAULT = os.path.join(REPO, "workers", "geometry", "parity", "golden_channels")
METHODS = ("difference", "splice")

sys.path.insert(0, os.path.dirname(__file__))
from compare import canon_ring  # shared canonical rotation


def ring_area(ring):
    return abs(sum(ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1]
                   for i in range(len(ring) - 1))) / 2


def compare_rings(rr, gr):
    """Canonical compare of one ring pair: (max_delta, n_divergent, n_pts)."""
    rc, gc = canon_ring(rr), canon_ring(gr)
    if len(rc) != len(gc):
        return None
    max_d = 0.0
    ndiff = 0
    for a, b in zip(rc, gc):
        d = max(abs(a[0] - b[0]), abs(a[1] - b[1]))
        max_d = max(max_d, d)
        if d != 0.0:
            ndiff += 1
    return max_d, ndiff, len(rc)


def quality(ring):
    """Simple structural checks: closed, >=4 pts, no consecutive dups,
    no repeated vertex (other than the closing one)."""
    if len(ring) < 4:
        return False, "too few vertices"
    if ring[0] != ring[-1]:
        return False, "not closed"
    body = ring[:-1]
    if len(set(map(tuple, body))) != len(body):
        return False, "duplicate vertices"
    return True, "ok"


def edge_crossings(ring):
    """Self-intersection count: all edge pairs (O(n²), rings are small)."""
    def seg_int(a1, a2, b1, b2):
        rx, ry = a2[0]-a1[0], a2[1]-a1[1]
        sx, sy = b2[0]-b1[0], b2[1]-b1[1]
        den = rx*sy - ry*sx
        if den == 0:
            return False
        t = ((b1[0]-a1[0])*sy - (b1[1]-a1[1])*sx) / den
        u = ((b1[0]-a1[0])*ry - (b1[1]-a1[1])*rx) / den
        return 0 < t < 1 and 0 < u < 1
    n = len(ring) - 1
    count = 0
    for i in range(n):
        for j in range(i + 2, n):
            if i == 0 and j == n - 1:
                continue  # arêtes adjacentes (fermeture)
            if seg_int(ring[i], ring[i+1], ring[j], ring[j+1]):
                count += 1
    return count


def point_in_ring(p, ring):
    """Ray casting +x."""
    inside = False
    n = len(ring)
    for i in range(n - 1):
        a, b = ring[i], ring[i + 1]
        if (a[1] > p[1]) != (b[1] > p[1]):
            x = a[0] + (p[1] - a[1]) * (b[0] - a[0]) / (b[1] - a[1])
            if x > p[0]:
                inside = not inside
    return inside


def hole_interior_probe(hole):
    """Bisector step from a convex vertex — sûr pour les anneaux concaves."""
    body = hole[:-1] if len(hole) > 1 and hole[0] == hole[-1] else hole
    n = len(body)
    for i in range(n):
        prev, cur, nxt = body[i - 1], body[i], body[(i + 1) % n]
        cross = (cur[0]-prev[0])*(nxt[1]-cur[1]) - (cur[1]-prev[1])*(nxt[0]-cur[0])
        if abs(cross) < 1e-12:
            continue
        # bissectrice
        import math
        a1 = math.atan2(prev[1]-cur[1], prev[0]-cur[0])
        a2 = math.atan2(nxt[1]-cur[1], nxt[0]-cur[0])
        bis = (a1 + a2) / 2
        d1 = math.dist(cur, prev); d2 = math.dist(cur, nxt)
        eps = min(max(min(d1, d2) / 4, 1e-3), 1.0)
        for sign in (1, -1):
            px = cur[0] + sign*eps*math.cos(bis)
            py = cur[1] + sign*eps*math.sin(bis)
            if point_in_ring((px, py), hole):
                return (px, py)
    return body[0]


def absolute_quality(ring, holes, space):
    """Qualité ABSOLUE du canal (indépendante du golden) :
    - anneau simple (0 auto-intersection)
    - trou réellement ouvert (son intérieur n'est plus enfermé)
    Retourne (ok, détail)."""
    issues = []
    nx = edge_crossings(ring)
    if nx:
        issues.append(f"{nx} auto-intersections")
    for h in holes:
        probe = hole_interior_probe(h)
        if point_in_ring(probe, ring):
            issues.append("trou encore enfermé")
    return (not issues), "; ".join(issues) or "ok"


def main():
    golden_dir = sys.argv[1] if len(sys.argv) > 1 else GOLDEN_DIR_DEFAULT
    space = sys.argv[2] if len(sys.argv) > 2 else "2.0"
    corpus_dirs = [
        os.path.join(REPO, "workers", "fileprocessing", "tests", "fixtures"),
        os.path.join(REPO, "server", "seed", "demo"),
        os.path.join(REPO, "workers", "geometry", "parity", "corpus_extra"),
        os.path.join(REPO, "workers", "geometry", "parity", "corpus_svg"),
    ]
    per_method = {m: {"IDENTICAL": 0, "DELTA": 0, "METRICS-OK": 0, "DIVERGENT": 0,
                      "files": 0, "quality_fail": []} for m in METHODS}
    for name in sorted(os.listdir(golden_dir)):
        if not name.endswith(".golden.json"):
            continue
        golden = json.load(open(os.path.join(golden_dir, name)))
        if "error" in golden:
            continue
        grings = golden.get("rings", [])
        if not grings:
            continue
        base = name[: -len(".golden.json")]
        corpus = None
        for d in corpus_dirs:
            p = os.path.join(d, base)
            if os.path.exists(p):
                corpus = p
                break
        if not corpus:
            print(f"  MISSING-CORPUS: {base}")
            continue
        # Trous d'origine (pour la qualité absolue) depuis le golden d'import.
        holes_by_part = []
        import_golden = os.path.join(REPO, "workers", "geometry", "parity",
                                     "golden", name)
        if os.path.exists(import_golden):
            ig = json.load(open(import_golden))
            holes_by_part = [p.get("holes") or [] for p in ig.get("parts", [])
                             if p.get("holes")]
        for m in METHODS:
            st = per_method[m]
            st["files"] += 1
            r = subprocess.run([CLI, corpus, space, m], capture_output=True, text=True)
            if r.returncode != 0:
                st["DIVERGENT"] += 1
                print(f"  [{m}] RUST-ERROR {base}: {r.stderr.strip()[:120]}")
                continue
            rrings = json.loads(r.stdout)["rings"]
            if len(rrings) != len(grings):
                st["DIVERGENT"] += 1
                print(f"  [{m}] {base}: ring count {len(rrings)} vs {len(grings)}")
                continue
            worst = 0.0
            structural = True
            for i, (rr, gr) in enumerate(zip(rrings, grings)):
                ok, why = quality(rr)
                if not ok:
                    st["quality_fail"].append(f"{base}#{i}: {why}")
                if i < len(holes_by_part):
                    aok, awhy = absolute_quality(rr, holes_by_part[i], float(space))
                    if not aok:
                        st["quality_fail"].append(f"{base}#{i}: {awhy}")
                cmp = compare_rings(rr, gr)
                if cmp is None:
                    structural = False
                    break
                worst = max(worst, cmp[0])
            if not structural:
                st["DIVERGENT"] += 1
                print(f"  [{m}] {base}: ring vertex count mismatch")
                continue
            # metrics: aire par anneau à 1e-3 relatif (gate §4.1)
            area_ok = True
            for rr, gr in zip(rrings, grings):
                ar, ag = ring_area(canon_ring(rr)), ring_area(canon_ring(gr))
                if ag > 0 and abs(ar - ag) / ag > 1e-3:
                    area_ok = False
            if worst == 0.0:
                st["IDENTICAL"] += 1
            elif worst <= 1e-9:
                st["DELTA"] += 1
            elif area_ok:
                st["METRICS-OK"] += 1
                print(f"  [{m}] METRICS-OK {base}: max {worst:.2e}")
            else:
                st["DIVERGENT"] += 1
                print(f"  [{m}] DIVERGENT {base}: max {worst:.2e}, area mismatch")
    print()
    for m in METHODS:
        st = per_method[m]
        ok = st["IDENTICAL"] + st["DELTA"] + st["METRICS-OK"]
        print(f"=== CHANNELS [{m}]: {st['IDENTICAL']} identical, {st['DELTA']} delta<=1e-9, "
              f"{st['METRICS-OK']} metrics-ok, {st['DIVERGENT']} divergent "
              f"(on {st['files']} fichiers à trous) — qualité KO: {len(st['quality_fail'])}")
        for q in st["quality_fail"]:
            print(f"    qualité: {q}")


if __name__ == "__main__":
    main()
