"""T1-T3 — garde de faisabilité jagua `w + 2·space` (Q-1, audit 2026-08-31).

jagua inflate l'item de space/2 ET déflate le conteneur de space/2
(jagua-rs/src/io/import.rs) : la condition RÉELLE de placement est
`w + 2·space <= sw`. L'ancienne garde `w + space` laissait passer 8×8 sur
une tôle 10 avec space 2 → panique SPP « strip-width is running away »
(lbf.rs, panic = abort → worker mort). Miroir JS :
localPayloadBuilder.test.js (piège #49).
"""
import os
import sys
import types

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))) + "\\..\\common")

# worker_common.mongo connects at import time — stub avant d'importer main
# (même technique que test_local_compute.py).
sys.modules.setdefault(
    "worker_common.mongo",
    types.SimpleNamespace(db=None, get_bucket=lambda name: None),
)

from core.main import part_fits_any_sheet

SHEET_10 = {"width": 10.0, "height": 10.0}
SHEET_12 = {"width": 12.0, "height": 12.0}
SHEET_12_NEAR = {"width": 11.9, "height": 12.0}
SHEET_1000x2000 = {"width": 1000.0, "height": 2000.0}


def test_repro_audit_8x8_sheet10_space2_rejected():
    # T1 — reproduction exacte de la panique de l'audit : doit être rejetée
    # AVANT le moteur (message utilisateur, pas de crash worker).
    assert part_fits_any_sheet(8, 8, [SHEET_10], 2) is False


def test_exact_fit_8x8_sheet12_space2_accepted():
    # T2 — pile `8 + 2×2 = 12` : limite exacte acceptée (tolérance 1e-6).
    assert part_fits_any_sheet(8, 8, [SHEET_12], 2) is True


def test_just_under_rejected():
    # 11.9 de large : 8+4 = 12 > 11.9 → rejet (pas de frontière floue).
    assert part_fits_any_sheet(8, 8, [SHEET_12_NEAR], 2) is False


def test_near_fit_998_rejected():
    # 998 + 2×2 = 1002 > 1000 : le cas « demande exacte » de l'audit —
    # une pièce quasi ajustée NE TIENT PAS avec l'espacement.
    assert part_fits_any_sheet(998, 10, [SHEET_1000x2000], 2) is False


def test_bench_flagship_100x100_space2_accepted():
    # T3 — le banc phare (100×100 / 1000×2000 / space 2) doit passer : le
    # durcissement ne doit pas rejeter les pièces qui rentraient VRAIMENT.
    assert part_fits_any_sheet(100, 100, [SHEET_1000x2000], 2) is True


def test_space0_unchanged():
    # space = 0 : 2×0 = 0, la garde dégénère en `w <= sw` (inchangé).
    assert part_fits_any_sheet(1000, 10, [SHEET_1000x2000], 0) is True
    assert part_fits_any_sheet(1001, 10, [SHEET_1000x2000], 0) is False


def test_fits_in_any_sheet_orientation():
    # Une pièce 10×50 tient sur la tôle 1000×2000 dans SON axe long —
    # la garde teste les deux dimensions à la fois (l'appelant teste les
    # rotations, la garde reste symétrique).
    assert part_fits_any_sheet(10, 50, [SHEET_1000x2000], 2) is True
