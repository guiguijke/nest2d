"""Analyse multi-tôles (constat user 2026-08-31) : pour chaque tôle du
meilleur layout — carrés, fans, bbox utilisée, plus grande bande libre.
Lit les SVG livrés (une entrée svg_files par tôle) + report.sheets.

Usage :
    docker run --rm -i --network nestorcut_nest2d \
        -e MONGO_URI=mongodb://mongo:27017/nest2d \
        nest2d-nesting-worker:dev python - < bench/analyze_bpp_2sheets.py <slug>
"""
import os
import re
import sys

from pymongo import MongoClient

db = MongoClient(os.environ["MONGO_URI"]).get_default_database()
job = db["nesting_jobs"].find_one({"slug": sys.argv[1]})
alt = job["alternatives"][0]
print(f"job {job['slug']} | status {job['status']} | placed {job.get('placed')}"
      f" | layoutCount {alt.get('layoutCount')} | usedSheetShare "
      f"{round(alt.get('usedSheetShare') or 0, 3)} | strategy {alt.get('strategy')}")

for si, fname in enumerate(alt["svg_files"]):
    f = db["nestSvg.files"].find_one({"filename": fname})
    data = b"".join(c["data"] for c in db["nestSvg.chunks"].find(
        {"files_id": f["_id"]}).sort("n", 1))
    svg = data.decode("utf-8", "replace")
    n_sq = n_fan = 0
    xs = []
    ys = []
    for m in re.finditer(r'<path d="([^"]+)"([^>]*)>', svg):
        d, attrs = m.group(1), m.group(2)
        tm = re.search(r'translate\(([-\d.]+) ([\-.\d]+)\)', attrs)
        if not tm:
            continue
        tx, ty = float(tm.group(1)), float(tm.group(2))
        if d.startswith("M50.000 -50"):
            n_sq += 1
            xs.append((tx - 50, tx + 50))
            ys.append((ty - 50, ty + 50))
        elif d.startswith("M-19"):
            n_fan += 1
            xs.append((tx - 19.8, tx + 19.8))
            ys.append((ty + 2.8 - 30.8, ty + 2.8))
    if xs:
        minx = min(a for a, _ in xs)
        maxx = max(b for _, b in xs)
        miny = min(a for a, _ in ys)
        maxy = max(b for _, b in ys)
    else:
        minx = maxx = miny = maxy = 0
    W, H = 1000.0, 1000.0
    # SVG y-down : miny/maxy en repère tôle par symétrie — approximation
    # suffisante pour la bande (vérifiée sur les carrés à ±0,5).
    right = W - maxx
    top_band = maxy - miny
    sheet_rep = (alt.get("report", {}).get("sheets") or [{}] * 99)[si] or {}
    offcut = sheet_rep.get("offcut") or {}
    print(
        f"  tôle {si + 1}: {n_sq} carrés + {n_fan} fans | bbox x [{minx:.0f}..{maxx:.0f}]"
        f" (bande droite {right:.0f} mm) | offcut rapport "
        f"{offcut.get('widthMm')}×{offcut.get('heightMm')}"
        f" ({round((offcut.get('areaMm2') or 0) / 1e6, 3)} m²)")
