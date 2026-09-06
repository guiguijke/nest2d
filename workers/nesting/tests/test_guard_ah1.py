"""AH1 (relecture A2/A3, lot 4) — la référence de la garde par classe X2
est capturée JUSTE après l'expansion (état moteur restitué, fans
comprises), AVANT hole-fill/résiduel : le recalcul à la finalisation
lisait une solution mutée en place par les passes — la garde comparait
l'état final à lui-même. Miroir du test vitest A2 : passes RÉELLES
(meta_slots/expand_meta/apply_hole_fill), perte injectée APRÈS les
passes, containers via parse_result_containers (rien à la main)."""
from core.holefill import apply_hole_fill, expand_meta, meta_slots
from core.metrics import per_class_counts_match
from core.placement import parse_result_containers

# Géométries calibrées du fichier voisin (hôte + secteur pinwheel) : le
# pinwheel est validé pour CETTE famille — une géométrie improvisée ne
# pose aucune fan (constaté en débogage).
from test_holefill import HOST, FILL

HOST_ID, FILL_ID = HOST["id"], FILL["id"]


def _t(item_id, rot, x, y):
    return {"item_id": item_id,
            "transformation": {"rotation": rot, "translation": [x, y]}}


def _case():
    # Scénario du test voisin test_meta_expand_attaches_fillers_to_hosts
    # (le pinwheel y est calibré) : 2 hôtes posés, 8 fans nichées.
    items = [dict(HOST, count=2), dict(FILL, count=8)]
    layouts = [{"container_id": 0,
                "placed_items": [_t(HOST_ID, 0, 0, 0), _t(HOST_ID, 90, 500, 0)]}]
    return items, layouts


def _capture(layouts):
    """La capture AH1 de main.py (même boucle) — post-expansion."""
    counts = {}
    for l in layouts:
        for pi in l.get("placed_items", []):
            k = pi["item_id"]
            counts[k] = counts.get(k, 0) + 1
    return counts


def _containers(layouts, items):
    out = {"solution": {"layouts": layouts, "density": 0, "cost": len(layouts)}}
    rc, _, _, _ = parse_result_containers(out, items, {0: (200.0, 200.0)})
    return rc


def test_capture_post_expansion_inclut_les_fans():
    items, layouts = _case()
    slots, _ = meta_slots(items, HOST_ID, FILL_ID)
    # NB : expand_meta RETOURNE les layouts (main.py réassigne
    # sol['layouts']) — la mutation en place n'est pas garantie.
    layouts = expand_meta(items, HOST_ID, FILL_ID, slots, layouts)
    counts = _capture(layouts)
    assert counts.get(HOST_ID) == 2
    assert counts.get(FILL_ID, 0) >= 1


def test_perte_injectee_detectee_par_la_capture_pas_par_le_recalcul():
    items, layouts = _case()
    slots, _ = meta_slots(items, HOST_ID, FILL_ID)
    # NB : expand_meta RETOURNE les layouts (main.py réassigne
    # sol['layouts']) — la mutation en place n'est pas garantie.
    layouts = expand_meta(items, HOST_ID, FILL_ID, slots, layouts)
    reference = _capture(layouts)
    apply_hole_fill(items, layouts, 0)
    # INJECTION : le post-pass perd le PREMIER HÔTE (pièce moteur).
    layouts[0]["placed_items"] = layouts[0]["placed_items"][1:]
    rc = _containers(layouts, items)
    # Garde AH1 : la capture post-expansion DÉTECTE la perte.
    assert not per_class_counts_match(rc, reference)
    # Ancienne référence : recalculée sur l'état final muté → muette.
    assert per_class_counts_match(rc, _capture(layouts))


def test_sans_perte_la_garde_passe():
    items, layouts = _case()
    slots, _ = meta_slots(items, HOST_ID, FILL_ID)
    # NB : expand_meta RETOURNE les layouts (main.py réassigne
    # sol['layouts']) — la mutation en place n'est pas garantie.
    layouts = expand_meta(items, HOST_ID, FILL_ID, slots, layouts)
    reference = _capture(layouts)
    apply_hole_fill(items, layouts, 0)
    rc = _containers(layouts, items)
    assert per_class_counts_match(rc, reference)
