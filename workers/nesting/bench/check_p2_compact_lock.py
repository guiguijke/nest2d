"""Verrou « compaction » partie 2 (plan 2026-09-05 §2.3) : dans
l'alternative MOTEUR finale, AUCUN hôte n'est déplacé par rapport à
l'état moteur brut (postPass.pre). Mesure sur le dump e2e navigateur :

- pre-solve.json : window.__lastSolveResult (moteur brut, avant post-pass
  et avant l'alternative grille) — layouts posés ;
- alt<k>_<strategy>_sheet<n>.svg : les SVG exportés du record final
  (l'alternative finale ne porte PAS de layouts — poses parsées des
  <path>, comme check_p2_locks).

Comparaison exacte (rot, tx, ty à 1e-4/1e-3) sur la classe hôte.

Usage : python check_p2_compact_lock.py <e2e_dir> <host_outer_area>
       host_outer_area : aire du PREMIER sous-chemin (anneau externe) de
       l'hôte — T-A : 10000.
"""
import json
import os
import re
import sys

d = sys.argv[1]
host_area = float(sys.argv[2]) if len(sys.argv) > 2 else 10000.0
SHEET_H = float(sys.argv[3]) if len(sys.argv) > 3 else 1000.0

pre = json.load(open(os.path.join(d, "pre-solve.json"), encoding="utf-8"))
num = r'-?\d+(?:\.\d+)?(?:e-?\d+)?'


def svg_host_poses(svg):
    """{(rot, tx, ty)} des hôtes (1er sous-chemin = anneau externe)."""
    out = set()
    for m in re.finditer(r'<path d="([^"]+)"([^>]*)>', svg):
        dd, attrs = m.group(1), m.group(2)
        tm = re.search(r'translate\((' + num + r') (' + num + r')\)', attrs)
        rm = re.search(r'rotate\((' + num + r')\)', attrs)
        if not tm:
            continue
        sub = re.search(r'M([^MZz]+)', dd)
        if not sub:
            continue
        pts = [float(v) for v in re.findall(num, sub.group(1))]
        poly = list(zip(pts[0::2], pts[1::2]))
        if len(poly) < 3:
            continue
        a = 0.0
        for i in range(len(poly)):
            x1, y1 = poly[i]
            x2, y2 = poly[(i + 1) % len(poly)]
            a += x1 * y2 - x2 * y1
        if abs(abs(a) / 2.0 - host_area) > 1.0:
            continue
        rot = float(rm.group(1)) if rm else 0.0
        # L'axe Y du SVG est inversé (scale(1 -1) APRÈS rotation) : la
        # pose moteur ty = hauteur tôle − translate y (constat empirique
        # e2e space 2 : 100/100 hôtes alignés par cette transformation).
        out.add((round(rot, 4), round(float(tm.group(1)), 3),
                 round(SHEET_H - float(tm.group(2)), 3)))
    return out


def pre_host_poses(alt, host_item_id):
    sol = (alt or {}).get("solution") or {}
    layouts = sol.get("layouts") or ([sol["layout"]] if sol.get("layout") else [])
    out = set()
    for l in layouts:
        for pi in l.get("placed_items") or []:
            if pi.get("item_id") != host_item_id:
                continue
            t = pi.get("transformation") or {}
            out.add((round(float(t.get("rotation") or 0), 4),
                     round(float((t.get("translation") or [0, 0])[0]), 3),
                     round(float((t.get("translation") or [0, 0])[1]), 3)))
    return out


pre_alts = pre.get("alternatives") or []
if not pre_alts:
    raise SystemExit("pas d'alternative dans pre-solve.json")

# L'hôte = la classe majoritaire du pre-solve (plus forte aire × count).
host_id = 0
best = -1.0
ids = {}
for l in (pre_alts[0].get("solution") or {}).get("layouts") or []:
    for pi in l.get("placed_items") or []:
        k = pi.get("item_id")
        ids[k] = ids.get(k, 0) + 1
if ids:
    # T-A : hôtes = la classe la moins nombreuse mais la plus grande —
    # heuristique : aire 10000 vs 615, on prend l'aire via le 1er SVG.
    host_id = min(ids, key=lambda k: ids[k]) if len(ids) == 2 else 0

before = pre_host_poses(pre_alts[0], host_id)
after = set()
for fname in sorted(os.listdir(d)):
    m = re.match(r'alt(\d+)_(left|bottom|balanced|compact|maxoffcut)_sheet\d+\.svg$', fname)
    if not m:
        continue
    after |= svg_host_poses(open(os.path.join(d, fname), encoding="utf-8").read())

moved = before - after
gained = after - before
ok = not moved and not gained
print(f"hôtes moteur brut {len(before)} | final {len(after)} | "
      f"déplacées {len(moved)} | nouvelles {len(gained)} | "
      f"{'HÔTES INTACTS (pose moteur, profil compact)' if ok else 'ÉCHEC'}")
for p in list(moved)[:3]:
    print("   déplacée :", p)
for p in list(gained)[:3]:
    print("   nouvelle :", p)
print(f"VERROU COMPACTION: {'OK' if ok else 'ÉCHEC'}")
sys.exit(0 if ok else 1)
