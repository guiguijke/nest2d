"""Audit BPP 2026-09-02 : rejoue fill_residual_bands sur les poses finales
du run banc bench-bpp2s-1-1788336629 (2 tôles 1000x1000, 100+800, space 0.1)
avec instrumentation du re-grid des hélices, pour déterminer pourquoi les
carrés restent ancrés y[99,999] (bande basse de ~99 mm vide).
"""
import os
import re
import sys

sys.path.insert(0, "/app")
from pymongo import MongoClient
from shapely.geometry import Polygon

db = MongoClient(os.environ["MONGO_URI"]).get_default_database()
job = db["nesting_jobs"].find_one({"slug": "bench-bpp2s-1-1788336629"})
alt = job["alternatives"][0]
from bench.seed_user_repro import FILLER_RING, host_geometry
outer, holes = host_geometry()


def parse_svg(svg):
    out = []
    for m in re.finditer(r'<path d="([^"]+)"([^>]*)>', svg):
        d, attrs = m.group(1), m.group(2)
        tm = re.search(r"translate\(([-\d.]+) ([\-.\d]+)\)", attrs)
        rm = re.search(r"rotate\(([-\d.]+)", attrs)
        if not tm:
            continue
        tx, ty = float(tm.group(1)), float(tm.group(2))
        rot = float(rm.group(1)) if rm else 0.0
        is_square = d.startswith("M50.000 -50")
        is_fan = d.startswith("M-19")
        if not (is_square or is_fan):
            continue
        out.append({
            "item_id": "square" if is_square else "fan",
            "transformation": {"rotation": rot, "translation": (tx, ty)},
        })
    return out


layouts = []
items = [
    {"id": "square", "coords": [[x, y] for x, y in outer],
     "holes": [[[x, y] for x, y in h] for h in holes],
     "rotations": [0.0, 90.0, 180.0, 270.0]},
    {"id": "fan", "coords": [list(p) for p in FILLER_RING],
     "rotations": [0.0, 90.0, 180.0, 270.0]},
]
for si, fname in enumerate(alt["svg_files"]):
    f = db["nestSvg.files"].find_one({"filename": fname})
    chunks = db["nestSvg.chunks"].find({"files_id": f["_id"]}).sort("n", 1)
    data = b"".join(c["data"] for c in chunks)
    layouts.append({"container_id": si,
                    "placed_items": parse_svg(data.decode("utf-8", "replace"))})

from core import residual
import core.structure as st

orig_regrid = residual._regrid_helices


def traced(last, units, items_by_id, sw, sh, space):
    by_cls = {}
    for u in units:
        by_cls.setdefault(u["host"]["item_id"], []).append(u)
    print(f"  [trace] regrid: {len(units)} unités, {len(by_cls)} classe(s)")
    for cls, group in by_cls.items():
        it = items_by_id[cls]
        small = {"id": cls, "coords": it["coords"],
                 "rotations": it.get("rotations") or [0.0]}
        lat = st.small_lattice(small, space, (space, space, sw - space, sh - space),
                               want=len(group), axis="x")
        print(f"  [trace] classe {cls}: {len(group)} hélices, "
              f"lattice propose {len(lat) if lat else 0} poses")
    moved = orig_regrid(last, units, items_by_id, sw, sh, space)
    print(f"  [trace] _regrid_helices moved={moved}")
    return moved


residual._regrid_helices = traced

n = residual.fill_residual_bands(layouts, items, {0: (1000, 1000), 1: (1000, 1000)}, 0.1)
print(f"fill_residual_bands rejoué: moved={n}")

from core.structure import _bbox, _rotated_bbox
for li, l in enumerate(layouts):
    nf = 0
    xs1 = ys1 = xs2 = ys2 = None
    for pi in l["placed_items"]:
        if pi["item_id"] != "square":
            continue
        nf += 1
        tr = pi["transformation"]
        rb = _rotated_bbox(_bbox(outer), float(tr["rotation"]))
        x0, y0 = tr["translation"][0] + rb[0], tr["translation"][1] + rb[1]
        x1, y1 = tr["translation"][0] + rb[2], tr["translation"][1] + rb[3]
        xs1 = x0 if xs1 is None else min(xs1, x0)
        ys1 = y0 if ys1 is None else min(ys1, y0)
        xs2 = x1 if xs2 is None else max(xs2, x1)
        ys2 = y1 if ys2 is None else max(ys2, y1)
    if nf:
        print(f"tôle {li + 1}: {nf} carrés AABB x[{xs1:.1f},{xs2:.1f}] "
              f"y[{ys1:.1f},{ys2:.1f}] | {len(l['placed_items'])} pièces")
