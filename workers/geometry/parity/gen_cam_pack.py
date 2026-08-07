"""Pack de validation CAM (mission v2 PR4, Phase 4) — préparé par l'agent,
exécuté par Guillaume dans SheetCam puis FluidNC.

Génère 4 DXF via le chemin Rust (export AC1027, BIN_BOUNDARY/OUT_SHAPE) :
  1. pièce simple (rectangle + congé/bulge),
  2. pièce à trous avec canaux (collision ouverte),
  3. job multi-pièces avec rotations (0/90/37°),
  4. même job multi-pièces en sortie INCH (unités).
Les fichiers sont relus par ezdxf (round-trip) avant écriture pour garantir
qu'ils sont lisibles ; la fiche test donne les critères SheetCam/FluidNC.

Run from repo root:
    python workers/geometry/parity/gen_cam_pack.py
"""
import json
import math
import os
import subprocess
import sys

import ezdxf

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
CLI = os.path.join(REPO, "workers", "geometry", "target", "release",
                   "nest-export-cli.exe" if os.name == "nt" else "nest-export-cli")
OUT = os.path.join(REPO, "docs", "cam-validation")


def save_source(doc, name):
    p = os.path.join(OUT, f"_src_{name}.dxf")
    doc.saveas(p)
    return p


def export(name, src_path, transforms, unit="mm", out_shape=True):
    spec = {"mode": "dxf", "sources": {"src": src_path}, "transforms": transforms,
            "bin_width": 300, "bin_height": 150, "space": 2.0,
            "add_out_shape": out_shape, "output_unit": unit}
    r = subprocess.run([CLI], input=json.dumps(spec), capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError(f"export {name}: {r.stderr[:200]}")
    out = os.path.join(OUT, f"{name}.dxf")
    with open(out, "w") as f:
        f.write(r.stdout)
    # round-trip ezdxf (lisibilité garantie)
    ezdxf.readfile(out)
    return out


def main():
    os.makedirs(OUT, exist_ok=True)

    # 1. pièce simple avec bulge (congé)
    d = ezdxf.new()
    m = d.modelspace()
    m.add_lwpolyline([(0, 0, 0.0), (80, 0, 0.3), (80, 40, 0.0), (0, 40, 0.0)],
                     format="xyb", close=True, dxfattribs={"layer": "CUT"})
    s1 = save_source(d, "simple")
    export("cam_1_piece_simple", s1,
           [{"item_id": "a", "file_slug": "src", "handles": handles(d), "angle": 0.0, "x": 20, "y": 20, "color": None}])

    # 2. pièce à trous (canaux ouverts via collision)
    d = ezdxf.new()
    m = d.modelspace()
    m.add_lwpolyline([(0, 0), (120, 0), (120, 80), (0, 80)], close=True, dxfattribs={"layer": "CUT"})
    m.add_circle((40, 40), 15, dxfattribs={"layer": "CUT"})
    m.add_circle((85, 40), 10, dxfattribs={"layer": "CUT"})
    s2 = save_source(d, "holed")
    export("cam_2_piece_trous", s2,
           [{"item_id": "a", "file_slug": "src", "handles": handles(d), "angle": 0.0, "x": 30, "y": 20, "color": None}])

    # 3. job multi-pièces avec rotations (mm)
    d = ezdxf.new()
    m = d.modelspace()
    m.add_lwpolyline([(0, 0), (60, 0), (60, 30), (0, 30)], close=True, dxfattribs={"layer": "CUT"})
    m.add_lwpolyline([(0, 0), (30, 0), (15, 25)], close=True, dxfattribs={"layer": "CUT"})
    m.add_circle((0, 0), 12, dxfattribs={"layer": "CUT"})
    s3 = save_source(d, "multi")
    hs = handles(d)
    export("cam_3_multi_rotations_mm", s3, [
        {"item_id": "a", "file_slug": "src", "handles": [hs[0]], "angle": 0.0, "x": 20, "y": 20, "color": None},
        {"item_id": "b", "file_slug": "src", "handles": [hs[1]], "angle": math.radians(90), "x": 120, "y": 30, "color": None},
        {"item_id": "c", "file_slug": "src", "handles": [hs[2]], "angle": math.radians(37), "x": 200, "y": 60, "color": None},
    ])

    # 4. même job en inch
    export("cam_4_multi_rotations_inch", s3, [
        {"item_id": "a", "file_slug": "src", "handles": [hs[0]], "angle": 0.0, "x": 20, "y": 20, "color": None},
        {"item_id": "b", "file_slug": "src", "handles": [hs[1]], "angle": math.radians(90), "x": 120, "y": 30, "color": None},
    ], unit="inch")

    print(f"pack CAM -> {OUT} ({len([f for f in os.listdir(OUT) if f.startswith('cam_')])} DXF)")


def handles(doc):
    return [e.dxf.handle for e in doc.modelspace()]


if __name__ == "__main__":
    main()
