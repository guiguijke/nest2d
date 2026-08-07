"""Golden generator: runs the REAL Python pipeline (read_dxf_file +
build_geometry + to_mongo_dict) on a DXF corpus and writes golden JSON per
file. Reference side of the parity harness (docs/PIPELINE-MAP.md §5).

Run from repo root:
    python workers/geometry/parity/golden.py <out_dir> [corpus_dir...]
"""
import json
import os
import sys

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
sys.path.insert(0, os.path.join(REPO, "workers", "common"))
sys.path.insert(0, os.path.join(REPO, "workers", "fileprocessing"))

TOLERANCE = 0.01  # demo flattening (server/seed/demo uses flattening=0.01)


def process(path):
    from dxf_utils import read_dxf_file
    from core.geometry.build_geometry import build_geometry

    drawing = read_dxf_file(path)
    if drawing is None:
        return {"error": "unreadable"}
    parts = []
    for cp in build_geometry(drawing, TOLERANCE):
        d = cp.to_mongo_dict()
        if d is None:
            continue
        parts.append({
            "coordinates": d["coordinates"],
            "holes": d.get("holes") or [],
            "width": d["width"],
            "height": d["height"],
        })
    return {
        "parts": parts,
        "source_units": getattr(drawing, "source_insunits", 0),
        "entity_count": len(drawing.modelspace()),
    }


def main():
    out_dir = sys.argv[1]
    corpus_dirs = sys.argv[2:] or [
        os.path.join(REPO, "workers", "fileprocessing", "tests", "fixtures"),
        os.path.join(REPO, "server", "seed", "demo"),
    ]
    os.makedirs(out_dir, exist_ok=True)
    n = 0
    for d in corpus_dirs:
        for name in sorted(os.listdir(d)):
            if not name.lower().endswith(".dxf"):
                continue
            path = os.path.join(d, name)
            try:
                golden = process(path)
            except Exception as e:
                golden = {"error": f"pipeline exception: {e}"}
            with open(os.path.join(out_dir, name + ".golden.json"), "w") as f:
                json.dump(golden, f)
            n += 1
    print(f"golden: {n} files -> {out_dir}")


if __name__ == "__main__":
    main()
