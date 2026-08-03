"""Display colors: palette sanity, import-time assignment and the
deterministic legacy fallback. The fallback vectors must match
server/utils/colors.js colorForPart (same sha1('slug:index') -> palette)."""
import re

from worker_common.colors import (
    PART_PALETTE,
    color_for_part,
    pick_colors,
    resolve_part_color,
    shade,
)

HEX_RE = re.compile(r"^#[0-9A-F]{6}$")


def test_palette_is_uppercase_hex():
    assert len(PART_PALETTE) == 24
    for color in PART_PALETTE:
        assert HEX_RE.match(color), color
    assert len(set(PART_PALETTE)) == len(PART_PALETTE)


def test_pick_colors_count_and_format():
    colors = pick_colors(5)
    assert len(colors) == 5
    for color in colors:
        assert color in PART_PALETTE


def test_pick_colors_no_repeat_within_first_cycle():
    colors = pick_colors(len(PART_PALETTE))
    assert len(set(colors)) == len(PART_PALETTE)


def test_pick_colors_cycles_beyond_palette():
    colors = pick_colors(len(PART_PALETTE) + 3)
    assert len(colors) == len(PART_PALETTE) + 3


def test_color_for_part_is_deterministic_and_varies():
    assert color_for_part("piece-a1b2c3.dxf", 0) == color_for_part("piece-a1b2c3.dxf", 0)
    assert color_for_part("piece-a1b2c3.dxf", 0) in PART_PALETTE
    # Same file, different part indexes -> (almost always) different colors;
    # different files, same index -> different color for these fixtures.
    assert color_for_part("piece-a1b2c3.dxf", 0) != color_for_part("piece-a1b2c3.dxf", 1)
    assert color_for_part("piece-a1b2c3.dxf", 0) != color_for_part("autre-z9y8x7.dxf", 0)


def test_color_for_part_reference_vectors():
    # FROZEN vectors — server/utils/colors.js colorForPart returns the same
    # values (verified against node --input-type=module at introduction).
    assert color_for_part("marine-lpl-001-x1y2z3.dxf", 0) == "#65A30D"
    assert color_for_part("marine-lpl-001-x1y2z3.dxf", 1) == "#0F766E"
    assert color_for_part("bracket-q9w8e7.dxf", 2) == "#9F1239"


def test_resolve_part_color_prefers_persisted():
    assert resolve_part_color({"color": "#123ABC"}, "f.dxf", 0) == "#123ABC"
    assert resolve_part_color({}, "f.dxf", 0) == color_for_part("f.dxf", 0)
    assert resolve_part_color({"color": None}, "f.dxf", 0) == color_for_part("f.dxf", 0)


def test_shade_darkens():
    assert shade("#FF8040", 0.5) == "#7F4020"
    assert shade("#2563EB", 1.0) == "#2563EB"
    assert HEX_RE.match(shade("#2563EB", 0.6))
