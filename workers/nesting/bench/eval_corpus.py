"""Évaluation du corpus de torture (§5) : pour chaque job bench-corpus-*,
fiche = état, placé/demandé, tôles, badges mesurés, postPass, verdict.
Le verdict « jamais pire que le moteur » est GARANTI par les critères
d'acceptation W1/W2/W3 (compte ET front par tôle, sinon restauration
tracée) ; ce script vérifie qu'ils tiennent sur des géométries diverses
(physique mesurée propre, aucun compte perdu, aucune erreur post-pass
non tracée) et signale tout rollback.

Usage : comme seed_corpus.py (mêmes env), MONGO_URI requis.
"""
import json
import os
import re
import sys

from pymongo import MongoClient

db = MongoClient(os.environ["MONGO_URI"]).get_default_database()


def fiche(slug_prefix="bench-corpus-"):
    rows = []
    for j in db["nesting_jobs"].find({"slug": {"$regex": f"^{slug_prefix}"}}).sort("createdAt", 1):
        case = j["slug"].split("-")[2].upper()
        requested = sum(int(f.get("count") or 0) for f in (j.get("files") or []))
        placed = j.get("placed")
        row = {"case": case, "slug": j["slug"], "status": j.get("status"),
               "placed": placed, "requested": requested}
        alts = j.get("alternatives") or []
        if alts:
            a = alts[0]
            r = a.get("report") or {}
            pp = r.get("postPass") or {}
            row.update({
                "layouts": a.get("layoutCount"),
                "overlapFree": r.get("overlapFree"),
                "insideSheet": r.get("insideSheet"),
                "dups": r.get("duplicatePoses"),
                "verify": r.get("verifyStatus"),
                "gap": r.get("smallestGapMm"),
                "postPass": {k: pp.get(k) for k in
                             ("residualMoved", "mergedReceivers",
                              "compactRollback", "compactRollbackReason",
                              "errors")},
                "perSheet": [s.get("partCount") for s in (r.get("sheets") or [])],
            })
            errors = pp.get("errors") or []
            verdict_ok = (
                j.get("status") == "done"
                and placed == requested
                and r.get("overlapFree") is True
                and r.get("insideSheet") is True
                and (r.get("duplicatePoses") or 0) == 0
                and not errors
            )
            row["verdict"] = "OK" if verdict_ok else "ÉCHEC"
        else:
            row["verdict"] = "ÉCHEC (aucune alternative)"
        rows.append(row)
    return rows


if __name__ == "__main__":
    rows = fiche()
    fails = 0
    for r in rows:
        print(f"T-{r['case']}: {r['verdict']} | {r.get('placed')}/{r.get('requested')}"
              f" | tôles {r.get('layouts')} {r.get('perSheet')}"
              f" | overlap {r.get('overlapFree')} inside {r.get('insideSheet')}"
              f" dups {r.get('dups')} gap {r.get('gap')}"
              f" | pp {json.dumps(r.get('postPass'), ensure_ascii=False)}")
        if r["verdict"] != "OK":
            fails += 1
    print(f"\nCORPUS: {len(rows) - fails}/{len(rows)} OK")
    sys.exit(1 if fails else 0)
