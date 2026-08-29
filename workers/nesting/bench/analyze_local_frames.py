"""Replay du profil LOCAL (mono-walk, −X, space 0.1, budget 40 s) sur le
binaire nest-engine natif + analyse des frames live :

1. la timeline des frames (stage, strip_width, max_x des items) ;
2. la PREUVE du bug champion : frames phase 2 dont les items tiennent dans
   la tôle (max_x <= 1000) mais dont strip_width (transposé !) > 1000 ->
   rejetées par fitsSheet/liveBetter -> jamais championnables ;
3. la largeur finale exportée (alternatives.json) vs la largeur de la
   dernière frame CHAMPIONNABLE (ce que le pool navigateur livrerait).

    docker run --rm -i --network nestorcut_nest2d \
        -e MONGO_URI=mongodb://mongo:27017/nest2d \
        nest2d-nesting-worker:dev python - < bench/analyze_local_frames.py
"""
import json
import os
import subprocess
import sys

sys.path.insert(0, "/app")

SPACE = 0.1
W, H = 1000.0, 2000.0
SHEET_W = W


def max_x_of(items):
    # items: [id, rot, x, y] — max_x = translation x (bbox approx : les hosts
    # sont posés par centroïde ~ centre, +50 mm ; suffisant pour le diagnostic)
    return max((it[2] for it in items), default=0.0)


def main():
    # ---- build instance/config (profil local) -----------------------------
    from pymongo import MongoClient
    from core.main import convert_files_to_input_items  # noqa: F401
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
    meta, solve_items = (None, jag_items)
    if packs:
        meta, reduced = reduce_for_solve(items, jag_items, packs, SPACE)
        if reduced:
            solve_items = reduced
    instance = build_spp_instance(solve_items, W, H, name="local-repro")
    seed = deterministic_seed({"instance": instance, "space": SPACE, "budget": BUDGET})
    config = build_engine_config(
        BUDGET, seed, 3, min_separation=SPACE, has_holes=bool(packs),
        max_strip_width=W, n_workers=1, biases=["left"],
        plateau_patience_sec=30.0, separator_workers=1,
    )
    config["live_events"] = True

    with open("/tmp/instance.json", "w") as fh:
        json.dump(instance, fh)
    with open("/tmp/config.json", "w") as fh:
        json.dump(config, fh)

    # ---- run engine, parse live frames ------------------------------------
    proc = subprocess.run(
        ["nest-engine", "-p", "spp", "-i", "/tmp/instance.json",
         "-c", "/tmp/config.json", "-s", "/tmp/out"],
        capture_output=True, text=True, timeout=BUDGET * 4,
    )
    frames = []
    for line in proc.stdout.splitlines():
        line = line.strip()
        if not line.startswith("{"):
            continue
        try:
            evt = json.loads(line)
        except json.JSONDecodeError:
            continue
        if evt.get("type") == "layout":
            frames.append(evt)

    print(f"frames live: {len(frames)}", flush=True)
    # Phase 1 = jusqu'au premier stage 'final' (report_final de la phase 1).
    final_idx = [i for i, f in enumerate(frames) if f.get("stage") == "final"]
    print(f"frames 'final': {len(final_idx)} aux index {final_idx}", flush=True)
    cut = final_idx[0] if final_idx else len(frames)
    p1 = frames[:cut]
    p2 = frames[cut:]
    for name, seg in [("phase1", p1), ("phase2", p2)]:
        if not seg:
            print(f"{name}: (aucune frame)", flush=True)
            continue
        ws = [f["strip_width"] for f in seg]
        print(f"{name}: {len(seg)} frames, strip_width min={min(ws):.1f} max={max(ws):.1f} "
              f"last={seg[-1]['strip_width']:.1f}", flush=True)
        # Preuve : frames dont les ITEMS tiennent dans la tôle mais strip_width > tôle
        bad = [f for f in seg if f["strip_width"] > SHEET_W + 0.5
               and max_x_of(f.get("items", [])) <= SHEET_W]
        print(f"  frames items-dans-la-tôle mais strip_width>{SHEET_W}: {len(bad)}/{len(seg)}",
              flush=True)
        for f in seg[-3:]:
            print(f"    sample: stage={f['stage']} sw={f['strip_width']:.1f} "
                  f"n={len(f.get('items', []))} max_x={max_x_of(f.get('items', [])):.1f} "
                  f"density={f.get('density')}", flush=True)

    # Ce que le pool navigateur garderait : meilleure frame CHAMPIONNABLE
    # (feasible + strip_width <= 1000) — miroir de localPool.liveBetter.
    champ = None
    for f in frames:
        if not f.get("feasible"):
            continue
        if f["strip_width"] > SHEET_W + 0.5:
            continue
        if champ is None or f["strip_width"] < champ["strip_width"] - 1e-4:
            champ = f
    print(f"champion navigateur (feasible & <= {SHEET_W}): "
          f"{champ['strip_width'] if champ else None}", flush=True)

    # Résultat réel du moteur (export final) — alternatives.json = LISTE
    with open("/tmp/out/alternatives.json") as fh:
        alts = json.load(fh)
    if isinstance(alts, dict):
        alts = alts.get("alternatives", [])
    for i, a in enumerate(alts[:3]):
        sol = a.get("solution") or {}
        print(f"alt#{i} bias={a.get('bias')} strip_width={sol.get('strip_width')} "
              f"density={sol.get('density')}", flush=True)
    if proc.returncode != 0:
        print("ENGINE STDERR:", proc.stderr[-800:], flush=True)


if __name__ == "__main__":
    main()
