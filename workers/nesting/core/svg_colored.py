"""Colored per-part SVG rendering of a nested sheet.

Built from the placement transforms + the input items' rings (outer + holes)
— NOT by flattening the recombined production DXF — so the downloadable DXF
keeps its source layers/colors untouched (cutting machines may key off them)
while the on-screen render carries the random per-part colors assigned at
import.

Draw convention matches the PRODUCTION DXF exactly (the dxf-viewer shows the
same thing): SVG is y-down while the engine frame is y-up, so every part is
drawn with `translate(x, H - y) scale(1, -1) rotate(angle)` — the scale flips
the ring back to y-up and the rotation (SVG clockwise == engine
counterclockwise once flipped) lands exactly on the DXF placement. Without
the flip the whole sheet renders vertically MIRRORED against the DXF view.
"""
import math

from worker_common.colors import FILL_OPACITY_LAYOUT

FALLBACK_PART_COLOR = "#2563EB"
SHEET_FRAME_COLOR = "#3B82F6"
SHEET_FILL = "#FFFFFF"


def build_colored_sheet_svg(transforms, items_by_id, bin_width, bin_height,
                            unit_scale=1.0, unit_attr="mm"):
    """One SVG string for a filled sheet. `transforms` are the sheet's
    placements (mm, engine frame); `unit_scale` converts mm -> output unit
    (1.0 for mm, 1/25.4 for inch) and is applied to every coordinate."""
    w = bin_width * unit_scale
    h = bin_height * unit_scale
    stroke_width = min(w, h) * 0.002

    parts = [
        "<?xml version='1.0' encoding='utf-8'?>",
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}{unit_attr}" height="{h}{unit_attr}" viewBox="0 0 {w} {h}">',
        f'<rect x="0" y="0" width="{w}" height="{h}" fill="{SHEET_FILL}" '
        f'stroke="{SHEET_FRAME_COLOR}" stroke-width="{stroke_width * 1.5}" />',
    ]

    for t in transforms:
        item = items_by_id.get(t.item_id) or {}
        rings = [item.get("coords"), *(item.get("holes") or [])]
        d = " ".join(
            "M" + " ".join(f"{x * unit_scale:.3f} {y * unit_scale:.3f}" for x, y in ring) + "Z"
            for ring in rings
            if ring and len(ring) > 2
        )
        if not d:
            continue
        color = t.color or item.get("color") or FALLBACK_PART_COLOR
        deg = math.degrees(t.angle)
        parts.append(
            f'<path d="{d}" '
            f'transform="translate({t.x * unit_scale:.3f} {h - t.y * unit_scale:.3f}) '
            f'scale(1 -1) rotate({deg:.3f})" '
            f'fill="{color}" fill-opacity="{FILL_OPACITY_LAYOUT}" fill-rule="evenodd" '
            f'stroke="{color}" stroke-width="{stroke_width}" />'
        )

    parts.append("</svg>")
    return "\n".join(parts)
