"""Generates the demo project's DXF set (marine sheet-metal parts) into
server/seed/demo/ + manifest.json. Run from the repo root:

    python scripts/generate_demo_dxf.py

The shapes are parametric and authored in canonical mm ($INSUNITS=4 +
$MEASUREMENT=1 — ezdxf.new() would otherwise declare METERS, see AGENTS.md
trap #27). Curved outlines use real ARC entities noded with LINEs (the
import pipeline flattens LWPOLYLINEs as straight vertices — bulge codes are
ignored), so the demo exercises the exact production import path (linework
noding + polygonize, even-odd hole detection, random part colors) and
showcases hole filling (frames/flanges host small parts in their cutouts).

Prints the exact net area per file (ezdxf.path flattening + shoelace) so the
manifest quantities can be tuned to fill ~70 % of the 3000x1500 demo sheet.
"""
import json
import math
from pathlib import Path

import ezdxf
from ezdxf import path as ezpath

OUT_DIR = Path(__file__).parent.parent / "server" / "seed" / "demo"


# ---------------------------------------------------------------------------
# shape builders — each returns a list of entity specs:
#   ("poly", [(x, y), ...])        LWPOLYLINE (outer profile, close=True)
#   ("line", (x1, y1, x2, y2))     LINE
#   ("arc",  (cx, cy, r, a0, a1))  ARC (degrees, CCW from a0 to a1)
#   ("circle", (cx, cy, r))        hole (even-odd rule turns it into a cutout)
#
# NOTE: no LWPOLYLINE bulges on purpose — the import pipeline flattens
# LWPOLYLINEs as straight vertices (bulge codes are ignored), so curved
# outlines are built from real ARC entities noded with LINEs instead.
# ---------------------------------------------------------------------------

def pentagon(w=60, h_body=45, h_roof=25):
    return [("poly", [
        (0, 0), (w, 0), (w, h_body),
        (w / 2, h_body + h_roof), (0, h_body),
    ])]


def gusset(a=90, b=90):
    return [("poly", [(0, 0), (a, 0), (0, b)])]


def right_triangle(a=100, b=80):
    return [("poly", [(0, 0), (a, 0), (a, b)])]


def trapezoid_hole(w_bot=160, w_top=140, h=90, hole_d=20):
    dx = (w_bot - w_top) / 2
    return [
        ("poly", [(0, 0), (w_bot, 0), (w_bot - dx, h), (dx, h)]),
        ("circle", (w_bot / 2, h / 2, hole_d / 2)),
    ]


def l_bracket(w=120, h=120, t=25):
    return [("poly", [
        (0, 0), (w, 0), (w, t), (t, t), (t, h), (0, h),
    ])]


def bar(w=15, h=80):
    return [("poly", [(0, 0), (w, 0), (w, h), (0, h)])]


def oblong(length=160, d=30):
    r = d / 2
    half = length / 2 - r
    return [
        ("line", (-half, -r, half, -r)),
        ("arc", (half, 0, r, -90, 90)),
        ("line", (half, r, -half, r)),
        ("arc", (-half, 0, r, 90, 270)),
    ]


def d_shape(r=45):
    return [
        ("line", (-r, 0, r, 0)),
        ("arc", (0, 0, r, 0, 180)),
    ]


def j_hook(w=40, h=100, t=20):
    return [("poly", [
        (0, 0), (w, 0), (w, t), (t, t), (t, h), (0, h),
    ])]


def quarter_disk(r=70):
    return [
        ("line", (0, 0, r, 0)),
        ("arc", (0, 0, r, 0, 90)),
        ("line", (0, r, 0, 0)),
    ]


def quarter_ring(r_out=90, r_in=60, angle_deg=90):
    a = math.radians(angle_deg)
    p_out = (r_out * math.cos(a), r_out * math.sin(a))
    p_in = (r_in * math.cos(a), r_in * math.sin(a))
    return [
        ("line", (r_in, 0, r_out, 0)),
        ("arc", (0, 0, r_out, 0, angle_deg)),
        ("line", (p_out[0], p_out[1], p_in[0], p_in[1])),
        ("arc", (0, 0, r_in, 0, angle_deg)),
    ]


def frame(w=420, h=300, t=40):
    return [
        ("poly", [(0, 0), (w, 0), (w, h), (0, h)]),
        ("poly", [(t, t), (w - t, t), (w - t, h - t), (t, h - t)]),
    ]


def flange(r_out=130, r_in=65, bolt_d=20, bolt_circle=95, bolts=4):
    entities = [("circle", (0, 0, r_out)), ("circle", (0, 0, r_in))]
    for i in range(bolts):
        a = math.radians(45 + i * 360 / bolts)
        entities.append(("circle", (bolt_circle * math.cos(a),
                                    bolt_circle * math.sin(a), bolt_d / 2)))
    return entities


def u_stiffener(w=350, h=200, t=30):
    return [("poly", [
        (0, 0), (w, 0), (w, h), (w - t, h),
        (w - t, t), (t, t), (t, h), (0, h),
    ])]


def notched_plate(w, h, top=(), bottom=(), holes=()):
    """Rectangular plate with rectangular notches on the top and/or bottom
    edge. top/bottom: tuples of (center_x, width, depth). holes: (cx, cy, d)."""
    pts = [(0.0, 0.0)]
    # bottom edge, left -> right (notches go UP into the plate)
    for cx, nw, nd in sorted(bottom):
        pts += [(cx - nw / 2, 0), (cx - nw / 2, nd),
                (cx + nw / 2, nd), (cx + nw / 2, 0)]
    pts += [(w, 0), (w, h)]
    # top edge, right -> left (notches go DOWN into the plate)
    for cx, nw, nd in sorted(top, reverse=True):
        pts += [(cx + nw / 2, h), (cx + nw / 2, h - nd),
                (cx - nw / 2, h - nd), (cx - nw / 2, h)]
    pts.append((0, h))
    entities = [("poly", pts)]
    entities += [("circle", (cx, cy, d / 2)) for cx, cy, d in holes]
    return entities


def rounded_notched_plate(w, h, r_corner, top=(), holes=()):
    """Notched plate with a rounded top-right corner (real ARC entity noded
    with the straight linework — the pipeline polygonizes them together)."""
    head = [
        ("line", (0, 0, w, 0)),
        ("line", (w, 0, w, h - r_corner)),
        ("arc", (w - r_corner, h - r_corner, r_corner, 0, 90)),
    ]
    pts = [(w - r_corner, h)]
    for cx, nw, nd in sorted(top, reverse=True):
        if cx + nw / 2 > w - r_corner:
            continue  # keep the rounded corner clear of notches
        pts += [(cx + nw / 2, h), (cx + nw / 2, h - nd),
                (cx - nw / 2, h - nd), (cx - nw / 2, h)]
    pts += [(0, h), (0, 0)]
    entities = head + [("poly_open", pts)]
    entities += [("circle", (cx, cy, d / 2)) for cx, cy, d in holes]
    return entities


# ---------------------------------------------------------------------------
# the demo set — (filename, builder, quantity)
# Quantities aim for ~3.2 M mm2 net area (~70 % of the 3000x1500 sheet).
# ---------------------------------------------------------------------------
PARTS = [
    ("marine_lpl_001", pentagon(60, 45, 25), 40),
    ("marine_lpl_002", gusset(90, 90), 24),
    ("marine_lpl_003", trapezoid_hole(160, 140, 90, 20), 14),
    ("marine_lpl_004", notched_plate(200, 120, top=[(60, 25, 18), (140, 25, 18)],
                                     holes=[(45, 55, 25), (155, 55, 25)]), 5),
    ("marine_lpl_005", l_bracket(120, 120, 25), 14),
    ("marine_lpl_006", bar(15, 80), 20),
    ("marine_lpl_007", trapezoid_hole(150, 120, 110, 22), 14),
    ("marine_lpl_008", oblong(160, 30), 12),
    ("marine_lpl_009", d_shape(45), 10),
    ("marine_lpl_010", j_hook(40, 100, 20), 12),
    ("marine_lpl_011", quarter_disk(70), 10),
    ("marine_lpl_012", notched_plate(260, 140, bottom=[(50, 22, 25), (130, 22, 25), (210, 22, 25)],
                                     holes=[(65, 80, 30), (195, 80, 30)]), 9),
    ("marine_lpl_013", rounded_notched_plate(240, 130, 55, top=[(80, 24, 20)],
                                             holes=[(60, 60, 28), (180, 60, 28)]), 9),
    ("marine_lpl_014", quarter_ring(90, 60, 90), 6),
    ("marine_lpl_015", quarter_ring(110, 75, 90), 6),
    ("marine_lpl_016", notched_plate(300, 150, bottom=[(75, 30, 28), (225, 30, 28)],
                                     holes=[(80, 85, 35), (220, 85, 35)]), 5),
    ("marine_lpl_017", notched_plate(260, 140, bottom=[(70, 26, 24), (190, 26, 24)],
                                     holes=[(70, 80, 32), (190, 80, 32)]), 7),
    ("marine_lpl_018", notched_plate(180, 110, bottom=[(50, 22, 20), (130, 22, 20)],
                                     holes=[(50, 60, 26), (130, 60, 26)]), 5),
    ("marine_lpl_019", right_triangle(100, 80), 36),
    ("marine_lpl_020", notched_plate(210, 130, top=[(55, 24, 20), (105, 24, 20), (155, 24, 20)],
                                     holes=[(60, 60, 24), (150, 60, 24)]), 6),
    ("marine_lpl_021", frame(420, 300, 40), 8),
    ("marine_lpl_022", flange(130, 65, 20, 95, 4), 9),
    ("marine_lpl_023", quarter_ring(120, 80, 60), 16),
    ("marine_lpl_024", u_stiffener(350, 200, 30), 7),
]


def write_dxf(entities):
    doc = ezdxf.new("R2010")
    # Canonical mm — never leave ezdxf's default METERS on a rebuilt doc.
    doc.header["$INSUNITS"] = 4
    doc.header["$MEASUREMENT"] = 1
    msp = doc.modelspace()
    for kind, spec in entities:
        if kind == "poly":
            msp.add_lwpolyline(spec, close=True)
        elif kind == "poly_open":
            msp.add_lwpolyline(spec, close=False)
        elif kind == "line":
            msp.add_line((spec[0], spec[1]), (spec[2], spec[3]))
        elif kind == "arc":
            msp.add_arc((spec[0], spec[1]), spec[2], spec[3], spec[4])
        elif kind == "circle":
            msp.add_circle((spec[0], spec[1]), spec[2])
    return doc


def net_area(doc):
    """Exact net material area: largest closed contour minus everything else
    (bulges and circles flattened through ezdxf.path, then shoelace)."""
    areas = []
    for entity in doc.modelspace():
        p = ezpath.make_path(entity)
        pts = [(v.x, v.y) for v in p.flattening(0.25)]
        if len(pts) < 3:
            continue
        area = abs(sum(
            pts[i][0] * pts[(i + 1) % len(pts)][1]
            - pts[(i + 1) % len(pts)][0] * pts[i][1]
            for i in range(len(pts))
        )) / 2
        areas.append(area)
    if not areas:
        return 0.0
    return 2 * max(areas) - sum(areas)


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    manifest = []
    grand_total = 0.0
    total_parts = 0
    print(f"{'file':<18} {'area cm2':>9} {'qty':>4} {'total cm2':>10}")
    for name, entities, qty in PARTS:
        doc = write_dxf(entities)
        doc.saveas(OUT_DIR / f"{name}.dxf")
        area = net_area(doc)
        grand_total += area * qty
        total_parts += qty
        manifest.append({"file": f"{name}.dxf", "name": f"{name}.dxf", "quantity": qty})
        print(f"{name:<18} {area / 100:>9.1f} {qty:>4} {area * qty / 100:>10.1f}")

    (OUT_DIR / "manifest.json").write_text(
        json.dumps(manifest, indent=2) + "\n", encoding="utf-8"
    )
    sheet = 3000 * 1500
    print(f"\n{len(PARTS)} files, {total_parts} parts, "
          f"net area {grand_total / 1e6:.2f} M mm2 "
          f"= {grand_total / sheet * 100:.1f}% of one 3000x1500 sheet")


if __name__ == "__main__":
    main()
