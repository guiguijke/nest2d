"""Mesure : le consommateur Python des frames live (decorate_live_items =
apply_hole_fill sur chaque frame, main.py report_live_layout) ralentit-il
le moteur (pipe stdout bloquant) ? Compare les itérations SA totales
(heartbeats) avec un on_event minimal vs un on_event qui rejoue la
décoration réelle (même throttle 0,35 s). 4 walks, RAYON 4, budget BUDGET s.
"""
import json
import os
import sys
import time

sys.path.insert(0, "/src/workers/nesting")
sys.path.insert(0, "/src/workers/common")
sys.path.insert(0, "/app")
os.environ.setdefault("NEST_LIVE_EVENTS", "1")

from core.engine import run_engine
from core.holefill import decorate_live_items

BENCH = "/src/workers/nesting/bench"
lp = json.load(open(f"{BENCH}/out_user_payload.json"))
instance = lp["instance"]
BUDGET = int(os.environ.get("BUDGET", "40"))
cfg = dict(lp["engineConfig"], time_budget_sec=BUDGET, live_events=True, n_workers=4,
           plateau_patience_sec=None)
input_items = lp["parts"]
meta = lp["meta"]
space = float(cfg["min_item_separation"])
print("cpus", os.cpu_count(), flush=True)


def run(mode):
    hb = {}
    frames = [0]
    dec_time = [0.0]
    last = [0.0]
    sizes = [0]

    def on_event(ev):
        t = ev.get("type")
        if t == "heartbeat":
            hb[ev["worker"]] = ev["iterations"]
        elif t == "layout":
            frames[0] += 1
            sizes[0] += len(json.dumps(ev))
            if mode == "decorate":
                now = time.time()
                if now - last[0] < 0.35:
                    return
                last[0] = now
                items = ev.get("items") or []
                id_map = meta["idMap"]
                items = [[id_map[i[0]] if isinstance(i[0], int) and 0 <= i[0] < len(id_map) else i[0], *i[1:]]
                         for i in items]
                t0 = time.perf_counter()
                decorate_live_items(items, input_items, space, meta=meta, apply_fill=True,
                                    sheets=[[1000.0, 1000.0]])
                dec_time[0] += time.perf_counter() - t0

    t0 = time.perf_counter()
    run_engine(instance, cfg, "bpp", on_event=on_event, rayon_threads=4)
    wall = time.perf_counter() - t0
    tot = sum(hb.values())
    print(f"{mode}: wall {wall:.1f}s, iterations per walk {hb} total {tot} ({tot/wall:.1f} it/s), "
          f"frames {frames[0]} ({sizes[0]/max(1,frames[0])/1024:.1f} KB avg), decorate time {dec_time[0]:.1f}s", flush=True)


run("minimal")
run("decorate")
