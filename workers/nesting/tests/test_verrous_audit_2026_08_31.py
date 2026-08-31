"""Verrous audit 2026-08-31 (docs/PLAN-P-Q-moteur.md — matrice T4, T6-T14).

Nouveaux tests du plan P/Q : filet insideSheet (P-4), rotations du lattice
(P-1), borne tôle de plan_lattice (P-2), bbox transposée R(−90) et overflow
gauche (P-3/P-m.2), normalisation des rotations vides (P-m.1).
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest

from core.structure import (
    _QUARTER_TURNS,
    _transposed_bbox,
    _zone_solve,
    detect_structural_case,
    layout_fits_sheet,
    plan_lattice,
    small_lattice,
)

SQUARE = [[50.0, -50.0], [-50.0, -50.0], [-50.0, 50.0], [50.0, 50.0], [50.0, -50.0]]
FAN = [[-19.8, 22.6], [0.0, 2.8], [19.8, 22.6], [0.0, 30.8], [-19.8, 22.6]]
QUARTERS = list(_QUARTER_TURNS)


def geom(coords, rotations=None):
    return {"coords": coords, "rotations": rotations if rotations is not None else QUARTERS}


class TestP4LayoutFitsSheet:
    """T4 — filet final : bbox externe de chaque placement ⊆ tôle."""

    def geom100(self):
        return {0: geom(SQUARE), 1: geom(FAN)}

    def test_rejects_right_overflow(self):
        # carré ±50 posé à tx=960 : bord droit 1010 > 1000 → dehors.
        layout = {"placed_items": [
            {"item_id": 0, "transformation": {"rotation": 0.0,
                                              "translation": (960.0, 50.0)}}]}
        assert layout_fits_sheet(layout, lambda i: self.geom100()[i],
                                 1000, 2000) is False

    def test_accepts_inside(self):
        layout = {"placed_items": [
            {"item_id": 0, "transformation": {"rotation": 0.0,
                                              "translation": (50.0, 50.0)}}]}
        assert layout_fits_sheet(layout, lambda i: self.geom100()[i],
                                 1000, 2000) is True

    def test_rejects_rotated_out(self):
        # rect 200×10 tourné à 90° : bbox (-5, -100, 5, 100) — la
        # translation le pousse hors tôle en Y.
        rect = [[-100.0, -5.0], [100.0, -5.0], [100.0, 5.0], [-100.0, 5.0],
                [-100.0, -5.0]]
        geoms = {0: {"coords": rect, "rotations": QUARTERS}}
        layout = {"placed_items": [
            {"item_id": 0, "transformation": {"rotation": 90.0,
                                              "translation": (50.0, 1970.0)}}]}
        assert layout_fits_sheet(layout, lambda i: geoms[i], 1000, 2000) is False

    def test_build_structural_p4_net_discards_off_sheet(self, monkeypatch):
        # Le filet est branché à la FIN de build_structural_layout : un
        # plan de grille hors tôle (bug géométrique futur) doit finir en
        # repli moteur (None), jamais en pièces livrées hors tôle.
        import core.structure as st
        items = [{"id": 0, "demand": 10}, {"id": 1, "demand": 5}]
        geoms = {0: geom(SQUARE), 1: geom(FAN)}
        bad_plan = {
            "placements": [
                {"item_id": 0,
                 "transformation": {"rotation": 0.0,
                                    "translation": (960.0, 50.0)}}
                for _ in range(10)],
            "lattice_extent": 1050.0, "zone_a": None, "zone_c": None,
            # zone B valide : le chemin atteint le filet final (et non un
            # return None précédent).
            "zone_b": (700.0, 0.1, 999.9, 1999.9),
            "zone_b_transposed": False, "per_line": 10, "lines": 1,
            "remainder": 0,
        }
        monkeypatch.setattr(st, "plan_lattice", lambda *a, **k: bad_plan)

        def solve(count, zh, zw, budget, transposed=False):
            return [{"item_id": 1,
                     "transformation": {"rotation": 0.0,
                                        "translation": (25.0, 5.0)}}
                    for _ in range(count)]
        out = st.build_structural_layout(items, lambda i: geoms[i], 1000.0,
                                         2000.0, 0.1, solve)
        assert out is None


class TestP1LatticeRotations:
    """T6/T7 — le lattice ne pose QUE des angles demandés."""

    def quarter_pie(self):
        r = 27.95
        cy = 2.9
        pts = []
        for k in range(-22, 23):
            a = math.radians(k * 45 / 22)
            pts.append([r * math.sin(a), cy + r * math.cos(a)])
        pts.append([0.0, cy])
        pts.append(pts[0])
        return pts

    def test_rotations_0_only(self):
        small = {"id": 7, "coords": self.quarter_pie(), "area": 550.0,
                 "rotations": [0.0]}
        rect = (500.4, 500.6, 600.4, 1999.9)
        out = small_lattice(small, 0.1, rect)
        assert out, "la grille bbox à 0° doit toujours remplir"
        for p in out:
            assert (float(p["transformation"]["rotation"]) % 360) == 0.0
        # Moins de pièces qu'avec 4 rotations (zigzags interdits).
        four = small_lattice(dict(small, rotations=QUARTERS), 0.1, rect)
        assert len(out) < len(four)

    def test_rotations_0_180_no_90_270(self):
        small = {"id": 7, "coords": self.quarter_pie(), "area": 550.0,
                 "rotations": [0.0, 180.0]}
        out = small_lattice(small, 0.1, (0.0, 0.0, 1000.0, 1999.9))
        assert out
        for p in out:
            r = float(p["transformation"]["rotation"]) % 360
            assert r in (0.0, 180.0)

    def test_detect_rejects_rect_without_rot0(self):
        # T8 : rect sans 0° dans ses rotations → l'autre rôle ne matche pas
        # non plus (FAN n'est pas un rect) → pas de grille.
        items = [{"id": 0, "demand": 100}, {"id": 1, "demand": 400}]
        geoms = {0: geom(SQUARE, [90.0, 270.0]), 1: geom(FAN)}
        total = 10000.0 * 100 + 615.7 * 400
        assert detect_structural_case(items, lambda i: geoms[i], total) is None


class TestP2PlanLatticeSheetBound:
    """T9 — la grille rect ne dépasse jamais la tôle (T10 = tests existants)."""

    def slat_case(self, demand=310):
        coords = [[0.0, 0.0], [510.0, 0.0], [510.0, 10.0], [0.0, 10.0],
                  [0.0, 0.0]]
        return {
            "rect": {"id": 0, "demand": demand, "coords": coords,
                     "rotations": QUARTERS, "area": 5100.0,
                     "bbox": (0.0, 0.0, 510.0, 10.0)},
            "small": {"id": 1, "demand": 100, "coords": FAN,
                      "rotations": QUARTERS, "area": 615.7,
                      "bbox": (-19.8, 2.8, 19.8, 30.8)},
        }

    def test_slats_off_sheet_returns_none(self):
        # 310 lattes 510×10 / tôle 1000×2000 / space 1 : 2 colonnes →
        # 2×511 = 1022 > 1000 → AVANT le fix, 129 pièces hors tôle.
        assert plan_lattice(self.slat_case(), 1000.0, 2000.0, 1.0) is None

    def test_slats_fit_when_sheet_wide_enough(self):
        lat = plan_lattice(self.slat_case(), 1100.0, 2000.0, 1.0)
        assert lat is not None
        for p in lat["placements"]:
            tx, _ = p["transformation"]["translation"]
            assert tx + 510.0 <= 1100.0 + 1e-6

    def test_objective_y_rows_bound(self):
        assert plan_lattice(self.slat_case(), 1000.0, 620.0, 1.0,
                            objective="y") is None


class TestP3TransposedBbox:
    """T11/T12 — bbox de mesure B′ = R(−90), pas R(+90)."""

    def test_transposed_bbox_is_R_minus_90(self):
        from core.structure import _bbox, _rotated_bbox
        bb = _bbox(FAN)
        got = _transposed_bbox(bb)
        # = bbox des coords transposées (y, -x) — comme main.py construit
        # l'instance de solve de la zone B′.
        transposed = [[y, -x] for x, y in FAN]
        assert got == pytest.approx(_bbox(transposed))
        # ≠ R(+90) dès que le centroïde n'est pas à l'origine (piège #48).
        assert got != pytest.approx(_rotated_bbox(bb, 90.0))

    def test_real_overflow_after_map_back_rejected(self):
        # T12 : bbox dérivée comme main.py (R-90). Un solve qui pose à
        # tx=75 passait l'ANCIENNE bbox R(+90) (bord droit 75+19.8 ≤ 99.9)
        # mais déborde réellement (75+30.8 = 105.8 ; map-back
        # y0+tx+hauteur = 1900+75+30.8 > 1999.9).
        small = {"id": 1, "coords": FAN, "rotations": QUARTERS,
                 "area": 615.7, "bbox": (-19.8, 2.8, 19.8, 30.8)}
        small_solve = dict(small, bbox=_transposed_bbox(small["bbox"]))

        def solve(count, strip_h, max_w, budget, transposed=False):
            return [{"transformation": {"rotation": 0.0,
                                        "translation": (75.0, 20.0)}}
                    for _ in range(count)]
        zone = (0.1, 1900.0, 100.0, 1999.9)
        assert _zone_solve(zone, small_solve, 0.1, 3, solve, 5,
                           transposed=True) == []

    def test_left_overflow_rejected(self):
        # T13 : tx+bx0 < 0 = chevauchement de la zone voisine — rejet,
        # même si le bord droit tient (l'ancien max(used_w, -(tx+bx0))
        # comparait ce débordement à la LARGEUR de zone).
        def solve(count, zh, zw, budget, transposed=False):
            return [{"transformation": {"rotation": 0,
                                        "translation": (10.0, 1.0)}}
                    for _ in range(count)]
        small = {"id": 1, "coords": FAN, "rotations": QUARTERS,
                 "area": 615.7, "bbox": (-19.8, 2.8, 19.8, 30.8)}
        assert _zone_solve((0.0, 0.0, 100.0, 500.0), small, 0.1, 5, solve,
                           5) == []


class TestPM1RotationsNormalized:
    """T14 — rotations vides = [0], absentes = quarts de tour (miroir JS)."""

    def test_detect_empty_rotations_means_zero_only(self):
        items = [{"id": 0, "demand": 100}, {"id": 1, "demand": 400}]
        geoms = {0: geom(SQUARE, []), 1: geom(FAN, [])}
        total = 10000.0 * 100 + 615.7 * 400
        case = detect_structural_case(items, lambda i: geoms[i], total)
        assert case is not None
        assert case["rect"]["rotations"] == [0.0]
        assert case["small"]["rotations"] == [0.0]

    def test_detect_missing_rotations_defaults_to_quarters(self):
        items = [{"id": 0, "demand": 100}, {"id": 1, "demand": 400}]
        geoms = {0: {"coords": SQUARE, "rotations": None},
                 1: {"coords": FAN, "rotations": None}}
        total = 10000.0 * 100 + 615.7 * 400
        case = detect_structural_case(items, lambda i: geoms[i], total)
        assert case is not None
        assert case["rect"]["rotations"] == QUARTERS
