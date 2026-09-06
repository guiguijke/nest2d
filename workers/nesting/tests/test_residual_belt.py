"""AC3/T-L (L2-ter) — la ceinture exacte du pass résiduel.

Constat AC3 : 1 banc sur 30 (T-A@2) a livré une alternative en
chevauchement attribuée à origin=post_pass (les gardes du pass jugent des
anneaux simplifiés avec tolérances). Ceinture posée : le pass mesure la
saleté EXACTE (anneaux bruts) avant et après ; s'il a dégradé l'état, il
restaure le snapshot d'entrée et trace residualRolledBack — l'alternative
reste DÉCOUPABLE au lieu d'être écartée au filet final.

T-L (le « cas de corpus » du plan) : la pose fautive n'est pas
reproductible de façon déterministe côté moteur (variance Y6 du budget
mur) — le cas est VERROUILLÉ ICI en injectant le défaut au plus près du
chemin réel (le relais de bandes pose une fan en chevauchement), ce qui
exerce exactement l'invariant ajouté.
"""
import math

import core.residual as R


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


def _layouts():
    # 2 tôles : receveuse avec un hôte, donneuse avec des fans posées en
    # rangée légale (pas 32 mm > 30 + space 2).
    recv = {"container_id": 0, "placed_items": [
        {"item_id": 0, "transformation": {"rotation": 0, "translation": [200, 200]}},
        # fan cible sur la RECEVEUSE : le relais sabotage va s'empiler
        # DESSUS (chevauchement INTRA-tôle — les paires ne se jugent
        # qu'au sein d'une même tôle, fix L2-ter).
        {"item_id": 1, "transformation": {"rotation": 0, "translation": [700, 700]}},
    ]}
    donor = {"container_id": 0, "placed_items": [
        {"item_id": 1, "transformation": {"rotation": 0, "translation": [200 + 32 * k, 600]}}
        for k in range(6)
    ]}
    return [recv, donor]


def test_belt_restores_when_pass_degrades(monkeypatch):
    """Le relais pose une fan EN CHEVAUCHEMENT (dégradé) → ceinture :
    restauration complète de l'état d'entrée, moved=0, trace
    residualRolledBack."""
    layouts = _layouts()
    before = [list(l["placed_items"]) for l in layouts]
    stats = {}

    def _evil_relay(layouts_, recv_i, candidates, items_by_id, bin_dims, space):
        # pose DEUX candidates AU MÊME POINT (700,700) : la fan cible de la
        # receveuse est elle-même détachée (candidate) — le chevauchement
        # vient donc de nouvelles-vs-nouvelles, intra-tôle.
        placed = 0
        for pi in candidates[:2]:
            pi["transformation"] = {"rotation": 0, "translation": [700.0, 700.0]}
            layouts_[recv_i]["placed_items"].append(pi)
            placed += 1
        return placed

    monkeypatch.setattr(R, "_relay_candidates_in_bands", _evil_relay)
    moved = R.fill_residual_bands(layouts, ITEMS, BIN, 2.0, stats=stats,
                                  profile="compact")
    assert moved == 0
    assert stats.get("residualRolledBack") is True
    assert any("ceinture exacte" in e.get("message", "")
               for e in stats.get("errors") or [])
    # état d'entrée RESTAURÉ au posé près
    assert len(layouts[0]["placed_items"]) == len(before[0])
    assert len(layouts[1]["placed_items"]) == len(before[1])


def test_belt_passes_clean_pass(monkeypatch):
    """Un pass propre (aucun chevauchement ajouté) n'est PAS restauré."""
    layouts = _layouts()
    stats = {}
    # déplacement PROPRE : la fan 0 de la donneuse va loin de tout le monde
    def _clean_relay(layouts_, recv_i, candidates, items_by_id, bin_dims, space):
        moved = 0
        for k, pi in enumerate(candidates):
            pi["transformation"] = {"rotation": 0,
                                    "translation": [700.0 + 32.0 * k, 200.0]}
            layouts_[recv_i]["placed_items"].append(pi)
            moved += 1
        return moved

    monkeypatch.setattr(R, "_relay_candidates_in_bands", _clean_relay)
    moved = R.fill_residual_bands(layouts, ITEMS, BIN, 2.0, stats=stats,
                                  profile="compact")
    assert stats.get("residualRolledBack") is None
    assert any(pi["transformation"]["translation"] == [700.0, 200.0]
               for l in layouts for pi in l["placed_items"])
    assert all(len(l["placed_items"]) for l in layouts)
    assert moved >= 1


def test_exact_overlap_area_measures_raw_rings():
    """La mesure exacte compte les chevauchements réels (anneaux bruts)."""
    dirty = _layouts()
    dirty[0]["placed_items"].append(
        {"item_id": 1, "transformation": {"rotation": 0, "translation": [700.0, 700.0]}})
    by_id = {i["id"]: i for i in ITEMS}
    clean = _exact(_layouts(), by_id)
    dirt = _exact(dirty, by_id)
    assert clean == 0
    assert dirt > 0


def _exact(layouts, by_id):
    return R._exact_overlap_area(layouts, by_id)


def test_ad1_recv_return_on_donor_validated(monkeypatch):
    """AD1 (L2-quater) — la cause racine : une candidate d'origine
    RECEVEUSE, non posée, était rendue sur la DONNEUSE à ses coordonnées
    d'origine — qui recouvrent une fan moteur de la donneuse (jamais
    testée : validate_return exclut les rendues et ne juge pas les paires
    entre elles). Correctif (variante 2 du plan) : elle RETOURNE SUR LA
    RECEVEUSE — jamais sur la donneuse."""
    layouts = _layouts()
    # Une fan RECEVEUSE (tôle 0) posée exactement sur une fan DONNEUSE
    # (tôle 1, rangée y=600) : coordonnées receveuse = (232, 600).
    layouts[0]["placed_items"].append(
        {"item_id": 1, "transformation": {"rotation": 0, "translation": [216.0, 600.0]}})
    stats = {}

    def _no_relay(layouts_, recv_i, candidates, items_by_id, bin_dims, space):
        return 0

    monkeypatch.setattr(R, "_relay_candidates_in_bands", _no_relay)
    R.fill_residual_bands(layouts, ITEMS, BIN, 2.0, stats=stats,
                          profile="compact")
    by_sheet = [[p for p in l["placed_items"]] for l in layouts]
    donor_fans = [p for p in by_sheet[1] if p["item_id"] == 1]
    assert not any(p["transformation"]["translation"] == [216.0, 600.0]
                   for p in donor_fans),         "aucune fan d'origine receveuse ne doit finir sur la donneuse"
    recv_fans = [p for p in by_sheet[0] if p["item_id"] == 1]
    assert any(p["transformation"]["translation"] == [216.0, 600.0]
               for p in recv_fans),         "la fan receveuse doit être de retour sur sa tôle d'origine"
    # la donneuse reste INTACTE : aucune ceinture nécessaire.
    assert stats.get("residualRolledBack") is not True
