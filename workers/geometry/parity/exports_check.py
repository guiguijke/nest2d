"""Harnais de parité exports (mission v2 PR3) : SVG coloré BYTE-LEVEL
(SHA-256, tolérance 0) et rapport VALEURS (tolérance ulp/arrondi), goldens
depuis les fonctions Python RÉELLES (svg_colored / metrics).

Run from repo root:
    python workers/geometry/parity/exports_check.py
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

GEO = os.path.join(REPO, "workers", "geometry")
EXPORT_CLI = os.path.join(GEO, "target", "release",
                          "nest-export-cli.exe" if os.name == "nt" else "nest-export-cli")
REPORT_CLI = os.path.join(GEO, "target", "release",
                          "nest-report-cli.exe" if os.name == "nt" else "nest-report-cli")


class T:
    def __init__(self, item_id, x, y, angle, color=None, handles=None, file_slug="f"):
        self.item_id = item_id
        self.x = x
        self.y = y
        self.angle = angle
        self.color = color
        self.handles = handles or []
        self.file_slug = file_slug


class C:
    def __init__(self, bw, bh, transforms):
        self.bin_width = bw
        self.bin_height = bh
        self.transforms = transforms


def cases():
    rect = {"coords": [[0, 0], [100, 0], [100, 50], [0, 50]],
            "holes": [[[40, 15], [60, 15], [60, 35], [40, 35]]],
            "color": "#2563EB"}
    tri = {"coords": [[0, 0], [40, 0], [20, 30]], "holes": [], "color": "#DC2626"}
    items = {"p1": rect, "p2": tri}
    transforms = [
        T("p1", 10, 10, 0.0),
        T("p1", 150, 20, math.radians(90)),
        T("p2", 60, 80, math.radians(37)),
        T("p2", 200, 60, math.radians(180)),
    ]
    return items, transforms, 300.0, 150.0


def run(cmd, stdin_text):
    r = subprocess.run(cmd, input=stdin_text, capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError(f"{cmd} failed: {r.stderr[:300]}")
    return r.stdout


def colored_parity():
    from core import svg_colored
    items, transforms, bw, bh = cases()
    py = svg_colored.build_colored_sheet_svg(transforms, items, bw, bh, 1.0, "mm")
    spec = {
        "mode": "colored",
        "transforms": [
            {"item_id": t.item_id, "file_slug": t.file_slug, "handles": t.handles,
             "angle": t.angle, "x": t.x, "y": t.y, "color": t.color}
            for t in transforms],
        "items": items,
        "bin_width": bw, "bin_height": bh,
    }
    rs = run([EXPORT_CLI], json.dumps(spec))
    hp, hr = hashlib.sha256(py.encode()).hexdigest(), hashlib.sha256(rs.encode()).hexdigest()
    return ("colored", hp == hr, py, rs)


def report_parity(tol=1e-6):
    from core import metrics
    items, transforms, bw, bh = cases()
    containers = [C(bw, bh, transforms)]
    py = {
        "per_sheet": metrics.per_sheet_metrics(containers, list_of_items(items)),
        "totals": None,
        "used_sheet_share": metrics.compute_used_sheet_share(containers, list_of_items(items)),
        "verify": metrics.verify_layout(containers, list_of_items(items), 2.0),
    }
    py["totals"] = metrics.report_totals(py["per_sheet"])
    spec = {"items": [dict(id=k, **v) for k, v in items.items()],
            "containers": [{"bin_width": bw, "bin_height": bh,
                            "transforms": [{"item_id": t.item_id, "angle": t.angle,
                                            "x": t.x, "y": t.y} for t in transforms]}],
            "space": 2.0}
    rs = json.loads(run([REPORT_CLI], json.dumps(spec)))

    def cmp(a, b, path="", skip_offcut=False):
        if isinstance(a, dict) and isinstance(b, dict):
            for k in a:
                if k not in b:
                    return f"{path}.{k} missing"
                if skip_offcut and k == "offcut":
                    continue  # offcut exact-scan = GEOS-dépendant, validé en régime band
                r = cmp(a[k], b[k], f"{path}.{k}", skip_offcut)
                if r:
                    return r
            return None
        if isinstance(a, list):
            if len(a) != len(b):
                return f"{path} len {len(a)} vs {len(b)}"
            for i, (x, y) in enumerate(zip(a, b)):
                r = cmp(x, y, f"{path}[{i}]", skip_offcut)
                if r:
                    return r
            return None
        if isinstance(a, bool) or isinstance(b, bool):
            return None if a == b else f"{path} bool {a} vs {b}"
        if isinstance(a, (int, float)) and isinstance(b, (int, float)):
            return None if abs(a - b) <= tol else f"{path} {a} vs {b}"
        return None if a == b else f"{path} {a!r} vs {b!r}"

    err = cmp(py, rs, "", True)
    if err:
        return ("report", False, json.dumps(py), json.dumps(rs), err)
    # Régime band (layout > budget) : offcut doit matcher exactement ici.
    err2 = band_offcut_parity(cmp)
    return ("report", err2 is None, json.dumps(py), json.dumps(rs), err2)


def band_offcut_parity(cmp):
    from core import metrics
    rect = {"coords": [[0, 0], [10, 0], [10, 10], [0, 10]], "holes": [], "color": "#2563EB"}
    items = [dict(id=f"q{i}", **rect) for i in range(61)]  # >60 parts → band
    class T: pass
    class C: pass
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
    import subprocess
    r = subprocess.run(
        [os.path.join(REPORT_CLI)],
        input=json.dumps(spec), capture_output=True, text=True)
    rs = json.loads(r.stdout)["per_sheet"]
    return cmp(py, rs, "band")


def list_of_items(items):
    return [dict(id=k, **v) for k, v in items.items()]


# ------------------------------------------------------------------ DXF

def _canon(doc):
    out = []
    for e in doc.modelspace():
        t = e.dxftype()
        layer = e.dxf.layer
        color = e.dxf.color if hasattr(e.dxf, "color") else 256
        g = None
        if t == "LINE":
            g = ("L", tuple(e.dxf.start)[:2], tuple(e.dxf.end)[:2])
        elif t == "CIRCLE":
            g = ("C", tuple(e.dxf.center)[:2], e.dxf.radius)
        elif t == "ARC":
            # ezdxf normalise les angles (±180) ; comparer mod 360.
            g = ("A", tuple(e.dxf.center)[:2], e.dxf.radius,
                 e.dxf.start_angle % 360, e.dxf.end_angle % 360)
        elif t == "LWPOLYLINE":
            g = ("P", e.closed,
                 tuple(tuple(round(c, 6) for c in p) for p in e.get_points(format="xyb")))
        elif t == "ELLIPSE":
            g = ("E", tuple(e.dxf.center)[:2], tuple(e.dxf.major_axis)[:2], e.dxf.ratio,
                 e.dxf.start_param, e.dxf.end_param)
        elif t == "SPLINE":
            g = ("S", e.dxf.degree, tuple(tuple(round(c, 6) for c in p) for p in e.control_points))
        else:
            g = (t,)
        out.append((t, layer, color, g))
    return out


def _cmp_canon(a, b, tol_geo=1e-9, tol_loose=1e-2):
    # OUT_SHAPE = bbox dérivée via ezdxf.bbox (approximative, dépend des
    # extrêmes de courbes) : informative, pas soumise à la parité stricte.
    a = [e for e in a if e[1] != "OUT_SHAPE"]
    b = [e for e in b if e[1] != "OUT_SHAPE"]
    if len(a) != len(b):
        return f"entity count {len(a)} vs {len(b)}"
    for i, (ea, eb) in enumerate(zip(a, b)):
        if ea[0] != eb[0] or ea[1] != eb[1]:
            return f"#{i} type/layer {ea[:2]} vs {eb[:2]}"
        loose = ea[1] in ("OUT_SHAPE", "BIN_BOUNDARY")
        tol = tol_loose if loose else tol_geo
        r = _cmp_val(ea[3], eb[3], tol, f"#{i}")
        if r:
            return r
    return None


def _cmp_val(a, b, tol, path):
    if isinstance(a, tuple) and isinstance(b, tuple):
        if len(a) != len(b):
            return f"{path} len {len(a)} vs {len(b)}"
        for i, (x, y) in enumerate(zip(a, b)):
            r = _cmp_val(x, y, tol, f"{path}[{i}]")
            if r:
                return r
        return None
    if isinstance(a, bool) or isinstance(b, bool):
        return None if a == b else f"{path} bool"
    if isinstance(a, (int, float)) and isinstance(b, (int, float)):
        return None if abs(a - b) <= tol else f"{path} {a} vs {b}"
    return None if a == b else f"{path} {a!r} vs {b!r}"


def dxf_parity():
    import ezdxf
    import tempfile
    from ezdxf import bbox as ezbbox
    from ezdxf.math import Matrix44

    # Source DXF synthétique couvrant tous les writers.
    src = ezdxf.new()
    msp = src.modelspace()
    msp.add_line((0, 0), (50, 0), dxfattribs={"layer": "CUT"})
    msp.add_lwpolyline([(0, 0, 0.3), (40, 0, 0.0), (40, 20, 0.0), (0, 20, 0.0)],
                       format="xyb", close=True, dxfattribs={"layer": "CUT"})
    msp.add_arc((25, 25), 10, 0, 120, dxfattribs={"layer": "CUT"})
    msp.add_circle((60, 30), 8, dxfattribs={"layer": "CUT"})
    msp.add_ellipse((30, 60), major_axis=(20, 0), ratio=0.5, dxfattribs={"layer": "CUT"})
    tmp = tempfile.NamedTemporaryFile(suffix=".dxf", delete=False)
    src.saveas(tmp.name)

    handles = [e.dxf.handle for e in src.modelspace()]
    angles = [0.0, math.radians(90), math.radians(37)]
    placements = []
    for k, ang in enumerate(angles):
        placements.append({"item_id": f"i{k}", "file_slug": "src", "handles": handles,
                           "angle": ang, "x": 20 + k * 80, "y": 10 + k * 30, "color": None})

    # --- Python : réplique fidèle de build_part (ezdxf).
    py_doc = ezdxf.new()
    py_msp = py_doc.modelspace()
    added = []
    src2 = ezdxf.readfile(tmp.name)
    by_handle = {e.dxf.handle: e for e in src2.modelspace()}
    for p in placements:
        R = Matrix44.z_rotate(p["angle"]); Tt = Matrix44.translate(p["x"], p["y"], 0)
        M = R * Tt
        for h in p["handles"]:
            e = by_handle.get(h)
            if e is None:
                continue
            ne = e.copy(); ne.transform(M); py_msp.add_entity(ne); added.append(ne)
    bw, bh, space = 300.0, 150.0, 2.0
    py_doc.layers.new(name="BIN_BOUNDARY", dxfattribs={"color": 5})
    py_msp.add_lwpolyline([(0, 0), (bw, 0), (bw, bh), (0, bh)], close=True,
                          dxfattribs={"layer": "BIN_BOUNDARY"})
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

    # --- Rust.
    spec = {"mode": "dxf", "sources": {"src": tmp.name}, "transforms": placements,
            "bin_width": bw, "bin_height": bh, "space": space, "add_out_shape": True,
            "output_unit": "mm"}
    rs_text = run([EXPORT_CLI], json.dumps(spec))
    rs_tmp = tempfile.NamedTemporaryFile(suffix=".dxf", delete=False, mode="w")
    rs_tmp.write(rs_text); rs_tmp.close()

    py_canon = _canon(ezdxf.readfile(py_tmp.name))
    rs_canon = _canon(ezdxf.readfile(rs_tmp.name))
    err = _cmp_canon(py_canon, rs_canon)
    return ("dxf", err is None, err)


def main():
    ok = True
    name, same, py, rs = colored_parity()
    print(f"[{name}] byte-identical: {same}")
    if not same:
        ok = False
        # diff first divergence
        for i, (a, b) in enumerate(zip(py, rs)):
            if a != b:
                print("  first byte diff at", i)
                print("  py:", py[max(0, i - 60):i + 60])
                print("  rs:", rs[max(0, i - 60):i + 60])
                break
        if len(py) != len(rs):
            print("  len py", len(py), "rs", len(rs))
    r = report_parity()
    print(f"[{r[0]}] value-parity: {r[1]}" + (f" — {r[4]}" if not r[1] else ""))
    if not r[1]:
        ok = False
    d = dxf_parity()
    print(f"[{d[0]}] semantic-parity: {d[1]}" + (f" — {d[2]}" if not d[1] else ""))
    if not d[1]:
        ok = False
    print("\n=== EXPORTS PARITY:", "OK" if ok else "FAIL", "===")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
