"""Analyse de STRUCTURE du layout final (profil local −X, space 0.1) :
alignement des carrés (lanes x / pitch y) et regroupement des fans.

Rejoue le binaire nest-engine avec le profil local puis mesure :
- carrés : clusters de positions x (lanes, ±0.3 mm), pitch y par lane,
  écart max au pitch canonique, carrés hors lane ;
- fans : clusters spatiaux (grille 50 mm), taille et étendue de chaque
  amas (1 amas propre = le résultat « canonique » attendu par l'user).

    docker run --rm -i --network nestorcut_nest2d \
        -e MONGO_URI=mongodb://mongo:27017/nest2d \
        nest2d-nesting-worker:dev python - < bench/analyze_layout_structure.py
"""
import json
import math
import os
import subprocess
import sys

sys.path.insert(0, "/app")

SPACE = 0.1
W, H = 1000.0, 2000.0


def main():
    from pymongo import MongoClient
    from core.nesting_input_builder import (
        build_spp_instance, build_engine_config, deterministic_seed, build_item,
    )
    from core.holed_polygons import open_holes_with_channels, channel_width_for_space
    from core.holefill import plan_hole_fills, reduce_for_solve
    from worker_common.colors import resolve_part_color

    db = MongoClient(os.environ["MONGO_URI"]).get_default_database()
    BUDGET = int(os.environ.get("BENCH_BUDGET", "40"))
    files = [
        {"slug": "piece_trou", "count": 100, "rotations": [0, 90, 180, 270]},
        {"slug": "piece_fillx4", "count": 800, "rotations": [0, 90, 180, 270]},
    ]
    items, jag_items = [], []
    idx = 0
    for f in files:
        doc = db["user_dxf_files"].find_one({"slug": f["slug"]})
        for pi, part in enumerate(doc["polygonParts"]):
            it = {
                "id": idx, "file_slug": f["slug"],
                "coords": part["coordinates"], "holes": part.get("holes") or [],
                "handles": part.get("handles"), "count": f["count"],
                "rotations": f["rotations"],
                "color": resolve_part_color(part, f["slug"], pi),
            }
            items.append(it)
            idx += 1
    ch_w = channel_width_for_space(SPACE)
    for it in items:
        coords = it["coords"]
        if it["holes"]:
            coords = open_holes_with_channels(coords, it["holes"], ch_w)
        jag_items.append(build_item(it["id"], it["count"], coords, it["rotations"]))

    packs = plan_hole_fills(items, SPACE)
    solve_items = jag_items
    if packs:
        meta, reduced = reduce_for_solve(items, jag_items, packs, SPACE)
        if reduced:
            solve_items = reduced
    instance = build_spp_instance(solve_items, W, H, name="struct-repro")
    seed = deterministic_seed({"instance": instance, "space": SPACE, "budget": BUDGET})
    config = build_engine_config(
        BUDGET, seed, 3, min_separation=SPACE, has_holes=bool(packs),
        max_strip_width=W, n_workers=1, biases=["left"],
        plateau_patience_sec=30.0, separator_workers=1,
    )
    with open("/tmp/instance.json", "w") as fh:
        json.dump(instance, fh)
    with open("/tmp/config.json", "w") as fh:
        json.dump(config, fh)
    proc = subprocess.run(
        ["nest-engine", "-p", "spp", "-i", "/tmp/instance.json",
         "-c", "/tmp/config.json", "-s", "/tmp/out"],
        capture_output=True, text=True, timeout=BUDGET * 4,
    )
    if proc.returncode != 0:
        print("ENGINE FAIL:", proc.stderr[-500:])
        sys.exit(1)

    with open("/tmp/out/alternatives.json") as fh:
        alts = json.load(fh)
    if isinstance(alts, dict):
        alts = alts.get("alternatives", [])
    alt = alts[0]
    placed = (alt.get("solution") or {}).get("layout", {}).get("placed_items", [])
    # items: hosts = id 0 (100 carrés pleins), fillers = id 1 (400 loose)
    hosts = [p for p in placed if p["item_id"] == 0]
    fans = [p for p in placed if p["item_id"] == 1]
    print(f"alt#0 bias={alt.get('bias')} strip={alt['solution'].get('strip_width'):.2f} "
          f"hosts={len(hosts)} fans={len(fans)}")

    # ---- lanes des carrés (clusters x, ±0.3) --------------------------------
    xs = sorted(p["transformation"]["translation"][0] for p in hosts)
    lanes = []
    for x in xs:
        if lanes and abs(x - lanes[-1][-1]) <= 0.3:
            lanes[-1].append(x)
        else:
            lanes.append([x])
    print(f"\nlanes carrés (x): {len(lanes)} -> " +
          ", ".join(f"{sum(l)/len(l):7.2f}×{len(l)}" for l in lanes))

    # pitch y par lane : positions y triées, écart au pitch 100+space
    pitch = 100.0 + SPACE
    worst = 0.0
    for li, lane in enumerate(lanes):
        lx = sum(lane) / len(lane)
        ys = sorted(p["transformation"]["translation"][1]
                    for p in hosts
                    if abs(p["transformation"]["translation"][0] - lx) <= 0.3)
        gaps = [round(b - a, 3) for a, b in zip(ys, ys[1:])]
        bad = [g for g in gaps if abs(g - pitch) > 0.05]
        if bad:
            worst = max(worst, max(abs(g - pitch) for g in bad))
        print(f"  lane {li} x={lx:7.2f} n={len(ys)} y0={ys[0]:7.2f} "
              f"gaps hors-pitch: {len(bad)}/{len(gaps)}" +
              (f" ex={bad[:4]}" if bad else ""))

    # ---- amas de fans (grille 50 mm) ----------------------------------------
    cells = {}
    for p in fans:
        x, y = p["transformation"]["translation"]
        cells.setdefault((round(x // 50), round(y // 50)), 0)
        cells[(round(x // 50), round(y // 50))] += 1
    # composantes connexes (8-voisinage)
    seen, clusters = set(), []
    for c in cells:
        if c in seen:
            continue
        stack, comp = [c], []
        seen.add(c)
        while stack:
            cur = stack.pop()
            comp.append(cur)
            for dx in (-1, 0, 1):
                for dy in (-1, 0, 1):
                    n = (cur[0] + dx, cur[1] + dy)
                    if n in cells and n not in seen:
                        seen.add(n)
                        stack.append(n)
        clusters.append(comp)
    clusters.sort(key=lambda comp: -len(comp))
    print(f"\namas de fans (cellules 50 mm, 8-connexité) : {len(clusters)}")
    for comp in clusters[:8]:
        xs2 = [c[0] for c in comp]
        ys2 = [c[1] for c in comp]
        n = sum(cells[c] for c in comp)
        print(f"  amas {n:4d} fans, {len(comp):3d} cellules, "
              f"x∈[{min(xs2)*50:.0f},{(max(xs2)+1)*50:.0f}] "
              f"y∈[{min(ys2)*50:.0f},{(max(ys2)+1)*50:.0f}]")

    # étalement fans : envergure de la bbox des centres
    fxs = [p["transformation"]["translation"][0] for p in fans]
    fys = [p["transformation"]["translation"][1] for p in fans]
    print(f"\nfans bbox centres: x∈[{min(fxs):.0f},{max(fxs):.0f}] "
          f"y∈[{min(fys):.0f},{max(fys):.0f}]")
    print(f"pire écart de pitch carrés: {worst:.3f} mm")


if __name__ == "__main__":
    main()
