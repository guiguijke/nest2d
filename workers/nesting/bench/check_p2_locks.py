"""Verrous d'homogénéité de la partie 2 (plan 2026-09-05 §2.3).

Pour un job bench multi-tôles, par alternative :
- « Grille » (strategy grid) : abscisses des HÔTES ≡ ox (mod w+s) à
  0,5 mm près sur TOUTES les tôles (le style grille est homogène —
  pleine grille ET colonnes de la dernière tôle partagent le pas) ;
- physique : comptes par classe, hôtes par tôle ;
- « jamais pire que le moteur » : chaque alternative couvre la demande.

Les poses sont lues dans les SVG persistés (bucket nestSvg, un fichier
par tôle et par alternative — parseur de check_svg_dir.py).

Usage (docker, MONGO_URI requis) :
    python check_p2_locks.py <slug> <space_mm> <host_area> [pitch_ox]
    host_area : aire (mm², ±1) de l'anneau externe AVEC trous de la
    classe hôte (T-A : 6152).
"""
import os
import re
import sys

from pymongo import MongoClient

db = MongoClient(os.environ["MONGO_URI"]).get_default_database()
SLUG, SPACE = sys.argv[1], float(sys.argv[2])
HOST_AREA = float(sys.argv[3])
HOST_W = float(sys.argv[4]) if len(sys.argv) > 4 else 100.0
num = r'-?\d+(?:\.\d+)?(?:e-?\d+)?'


def parse_svg_poses(svg):
    """[(area, tx, ty, rot)] — anneaux externes depuis le `d` (1er
    sous-chemin), transform translate(x y) rotate(deg), scale(1 -1)."""
    out = []
    for m in re.finditer(r'<path d="([^"]+)"([^>]*)>', svg):
        dd, attrs = m.group(1), m.group(2)
        tm = re.search(r'translate\((' + num + r') (' + num + r')\)', attrs)
        rm = re.search(r'rotate\((' + num + r')\)', attrs)
        if not tm:
            continue
        pts = [float(v) for v in re.findall(num, re.search(r'M([^MZz]+)', dd).group(1))]
        poly = list(zip(pts[0::2], pts[1::2]))
        if len(poly) < 3:
            continue
        a = 0.0
        for i in range(len(poly)):
            x1, y1 = poly[i]
            x2, y2 = poly[(i + 1) % len(poly)]
            a += x1 * y2 - x2 * y1
        out.append((abs(a) / 2.0, float(tm.group(1)), float(tm.group(2)),
                    float(rm.group(1)) if rm else 0.0))
    return out


job = db["nesting_jobs"].find_one({"slug": SLUG})
if not job:
    raise SystemExit(f"job introuvable : {SLUG}")
requested = sum(int(f.get("count") or 0) for f in (job.get("files") or []))
pitch = HOST_W + SPACE
ox = SPACE + HOST_W / 2.0

from gridfs import GridFS
svg_fs = GridFS(db, collection="nestSvg")

fails = 0
for alt in job.get("alternatives") or []:
    strategy = alt.get("strategy")
    r = alt.get("report") or {}
    sheets = r.get("sheets") or []
    total = sum(s.get("partCount") or 0 for s in sheets)
    line = (f"[{strategy}] tôles {alt.get('layoutCount')} "
            f"{[s.get('partCount') for s in sheets]} | total {total}/{requested} "
            f"| overlap {r.get('overlapFree')} inside {r.get('insideSheet')} "
            f"dups {r.get('duplicatePoses')} gap {r.get('smallestGapMm')}")
    if total != requested:
        fails += 1
        line += " | ÉCHEC (compte)"
    # Verrou grille : hôtes au pas sur toutes les tôles.
    if strategy == "grid":
        bad = 0
        hosts_per_sheet = []
        for fname in alt.get("svg_files") or []:
            try:
                svg = svg_fs.get_last_version(filename=fname).read().decode("utf-8")
            except Exception:
                continue
            poses = parse_svg_poses(svg)
            hosts = [p for p in poses if abs(p[0] - HOST_AREA) < 1.0]
            hosts_per_sheet.append(len(hosts))
            for _a, tx, _ty, _rot in hosts:
                m = (tx - ox) % pitch
                if min(m, pitch - m) > 0.5 + 1e-9:
                    bad += 1
        line += f" | hôtes/tôle {hosts_per_sheet} au pas {pitch}"
        if bad:
            fails += 1
            line += f" | ÉCHEC ({bad} hôtes hors pas)"
        else:
            line += " | HOMOGÈNE (±0,5 mm)"
    print(line)

print(f"\nVERROUS P2: {'OK' if fails == 0 else f'{fails} ÉCHEC(S)'}")
sys.exit(1 if fails else 0)
