"""Audit 2026-09-02 (soir) : reproduit le run user « ça overlappe » (999
fans + 100 trous, 2×1000×1000, space 0,1, THIS DEVICE).

1. clone le job user en computeLocation local → le worker reconstruit
   localPayload (parts/meta/instance/engineConfig) et le laisse en
   awaiting_local ;
2. dump ce payload dans /app/bench/out_user_payload.json ;
3. résout l'instance avec le moteur NATIF (run_engine) — équivalent
   structurel du wasm navigateur — et dump les layouts pré-post-pass dans
   /app/bench/out_user_layouts_pre.json (solution.rank 0 normalisée).

Le replay JS (séquence localBridge exacte) se fait ensuite côté vitest.
"""
import copy
import json
import os
import sys
import time

sys.path.insert(0, "/app")
from pymongo import MongoClient
from datetime import datetime

db = MongoClient(os.environ["MONGO_URI"]).get_default_database()

src = db["nesting_jobs"].find_one({
    "slug": {"$regex": "nested-f-5cb4b555c1150cb9_999"}})
assert src, "job source introuvable"
slug = f"bench-replayuser-{int(time.time())}"
# Les fichiers du user ne vivent QUE dans son navigateur (J-077) : on
# rejoue avec les fixtures canoniques équivalentes (mêmes géométries
# .testparts) aux quantités exactes du run incriminé.
files = [
    {"slug": "piece_fillx4", "count": 999, "rotations": [0, 90, 180, 270]},
    {"slug": "piece_trou", "count": 100, "rotations": [0, 90, 180, 270]},
]
doc = {
    "slug": slug,
    "projectSlug": "bench-project",
    "ownerId": "bench-user",
    "files": files,
    "params": dict(src["params"], computeLocation="local"),
    "status": "pending",
    "priority": 20,
    "createdAt": datetime.now(),
}
db["nesting_jobs"].insert_one(doc)
print("JOB", slug, flush=True)

# attendre awaiting_local (le worker actif prépare le payload)
for _ in range(120):
    j = db["nesting_jobs"].find_one({"slug": slug})
    if j.get("status") == "awaiting_local":
        break
    if j.get("status") in ("error", "done"):
        print("statut inattendu:", j.get("status"), j.get("error"))
        sys.exit(1)
    time.sleep(1)
else:
    print("timeout awaiting_local")
    sys.exit(1)

lp = j["localPayload"]
with open("/app/bench/out_user_payload.json", "w") as f:
    json.dump(lp, f)
print("payload dumpé: parts", len(lp.get("parts") or []),
      "| problem", lp.get("problem"),
      "| meta", bool(lp.get("meta")), flush=True)

# --- solve natif de la MÊME instance/config
from core.engine import run_engine
instance = lp["instance"]
config = lp["engineConfig"]
config = dict(config)
config["time_budget_sec"] = int(os.environ.get("BENCH_BUDGET", "90"))
config["live_events"] = False
alts = run_engine(instance, config, "bpp")
sol = alts[0]["solution"]
layouts = copy.deepcopy(sol.get("layouts") or [])
with open("/app/bench/out_user_layouts_pre.json", "w") as f:
    json.dump({"slug": slug, "rank": alts[0].get("rank"),
               "layouts": layouts}, f)
print("layouts pré-post-pass dumpés:", [len(l.get("placed_items") or []) for l in layouts], flush=True)

# --- post-pass PYTHON sur les mêmes layouts (parité chiffrée JS↔Python,
# plan 2026-09-03 §1.6) : expand_meta → apply_hole_fill →
# fill_residual_bands, dump pour le vitest de parité.
from core.holefill import expand_meta, apply_hole_fill
from core.residual import fill_residual_bands

post = copy.deepcopy(layouts)
items = copy.deepcopy(lp["parts"])
meta = lp.get("meta") or {}
space = float((lp.get("engineConfig") or {}).get("min_item_separation") or 0)
if meta.get("idMap"):
    for l in post:
        for pi in l.get("placed_items", []):
            pid = pi.get("item_id")
            if isinstance(pid, int) and 0 <= pid < len(meta["idMap"]):
                pi["item_id"] = meta["idMap"][pid]
if meta and not meta.get("packs"):
    post = expand_meta(items, meta["host"], meta["fill"],
                       meta.get("slots") or [], post,
                       meta.get("ringRotations"))
n_hf = apply_hole_fill(items, post, space)
stats = {}
n_res = fill_residual_bands(post, items, {0: (1000.0, 1000.0)}, space,
                            stats=stats)
with open("/app/bench/out_user_layouts_post_py.json", "w") as f:
    json.dump({"layouts": post, "holeFill": n_hf, "residualMoved": n_res,
               "stats": stats}, f)
print("post-pass Python dumpé:", [len(l.get("placed_items") or []) for l in post],
      "| holeFill", n_hf, "| residualMoved", n_res,
      "| rollback", stats.get("compactRollback"), flush=True)
db["nesting_jobs"].update_one({"slug": slug}, {"$set": {"status": "error", "error": "audit replay (annulé)"}})
