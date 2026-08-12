"""Bench grille (J-092) : pièces identiques en tôle portrait — reproduit les
3 constats captures (left = colonnes de gauche non remplies, balanced =
free_top != free_right, bottom quasi OK). Tourne IN-PROCESS dans l'image
worker et dumpe instance+config moteur pour replay natif :

    docker run --rm -i --network nest2d_nest2d \
        -e MONGO_URI=mongodb://mongo:27017/nest2d \
        -v $PWD/workers/nesting/bench/fixtures:/fixtures \
        nest2d-nesting-worker:dev python - < workers/nesting/bench/seed_grid.py

Puis replay natif + métriques :

    cd workers/nesting/engine && cargo run --release -p nest-engine -- \
        -i ../bench/fixtures/grid_instance.json \
        -c ../bench/fixtures/grid_config.json -s /tmp/grid-out -p spp
    python ../bench/grid_metrics.py /tmp/grid-out/alternatives.json

Métriques imprimées par alternative : usedWidth/usedHeight, stairExcess
(aire vide au-dessus des colonnes plus courtes — left), |free_top-free_right|
(balanced), offcut le plus grand rectangle vide garanti.
"""
import io
import json
import os
import sys
import time
from datetime import datetime

import ezdxf
from pymongo import MongoClient

OWNER = "bench-user"
# Tôle PORTRAIT (le cas des captures) : 4 colonnes de 200 (+2 d'espacement).
SHEET = {"width": 1000.0, "height": 2000.0, "count": 1}
BUDGET_SEC = int(os.environ.get("BENCH_BUDGET", "13"))  # défaut = budget navigateur

PART_W, PART_H, COUNT = 200.0, 100.0, 40
SPACE = 2.0


def make_dxf(w, h):
    doc = ezdxf.new("R2010")
    msp = doc.modelspace()
    ent = msp.add_lwpolyline([(0, 0), (w, 0), (w, h), (0, h)], close=True)
    buf = io.StringIO()
    doc.write(buf)
    return buf.getvalue().encode("ascii", "ignore"), ent.dxf.handle


def main():
    db = MongoClient(os.environ["MONGO_URI"]).get_default_database()

    sys.path.insert(0, "/app")
    from worker_common.crypto import write_gridfs
    from worker_common.mongo import get_bucket

    bucket = get_bucket("validDxf")
    db["users"].update_one(
        {"id": OWNER}, {"$setOnInsert": {"id": OWNER, "name": "Bench"}}, upsert=True
    )

    slug = "grid200x100"
    dxf_bytes, handle = make_dxf(PART_W, PART_H)
    write_gridfs(bucket, slug, dxf_bytes, OWNER, None)
    db["user_dxf_files"].update_one(
        {"slug": slug},
        {"$set": {
            "slug": slug,
            "ownerId": OWNER,
            "polygonParts": [{
                "coordinates": [[0, 0], [PART_W, 0], [PART_W, PART_H], [0, PART_H]],
                "holes": [],
                "handles": [handle],
            }],
        }},
        upsert=True,
    )
    # Rotations 0/90 seulement : pièce rectangulaire, 180/270 redondants.
    files = [{"slug": slug, "count": COUNT, "rotations": [0, 90]}]

    job_slug = f"bench-grid-{int(time.time())}"
    doc = {
        "slug": job_slug,
        "projectSlug": "bench-project",
        "ownerId": OWNER,
        "files": files,
        "params": {
            "sheets": [SHEET],
            "width": SHEET["width"],
            "height": SHEET["height"],
            "sheetCount": SHEET["count"],
            "space": SPACE,
            "addOutShape": False,
            "directions": ["left", "bottom", "balanced"],
            "vcores": 4,
            "timeBudgetSec": BUDGET_SEC,
            "alternativesCount": 3,
            "computeLevel": "standard",
        },
        "status": "processing",
        "priority": 20,
        "createdAt": datetime.now(),
    }
    res = db["nesting_jobs"].insert_one(doc)
    doc["_id"] = res.inserted_id

    # Espion : dump instance + config moteur pour le replay natif.
    import core.main as m

    orig_run_engine = m.run_engine

    def spy(instance, engine_config, *args, **kwargs):
        for name, payload in (("grid_instance", instance), ("grid_config", engine_config)):
            for dest in (f"/tmp/{name}.json", f"/fixtures/{name}.json"):
                try:
                    with open(dest, "w") as f:
                        json.dump(payload, f)
                except OSError:
                    pass  # /fixtures non monté : le dump /tmp suffit au debug
        return orig_run_engine(instance, engine_config, *args, **kwargs)

    m.run_engine = spy

    print(f"[grid] job {job_slug} in-process ({BUDGET_SEC}s, "
          f"{COUNT}x {PART_W:.0f}x{PART_H:.0f} sur {SHEET['width']:.0f}x{SHEET['height']:.0f})",
          flush=True)
    m.nesting_process(doc)

    # In-process : c'est worker_loop qui écrit "done" d'habitude — lire les
    # alternatives directement dès que nesting_process a fini.
    final = db["nesting_jobs"].find_one({"slug": job_slug})
    alts = final.get("alternatives") or []
    print(f"[grid] status={final.get('status')} alternatives={len(alts)}", flush=True)
    if not alts:
        print(f"[grid] ERROR: {final.get('error') or final.get('information')}")
        sys.exit(1)

    for i, alt in enumerate(alts):
        off = alt.get("offcut") or {}
        print(
            f"  #{i} strategy={alt.get('strategy')!r} density={alt.get('density'):.4f} "
            f"usedSheetShare={alt.get('usedSheetShare'):.4f} "
            f"offcut={off.get('width', 0):.0f}x{off.get('height', 0):.0f}",
            flush=True,
        )
    print("[grid] fixtures: /fixtures/grid_instance.json + grid_config.json "
          "(replay natif + grid_metrics.py)", flush=True)


if __name__ == "__main__":
    main()
