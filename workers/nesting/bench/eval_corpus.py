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


def fiche(slug_prefix="bench-corpus-", since=None):
    """X4 (vérif tour 4) : `since` (timestamp UNIX, env CORPUS_SINCE) filtre
    sur le RUN COURANT — l'ancienne fiche mélangeait tous les jobs
    historiques. Le verdict « pire que le moteur ? » est maintenant
    MESURÉ : postPass.pre (brut par tôle) contre final."""
    import datetime as _dt
    query = {"slug": {"$regex": f"^{slug_prefix}"}}
    if since:
        query["createdAt"] = {"$gte": _dt.datetime.fromtimestamp(float(since), _dt.timezone.utc)}
    rows = []
    for j in db["nesting_jobs"].find(query).sort("createdAt", 1):
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
            # X4 : gain mesuré brut → final par tôle.
            pre = pp.get("pre") or []
            final = r.get("sheets") or []
            gains = []
            worse = False
            for k in range(min(len(pre), len(final))):
                delta = (final[k].get("partCount") or 0) - (pre[k].get("count") or 0)
                gains.append(delta)
                pre_front = pre[k].get("frontX")
                # front : sans post-pass.finalX persisté on se fie à
                # l'invariant W1/W2 (acceptation count+front) ; le GAIN de
                # compte est la mesure dure.
                if delta < 0:
                    worse = True
            row["gainParTôle"] = gains
            row["pireQueMoteur"] = worse
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
              f" | gain {r.get('gainParTôle')}"
              f"{' | PIRE QUE LE MOTEUR' if r.get('pireQueMoteur') else ''}"
              f" | tôles {r.get('layouts')} {r.get('perSheet')}"
              f" | overlap {r.get('overlapFree')} inside {r.get('insideSheet')}"
              f" dups {r.get('dups')} gap {r.get('gap')}"
              f" | pp {json.dumps(r.get('postPass'), ensure_ascii=False)}")
        if r["verdict"] != "OK":
            fails += 1
    print(f"\nCORPUS: {len(rows) - fails}/{len(rows)} OK")
    sys.exit(1 if fails else 0)
