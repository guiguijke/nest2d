"""J-085 — post-pass hole-fill : complète un trou en pinwheel (4 fillers),
déterministe et validé (dans le trou, spacing, placed inchangé).

Run: PYTHONPATH=workers/common python -m pytest workers/nesting/tests/test_holefill.py -q
"""
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
sys.path.insert(0, str(Path(__file__).parent.parent.parent / "common"))

from core.holefill import apply_hole_fill


def _circle(cx, cy, r, n=64):
    pts = [(cx + r * math.cos(2 * math.pi * i / n), cy + r * math.sin(2 * math.pi * i / n)) for i in range(n)]
    pts.append(pts[0])
    return pts


def _sector():
    # quartier de disque r=28 rétréci (arc 5°..85°) pour que 4 secteurs en
    # pinwheel laissent un espacement (~4mm) entre eux ; le disque r=28 tient
    # dans le trou r=35 avec marge >= 2mm.
    a0, a1 = math.radians(5), math.radians(85)
    pts = [(2.83, 2.83)]
    for i in range(9):
        a = a0 + (a1 - a0) * (i / 8.0)
        pts.append((28.0 * math.cos(a), 28.0 * math.sin(a)))
    pts.append((2.83, 2.83))
    return pts


# Géométrie auto-portée (pas de fixture externe) : hôte 100x100 + trou Ø70,
# filler secteur r=28 => capacité pinwheel 4 par trou.
HOST = {"id": 0, "coords": [(-50, -50), (-50, 50), (50, 50), (50, -50), (-50, -50)],
        "holes": [_circle(0, 0, 35.0)], "count": 1}
FILL = {"id": 1, "coords": _sector(), "holes": [], "count": 4}


def _t(item_id, rot, x, y):
    return {"item_id": item_id, "transformation": {"rotation": rot, "translation": [x, y]}}


def test_repack_fills_empty_hole_with_pinwheel():
    from shapely.geometry import Polygon
    from shapely.affinity import rotate, translate
    # hôte à l'origine, 4 fillers libres empilés loin au-dessus.
    layouts = [{"placed_items": [
        _t(0, 0, 0, 0),
        _t(1, 0, 0, 500), _t(1, 0, 50, 500), _t(1, 90, 100, 500), _t(1, 180, 150, 500),
    ]}]
    rec = apply_hole_fill([HOST, FILL], layouts, 2.0)
    assert rec == 4
    rots = sorted(pi["transformation"]["rotation"] for pi in layouts[0]["placed_items"][1:])
    assert rots == [0.0, 90.0, 180.0, 270.0]
    # les 4 fillers sont nichés : centre dans le trou (repère monde = hôte à l'origine).
    hole = Polygon(HOST["holes"][0])
    for pi in layouts[0]["placed_items"][1:]:
        tr = pi["transformation"]
        poly = translate(rotate(Polygon(FILL["coords"]), tr["rotation"], origin=(0, 0)),
                         tr["translation"][0], tr["translation"][1])
        assert hole.contains(poly.centroid)


def test_repack_skips_full_hole():
    # 4 fillers déjà nichés en pinwheel => rien à faire.
    layouts = [{"placed_items": [
        _t(0, 0, 0, 0),
        _t(1, 0, 0, 0), _t(1, 90, 0, 0), _t(1, 180, 0, 0), _t(1, 270, 0, 0),
    ]}]
    rec = apply_hole_fill([HOST, FILL], layouts, 2.0)
    assert rec == 0


def test_meta_expand_attaches_fillers_to_hosts():
    from core.holefill import meta_slots, expand_meta
    from shapely.geometry import Polygon
    from shapely.affinity import rotate, translate
    items = [dict(HOST, count=2), dict(FILL, count=8)]
    slots, remaining = meta_slots(items, 0, 1)
    assert remaining == 0 and sorted(slots) == [4, 4]
    # deux hôtes posés (dont un tourné 90°) ; l'expansion doit entraîner les
    # fillers avec la rotation de l'hôte et les nicher dans le trou.
    layouts = [{"placed_items": [_t(0, 0, 0, 0), _t(0, 90, 500, 0)]}]
    expanded = expand_meta(items, 0, 1, slots, layouts)
    assert len(expanded[0]["placed_items"]) == 2 + 8
    # rotations = pinwheel + rotation de l'hôte (0 et 90)
    rots = sorted(pi["transformation"]["rotation"] % 360 for pi in expanded[0]["placed_items"][2:])
    assert rots == sorted([0, 90, 180, 270] + [90, 180, 270, 0])


def test_pinwheel_capacity_fixture_sector_full():
    from core.holefill import pinwheel_capacity
    # secteur 5°..85° r=28 dans trou Ø70 à space 2 : les 4 rotations valident.
    assert pinwheel_capacity(HOST["holes"][0], FILL["coords"], 2.0) == [0.0, 90.0, 180.0, 270.0]


def test_pinwheel_capacity_rejects_oversized_filler():
    from core.holefill import pinwheel_capacity
    big = [(-40, -40), (40, -40), (40, 40), (-40, 40), (-40, -40)]
    assert pinwheel_capacity(HOST["holes"][0], big, 2.0) == []


def test_pinwheel_capacity_partial_when_siblings_overlap():
    from core.holefill import pinwheel_capacity
    # rectangle 60×10 : chaque rotation tient seule dans le trou, mais deux
    # copies pivotées se chevauchent au centre → une seule retenue.
    rect = [(-30, -5), (30, -5), (30, 5), (-30, 5), (-30, -5)]
    assert pinwheel_capacity(HOST["holes"][0], rect, 2.0) == [0.0]


def test_pinwheel_capacity_respects_allowed_orientations():
    from core.holefill import pinwheel_capacity
    rots = pinwheel_capacity(HOST["holes"][0], FILL["coords"], 2.0, allowed={0.0, 180.0})
    assert rots == [0.0, 180.0]


def test_meta_expand_uses_validated_rotations_only():
    from core.holefill import expand_meta
    layouts = [{"placed_items": [_t(0, 0, 0, 0)]}]
    expanded = expand_meta([HOST, FILL], 0, 1, [2], layouts, [[0.0, 180.0]])
    rots = sorted(pi["transformation"]["rotation"] for pi in expanded[0]["placed_items"][1:])
    assert rots == [0.0, 180.0]


def test_decorate_live_items_expands_meta_without_mutating_source():
    from core.holefill import decorate_live_items
    src = [[0, 0.0, 0.0, 0.0]]
    out, stats = decorate_live_items(
        src,
        [HOST, FILL],
        2.0,
        meta={"host": 0, "fill": 1, "slots": [2], "ringRotations": [[0.0, 180.0]]},
        apply_fill=False,
        sheets=[[200.0, 200.0]],
    )
    assert len(out) == 3
    assert stats["holesFilled"] == 2
    assert stats["density"] is not None and stats["density"] > 0
    assert src == [[0, 0.0, 0.0, 0.0]]
