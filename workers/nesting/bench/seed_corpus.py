"""Corpus de torture multi-tôles (§5 du plan correctif 2, 2026-09-04) :
« le nesting doit fonctionner pour toute pièce ». Joué à CHAQUE lot —
les post-pass sont calibrés sur Piece_Trou/Piece_Fillx4 ; sur d'autres
géométries ils doivent être no-op tracés ou gagnants, JAMAIS dégradants.

Cas (T-A..T-I) : voir CASES. Chaque cas sème un job BPP au format
produit. Évaluation : bench/eval_corpus.py (physique via rapport mesuré
+ SVG, postPass, verdict « jamais pire que le moteur » garanti par les
critères d'acceptation W1/W2/W3 — compte ET front — et vérifié par les
gardes : D3 no-op sur rotations non quart de tour, lattice no-op hors
classe pavable, hélices no-op sans hôtes à trous).

Usage :
    docker run --rm -i --network nestorcut_nest2d \
        -e MONGO_URI=mongodb://mongo:27017/nest2d \
        -e CORPUS_CASES=A,B,C,D,E,F,G,H \
        nest2d-nesting-worker:dev python - < bench/seed_corpus.py
"""
import json
import os
import sys
import time
from datetime import datetime

from pymongo import MongoClient

OWNER = "bench-user"
BUDGET_SEC = int(os.environ.get("BENCH_BUDGET", "90"))
sys.path.insert(0, "/app")
from bench.seed_user_repro import make_dxf  # noqa: E402


# ---------------------------------------------------------------------------
# Générateurs de géométrie (anneaux fermés, y-up, origine coin bas-gauche
# pour les formes simples — jamais centrées, pour excercer rotatedBbox).
# ---------------------------------------------------------------------------

def rect(w, h, x=0.0, y=0.0):
    return [[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]]


def l_shape():
    # L 200×200, branche 60, centroïde HORS matière au sens centroïde
    # de bbox (pièce non convexe).
    return [[0, 0], [200, 0], [200, 60], [60, 60], [60, 200], [0, 200], [0, 0]]


def u_shape():
    # U 240×200, branche 60.
    return [[0, 0], [240, 0], [240, 200], [180, 200], [180, 60],
            [60, 60], [60, 200], [0, 200], [0, 0]]


def long_thin():
    return rect(900, 40)


def near_full():
    return rect(950, 950)


def fan_ring():
    # la Fillx4 du corpus de référence (coords réelles seed_user_repro)
    from bench.seed_user_repro import filler_geometry
    return filler_geometry()[0]


def host_ring():
    from bench.seed_user_repro import host_geometry
    outer, holes = host_geometry()
    return outer, holes


QUARTERS = [0, 90, 180, 270]


def case_files(case):
    """(files, sheets, space, note) par cas — files au format produit."""
    if case == "A":
        outer, holes = host_ring()
        return ([
            {"slug": "piece_trou", "count": 100, "rotations": QUARTERS,
             "parts": [{"coordinates": outer, "holes": holes}]},
            {"slug": "piece_fillx4", "count": 800, "rotations": QUARTERS,
             "parts": [{"coordinates": fan_ring(), "holes": []}]},
        ], [{"width": 1000.0, "height": 1000.0, "count": 2}],
        float(os.environ.get("CORPUS_SPACE_A", "0.1")),
        "corpus de référence 100+800")
    if case == "B":
        return ([
            {"slug": "rect300", "count": 20, "rotations": QUARTERS,
             "parts": [{"coordinates": rect(300, 200), "holes": []}]},
            {"slug": "rect250", "count": 20, "rotations": QUARTERS,
             "parts": [{"coordinates": rect(250, 180), "holes": []}]},
            {"slug": "rect120", "count": 40, "rotations": QUARTERS,
             "parts": [{"coordinates": rect(120, 90), "holes": []}]},
        ], [{"width": 1500.0, "height": 1000.0, "count": 3}], 2.0,
        "3 classes de rectangles proches — aucune hélice, lattice sans petit")
    if case == "C":
        return ([
            {"slug": "lshape", "count": 40, "rotations": QUARTERS,
             "parts": [{"coordinates": l_shape(), "holes": []}]},
            {"slug": "ushape", "count": 20, "rotations": QUARTERS,
             "parts": [{"coordinates": u_shape(), "holes": []}]},
        ], [{"width": 1200.0, "height": 1000.0, "count": 2}], 1.0,
        "pièces L et U non convexes — cible containment/doublon (W4/W9)")
    if case == "D":
        return ([
            {"slug": "longthin", "count": 30, "rotations": [0, 90],
             "parts": [{"coordinates": long_thin(), "holes": []}]},
            {"slug": "small", "count": 300, "rotations": QUARTERS,
             "parts": [{"coordinates": rect(60, 40), "holes": []}]},
        ], [{"width": 1000.0, "height": 1000.0, "count": 2}], 1.0,
        "pièces longues et fines 900×40 — une orientation dominante")
    if case == "E":
        outer, holes = host_ring()
        return ([
            {"slug": "piece_trou", "count": 60, "rotations":
             [0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330],
             "parts": [{"coordinates": outer, "holes": holes}]},
            {"slug": "piece_fillx4", "count": 400, "rotations":
             [0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330],
             "parts": [{"coordinates": fan_ring(), "holes": []}]},
        ], [{"width": 1000.0, "height": 1000.0, "count": 3}],
        float(os.environ.get("CORPUS_SPACE_E", "0.1")),
        "rotations à 30° (rotationCount 12) — passes JS/Python no-op tracé (D3)")
    if case == "F":
        return ([
            {"slug": "rect200", "count": 90, "rotations": QUARTERS,
             "parts": [{"coordinates": rect(200, 150), "holes": []}]},
        ], [
            {"width": 1000.0, "height": 1000.0, "count": 1},
            {"width": 2000.0, "height": 1000.0, "count": 1},
        ], 1.0,
        "deux formats — coût ∝ surface, container_id/V11/C13")
    if case == "G":
        return ([
            {"slug": "nearfull", "count": 1, "rotations": [0],
             "parts": [{"coordinates": near_full(), "holes": []}]},
            {"slug": "small", "count": 200, "rotations": QUARTERS,
             "parts": [{"coordinates": rect(50, 30), "holes": []}]},
        ], [{"width": 1000.0, "height": 1000.0, "count": 2}], 0.5,
        "grande pièce quasi pleine tôle + 200 petites")
    if case == "H":
        return ([
            {"slug": "unit", "count": 200, "rotations": QUARTERS,
             "parts": [{"coordinates": rect(120, 80), "holes": []}]},
        ], [{"width": 1000.0, "height": 1000.0, "count": 3}], 1.0,
        "classe unique 600 × — recuit vivant (V2), apply_move Restart")
    if case == "I":
        # ESICUP en BPP : les pièces du benchmark comme items, tôle-bande
        # ×3 (approximation multi-tôles du strip d'origine).
        base = "/app/benchmarks/instances"
        case_i = []
        with open(f"{base}/shirts.json") as f:
            inst = json.load(f)
        polys = inst["items"] if isinstance(inst.get("items"), list) else []
        n = 0
        for it in polys[:40]:
            shape = it.get("shape", it)
            data = shape.get("data") if isinstance(shape, dict) else None
            ring = data if isinstance(data, list) else (
                shape.get("outer") if isinstance(shape, dict) else None)
            if not ring:
                continue
            n += 1
            if n > 8:
                break
            case_i.append({"slug": f"esicup{n}", "count": 12, "rotations": QUARTERS,
                           "parts": [{"coordinates": ring, "holes": []}]})
        if not case_i:
            # repli : rectangles si l'instance n'est pas au format attendu
            case_i = [{"slug": "rect150", "count": 60, "rotations": QUARTERS,
                       "parts": [{"coordinates": rect(150, 110), "holes": []}]}]
        return (case_i, [{"width": 2200.0, "height": 1000.0, "count": 2}],
                1.0, "formes libres ESICUP (shirts) en BPP multi-tôles")
    raise SystemExit(f"cas inconnu : {case}")


def main():
    mongo = MongoClient(os.environ["MONGO_URI"])
    db = mongo.get_default_database()
    from worker_common.crypto import write_gridfs
    from worker_common.mongo import get_bucket

    bucket = get_bucket("validDxf")
    db["users"].update_one({"id": OWNER}, {"$setOnInsert": {"id": OWNER}}, upsert=True)

    cases = (os.environ.get("CORPUS_CASES") or "A,B,C,D,E,F,G,H,I").split(",")
    ts = int(time.time())
    for case_idx, case in enumerate(cases):
        case = case.strip().upper()
        files, sheets, space, note = case_files(case)
        for f in files:
            rings = [f["parts"][0]["coordinates"]] + (f["parts"][0].get("holes") or [])
            dxf_bytes, handles = make_dxf(rings)
            write_gridfs(bucket, f["slug"], dxf_bytes, OWNER, None)
            db["user_dxf_files"].update_one(
                {"slug": f["slug"]},
                {"$set": {
                    "slug": f["slug"],
                    "ownerId": OWNER,
                    "polygonParts": [{
                        "coordinates": [[x, y] for x, y in f["parts"][0]["coordinates"]],
                        "holes": [[ [x, y] for x, y in h]
                                  for h in (f["parts"][0].get("holes") or [])],
                        "handles": handles,
                    }],
                }},
                upsert=True,
            )
        # Y5 (vérif tour 5) : suffixe d'index — deux cas dans la même
        # seconde partageaient le slug (trois docs, un seul traité).
        job_slug = f"bench-corpus-{case.lower()}-{ts}-{case_idx}"
        db["nesting_jobs"].insert_one({
            "slug": job_slug,
            "projectSlug": "bench-project",
            "ownerId": OWNER,
            "files": [{"slug": f["slug"], "count": f["count"],
                       "rotations": f["rotations"]} for f in files],
            "params": {
                "sheets": sheets,
                "space": space, "addOutShape": False, "fillHoles": True,
                "directions": ["left"],
                "vcores": 4, "timeBudgetSec": BUDGET_SEC,
                "alternativesCount": 1, "computeLevel": "standard",
            },
            "status": "pending", "priority": 20, "createdAt": datetime.now(),
        })
        print(f"JOB {job_slug} :: T-{case} :: {note}")


if __name__ == "__main__":
    main()
