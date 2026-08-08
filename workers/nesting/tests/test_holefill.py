"""J-085 — post-pass hole-fill : complète un trou en pinwheel (4 fillers),
déterministe et validé (dans le trou, spacing, placed inchangé).

Run: PYTHONPATH=workers/common python -m pytest workers/nesting/tests/test_holefill.py -q
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
sys.path.insert(0, str(Path(__file__).parent.parent.parent / "common"))

from core.holefill import apply_hole_fill

PARTS = json.load(open(Path(__file__).resolve().parents[3] / ".zcode" / "parts50.json"))
HOST = {"id": 0, "coords": PARTS["trou"]["coords"], "holes": PARTS["trou"]["holes"], "count": 1}
FILL = {"id": 1, "coords": PARTS["fill"]["coords"], "holes": [], "count": 4}


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
