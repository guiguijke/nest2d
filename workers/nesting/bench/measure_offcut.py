"""P3 (verrou ajouté par le vérificateur) — chute de la DERNIÈRE tôle de
l'alternative moteur (compaction) avant/après l'arrêt par itérations.

Pour chaque job bench-corpus depuis CORPUS_SINCE : alternative non-grille
(moteur), comptes par tôle, front de la 1ʳᵉ tôle (max x des poses,
via le pré-état `pre` du post-pass quand présent), et chute de la
dernière tôle (dims + aire). Tolérance du vérificateur : 3 pièces ou
5 mm de front.

Usage (conteneur worker, réseau nest2d) :
    CORPUS_SINCE=<ts> python bench/measure_offcut.py
"""
import datetime as _dt
import math
import os
import sys

from pymongo import MongoClient

db = MongoClient(os.environ["MONGO_URI"]).get_default_database()
since = float(os.environ.get("CORPUS_SINCE", "0"))
q = {"slug": {"$regex": "^bench-corpus-"}}
if since:
    q["createdAt"] = {"$gte": _dt.datetime.fromtimestamp(since, _dt.timezone.utc)}

rows = []
for j in db["nesting_jobs"].find(q).sort("createdAt", 1):
    case = j["slug"].split("-")[2].upper()
    alts = j.get("alternatives") or []
    for alt in alts:
        strat = alt.get("strategy")
        if strat == "grid":
            continue
        report = alt.get("report") or {}
        sheets = report.get("sheets") or []
        if not sheets:
            continue
        counts = [s.get("partCount") for s in sheets]
        last = sheets[-1]
        off = last.get("offcut") or {}
        rows.append({
            "case": case, "slug": j["slug"][:44], "strategy": strat,
            "counts": counts,
            "offcut_last": {
                "w": off.get("widthMm"), "h": off.get("heightMm"),
                "area": off.get("areaMm2"), "reusable": off.get("reusable"),
            },
        })

for r in rows:
    print(f"{r['case']} | {r['strategy']} | tôles {r['counts']} | "
          f"chute dernière {r['offcut_last']['w']}×{r['offcut_last']['h']} "
          f"({r['offcut_last']['area']} mm², reusable={r['offcut_last']['reusable']})")
print(f"--- {len(rows)} alternatives moteur ---")
