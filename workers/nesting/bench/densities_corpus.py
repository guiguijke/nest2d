"""Densités du corpus (3.9 — page /benchmarks) : pour chaque job
bench-corpus-* du RUN le plus récent, extrait la fiche publique —
cas, espacement demandé, tôles, densité matière mesurée, physique.

Sortie JSON sur stdout (consommée par app/data/benchmarks.*.js) :

    [{"case":"A","spaceMm":0.1,"layouts":2,"placed":900,"requested":900,
      "densityPct":67.4,"overlapFree":true,"insideSheet":true,
      "verdict":"ok"}, ...]

Usage :
    docker run --rm -i --network nestorcut_nest2d \
        -e MONGO_URI=mongodb://mongo:27017/nest2d \
        [-e CORPUS_SINCE=<unix ts>] \
        nest2d-nesting-worker:dev python - < bench/densities_corpus.py
"""
import datetime as _dt
import json
import os

from pymongo import MongoClient

db = MongoClient(os.environ["MONGO_URI"]).get_default_database()

query = {"slug": {"$regex": r"^bench-corpus-"}}
since = os.environ.get("CORPUS_SINCE")
if since:
    query["createdAt"] = {"$gte": _dt.datetime.fromtimestamp(float(since), _dt.timezone.utc)}

rows = []
for j in db["nesting_jobs"].find(query).sort("createdAt", 1):
    case = j["slug"].split("-")[2].upper()
    params = j.get("params") or {}
    requested = sum(int(f.get("count") or 0) for f in (j.get("files") or []))
    placed = j.get("placed") or 0
    row = {
        "case": case,
        "spaceMm": round(float(params.get("space") or 0), 2),
        "requested": requested,
        "placed": placed,
    }
    if j.get("status") == "error":
        row["verdict"] = "refused"
        rows.append(row)
        continue
    alts = j.get("alternatives") or []
    if not alts:
        row["verdict"] = "failed"
        rows.append(row)
        continue
    a = alts[0]
    r = a.get("report") or {}
    totals = r.get("totals") or {}
    dens = totals.get("densityPct")
    if dens is None and isinstance(a.get("density"), (int, float)):
        dens = round(a["density"] * 100, 1)
    row.update({
        "layouts": a.get("layoutCount"),
        "densityPct": round(dens, 1) if isinstance(dens, (int, float)) else None,
        "overlapFree": r.get("overlapFree"),
        "insideSheet": r.get("insideSheet"),
        "smallestGapMm": r.get("smallestGapMm"),
        "unplaced": r.get("unplaced") or 0,
        "verdict": "partial" if (r.get("unplaced") or 0) > 0 else "ok",
    })
    rows.append(row)

print(json.dumps(rows, ensure_ascii=False, indent=1))
