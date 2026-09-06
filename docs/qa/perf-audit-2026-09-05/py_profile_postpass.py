"""Profil cProfile du post-pass Python + finalisation (hors Mongo) sur le
rejeu user (bench/out_user_payload.json + out_user_layouts_pre.json).
Etapes : idMap -> expand_meta -> apply_hole_fill -> fill_residual_bands
(compact) -> apply_hole_fill #2 -> parse_result_containers -> verify_layout
-> largest_empty_rectangle -> per_sheet_metrics -> compute_used_sheet_share
-> build_colored_sheet_svg. DXF (GridFS) non rejoue.
"""
import copy
import cProfile
import io
import json
import pstats
import sys
import time

sys.path.insert(0, "/src/workers/nesting")
sys.path.insert(0, "/src/workers/common")
sys.path.insert(0, "/app")

BENCH = "/src/workers/nesting/bench"
lp = json.load(open(f"{BENCH}/out_user_payload.json"))
pre = json.load(open(f"{BENCH}/out_user_layouts_pre.json"))

from core.holefill import expand_meta, apply_hole_fill
from core.residual import fill_residual_bands, layout_aabb
from core.placement import parse_result_containers
from core.metrics import (verify_layout, largest_empty_rectangle,
                          per_sheet_metrics, compute_used_sheet_share)
from core.svg_colored import build_colored_sheet_svg

items = copy.deepcopy(lp["parts"])
meta = lp.get("meta") or {}
space = float((lp.get("engineConfig") or {}).get("min_item_separation") or 0)
layouts = copy.deepcopy(pre["layouts"])
bin_dims = {0: (1000.0, 1000.0)}

T = {}
def timed(name, fn, *a, **k):
    t0 = time.perf_counter()
    r = fn(*a, **k)
    T[name] = time.perf_counter() - t0
    print(f"  {name}: {T[name]*1e3:.0f} ms", flush=True)
    return r

def pipeline(profile_stage=None):
    global layouts
    layouts = copy.deepcopy(pre["layouts"])
    if meta.get("idMap"):
        for l in layouts:
            for pi in l.get("placed_items", []):
                pid = pi.get("item_id")
                if isinstance(pid, int) and 0 <= pid < len(meta["idMap"]):
                    pi["item_id"] = meta["idMap"][pid]
    if meta and not meta.get("packs"):
        layouts = timed("expand_meta", expand_meta, items, meta["host"], meta["fill"],
                        meta.get("slots") or [], layouts, meta.get("ringRotations"))
    n1 = timed("apply_hole_fill#1", apply_hole_fill, items, layouts, space)
    items_by_id = {it["id"]: it for it in items}
    timed("pre_snapshot(layout_aabb)", lambda: [layout_aabb(l, items_by_id) for l in layouts])
    stats = {}
    n2 = timed("fill_residual_bands(compact)", fill_residual_bands, layouts, items, bin_dims, space,
               stats=stats, profile="compact")
    n3 = timed("apply_hole_fill#2", apply_hole_fill, items, layouts, space)
    print("  counts", [len(l["placed_items"]) for l in layouts], "hf", n1, "res", n2, "hf2", n3,
          "rollback", stats.get("compactRollback"), flush=True)
    out = {"solution": {"layouts": layouts, "density": 0, "cost": len(layouts)}}
    rc, placed, dens, cost = timed("parse_result_containers", parse_result_containers, out, items, bin_dims)
    ver = timed("verify_layout", verify_layout, rc, items, space)
    print("  verify:", {k: ver[k] for k in ("smallestGapMm", "overlapFree", "verifyStatus", "holesFilled")}, flush=True)
    off = timed("largest_empty_rectangle", largest_empty_rectangle, rc, items)
    sm = timed("per_sheet_metrics", per_sheet_metrics, rc, items)
    us = timed("compute_used_sheet_share", compute_used_sheet_share, rc, items)
    svgs = timed("build_colored_sheet_svg x sheets", lambda: [
        build_colored_sheet_svg(c.transforms, items_by_id, c.bin_width, c.bin_height, 1.0, "mm") for c in rc])
    print("  svg bytes", [len(s) for s in svgs], flush=True)

print("=== run 1 (timings)")
t0 = time.perf_counter()
pipeline()
print(f"TOTAL post-pass+finalisation: {(time.perf_counter()-t0)*1e3:.0f} ms")
print("=== run 2 (cProfile, top 35 cumulative)")
pr = cProfile.Profile()
pr.enable()
pipeline()
pr.disable()
s = io.StringIO()
ps = pstats.Stats(pr, stream=s).sort_stats("cumulative")
ps.print_stats(35)
print(s.getvalue()[:9000])
s = io.StringIO()
ps = pstats.Stats(pr, stream=s).sort_stats("tottime")
ps.print_stats(25)
print(s.getvalue()[:7000])
