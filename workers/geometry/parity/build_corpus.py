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


if __name__ == "__main__":
    main()
