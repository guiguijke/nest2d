"""Golden generator for the CHANNEL stage (holed_polygons.open_holes_with_
channels) — the real Python pipeline (read_dxf_file / svg_bytes_to_drawing +
build_geometry) then the production channel opener, at a fixed job spacing.

Output per file: { rings: [ [pt, ...] ] } — one ring per holed part, in part
order. Rust side: nest-channels-cli (methods difference|splice).

Run from repo root:
    python workers/geometry/parity/golden_channels.py <out_dir> <space> [corpus_dir...]
"""
import json
import os
import sys

# Prod parity: no scipy in the worker image (svgelements fallback paths).
sys.modules["scipy"] = None
sys.modules["scipy.integrate"] = None
sys.modules["scipy.special"] = None

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
sys.path.insert(0, os.path.join(REPO, "workers", "common"))
sys.path.insert(0, os.path.join(REPO, "workers", "fileprocessing"))
sys.path.insert(0, os.path.join(REPO, "workers", "nesting"))

TOLERANCE = 0.01


def process(path, space):
    from core.geometry.build_geometry import build_geometry
    from core.holed_polygons import (
        channel_width_for_space,
        channels_usable,
        open_holes_with_channels,
    )

    if path.lower().endswith(".svg"):
        from core.svg_to_drawing import svg_bytes_to_drawing

        with open(path, "rb") as f:
            drawing = svg_bytes_to_drawing(f.read())
    else:
        from dxf_utils import read_dxf_file

        drawing = read_dxf_file(path)
        if drawing is None:
            return {"error": "unreadable"}
    width = channel_width_for_space(space)
    usable = channels_usable(space)
    rings = []
    for cp in build_geometry(drawing, TOLERANCE):
        d = cp.to_mongo_dict()
        if d is None:
            continue
        holes = d.get("holes") or []
        if not holes:
            continue
        if not usable:
            # D-MOT-2 : canaux scellés → anneau externe plein (trous fermés).
            rings.append(d["coordinates"])
            continue
        ring = open_holes_with_channels(d["coordinates"], holes, width)
        rings.append(ring)
    return {"rings": rings, "space": space, "channel_width": width if usable else None}


def main():
    out_dir = sys.argv[1]
    space = float(sys.argv[2]) if len(sys.argv) > 2 else 2.0
    corpus_dirs = sys.argv[3:] or [
        os.path.join(REPO, "workers", "fileprocessing", "tests", "fixtures"),
        os.path.join(REPO, "server", "seed", "demo"),
        os.path.join(REPO, "workers", "geometry", "parity", "corpus_extra"),
        os.path.join(REPO, "workers", "geometry", "parity", "corpus_svg"),
    ]
    os.makedirs(out_dir, exist_ok=True)
    n = 0
    for d in corpus_dirs:
        for name in sorted(os.listdir(d)):
            if not name.lower().endswith((".dxf", ".svg")):
                continue
            path = os.path.join(d, name)
            try:
                golden = process(path, space)
            except Exception as e:
                golden = {"error": f"pipeline exception: {e}"}
            with open(os.path.join(out_dir, name + ".golden.json"), "w") as f:
                json.dump(golden, f)
            n += 1
    print(f"golden channels: {n} files -> {out_dir} (space={space})")


if __name__ == "__main__":
    main()
