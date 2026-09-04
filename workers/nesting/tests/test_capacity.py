"""Pré-contrôle de capacité avec espacement (plan 2026-09-05 §1.2a).

Cas de référence (captures propriétaire) : 900 Fillx4 + 100 Piece_Trou
sur 1 tôle 1000×2000 à 4 mm — l'aire NUE dit 58 %, l'aire GONFLÉE dit
≈ 0,92 → refus, avec les trois leviers (≈ 2 tôles, ≈ 900 pièces max,
≈ 2 mm d'espacement max).
"""
import json
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest

from core.capacity import (
    REFUSE_RATIO, REFERENCE_PACKING, capacity_report, inflated_area,
    sheet_usable_area,
)


def _fan():
    # Fillx4 du corpus (bench.seed_user_repro) — 40×28, ~615 mm².
    return [[-19.8, 22.6], [0.0, 2.8], [19.8, 22.6], [0.0, 30.8],
            [-19.8, 22.6]]


def _host():
    return [[50.0, -50.0], [-50.0, -50.0], [-50.0, 50.0], [50.0, 50.0],
            [50.0, -50.0]]


class TestInflatedArea:
    def test_fan_at_4mm_gains_about_45_percent(self):
        a0 = inflated_area({"coords": _fan()}, 0.0)
        a4 = inflated_area({"coords": _fan()}, 4.0)
        # périmètre fan ≈ 122 mm (pentagone) → +38-45 % selon la forme
        assert 1.35 <= a4 / a0 <= 1.50

    def test_host_at_4mm_gains_about_8_percent(self):
        a0 = inflated_area({"coords": _host()}, 0.0)
        a4 = inflated_area({"coords": _host()}, 4.0)
        assert a4 / a0 == pytest.approx(1.08, abs=0.02)

    def test_minkowski_formula_exact_rectangle(self):
        # rect 100×50 : A=5000, P=300 → A + 150s + πs²/4
        rect = [[0, 0], [100, 0], [100, 50], [0, 50], [0, 0]]
        assert inflated_area({"coords": rect}, 2.0) == pytest.approx(
            5000 + 300 * 1.0 + math.pi * 1.0)

    def test_usable_area_deflated(self):
        # piège #49 : jagua déflate le conteneur de s/2 par côté.
        assert sheet_usable_area(1000, 2000, 4) == pytest.approx(996 * 1996)


class TestCapacityReport:
    def _parts(self):
        return [{"coords": _host(), "count": 100},
                {"coords": _fan(), "count": 900}]

    def _sheets(self):
        return [{"width": 1000.0, "height": 2000.0, "count": 1}]

    def test_owner_case_at_4mm_is_refused(self):
        r = capacity_report(self._parts(), self._sheets(), 4.0)
        assert r["ratio"] > REFUSE_RATIO
        assert r["refused"] is True
        # ≈ 2 tôles nécessaires
        assert r["sheetsNeeded"] == 2

    def test_owner_case_at_4mm_levers(self):
        r = capacity_report(self._parts(), self._sheets(), 4.0)
        total_max = sum(r["maxPartsAtSpacing"].values())
        # ≈ 600-950 pièces max (aire gonflée / 0,85) — planchard large :
        # la borne est le ratio, pas un chiffre exact.
        assert 500 <= total_max < 1000
        # espacement max qui tient ≈ 2 mm (pas 4)
        assert r["maxSpacingForFitMm"] < 4.0
        assert r["maxSpacingForFitMm"] >= 1.0

    def test_owner_case_at_low_spacing_passes(self):
        r = capacity_report(self._parts(), self._sheets(), 0.1)
        assert r["refused"] is False
        assert r["ratio"] < 0.88

    def test_two_sheets_not_refused(self):
        sheets = [{"width": 1000.0, "height": 2000.0, "count": 2}]
        r = capacity_report(self._parts(), sheets, 4.0)
        # 2 tôles : ratio ≈ 0,46 → OK, tout tient sur le stock déclaré
        assert r["refused"] is False
        assert r["sheetsNeeded"] <= 2

    def test_zero_spacing_never_refused_on_empty_ok(self):
        r = capacity_report([], self._sheets(), 4.0)
        assert r is None

    def test_ratio_monotonic_in_spacing(self):
        for sp in (0.0, 1.0, 2.0, 4.0, 8.0):
            r = capacity_report(self._parts(), self._sheets(), sp)
            if sp == 0.0:
                prev = r["ratio"]
            else:
                assert r["ratio"] > prev
                prev = r["ratio"]
