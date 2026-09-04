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
            # X4 : gain mesuré brut → final. « Pire que le moteur » =
            # TOTAL final < total brut (les transferts inter-tôles sont le
            # BUT de la passe fusionnée : une tôle perd, l'autre gagne —
            # l'ancien test par tôle signalait à tort T-K) OU physique KO.
            pre = pp.get("pre") or []
            final = r.get("sheets") or []
            gains = []
            for k in range(min(len(pre), len(final))):
                gains.append((final[k].get("partCount") or 0)
                            - (pre[k].get("count") or 0))
            pre_total = sum((p2.get("count") or 0) for p2 in pre)
            final_total = sum((s2.get("partCount") or 0) for s2 in final)
            row["gainParTôle"] = gains
            row["pireQueMoteur"] = final_total < pre_total
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
                "pre": pp.get("pre"),
            })
            errors = pp.get("errors") or []
            # Plan 2026-09-05 : une solution PARTIELLE propre (physique
            # valide, unplaced explicite) est un verdict OK — c'est le
            # comportement attendu sur stock serré (T-F, T-K).
            unplaced = r.get("unplaced") or 0
            verdict_ok = (
                j.get("status") == "done"
                and placed == requested - unplaced
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
    # Y7 (vérif tour 5) : par défaut, ne lister que les jobs portant
    # report.postPass.pre (génération courante) — l'ancien défaut
    # mélangeait tous les jobs historiques.
    import os as _os
    rows = fiche(since=_os.environ.get("CORPUS_SINCE"))
    rows = [r for r in rows if r.get("pre") is not None or r["verdict"].startswith("ÉCHEC")]
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
