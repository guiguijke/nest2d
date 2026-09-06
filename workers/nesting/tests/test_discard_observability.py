"""AC1/AC2 (L2-ter) — attribution par étage du diagnostic d'écartage.

`main.py::_record_discard` décide `originStage` en vérifiant (1) le
snapshot moteur pris AVANT expansion, (2) l'expansion SEULE rejouée sur
une copie du snapshot, (3) l'état final. Ces tests valident la sémantique
avec les MÊMES primitives (verify_layout + expand_meta +
parse_result_containers + overlapping_pairs) :

- moteur propre + expansion forcée en chevauchement ⇒ « expand » ;
- moteur sale ⇒ « engine » quoi qu'il arrive ensuite ;
- moteur + expansion propres, état final sale ⇒ « post_pass » ;
- paires identifiées par POSE (tôle + index), avec aire et centroïde.
"""
import math

from core.holefill import expand_meta
from core.metrics import overlapping_pairs, verify_layout
from core.placement import parse_result_containers


def _ring(r=35.0, n=16):
    return [[r * math.cos(2 * math.pi * i / n), r * math.sin(2 * math.pi * i / n)]
            for i in range(n)]


ITEMS = [
    {"id": 0, "file_slug": "host",
     "coords": [[-50, -50], [50, -50], [50, 50], [-50, 50], [-50, -50]],
     "holes": [_ring()], "rotations": [0.0, 90.0, 180.0, 270.0]},
    {"id": 1, "file_slug": "fill",
     "coords": [[-15, -15], [15, -15], [15, 15], [-15, 15], [-15, -15]],
     "holes": [], "rotations": [0.0, 90.0, 180.0, 270.0]},
]
BIN = {0: (1000.0, 1000.0)}


def _verify(layouts):
    containers, _, _, _ = parse_result_containers(
        {"solution": {"layouts": layouts}}, ITEMS, BIN)
    return verify_layout(containers, ITEMS, 2.0), containers


def _dirty(v):
    return bool(v) and (v.get("overlapFree") is False or v.get("duplicatePoses"))


def _origin(pre, expanded):
    return "engine" if _dirty(pre) else "expand" if _dirty(expanded) else "post_pass"


def test_engine_clean_expansion_overlap_attributes_expand():
    """Snapshot moteur propre ; expansion forcée avec deux rotations qui se
    superposent au centre du trou (jamais validée par un vrai pinwheel) —
    l'étage expand doit être sale, l'attribution « expand »."""
    snapshot = [{"container_id": 0, "placed_items": [
        {"item_id": 0, "transformation": {"rotation": 0, "translation": [500, 500]}},
    ]}]
    pre, _ = _verify(snapshot)
    assert not _dirty(pre), "le moteur seul doit être propre"

    import copy
    expanded_layouts = expand_meta(
        ITEMS, 0, 1, [2], copy.deepcopy(snapshot), [[0.0, 90.0]])
    expanded, containers = _verify(expanded_layouts)
    assert _dirty(expanded), "l'expansion forcée doit être en chevauchement"
    assert _origin(pre, expanded) == "expand"

    # AC2 : paires par POSE — host en 0, fans en 1 et 2 de la tôle 0.
    pairs = overlapping_pairs(containers, ITEMS, 2.0)
    assert pairs, "les paires doivent être détectées"
    p = pairs[0]
    assert p["sheet"] == 0
    assert {p["idxA"], p["idxB"]} == {1, 2}
    assert p["itemA"] == 1 and p["itemB"] == 1
    assert p["areaMm2"] > 100.0
    assert p["centroid"] == [500.0, 500.0]


def test_dirty_engine_attributes_engine():
    """Deux hôtes superposés dans le snapshot ⇒ moteur sale, quoi qu'il
    arrive ensuite."""
    snapshot = [{"container_id": 0, "placed_items": [
        {"item_id": 0, "transformation": {"rotation": 0, "translation": [500, 500]}},
        {"item_id": 0, "transformation": {"rotation": 0, "translation": [510, 500]}},
    ]}]
    pre, _ = _verify(snapshot)
    assert _dirty(pre)
    assert _origin(pre, {}) == "engine"


def test_clean_engine_clean_expansion_dirty_final_attributes_post_pass():
    """Expansion valide (une seule rotation) : moteur et expansion propres ;
    un état final sali par une passe (fan ajoutée dessus) ⇒ « post_pass »."""
    snapshot = [{"container_id": 0, "placed_items": [
        {"item_id": 0, "transformation": {"rotation": 0, "translation": [500, 500]}},
    ]}]
    pre, _ = _verify(snapshot)
    import copy
    expanded_layouts = expand_meta(
        ITEMS, 0, 1, [1], copy.deepcopy(snapshot), [[0.0]])
    expanded, _ = _verify(expanded_layouts)
    assert not _dirty(pre) and not _dirty(expanded)

    final = copy.deepcopy(expanded_layouts)
    final[0]["placed_items"].append(
        {"item_id": 1, "transformation": {"rotation": 0, "translation": [500, 500]}})
    final_v, _ = _verify(final)
    assert _dirty(final_v)
    assert _origin(pre, expanded) == "post_pass"
