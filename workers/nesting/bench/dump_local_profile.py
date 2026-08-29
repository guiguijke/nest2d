"""Dump l'instance+config moteur du profil LOCAL (mono-walk, −X, space 0.1)
pour replay direct du binaire nest-engine — reproduit ce que le worker
prépare pour le navigateur (J-085 réduit inclus), sans solve.

    docker run --rm -i --network nestorcut_nest2d \
        -e MONGO_URI=mongodb://mongo:27017/nest2d \
        nest2d-nesting-worker:dev python - < bench/dump_local_profile.py
Écrit /tmp/instance.json + /tmp/config.json (imprime les chemiers sur stdout).
"""
import json
import os
import sys

sys.path.insert(0, "/app")

from pymongo import MongoClient
from core.main import convert_files_to_input_items
from core.nesting_input_builder import (
    build_bin, build_spp_instance, build_engine_config, deterministic_seed,
)
from core.holed_polygons import channels_usable
from core.holefill import plan_hole_fills, reduce_for_solve

SPACE = 0.1
BUDGET = int(os.environ.get("BENCH_BUDGET", "40"))
W, H = 1000.0, 2000.0


def main():
    db = MongoClient(os.environ["MONGO_URI"]).get_default_database()
    files = [
        {"slug": "piece_trou", "count": 100, "rotations": [0, 90, 180, 270]},
        {"slug": "piece_fillx4", "count": 800, "rotations": [0, 90, 180, 270]},
    ]
    # Neutralise le tunnel Mongo/crypto du pipeline standard : on lit les
    # polygonParts tels que seedés par seed_user_repro.py.
    import core.main as m
    items = []
    idx = 0
    from worker_common.colors import resolve_part_color
    for f in files:
        doc = db["user_dxf_files"].find_one({"slug": f["slug"]})
        for pi, part in enumerate(doc["polygonParts"]):
            items.append({
                "id": idx, "file_slug": f["slug"],
                "coords": part["coordinates"], "holes": part.get("holes") or [],
                "handles": part.get("handles"), "count": f["count"],
                "rotations": f["rotations"],
                "color": resolve_part_color(part, f["slug"], pi),
            })
            idx += 1

    from core.holed_polygons import open_holes_with_channels, channel_width_for_space
    ch_w = channel_width_for_space(SPACE)
    jag_items = []
    for it in items:
        coords = it["coords"]
        if it["holes"]:
            coords = open_holes_with_channels(coords, it["holes"], ch_w)
        from core.nesting_input_builder import build_item
        jag_items.append(build_item(it["id"], it["count"], coords, it["rotations"]))

    packs = plan_hole_fills(items, SPACE)
    meta, reduced = (None, None)
    if packs:
        meta, reduced = reduce_for_solve(items, jag_items, packs, SPACE)
    solve_items = reduced if reduced else jag_items
    instance = build_spp_instance(solve_items, W, H, name="local-repro")
    if meta:
        with open("/tmp/meta.json", "w") as fh:
            json.dump({"packs": len(packs), "idMap_len": len(meta["idMap"])}, fh)

    seed = deterministic_seed({"instance": instance, "space": SPACE, "budget": BUDGET})
    config = build_engine_config(
        BUDGET, seed, 3, min_separation=SPACE, has_holes=bool(packs),
        max_strip_width=W, n_workers=1, biases=["left"],
        plateau_patience_sec=30.0, separator_workers=1,
    )
    config["live_events"] = True  # frames live -> stdout

    with open("/tmp/instance.json", "w") as fh:
        json.dump(instance, fh)
    with open("/tmp/config.json", "w") as fh:
        json.dump(config, fh)
    n_items = len(solve_items)
    demand = sum(i["demand"] for i in solve_items)
    print(f"DUMP OK items={n_items} demand={demand} packs={len(packs) if packs else 0} "
          f"budget={BUDGET} seed={seed}", flush=True)


if __name__ == "__main__":
    main()
