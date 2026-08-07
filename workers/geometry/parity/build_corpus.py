"""Extended corpus generator for the parity harness (docs/PIPELINE-MAP.md §5):
broken/representative DXFs built with ezdxf — units variants, bulges,
INSERT blocks (nested), ellipse/spline entities, text-only, zero entities,
HATCH, duplicate handles (recover path).

Run from repo root: python workers/geometry/parity/build_corpus.py
"""
import math
import os

import ezdxf

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
OUT = os.path.join(REPO, "workers", "geometry", "parity", "corpus_extra")


def new_doc(insunits=4):
    doc = ezdxf.new("R2010")
    doc.header["$INSUNITS"] = insunits
    return doc


def save(doc, name):
    doc.saveas(os.path.join(OUT, name))


def main():
    os.makedirs(OUT, exist_ok=True)

    # --- units variants: same 100x50 rectangle authored in foreign units
    for code, factor, tag in [(1, 25.4, "in"), (2, 304.8, "ft"), (5, 10.0, "cm"), (6, 1000.0, "m"), (9, 0.0254, "mil")]:
        doc = new_doc(code)
        doc.modelspace().add_lwpolyline(
            [(0, 0), (100 / factor, 0), (100 / factor, 50 / factor), (0, 50 / factor)], close=True
        )
        save(doc, f"units_{tag}.dxf")

    # --- unitless (0) and unknown (7)
    for code, tag in [(0, "none"), (7, "unknown")]:
        doc = new_doc(code)
        doc.modelspace().add_lwpolyline([(0, 0), (80, 0), (80, 40), (0, 40)], close=True)
        save(doc, f"units_{tag}.dxf")

    # --- bulges ignored (D-IMP-8): a "stadium" authored with bulges reads as chords
    doc = new_doc()
    e = doc.modelspace().add_lwpolyline(
        [(0, 0), (100, 0), (100, 50), (0, 50)], close=True
    )
    # add a bulge on segment 1 (semicircle) — Python ignores it (get_points xy)
    e[1] = (100, 0, 0, 0, 1.0)  # x, y, start_width, end_width, bulge
    save(doc, "bulge_ignored.dxf")

    # --- INSERT blocks (nested)
    doc = new_doc()
    blk = doc.blocks.new(name="INNER")
    blk.add_lwpolyline([(0, 0), (20, 0), (20, 20), (0, 20)], close=True)
    outer = doc.blocks.new(name="OUTER")
    outer.add_circle((5, 5), 3)
    outer.add_blockref("INNER", insert=(10, 10))
    doc.modelspace().add_blockref("OUTER", insert=(100, 100))
    doc.modelspace().add_blockref("INNER", insert=(0, 0))
    save(doc, "blocks_nested.dxf")

    # --- ellipse + spline + arc mix
    doc = new_doc()
    doc.modelspace().add_ellipse((0, 0), major_axis=(60, 0), ratio=0.5)
    sp = doc.modelspace().add_spline(degree=3)
    sp.control_points = [(0, 0), (30, 80), (60, 0), (90, 80), (120, 0)]
    doc.modelspace().add_arc((0, 0), 50, 20, 250)
    save(doc, "curves_mix.dxf")

    # --- text-only file (zero linework)
    doc = new_doc()
    doc.modelspace().add_text("hello")
    save(doc, "text_only.dxf")

    # --- zero entities
    doc = new_doc()
    save(doc, "empty.dxf")

    # --- HATCH (pattern) — documented divergence (skipped in Rust)
    doc = new_doc()
    doc.modelspace().add_lwpolyline([(0, 0), (50, 0), (50, 50), (0, 50)], close=True)
    h = doc.modelspace().add_hatch()
    h.set_pattern_fill("ANSI31", scale=5.0)
    h.paths.add_polyline_path([(0, 0), (50, 0), (50, 50), (0, 50)], is_closed=True)
    save(doc, "hatch_pattern.dxf")

    # --- legacy POLYLINE with SEQEND
    doc = new_doc()
    pl = doc.modelspace().add_polyline2d([(0, 0), (70, 0), (70, 70), (0, 70)], close=True)
    save(doc, "legacy_polyline.dxf")

    # --- duplicate handles (recover path): two identical squares
    doc = new_doc()
    doc.modelspace().add_lwpolyline([(0, 0), (10, 0), (10, 10), (0, 10)], close=True)
    doc.modelspace().add_lwpolyline([(20, 20), (30, 20), (30, 30), (20, 30)], close=True)
    save(doc, "two_parts.dxf")

    print(f"extended corpus -> {OUT} ({len(os.listdir(OUT))} files)")




# ---------------------------------------------------------------- SVG corpus
SVG_OUT = os.path.join(REPO, "workers", "geometry", "parity", "corpus_svg")


def save_svg(text, name):
    with open(os.path.join(SVG_OUT, name), "w", encoding="utf-8") as f:
        f.write(text)


def main_svg():
    os.makedirs(SVG_OUT, exist_ok=True)

    # unités physiques variées (même géométrie, mm/cm/in/pt/px)
    for unit in ["mm", "cm", "in", "pt", "px", ""]:
        w = {"mm": "100mm", "cm": "10cm", "in": "3.937007874015748in",
             "pt": "283.46456692913387pt", "px": "377.9527559055118", "": "100"}[unit]
        tag = unit or "none"
        save_svg(
            f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="50{unit}">'
            f'<rect x="0" y="0" width="80" height="40"/></svg>',
            f"svg_units_{tag}.svg",
        )

    # viewBox seul (pas de width/height) + viewBox mismatch avec width mm
    save_svg(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300">'
        '<rect x="10" y="10" width="180" height="120"/></svg>',
        "svg_viewbox_only.svg",
    )
    save_svg(
        '<svg xmlns="http://www.w3.org/2000/svg" width="300mm" height="200mm" viewBox="0 0 300 200">'
        '<circle cx="100" cy="70" r="25"/></svg>',
        "svg_viewbox_mm_mismatch.svg",
    )

    # transforms imbriquées (groupes cascadés, rotate/scale/translate)
    save_svg(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 500 500">'
        '<g transform="translate(50,50)"><g transform="scale(2) rotate(15)">'
        '<rect x="0" y="0" width="60" height="30"/>'
        '<circle cx="100" cy="100" r="20"/>'
        '</g></g></svg>',
        "svg_nested_transforms.svg",
    )

    # chemins ouverts (linework) + fermés, courbes C/S/Q/T, arcs A, relatif
    save_svg(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 500 500">'
        '<path d="M10 400 C 60 380, 140 420, 190 400 S 300 370, 350 400"/>'
        '<path d="M20 20 Q 60 80 120 20 T 220 20"/>'
        '<path d="m 300 300 l 40 0 l 0 40 l -40 0 z"/>'
        '<path d="M 50 250 A 30 20 0 1 1 120 280 A 30 20 30 0 0 50 250 Z"/>'
        '</svg>',
        "svg_curves_arcs.svg",
    )

    # formes : polyline ouverte, polygon, line, rounded rect, ellipse
    save_svg(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 500 500">'
        '<polyline points="10,10 90,10 90,60"/>'
        '<polygon points="110,10 190,10 150,60"/>'
        '<line x1="200" y1="10" x2="290" y2="60"/>'
        '<rect x="300" y="10" width="80" height="50" rx="12"/>'
        '<ellipse cx="80" cy="150" rx="60" ry="25"/>'
        '</svg>',
        "svg_shapes.svg",
    )

    # zéro géométrie convertible (texte seul) + fichier vide de sens
    save_svg(
        '<svg xmlns="http://www.w3.org/2000/svg"><text x="10" y="10">hello</text></svg>',
        "svg_text_only.svg",
    )
    save_svg('<svg xmlns="http://www.w3.org/2000/svg"></svg>', "svg_empty.svg")

    # display:none + éléments skippés (image, gradient)
    save_svg(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">'
        '<g display="none"><rect x="0" y="0" width="50" height="50"/></g>'
        '<rect x="10" y="10" width="30" height="30" style="display:inline"/>'
        '</svg>',
        "svg_display_none.svg",
    )

    # doublons exacts (deux rectangles superposés) + deux corps disjoints
    save_svg(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100">'
        '<rect x="0" y="0" width="40" height="40"/>'
        '<rect x="0" y="0" width="40" height="40"/>'
        '<rect x="80" y="0" width="40" height="40"/>'
        '</svg>',
        "svg_duplicates.svg",
    )

    # transform sur path avec arc (réification sous matrice)
    save_svg(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 300">'
        '<g transform="translate(30,40) scale(1.5)">'
        '<path d="M 0 0 A 25 25 0 0 1 50 50 L 50 0 Z"/>'
        '</g></svg>',
        "svg_arc_transform.svg",
    )

    # pièce à trou (rect + circle imbriqués = anneau)
    save_svg(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">'
        '<rect x="10" y="10" width="180" height="180"/>'
        '<circle cx="100" cy="100" r="40"/>'
        '</svg>',
        "svg_holed_plate.svg",
    )

    print(f"svg corpus -> {SVG_OUT} ({len(os.listdir(SVG_OUT))} files)")


if __name__ == "__main__":
    main()
    main_svg()
