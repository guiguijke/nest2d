"""Diagnostic qualité trou-filling à l'échelle (J-085) : 50 hôtes à trou +
200 fillers sur 1000x2000, space 2mm — réplique EXACTE de la construction
d'instance du worker (canal capillaire inclus) mais exécute le moteur NATIF
directement et mesure holesFilled par config, pour tester les leviers
(budget, patience, two_phase, phase1_ratio) sans passer par Mongo/worker.

    cd workers/nesting && PYTHONPATH=../common python bench/holes_scale.py
"""
import json
import os
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).parent
NEST = HERE.parent
sys.path.insert(0, str(NEST))
sys.path.insert(0, str(NEST.parent / "common"))

from core.nesting_input_builder import build_item, build_spp_instance, build_engine_config
from core.holed_polygons import open_holes_with_channels, channel_width_for_space
from core.placement import parse_result_containers
from core.metrics import verify_layout

ENGINE = NEST / "engine" / "target" / "release" / ("nest-engine.exe" if os.name == "nt" else "nest-engine")
PARTS = json.load(open(NEST.parent.parent / ".zcode" / "parts50.json"))

SPACE = 2.0
SHEET_W, SHEET_H = 1000.0, 2000.0
HOST_QTY, FILL_QTY = 50, 200


def input_items():
    items = []
    for iid, (key, qty) in enumerate([("trou", HOST_QTY), ("fill", FILL_QTY)]):
        coords = PARTS[key]["coords"]
        holes = PARTS[key]["holes"]
        if holes:
            coords = open_holes_with_channels(coords, holes, channel_width_for_space(SPACE))
        items.append({
            "id": iid, "file_slug": key, "coords": coords, "holes": holes,
            "count": qty, "rotations": [0, 90, 180, 270], "handles": [],
            "color": "#000",
        })
    return items


def run(extra_cfg, budget, label):
    items = input_items()
    jag = [build_item(i["id"], i["count"], i["coords"], i["rotations"]) for i in items]
    instance = build_spp_instance(jag, SHEET_W, SHEET_H, name="scale")
    cfg = build_engine_config(
        budget, 12345, 1, min_separation=SPACE, has_holes=True,
        max_strip_width=SHEET_W, n_workers=1, biases=["left"],
        plateau_patience_sec=None, separator_workers=1,
    )
    cfg.update(extra_cfg)
    import tempfile
    d = tempfile.mkdtemp()
    ip, cp = Path(d) / "i.json", Path(d) / "c.json"
    ip.write_text(json.dumps(instance))
    cp.write_text(json.dumps(cfg))
    r = subprocess.run([str(ENGINE), "-i", str(ip), "-c", str(cp), "-s", d, "-p", "spp"],
                       capture_output=True, text=True)
    if r.returncode != 0:
        print(f"[{label}] ENGINE ERROR: {r.stderr[-300:]}")
        return
    alts = json.load(open(Path(d) / "alternatives.json"))
    best = alts[0]
    sol = best["solution"]
    # SPP = layout singulier ; normaliser comme local-result.post.js.
    if "layouts" not in sol and "layout" in sol:
        sol = {**sol, "layouts": [sol["layout"]]}
    bins = {0: (SHEET_W, SHEET_H)}
    containers, placed, density, cost = parse_result_containers({"solution": sol}, items, bins)
    rep = verify_layout(containers, items, SPACE)
    print(f"[{label}] nested={rep['holesFilled']}/{FILL_QTY} placed={placed} "
          f"width={best['strip_width']:.0f} gap={rep['smallestGapMm']} overlapFree={rep['overlapFree']}",
          flush=True)


if __name__ == "__main__":
    B = int(os.environ.get("B", "13"))
    run({}, B, f"baseline {B}s")
    run({"two_phase": False}, B, f"no-2phase {B}s")
    run({}, 60, "baseline 60s")
    run({"phase1_ratio": 0.4}, 60, "phase1=0.4 60s")
