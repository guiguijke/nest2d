"""Constructeur de grille multi-tôles (plan 2026-09-05 §2.2b/§2.3).

Verrous : capacité par tôle (81 hôtes 100×100 sur 1000×1000), séquence
100 hôtes → 81 + 19 (dernière tôle en colonnes depuis −X, au pas),
800 fans réparties trous → bandes → tôle suivante, tout validé
physiquement, stock insuffisant → None (jamais une grille partielle),
motif non reconnu → None (généricité §5).

Run: PYTHONPATH=workers/common:workers/nesting python -m pytest
workers/nesting/tests/test_structure_multi.py -q (shapely requis).
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest

from core.residual import _validate_batch
from core.structure import layout_fits_sheet
from core.structure_multi import (
    build_grid_layouts_multi, host_grid_capacity,
)

SQUARE = [[50.0, -50.0], [-50.0, -50.0], [-50.0, 50.0], [50.0, 50.0], [50.0, -50.0]]
FAN = [[-19.8, 22.6], [0.0, 2.8], [19.8, 22.6], [0.0, 30.8], [-19.8, 22.6]]
HOLE_RING = [[35.0 * math.cos(a / 16 * 2 * math.pi),
              35.0 * math.sin(a / 16 * 2 * math.pi)] for a in range(16)]
QUARTERS = [0.0, 90.0, 180.0, 270.0]
BBOX_SQUARE = (-50.0, -50.0, 50.0, 50.0)


def make_items(n_hosts, n_fans):
    return [
        {"id": 0, "coords": SQUARE, "holes": [HOLE_RING],
         "rotations": QUARTERS, "demand": n_hosts},
        {"id": 1, "coords": FAN, "holes": [], "rotations": QUARTERS,
         "demand": n_fans},
    ]


def geom_of(item_id):
    return {0: {"coords": SQUARE, "rotations": QUARTERS},
            1: {"coords": FAN, "rotations": QUARTERS}}[item_id]


SHEETS_2 = [{"width": 1000.0, "height": 1000.0, "count": 2}]


class TestHostGridCapacity:
    def test_81_hosts_at_space_0_1(self):
        assert host_grid_capacity(BBOX_SQUARE, 1000.0, 1000.0, 0.1) == 81

    def test_at_most_81_at_space_2(self):
        # 9 × 9 au pas 102 — le plan exige ≤ 81 selon le pas.
        assert host_grid_capacity(BBOX_SQUARE, 1000.0, 1000.0, 2.0) <= 81
        assert host_grid_capacity(BBOX_SQUARE, 1000.0, 1000.0, 2.0) >= 49

    def test_host_too_big_is_zero(self):
        assert host_grid_capacity(BBOX_SQUARE, 90.0, 90.0, 2.0) == 0


class TestBuildGridMulti:

    def test_sequence_100_hosts_81_plus_19_space_2(self):
        items = make_items(100, 800)
        stats = {}
        layouts = build_grid_layouts_multi(items, geom_of, SHEETS_2, 2.0,
                                           stats=stats)
        assert layouts is not None, stats.get("errors")
        assert len(layouts) == 2
        hosts1 = [p for p in layouts[0]["placed_items"] if p["item_id"] == 0]
        hosts2 = [p for p in layouts[1]["placed_items"] if p["item_id"] == 0]
        fans1 = [p for p in layouts[0]["placed_items"] if p["item_id"] == 1]
        fans2 = [p for p in layouts[1]["placed_items"] if p["item_id"] == 1]
        # Séquence 81 + 19.
        assert len(hosts1) == 81 and len(hosts2) == 19
        # Fans : trous (4/hôte pinwheel) puis bandes puis tôle 2.
        assert len(fans1) >= 4 * 81 - 4  # presque tous les trous remplis
        assert len(fans1) + len(fans2) == 800
        # Dernière tôle : colonnes d'hôtes DEPUIS −X au pas 102 (± 0,5).
        pitch = 102.0
        for p in hosts2:
            tx = p["transformation"]["translation"][0]
            m = (tx - 52.0) % pitch  # ox = 2 − (−50) = 52
            assert min(m, pitch - m) <= 0.5,             f"hôte tôle 2 hors pas : tx={tx}"
        # Comptes par classe par tôle (verrou miroir JS).
        assert len(fans2) == 800 - len(fans1)

    def test_space_0_1_two_sheets_full_demand(self):
        items = make_items(100, 800)
        stats = {}
        layouts = build_grid_layouts_multi(items, geom_of, SHEETS_2, 0.1,
                                           stats=stats)
        assert layouts is not None, stats.get("errors")
        assert len(layouts) == 2
        hosts1 = [p for p in layouts[0]["placed_items"] if p["item_id"] == 0]
        hosts2 = [p for p in layouts[1]["placed_items"] if p["item_id"] == 0]
        assert len(hosts1) == 81 and len(hosts2) == 19
        assert sum(len(l["placed_items"]) for l in layouts) == 900

    def test_physical_validity_all_sheets_space_2(self):
        items = make_items(100, 800)
        layouts = build_grid_layouts_multi(items, geom_of, SHEETS_2, 2.0,
                                           stats={})
        by_id = {it["id"]: it for it in items}
        for l in layouts:
            ok = _validate_batch(
                list(l["placed_items"]),
                {"container_id": l["container_id"], "placed_items": []},
                by_id, 1000.0, 1000.0, 2.0)
            assert ok, "grille multi-tôles physiquement invalide"

    def test_stock_insufficient_returns_none(self):
        items = make_items(100, 800)
        stats = {}
        layouts = build_grid_layouts_multi(
            items, geom_of,
            [{"width": 1000.0, "height": 1000.0, "count": 1}], 2.0,
            stats=stats)
        assert layouts is None
        # Refus TRACÉ (colonnes d'hôtes hors tôle ou stock insuffisant) —
        # jamais une grille partielle.
        assert len(stats["errors"]) >= 1

    def test_no_structural_case_returns_none(self):
        # T-B like : deux classes rectangulaires, aucune dominante à 60 %
        # ni « petite » classe → pas de grille canonique (généricité §5).
        big1 = [[0, 0], [300, 0], [300, 200], [0, 200], [0, 0]]
        big2 = [[0, 0], [250, 0], [250, 180], [0, 180], [0, 0]]
        items = [
            {"id": 0, "coords": big1, "holes": [], "rotations": QUARTERS,
             "demand": 20},
            {"id": 1, "coords": big2, "holes": [], "rotations": QUARTERS,
             "demand": 20},
        ]

        def geom2(item_id):
            return {0: {"coords": big1, "rotations": QUARTERS},
                    1: {"coords": big2, "rotations": QUARTERS}}[item_id]

        stats = {}
        assert build_grid_layouts_multi(
            items, geom2,
            [{"width": 1500.0, "height": 1000.0, "count": 3}], 2.0,
            stats=stats) is None
        # Pas d'erreur tracée : le motif n'est simplement pas reconnu.

    def test_exact_demand_single_sheet(self):
        # 81 hôtes + 324 fans (4/trou) tiennent sur UNE tôle : la
        # séquence ne crée pas de 2e tôle vide.
        items = make_items(81, 324)
        stats = {}
        layouts = build_grid_layouts_multi(
            items, geom_of,
            [{"width": 1000.0, "height": 1000.0, "count": 2}], 2.0,
            stats=stats)
        assert layouts is not None, stats.get("errors")
        assert len(layouts) == 1
        assert sum(len(l["placed_items"]) for l in layouts) == 81 + 324
