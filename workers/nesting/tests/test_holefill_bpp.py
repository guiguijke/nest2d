"""apply_hole_fill BPP — scoping PAR TÔLE (constat 2026-09-01).

Les layouts BPP partagent le repère de coordonnées : pooler trous/libres
à travers les tôles (ancien code) laissait `nested_hole` classer les fans
d'une tôle comme occupants du trou coïncidant d'une autre, et le repli
pinwheel posait DEUX jeux de poses canoniques au même point (« jumeaux »
à pose identique — 71 paires sur le banc 2×1000×1000 space 0.1) tout en
posant des fans d'une tôle aux coordonnées d'une autre (téléport).

Run: PYTHONPATH=workers/common python -m pytest workers/nesting/tests/test_holefill_bpp.py -q
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
    a0, a1 = math.radians(5), math.radians(85)
    pts = [(2.83, 2.83)]
    for i in range(9):
        a = a0 + (a1 - a0) * (i / 8.0)
        pts.append((28.0 * math.cos(a), 28.0 * math.sin(a)))
    pts.append((2.83, 2.83))
    return pts


HOST = {"id": 0, "coords": [(-50, -50), (-50, 50), (50, 50), (50, -50), (-50, -50)],
        "holes": [_circle(0, 0, 35.0)], "count": 1}
FILL = {"id": 1, "coords": _sector(), "holes": [], "count": 8}


def _t(item_id, rot, x, y):
    return {"item_id": item_id, "transformation": {"rotation": rot, "translation": [x, y]}}


def _poses(layout):
    return [(pi["transformation"]["rotation"], *pi["transformation"]["translation"])
            for pi in layout["placed_items"] if pi["item_id"] == FILL["id"]]


def _in_hole(poses, cx=500.0, cy=500.0, r=35.0):
    """Poses dont le filler est niché dans le trou (centre du secteur dans
    le disque du trou, aux coordonnées monde (cx, cy))."""
    from shapely.geometry import Polygon
    from shapely.affinity import rotate, translate
    hole = Polygon(_circle(cx, cy, r))
    out = []
    for rot, tx, ty in poses:
        poly = translate(rotate(Polygon(FILL["coords"]), rot, origin=(0, 0)), tx, ty)
        if hole.contains(poly.centroid):
            out.append((rot, tx, ty))
    return out


def test_bpp_coincident_holes_no_twins_no_cross_sheet_teleport():
    """2 tôles dont les hôtes occupent LES MÊMES coordonnées monde (grille
    canonique BPP). Chaque trou doit recevoir les fans de SA tôle, aux
    poses canoniques — jamais deux fans de la même tôle à la même pose,
    jamais un fan posé aux coordonnées du trou de l'autre tôle."""
    items = [dict(HOST, count=2), dict(FILL, count=8)]
    # Tôle 1 : hôte (500,500) trou vide + 4 fans libres en bande à droite.
    # Tôle 2 : hôte (500,500) — COÏNCIDE — trou vide + 4 fans libres en bande.
    layouts = [
        {"placed_items": [
            _t(0, 0, 500, 500),
            _t(1, 0, 800, 200), _t(1, 90, 850, 200), _t(1, 180, 900, 200), _t(1, 270, 950, 200),
        ]},
        {"placed_items": [
            _t(0, 0, 500, 500),
            _t(1, 0, 100, 200), _t(1, 90, 150, 200), _t(1, 180, 200, 200), _t(1, 270, 250, 200),
        ]},
    ]
    rec = apply_hole_fill(items, layouts, 2.0)
    # 4 relocalisés PAR TÔLE (l'ancien code poolé en donnait 4 au total,
    # pris sur les fans des DEUX tôles).
    assert rec == 8
    for li, layout in enumerate(layouts):
        in_hole = _in_hole(_poses(layout))
        assert len(in_hole) == 4, f"tôle {li + 1} : {len(in_hole)} fans dans le trou"
        # PAS de jumeaux : 4 poses distinctes.
        assert len(set(in_hole)) == 4, f"tôle {li + 1} : poses dupliquées {in_hole}"


def test_bpp_no_teleport_of_sheet_one_fans_into_sheet_two_hole():
    """CAS DISTINGUANT (jumeaux du banc 2026-09-01) : tôle 1 = trou PLEIN
    (4 fans nichés) + 2 fans libres ; tôle 2 = trou VIDE aux MÊMES
    coordonnées, aucun fan libre. L'ancien code poolé voyait le trou de la
    tôle 2 « vide de membres » et y consommait les fans LIBRES DE LA TÔLE 1
    — posés aux coordonnées du trou coïncidant, ils s'empilaient sur les
    4 fans déjà nichés de la tôle 1 (paires « jumeaux »). Scopé par tôle :
    rien ne bouge."""
    items = [dict(HOST, count=2), dict(FILL, count=6)]
    layouts = [
        {"placed_items": [
            _t(0, 0, 500, 500),
            _t(1, 0, 500, 500), _t(1, 90, 500, 500), _t(1, 180, 500, 500), _t(1, 270, 500, 500),
            _t(1, 0, 800, 800), _t(1, 90, 850, 800),
        ]},
        {"placed_items": [_t(0, 0, 500, 500)]},
    ]
    before_t1 = _poses(layouts[0])
    rec = apply_hole_fill(items, layouts, 2.0)
    assert rec == 0
    assert _poses(layouts[0]) == before_t1
    assert _poses(layouts[1]) == []


def test_bpp_member_of_other_sheet_not_counted():
    """4 fans déjà nichés dans le trou de la tôle 1 (coordonnées (500,500))
    ne comptent PAS comme occupants du trou coïncidant de la tôle 2 : le
    trou de la tôle 2 doit pouvoir se remplir avec SES fans libres."""
    items = [dict(HOST, count=2), dict(FILL, count=8)]
    layouts = [
        {"placed_items": [
            _t(0, 0, 500, 500),
            _t(1, 0, 500, 500), _t(1, 90, 500, 500), _t(1, 180, 500, 500), _t(1, 270, 500, 500),
        ]},
        {"placed_items": [
            _t(0, 0, 500, 500),
            _t(1, 0, 100, 200), _t(1, 90, 150, 200), _t(1, 180, 200, 200), _t(1, 270, 250, 200),
        ]},
    ]
    rec = apply_hole_fill(items, layouts, 2.0)
    # Ancien code : les 4 fans de la tôle 1 étaient membres du trou POOLÉ
    # → trou « plein » → la tôle 2 ne remplissait jamais son trou (rec=0).
    assert rec == 4
    assert len(_in_hole(_poses(layouts[1]))) == 4
    # La tôle 1 n'a pas bougé (déjà pleine, poses nichées inchangées).
    t1 = _in_hole(_poses(layouts[0]))
    assert len(t1) == 4
    assert len(set(t1)) == 4
