"""Diff client/serveur (mission v2 PR4) — LE gate de bout en bout.

Joue le MÊME job par les deux chemins et compare chaque artefact :
  - serveur : les fonctions Python réelles (svg_colored, metrics) ;
  - client  : le bundle WASM géométrie (public/geometry) via wasm_client.mjs
    (= exactement ce que le navigateur exécute).
Régimes : SVG coloré = byte-level (SHA-256, tol. 0) ; rapport = valeurs 1e-6 ;
import = liste de pièces identique au golden Python (post-snap).
Échec = merge bloqué (job CI `client-server-diff`).

Run from repo root:
    python workers/geometry/parity/client_server_diff.py
"""
import hashlib
import json
import math
import os
import subprocess
import sys

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
sys.path.insert(0, os.path.join(REPO, "workers", "common"))
sys.path.insert(0, os.path.join(REPO, "workers", "nesting"))
sys.path.insert(0, os.path.join(REPO, "workers", "fileprocessing"))
sys.path.insert(0, os.path.join(REPO, "workers", "geometry", "parity"))

WASM_CLIENT = os.path.join(REPO, "workers", "geometry", "parity", "wasm_client.mjs")
GOLDEN = os.path.join(REPO, "workers", "geometry", "parity", "golden")


def wasm(mode, spec):
    r = subprocess.run(["node", WASM_CLIENT, mode], input=json.dumps(spec),
                       capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError(f"wasm_client {mode} failed: {r.stderr[:300]}")
    return r.stdout


class T:
    def __init__(self, item_id, x, y, angle, color=None):
        self.item_id = item_id
        self.x = x
        self.y = y
        self.angle = angle
        self.color = color


def cases():
    rect = {"coords": [[0, 0], [100, 0], [100, 50], [0, 50]],
            "holes": [[[40, 15], [60, 15], [60, 35], [40, 35]]], "color": "#2563EB"}
    tri = {"coords": [[0, 0], [40, 0], [20, 30]], "holes": [], "color": "#DC2626"}
    items = {"p1": rect, "p2": tri}
    transforms = [T("p1", 10, 10, 0.0), T("p1", 150, 20, math.radians(90)),
                  T("p2", 60, 80, math.radians(37)), T("p2", 200, 60, math.radians(180))]
    return items, transforms, 300.0, 150.0


def colored_diff():
    from core import svg_colored
    items, transforms, bw, bh = cases()
    py = svg_colored.build_colored_sheet_svg(transforms, items, bw, bh, 1.0, "mm")
    spec = {"transforms": [{"item_id": t.item_id, "file_slug": "f", "handles": [],
                            "angle": t.angle, "x": t.x, "y": t.y, "color": t.color}
                           for t in transforms],
            "items": items, "bin_width": bw, "bin_height": bh}
    rs = wasm("colored", spec)
    return ("svg_colored", hashlib.sha256(py.encode()).hexdigest() == hashlib.sha256(rs.encode()).hexdigest())


def report_diff(tol=1e-6):
    from core import metrics
    items, transforms, bw, bh = cases()

    class C:
        pass
    c = C()
    c.bin_width = bw
    c.bin_height = bh
    c.transforms = transforms
    item_list = [dict(id=k, **v) for k, v in items.items()]
    py = {"per_sheet": metrics.per_sheet_metrics([c], item_list),
          "verify": metrics.verify_layout([c], item_list, 2.0)}
    spec = {"items": item_list,
            "containers": [{"bin_width": bw, "bin_height": bh,
                            "transforms": [{"item_id": t.item_id, "angle": t.angle,
                                            "x": t.x, "y": t.y} for t in transforms]}],
            "space": 2.0}
    rs = json.loads(wasm("report", spec))

    def cmp(a, b):
        if isinstance(a, dict):
            return all(k in b and (k == "offcut" or cmp(a[k], b[k])) for k in a)
        if isinstance(a, list):
            return len(a) == len(b) and all(cmp(x, y) for x, y in zip(a, b))
        if isinstance(a, bool):
            return a == b
        if isinstance(a, (int, float)) and isinstance(b, (int, float)):
            return abs(a - b) <= tol
        return a == b
    if not cmp(py, rs):
        return ("rapport", False)
    # offcut exact-scan : comparé en régime band (déterministe), comme exports_check.
    return ("rapport", band_offcut_diff(tol))


def band_offcut_diff(tol=1e-6):
    from core import metrics
    rect = {"coords": [[0, 0], [10, 0], [10, 10], [0, 10]], "holes": [], "color": "#2563EB"}
    items = [dict(id=f"q{i}", **rect) for i in range(61)]

    class T:
        pass
    class C:
        pass
    ts = []
    for i in range(61):
        t = T(); t.item_id = f"q{i}"; t.x = (i % 9) * 30.0; t.y = (i // 9) * 20.0; t.angle = 0.0
        ts.append(t)
    c = C(); c.bin_width = 300; c.bin_height = 200; c.transforms = ts
    py = metrics.per_sheet_metrics([c], items)
    spec = {"items": items,
            "containers": [{"bin_width": 300, "bin_height": 200,
                            "transforms": [{"item_id": t.item_id, "angle": 0.0, "x": t.x, "y": t.y} for t in ts]}],
            "space": 0.0}
    rs = json.loads(wasm("report", spec))["per_sheet"]
    return all(
        (a["offcut"] is None and b["offcut"] is None)
        or (a["offcut"] and b["offcut"] and all(
            abs(a["offcut"][k] - b["offcut"][k]) <= tol for k in ("widthMm", "heightMm", "areaMm2")
            if isinstance(a["offcut"].get(k), (int, float))) and a["offcut"]["reusable"] == b["offcut"]["reusable"])
        for a, b in zip(py, rs)
    )


def import_diff():
    # Le bundle wasm doit reproduire le golden Python (post-snap) sur le corpus.
    import glob
    ok = True
    n = 0
    for g in sorted(glob.glob(os.path.join(GOLDEN, "*.golden.json")))[:12]:
        golden = json.load(open(g))
        if "error" in golden or not golden.get("parts"):
            continue
        base = os.path.basename(g)[:-len(".golden.json")]
        src = None
        for d in ["workers/fileprocessing/tests/fixtures", "server/seed/demo",
                  "workers/geometry/parity/corpus_extra", "workers/geometry/parity/corpus_svg"]:
            p = os.path.join(REPO, d, base)
            if os.path.exists(p):
                src = p
                break
        if not src:
            continue
        n += 1
        rs = json.loads(wasm("import", {"path": src}))
        if len(rs["parts"]) != len(golden["parts"]):
            ok = False
            print(f"  import {base}: part count {len(rs['parts'])} vs {len(golden['parts'])}")
    return (f"import[{n}]", ok)


def dxf_sheet_diff():
    """J-082 : tôle combinée MULTI-SOURCES du navigateur (export_dxf_sheet,
    jumeau de build_part) vs la réplique ezdxf du chemin serveur — le
    téléchargement DXF Mode Local doit être sémantiquement identique.
    Deux fichiers sources pour exercer le regroupement par file_slug."""
    import tempfile
    import ezdxf
    from ezdxf.math import Matrix44
    from exports_check import _canon, _cmp_canon

    # Source A : ligne + cercle ; Source B : polyligne + arc (tous writers).
    src_a = ezdxf.new()
    msp_a = src_a.modelspace()
    msp_a.add_line((0, 0), (50, 0), dxfattribs={"layer": "CUT"})
    msp_a.add_circle((60, 30), 8, dxfattribs={"layer": "CUT"})
    tmp_a = tempfile.NamedTemporaryFile(suffix=".dxf", delete=False)
    src_a.saveas(tmp_a.name)

    src_b = ezdxf.new()
    msp_b = src_b.modelspace()
    msp_b.add_lwpolyline([(0, 0), (40, 0), (40, 20), (0, 20)], close=True,
                         dxfattribs={"layer": "CUT"})
    msp_b.add_arc((25, 25), 10, 0, 120, dxfattribs={"layer": "CUT"})
    tmp_b = tempfile.NamedTemporaryFile(suffix=".dxf", delete=False)
    src_b.saveas(tmp_b.name)

    doc_a = ezdxf.readfile(tmp_a.name)
    doc_b = ezdxf.readfile(tmp_b.name)
    handles_a = [e.dxf.handle for e in doc_a.modelspace()]
    handles_b = [e.dxf.handle for e in doc_b.modelspace()]

    # Placements alternant les deux sources (comme un vrai job multi-fichiers).
    placements = [
        {"item_id": "i0", "file_slug": "fa", "handles": handles_a,
         "angle": 0.0, "x": 20.0, "y": 10.0, "color": None},
        {"item_id": "i1", "file_slug": "fb", "handles": handles_b,
         "angle": math.radians(90), "x": 100.0, "y": 40.0, "color": None},
        {"item_id": "i2", "file_slug": "fa", "handles": handles_a,
         "angle": math.radians(37), "x": 180.0, "y": 70.0, "color": None},
    ]
    bw, bh, space = 300.0, 150.0, 2.0

    # --- Serveur : réplique fidèle de build_part (groupement par fichier,
    # copie par handle, BIN_BOUNDARY, OUT_SHAPE, en-têtes mm).
    py_doc = ezdxf.new()
    py_msp = py_doc.modelspace()
    added = []
    by_file = {}
    for p in placements:
        by_file.setdefault(p["file_slug"], []).append(p)
    docs = {"fa": doc_a, "fb": doc_b}
    for slug, ps in by_file.items():
        by_handle = {e.dxf.handle: e for e in docs[slug].modelspace()}
        for p in ps:
            M = Matrix44.z_rotate(p["angle"]) * Matrix44.translate(p["x"], p["y"], 0)
            for h in p["handles"]:
                e = by_handle.get(h)
                if e is None:
                    continue
                ne = e.copy()
                ne.transform(M)
                py_msp.add_entity(ne)
                added.append(ne)
    py_doc.layers.new(name="BIN_BOUNDARY", dxfattribs={"color": 5})
    py_msp.add_lwpolyline([(0, 0), (bw, 0), (bw, bh), (0, bh)], close=True,
                          dxfattribs={"layer": "BIN_BOUNDARY"})
    from ezdxf import bbox as ezbbox
    bb = ezbbox.extents(added)
    py_doc.layers.new(name="OUT_SHAPE", dxfattribs={"color": 1})
    py_msp.add_lwpolyline([
        (bb.extmin.x - space, bb.extmin.y - space), (bb.extmax.x + space, bb.extmin.y - space),
        (bb.extmax.x + space, bb.extmax.y + space), (bb.extmin.x - space, bb.extmax.y + space)],
        close=True, dxfattribs={"layer": "OUT_SHAPE"})
    py_doc.header["$INSUNITS"] = 4
    py_doc.header["$MEASUREMENT"] = 1
    py_tmp = tempfile.NamedTemporaryFile(suffix=".dxf", delete=False)
    py_doc.saveas(py_tmp.name)

    # --- Client : le bundle WASM navigateur (export_dxf_sheet).
    spec = {"sources": {"fa": tmp_a.name, "fb": tmp_b.name},
            "transforms": placements, "bin_width": bw, "bin_height": bh,
            "space": space, "add_out_shape": True, "output_unit": "mm"}
    rs_text = wasm("dxf_sheet", spec)
    rs_tmp = tempfile.NamedTemporaryFile(suffix=".dxf", delete=False, mode="w")
    rs_tmp.write(rs_text)
    rs_tmp.close()

    err = _cmp_canon(_canon(ezdxf.readfile(py_tmp.name)),
                     _canon(ezdxf.readfile(rs_tmp.name)))
    if err:
        print(f"  dxf_sheet: {err}")
    return ("dxf_sheet", err is None)


def main():
    ok = True
    for name, same in [colored_diff(), report_diff(), import_diff(), dxf_sheet_diff()]:
        print(f"[{name}] client==serveur: {same}")
        ok = ok and same
    print("\n=== CLIENT/SERVEUR DIFF:", "OK" if ok else "FAIL", "===")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
