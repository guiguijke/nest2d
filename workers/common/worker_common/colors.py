"""Per-part display colors — screen rendering only, NEVER written into the
production result DXF (cutting machines may key power/order off entity
colors, so the downloadable DXF keeps its source layers/colors untouched).

A fixed palette keeps the render readable on the light CAD canvas (explicit
palette, never theme-dependent vars). Colors are assigned at import time
(`pick_colors`) and persisted on each polygonPart; documents imported before
this feature have no `color` field and get the deterministic fallback
`color_for_part(slug, index)` so the live view, the result SVG and the parts
list always agree on the same color for the same part.

Keep this palette in sync with server/utils/colors.js (the fallback must
pick the SAME color for a given (slug, index) in Python and in Node).
"""
import hashlib
import random

# 24 medium-saturation colors, legible as a stroke on a white sheet.
PART_PALETTE = [
    "#2563EB", "#DC2626", "#059669", "#D97706", "#7C3AED", "#DB2777",
    "#0D9488", "#EA580C", "#4F46E5", "#65A30D", "#0891B2", "#BE185D",
    "#16A34A", "#9333EA", "#0284C7", "#C026D3", "#CA8A04", "#E11D48",
    "#0F766E", "#9F1239", "#3F6212", "#1D4ED8", "#B45309", "#6D28D9",
]

# Fill is always the part color at low opacity; the stroke carries the full
# color (CAD-style look, holes stay readable through the fill).
FILL_OPACITY_PREVIEW = 0.18  # import preview thumbnail (single part context)
FILL_OPACITY_LAYOUT = 0.35   # nested sheet (dense, parts side by side)


def pick_colors(count):
    """`count` random palette colors. Sampled without replacement in shuffled
    cycles so parts of the same file look distinct (a plain random.choice per
    part would hand neighbors the same color surprisingly often)."""
    out = []
    while len(out) < count:
        bag = PART_PALETTE[:]
        random.shuffle(bag)
        out.extend(bag)
    return out[:count]


def color_for_part(slug, index):
    """Deterministic fallback for parts imported before colors existed.
    MUST match colorForPart in server/utils/colors.js (sha1 of 'slug:index',
    first byte modulo palette length)."""
    digest = hashlib.sha1(f"{slug}:{index}".encode("utf-8")).digest()
    return PART_PALETTE[digest[0] % len(PART_PALETTE)]


def resolve_part_color(part, slug, index):
    """Persisted color if present, deterministic fallback otherwise."""
    return part.get("color") or color_for_part(slug, index)


def shade(hex_color, factor):
    """Darkens (#rrggbb * factor) — used for the dashed hole rings so they
    read as the same hue as their part, only deeper."""
    r = int(hex_color[1:3], 16)
    g = int(hex_color[3:5], 16)
    b = int(hex_color[5:7], 16)
    return "#{:02X}{:02X}{:02X}".format(
        min(255, int(r * factor)),
        min(255, int(g * factor)),
        min(255, int(b * factor)),
    )
