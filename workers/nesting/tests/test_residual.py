"""Tests du post-pass BPP « remplissage des bandes résiduelles »
(docs/PLAN-bpp-impl.md §5.1, matrice T1-T8)."""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest

from core.residual import (
    _fill_ratio,
    _validate_batch,
    fill_residual_bands,
    layout_aabb,
    residual_bands,
)
from core.structure import small_lattice

try:
    import shapely  # noqa: F401
    HAS_SHAPELY = True
except ImportError:
    HAS_SHAPELY = False

SQUARE = [[50.0, -50.0], [-50.0, -50.0], [-50.0, 50.0], [50.0, 50.0], [50.0, -50.0]]
FAN = [[-19.8, 22.6], [0.0, 2.8], [19.8, 22.6], [0.0, 30.8], [-19.8, 22.6]]
HOLE_RING = [[35.0 * math.cos(a / 16 * 2 * math.pi),
              35.0 * math.sin(a / 16 * 2 * math.pi)] for a in range(16)]
QUARTERS = [0.0, 90.0, 180.0, 270.0]

HOST = {"id": 0, "coords": SQUARE, "holes": [HOLE_RING], "rotations": QUARTERS}
FAN_ITEM = {"id": 1, "coords": FAN, "holes": [], "rotations": QUARTERS}
ITEMS = [HOST, FAN_ITEM]
BY_ID = {i["id"]: i for i in ITEMS}
BIN = {0: (1000.0, 1000.0)}


def pi(item_id, tx, ty, rot=0.0):
    return {"item_id": item_id,
            "transformation": {"rotation": rot, "translation": (tx, ty)}}


def layout(pis, container_id=0):
    return {"container_id": container_id, "placed_items": pis}


class TestT1ResidualBands:
    def test_bands_clipped_inset(self):
        bands = residual_bands((2.0, 2.0, 920.0, 920.0), 1000.0, 1000.0, 2.0)
        by_name = {b["name"]: b["rect"] for b in bands}
        assert by_name["right"] == pytest.approx((922.0, 2.0, 998.0, 920.0))
        assert by_name["top"] == pytest.approx((2.0, 922.0, 920.0, 998.0))
        assert by_name["corner"] == pytest.approx((922.0, 922.0, 998.0, 998.0))
        assert "left" not in by_name and "bottom" not in by_name
        # Aucun rect ne recouvre l'AABB utilisée (2,2,920,920).
        for b in bands:
            x0, y0, x1, y1 = b["rect"]
            covers = (x0 < 920.0 and x1 > 2.0 and y0 < 920.0 and y1 > 2.0)
            assert not covers, b["name"]
        # right clippé à l'AABB (pas pleine tôle) : maxy == used.maxy.
        assert by_name["right"][3] == pytest.approx(920.0)
        # tri aire décroissante (corner ≥ right ≥ top ici).
        areas = [b["area"] for b in bands]
        assert areas == sorted(areas, reverse=True)

    def test_empty_bands_dropped(self):
        # AABB collée aux bords : aucune bande positive.
        assert residual_bands((2.0, 2.0, 998.0, 998.0), 1000.0, 1000.0, 2.0) == []


class TestT2LatticeInBand:
    @pytest.mark.skipif(not HAS_SHAPELY, reason="small_lattice requiert shapely")
    def test_fan_lattice_in_81mm_band(self):
        band = (919.0, 2.0, 998.0, 902.0)  # 79×900, typique du constat
        small = {"id": 1, "coords": FAN, "rotations": QUARTERS}
        lat = small_lattice(small, 2.0, band, want=400, axis="x")
        assert lat and len(lat) >= 2
        # Viser la densité du corpus : ~3 colonnes entrelacées sur 900 mm.
        assert len(lat) >= 40, f"lattice trop creux : {len(lat)}"
        from shapely.affinity import rotate as sh_rotate, translate as sh_translate
        from shapely.geometry import Polygon
        polys = []
        for p in lat:
            tr = p["transformation"]
            q = sh_translate(
                sh_rotate(Polygon(FAN), float(tr["rotation"]), origin=(0, 0)),
                tr["translation"][0], tr["translation"][1])
            b = q.bounds
            assert b[0] >= 919.0 - 1e-6 and b[2] <= 998.0 + 1e-6
            assert b[1] >= 2.0 - 1e-6 and b[3] <= 902.0 + 1e-6
            polys.append(q)
        for i in range(len(polys)):
            for j in range(i + 1, len(polys)):
                assert polys[i].distance(polys[j]) >= 2.0 - 1e-6, (i, j)


class TestT3MoveFreeParts:
    @pytest.mark.skipif(not HAS_SHAPELY, reason="validation requiert shapely")
    def test_hosts_and_nested_never_move(self):
        # L0 : 4 hôtes (2×2, pitch 102) + 1 fan niché au centre de chaque
        # trou (le quart-de-disque a un centroïde décentré ~16,8 mm : la
        # translation le recentre pour que contains(centroid) le niche).
        hosts = [pi(0, x, y) for x in (52.0, 154.0) for y in (52.0, 154.0)]
        nested = [pi(1, h["transformation"]["translation"][0],
                     h["transformation"]["translation"][1] - 16.8)
                  for h in hosts]
        l0 = layout(list(hosts) + nested)
        # L1 : un hôte (elle ne doit jamais se vider) + 20 fans libres.
        free_l1 = [pi(1, 60.0 + 45 * (k % 9), 600.0 + 45 * (k // 9))
                   for k in range(20)]
        l1 = layout([pi(0, 500.0, 500.0)] + free_l1)
        layouts = [l0, l1]

        n = fill_residual_bands(layouts, ITEMS, BIN, 2.0)
        assert n >= 2, "au moins un batch devait passer"
        # Invariant de compte global et par classe.
        all_pis = [p for l in layouts for p in l["placed_items"]]
        assert len(all_pis) == 29
        assert sum(1 for p in all_pis if p["item_id"] == 0) == 5
        assert sum(1 for p in all_pis if p["item_id"] == 1) == 24
        # L0 a gagné exactement ce que L1 a perdu ; 2 tôles conservées.
        assert len(layouts) == 2
        assert len(layouts[0]["placed_items"]) == 8 + n
        assert len(layouts[1]["placed_items"]) == 21 - n
        # Hôtes immobiles (transformation d'origine).
        for l in layouts:
            for p in l["placed_items"]:
                if p["item_id"] == 0:
                    tx, ty = p["transformation"]["translation"]
                    assert (tx, ty) in {(52.0, 52.0), (154.0, 52.0),
                                        (52.0, 154.0), (154.0, 154.0),
                                        (500.0, 500.0)}
        # Les nichés non plus : les 4 fans restent au centre des trous L0.
        kept_nested = 0
        for h in hosts:
            cx, cy = h["transformation"]["translation"]
            match = any(
                p["item_id"] == 1
                and abs(p["transformation"]["translation"][0] - cx) < 1e-9
                and abs(p["transformation"]["translation"][1] - (cy - 16.8)) < 1e-9
                for p in layouts[0]["placed_items"])
            kept_nested += 1 if match else 0
        assert kept_nested == 4


class TestT4NoFitNoop:
    @pytest.mark.skipif(not HAS_SHAPELY, reason="shapely")
    def test_band_too_small_for_fan(self):
        # AABB gigantesque → bande résiduelle 10×10 : le fan (40×28)
        # ne tient dans AUCUNE rotation → no-op.
        l0 = layout([pi(0, 500.0, 500.0)])
        l1 = layout([pi(1, 100.0, 100.0)])
        layouts = [l0, l1]
        assert fill_residual_bands(layouts, ITEMS, BIN, 2.0) == 0
        assert len(layouts[0]["placed_items"]) == 1
        assert len(layouts[1]["placed_items"]) == 1


class TestT5SingleLayout:
    def test_single_layout_noop(self):
        l = layout([pi(0, 50.0, 50.0), pi(1, 300.0, 300.0)])
        snapshot = [dict(p["transformation"]) for p in l["placed_items"]]
        assert fill_residual_bands([l], ITEMS, BIN, 2.0) == 0
        for p, s in zip(l["placed_items"], snapshot):
            assert p["transformation"] == s


class TestT6ValidateBatch:
    """Seules les pièces AJOUTÉES sont jugées (les paires préexistantes ne
    sont pas re-jugées — un défaut amont ne paralyse pas le pass)."""

    @pytest.mark.skipif(not HAS_SHAPELY, reason="shapely")
    def test_new_part_overlapping_preexisting_rejected(self):
        # préexistant en (50,50) ; la nouvelle en (60,60) le chevauche.
        l = layout([pi(1, 50.0, 50.0)])
        new = pi(1, 60.0, 60.0)
        l["placed_items"].append(new)
        assert _validate_batch([new], l, BY_ID, 1000.0, 1000.0, 2.0) is False

    @pytest.mark.skipif(not HAS_SHAPELY, reason="shapely")
    def test_new_part_far_enough_accepted(self):
        l = layout([pi(1, 50.0, 50.0)])
        new = pi(1, 200.0, 200.0)
        l["placed_items"].append(new)
        assert _validate_batch([new], l, BY_ID, 1000.0, 1000.0, 2.0) is True

    @pytest.mark.skipif(not HAS_SHAPELY, reason="shapely")
    def test_preexisting_twins_do_not_block_a_legal_new_part(self):
        # Régression du banc : jumeaux expand_meta à distance 0 — une
        # NOUVELLE pièce légale ailleurs doit passer malgré eux.
        l = layout([pi(1, 50.0, 50.0), pi(1, 50.0, 50.0)])
        new = pi(1, 400.0, 400.0)
        l["placed_items"].append(new)
        assert _validate_batch([new], l, BY_ID, 1000.0, 1000.0, 2.0) is True

    @pytest.mark.skipif(not HAS_SHAPELY, reason="shapely")
    def test_new_part_outside_sheet_rejected(self):
        l = layout([pi(1, 50.0, 50.0)])
        new = pi(1, 990.0, 50.0)  # fan déborde à droite
        l["placed_items"].append(new)
        assert _validate_batch([new], l, BY_ID, 1000.0, 1000.0, 2.0) is False


class TestT9CornerCovered:
    """Constat 2026-09-01 : donneurs suffisants → la 2e bande, recalculée
    sur l'AABB étendue par la 1re, couvre le coin TR — aucun vide « en
    escalier » (le miroir JS avait une coquille tx/ty dans layoutAabb qui
    tuait la bande haut après un fill de droite : ce test fige la parité)."""

    def test_corner_filled_when_donors_sufficient(self):
        hosts = [pi(0, 150.0 + 100 * gx, 150.0 + 100 * gy)
                 for gx in range(8) for gy in range(8)]
        free = [pi(1, 40.0 + 60 * (k % 15), 40.0 + 60 * (k // 15))
                for k in range(400)]
        layouts = [
            layout(hosts),
            layout([pi(0, 500.0, 950.0)] + free),
        ]
        n = fill_residual_bands(layouts, ITEMS, BIN, 2.0)
        assert n > 0
        moved = [p for p in layouts[0]["placed_items"] if p["item_id"] == 1]
        right = [p for p in moved if p["transformation"]["translation"][0] > 902]
        top = [p for p in moved if p["transformation"]["translation"][1] > 902]
        corner = [p for p in moved
                  if p["transformation"]["translation"][0] > 902
                  and p["transformation"]["translation"][1] > 902]
        assert right and top and corner


class TestT7FillRatio:
    def test_ratio_selects_least_filled_as_donor(self):
        a = layout([pi(1, 60.0 + 105 * k, 60.0) for k in range(10)])
        b = layout([pi(1, 60.0, 60.0), pi(1, 300.0, 300.0)])
        ra = _fill_ratio(a, BY_ID, BIN)
        rb = _fill_ratio(b, BY_ID, BIN)
        assert ra > rb
        # T3 démontre déjà le choix du donor ; ici on fige la sémantique
        # du ratio (aires outer / aire tôle).

    def test_ratio_same_items_bigger_sheet_lower(self):
        small_bin = {0: (500.0, 500.0)}
        l = layout([pi(1, 60.0, 60.0)])
        assert _fill_ratio(l, BY_ID, small_bin) > _fill_ratio(l, BY_ID, BIN)


class TestT8EmptyLastRemoved:
    @pytest.mark.skipif(not HAS_SHAPELY, reason="shapely")
    def test_last_emptied_layout_removed(self):
        # L0 plein d'hôtes avec une bande immense ; L1 = 4 fans libres
        # (pas d'hôtes) → tous déplacés → layout retiré.
        hosts = [pi(0, x, y) for x in (52.0, 154.0) for y in (52.0, 154.0)]
        l0 = layout(list(hosts))
        l1 = layout([pi(1, 60.0 + 45 * k, 500.0) for k in range(4)])
        layouts = [l0, l1]
        n = fill_residual_bands(layouts, ITEMS, BIN, 2.0)
        assert n == 4
        assert len(layouts) == 1
        assert len(layouts[0]["placed_items"]) == 8
        assert sum(1 for p in layouts[0]["placed_items"] if p["item_id"] == 1) == 4


class TestLayoutAabb:
    def test_aabb_rotation_48(self):
        # rect 200×10 tourné à 90° : bbox tournée = (-5,-100,5,100) →
        # AABB dépend de la rotation (piège #48), pas de la bbox brute.
        item = {"id": 2, "coords": [[-100.0, -5.0], [100.0, -5.0],
                                    [100.0, 5.0], [-100.0, 5.0], [-100.0, -5.0]],
                "holes": [], "rotations": QUARTERS}
        l = layout([{"item_id": 2,
                     "transformation": {"rotation": 90.0,
                                        "translation": (500.0, 500.0)}}])
        got = layout_aabb(l, {2: item})
        assert got == pytest.approx((495.0, 400.0, 505.0, 600.0))
