"""Tests du post-pass BPP « remplissage des bandes résiduelles »
(docs/PLAN-bpp-impl.md §5.1, matrice T1-T8)."""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest

from core.residual import (
    _fill_ratio,
    _fill_one_batch,
    _helix_units_and_free,
    _regrid_helices,
    _remove_by_identity,
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
        # 2 tôles conservées ; L0 a gagné exactement ce que L1 a perdu
        # (les fans recompactées SUR L1 — v2 — ne quittent pas L1, et
        # l'hôte de la donneuse peut avoir été re-grillé : n inclut ces
        # déplacements internes, seul le SOLDE L0↔L1 est invariant).
        assert len(layouts) == 2
        gain0 = len(layouts[0]["placed_items"]) - 8
        assert len(layouts[1]["placed_items"]) == 21 - gain0
        # Hôtes de la tôle RECEVEUSE immobiles (l'hôte de la donneuse,
        # lui, est re-grillé par la compaction v2).
        for p in layouts[0]["placed_items"]:
            if p["item_id"] == 0:
                tx, ty = p["transformation"]["translation"]
                assert (tx, ty) in {(52.0, 52.0), (154.0, 52.0),
                                    (52.0, 154.0), (154.0, 154.0)}
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


class TestT10CompactLastSheet:
    """Constat 2026-09-02 « pas optimisé −X » : le moteur BPP ne compacte
    pas la dernière tôle. La compaction détache les libres et les re-pose
    en lattice derrière le bloc ancré (hôtes + nichées) — la chute
    redevient un rectangle unique."""

    def _full_sheet0(self):
        # 100 hôtes 10×10 → AABB collée aux bords : AUCUNE bande, la tôle
        # pleine ne peut rien recevoir (les libres restent sur la donneuse).
        hosts = [pi(0, 52.0 + 100 * gx, 52.0 + 100 * gy)
                 for gx in range(10) for gy in range(10)]
        return layout(hosts)

    def test_helices_regrillees_et_libres_compactees(self):
        # Donneuse : colonne d'hôtes à x=150 + 25 fans dispersées jusqu'à
        # x=900. v2 : hélices re-grillées en colonnes DEPUIS le bord
        # gauche, fans re-posées derrière la grille — tout −X, chute
        # rectangulaire unique.
        hosts = [pi(0, 150.0, 50.0 + 100 * k) for k in range(10)]
        free = [pi(1, 500.0 + 60 * (k % 7), 100.0 + 70 * (k // 7))
                for k in range(25)]
        layouts = [self._full_sheet0(), layout(hosts + free)]

        n = fill_residual_bands(layouts, ITEMS, BIN, 2.0)
        assert n >= 25 + 10  # hôtes re-grillés + fans recompactées
        # Comptes invariants : rien n'a bougé vers la tôle pleine.
        assert len(layouts[0]["placed_items"]) == 100
        l1_fans = [p for p in layouts[1]["placed_items"] if p["item_id"] == 1]
        l1_hosts = [p for p in layouts[1]["placed_items"] if p["item_id"] == 0]
        assert len(l1_fans) == 25
        assert len(l1_hosts) == 10
        # Hélices compactées à gauche (2 colonnes max depuis x≈2+50).
        for p in l1_hosts:
            tx = p["transformation"]["translation"][0]
            assert tx <= 160, f"hôte non re-grillé : tx={tx}"
        # Fans derrière la grille des hélices, en bloc compact. Borne basse
        # 100 (et non 155) depuis le fix poches (audit 2026-09-02 F1) : les
        # fans remplissent D'ABORD la poche de la colonne partielle
        # d'hélices (x[104,204]) avant la bande droite.
        for p in l1_fans:
            tx = p["transformation"]["translation"][0]
            assert 100 <= tx <= 450, f"fan non compactée : tx={tx}"
        aabb = layout_aabb(layouts[1], BY_ID)
        assert aabb[2] <= 500  # chute = rectangle x[500,1000]

    def test_fixture_legal_tout_compacte_sans_chevauchement(self):
        # Originals LÉGAUX (grille 60 mm, sans contact hôtes) : tout est
        # re-posé derrière l'ancre, layout final valide par paires.
        # NB : le chemin « restauration des non-placées » ne peut pas être
        # atteint avec ce filler simple (la capacité du lattice EST sa
        # densité max) — il ne se déclenche qu'avec des géométries
        # imbriquées (Fillx4 réel) : filet de sécurité, pas un objectif.
        hosts = [pi(0, 152.0, 50.0 + 100 * k) for k in range(10)]
        free = [pi(1, 300.0 + 60 * gx, 20.0 + 60 * gy)
                for gx in range(12) for gy in range(16)]
        layouts = [self._full_sheet0(), layout(hosts + free)]

        n = fill_residual_bands(layouts, ITEMS, BIN, 2.0)
        assert n >= 192  # fans re-posées + hôtes re-grillés
        l1_fans = [p for p in layouts[1]["placed_items"] if p["item_id"] == 1]
        l1_hosts = [p for p in layouts[1]["placed_items"] if p["item_id"] == 0]
        assert len(l1_fans) == 192
        assert len(l1_hosts) == 10
        for p in l1_hosts:
            assert p["transformation"]["translation"][0] <= 160
        # Bloc compact derrière la grille des hélices, fini bien avant
        # x=960. Borne basse ~2 : depuis P1 (audit 2026-09-03) la poche de
        # la colonne partielle est CLIPPÉE au sommet des colonnes pleines
        # et la bande haute pleine largeur est remplie la première en
        # gravité −X — c'est le coin haut-gauche qui était perdu.
        for p in l1_fans:
            tx = p["transformation"]["translation"][0]
            assert 2 <= tx <= 420, f"fan non compactée : tx={tx}"
        if HAS_SHAPELY:
            import math as _math
            from shapely.geometry import Polygon
            polys = []
            for p in layouts[1]["placed_items"]:
                it = BY_ID[p["item_id"]]
                tr = p["transformation"]
                r = _math.radians(tr["rotation"])
                c, si = _math.cos(r), _math.sin(r)
                pts = [(tr["translation"][0] + c * x - si * y,
                        tr["translation"][1] + si * x + c * y)
                       for x, y in it["coords"]]
                polys.append(Polygon(pts))
            # Paires impliquant une FAN uniquement : les hôtes se
            # touchent dans ce fixture (grille 100 mm, artefact local) —
            # état PRÉEXISTANT que le pass ne rejuge pas.
            ids = [p["item_id"] for p in layouts[1]["placed_items"]]
            for i in range(len(polys)):
                for j in range(i + 1, len(polys)):
                    if ids[i] == 0 and ids[j] == 0:
                        continue
                    assert polys[i].distance(polys[j]) >= 2.0 - 0.05,                         f"chevauchement {i}-{j}"


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


class TestT11PocketsFromRegrid:
    """Fix poches (audit 2026-09-02 F1) : _regrid_helices retourne le rect
    libre de la colonne PARTIELLE de la grille — 10 hélices = colonnes 9+1,
    la poche x[104,204]×y[104,998] doit être exposée au remplissage."""

    def _regrid(self, n_hosts):
        hosts = [pi(0, 500.0 + 37 * k, 500.0) for k in range(n_hosts)]
        last = layout(list(hosts))
        units, free = _helix_units_and_free(last, BY_ID)
        return last, units, free

    @pytest.mark.skipif(not HAS_SHAPELY, reason="shapely")
    def test_partial_column_yields_pocket(self):
        last, units, free = self._regrid(10)
        moved, pockets = _regrid_helices(last, units, BY_ID, 1000.0, 1000.0, 2.0)
        assert moved == 10
        assert len(pockets) == 1
        # P1 : y1 clippé au sommet des colonnes PLEINES (9 poses de 100 mm
        # + pas ≈ 916-918), pas au bord de tôle (998 comme avant le fix).
        y1 = pockets[0][3]
        assert 900.0 < y1 < 930.0, y1
        assert pockets[0][:3] == pytest.approx((104.0, 104.0, 204.0), abs=1.5)

    @pytest.mark.skipif(not HAS_SHAPELY, reason="shapely")
    def test_full_columns_no_pocket(self):
        last, units, free = self._regrid(18)  # 2 colonnes pleines de 9
        moved, pockets = _regrid_helices(last, units, BY_ID, 1000.0, 1000.0, 2.0)
        assert moved == 18
        assert pockets == []

    @pytest.mark.skipif(not HAS_SHAPELY, reason="shapely")
    def test_lattice_failure_restores_and_no_pocket(self):
        last, units, free = self._regrid(200)  # ne tient jamais sur la tôle
        before = [dict(p["transformation"]) for p in last["placed_items"]]
        moved, pockets = _regrid_helices(last, units, BY_ID, 1000.0, 1000.0, 2.0)
        assert moved == 0 and pockets == []
        for p, b in zip(last["placed_items"], before):
            assert p["transformation"] == b


class TestT12PocketFilledFirst:
    """La compaction remplit la poche de la colonne partielle AVANT la
    bande droite : des fans vivent dans x[104,204] même quand la bande
    droite a de la capacité, et le layout reste physiquement valide."""

    @pytest.mark.skipif(not HAS_SHAPELY, reason="shapely")
    def test_fans_in_pocket_and_valid(self):
        hosts = [pi(0, 500.0 + 37 * k, 300.0) for k in range(10)]
        free = [pi(1, 400.0 + 60 * (k % 9), 500.0 + 50 * (k // 9))
                for k in range(25)]
        layouts = [layout([pi(0, 52.0 + 100 * gx, 52.0 + 100 * gy)
                           for gx in range(10) for gy in range(10)]),
                   layout(hosts + free)]
        n = fill_residual_bands(layouts, ITEMS, BIN, 2.0)
        assert n > 0
        l1_fans = [p for p in layouts[1]["placed_items"] if p["item_id"] == 1]
        assert len(l1_fans) == 25  # rien ne quitte la donneuse (L0 pleine)
        in_pocket = [p for p in l1_fans
                     if 104 <= p["transformation"]["translation"][0] <= 204]
        assert in_pocket, "la poche de la colonne partielle devrait être remplie"
        # Validité physique des fans du layout final (hélices incluses :
        # re-grillées par small_lattice, elles sont valides par paires).
        from shapely.geometry import Polygon
        polys = []
        for p in layouts[1]["placed_items"]:
            it = BY_ID[p["item_id"]]
            tr = p["transformation"]
            r = math.radians(tr["rotation"])
            c, s = math.cos(r), math.sin(r)
            pts = [(tr["translation"][0] + c * x - s * y,
                    tr["translation"][1] + s * x + c * y)
                   for x, y in it["coords"]]
            polys.append(Polygon(pts))
        ids = [p["item_id"] for p in layouts[1]["placed_items"]]
        for i in range(len(polys)):
            for j in range(i + 1, len(polys)):
                if ids[i] == 0 and ids[j] == 0:
                    continue  # hôtes du fixture dispersés : artefact préexistant
                assert polys[i].distance(polys[j]) >= 2.0 - 0.05, (i, j)


class TestT13SinglePosePocketBatch:
    """Batches d'une pose : autorisés en zones explicites (poches), refusés
    sur les bandes classiques (T4 verrouille déjà le refus par défaut)."""

    @pytest.mark.skipif(not HAS_SHAPELY, reason="shapely")
    def test_pocket_accepts_single_pose(self):
        # Rect 60×60 : le fan (40×28) n'y tient qu'une fois.
        l0 = layout([pi(0, 100.0, 100.0)])
        fan = pi(1, 700.0, 700.0)
        n = _fill_one_batch([l0], 0, 0, BY_ID, BIN, 2.0, free=[fan],
                            bands=[{"name": "pocket", "rect": (500.0, 500.0, 560.0, 560.0),
                                    "axis": "x"}])
        assert n == 1
        assert l0["placed_items"][-1] is fan

    @pytest.mark.skipif(not HAS_SHAPELY, reason="shapely")
    def test_default_bands_refuse_single_donor(self):
        # Même géométrie via les bandes classiques (bands=None) : une seule
        # donneuse → lattice tronqué à 1 pose → skip (seuil 2, contrat T4).
        l0 = layout([pi(0, 500.0, 500.0)])
        fan = pi(1, 700.0, 700.0)
        n = _fill_one_batch([l0], 0, 0, BY_ID, BIN, 2.0, free=[fan])
        assert n == 0
        assert l0["placed_items"] == [l0["placed_items"][0]]


class TestT14RetryDegraded:
    """Un batch invalide est ré-essayé en tailles décroissantes : une pièce
    leurre sur la 2e pose du lattice n'empêche plus de poser la 1re (audit
    F2b — l'ancien code rollbackait tout le batch)."""

    @pytest.mark.skipif(not HAS_SHAPELY, reason="shapely")
    def test_degraded_batch_places_valid_subset(self):
        band = {"name": "pocket", "rect": (500.0, 2.0, 998.0, 400.0), "axis": "x"}
        small = {"id": 1, "coords": FAN, "rotations": QUARTERS}
        lat = small_lattice(small, 2.0, band["rect"], want=3, axis="x")
        assert lat and len(lat) >= 3
        # Leurre = pièce préexistante POSÉE sur la 2e pose du lattice.
        t1 = lat[0]["transformation"]
        t2 = lat[1]["transformation"]
        l0 = layout([pi(0, 100.0, 100.0),
                     {"item_id": 1,
                      "transformation": {"rotation": t2["rotation"],
                                         "translation": tuple(t2["translation"])}}])
        free = [pi(1, 700.0 + 40 * k, 800.0) for k in range(3)]
        n = _fill_one_batch([l0], 0, 0, BY_ID, BIN, 2.0, free=free, bands=[band])
        # A7 (audit 2026-09-03) : chaque pose est validée individuellement —
        # la pose leurre (2e) est sautée, les poses 1 ET 3 sont posées
        # (l'ancien retry take//2 ne produisait que {1} ou {1,2,3}).
        assert n == 2
        t3 = lat[2]["transformation"]
        for t in (t1, t3):
            moved = [p for p in l0["placed_items"]
                     if p["item_id"] == 1
                     and p["transformation"]["translation"]
                     == tuple(t["translation"])]
            assert moved, f"pose {t['translation']} doit être occupée"


class TestT15RemoveByIdentity:
    """Régression audit 2026-09-02 : list.remove par VALEUR détruisait une
    pièce déjà posée à la pose jumelle (pose lattice identique) au lieu de
    lever — la compaction bouclait à l'infini. Verrou d'identité."""

    def test_removes_the_exact_object(self):
        a = pi(1, 100.0, 100.0)
        b = pi(1, 100.0, 100.0)  # == a par valeur, objet distinct
        lst = [a]
        assert _remove_by_identity(lst, b) is False
        assert lst == [a]
        assert _remove_by_identity(lst, a) is True
        assert lst == []


class TestSpace0Validation:
    """A1 (audit 2026-09-03, bloquant) : à space 0, `d < space − ε` est
    toujours faux → _validate_batch n'excluait PLUS RIEN (3 136
    chevauchements au banc sur le corpus user-like). Politique §8.1 :
    contact permis, chevauchement d'aire > 0,01 mm² rejeté."""

    @pytest.mark.skipif(not HAS_SHAPELY, reason="shapely")
    def test_identical_pose_rejected_at_space_0(self):
        l = layout([pi(1, 200.0, 200.0), pi(1, 200.0, 200.0)])
        assert _validate_batch(l["placed_items"], l, BY_ID, 1000.0, 1000.0, 0.0) is False

    @pytest.mark.skipif(not HAS_SHAPELY, reason="shapely")
    def test_partial_overlap_rejected_at_space_0(self):
        # Deux fans décalées de 5 mm : chevauchement franc.
        l = layout([pi(1, 200.0, 200.0), pi(1, 205.0, 200.0)])
        assert _validate_batch(l["placed_items"], l, BY_ID, 1000.0, 1000.0, 0.0) is False

    @pytest.mark.skipif(not HAS_SHAPELY, reason="shapely")
    def test_exact_contact_allowed_at_space_0(self):
        # Carrés bord à bord (100 mm de côté, centres à 100 mm) : contact
        # légal, aire d'intersection nulle → accepté.
        l = layout([pi(0, 150.0, 200.0), pi(0, 250.0, 200.0)])
        assert _validate_batch(l["placed_items"][1:], l, BY_ID, 1000.0, 1000.0, 0.0) is True

    @pytest.mark.skipif(not HAS_SHAPELY, reason="shapely")
    def test_small_gap_still_rejected_when_space_positive(self):
        # 0,03 mm à space 0,1 : rejeté (miroir JS « paire à 0,03 »).
        l = layout([pi(0, 200.0, 200.0), pi(0, 300.03, 200.0)])
        assert _validate_batch(l["placed_items"][1:], l, BY_ID, 1000.0, 1000.0, 0.1) is False

    @pytest.mark.skipif(not HAS_SHAPELY, reason="shapely")
    def test_pipeline_two_sheets_space_0_no_duplicate_no_overlap(self):
        # Pipeline complet à space 0 (2 tôles, hôtes + fans) : 0 pose
        # dupliquée, 0 paire d'aire d'intersection > 0,01 mm².
        from shapely.geometry import Polygon
        hosts = [pi(0, 100.0 + 110 * k, 500.0) for k in range(6)]
        free = [pi(1, 40.0 + 45 * (k % 8), 40.0 + 45 * (k // 8))
                for k in range(24)]
        layouts = [layout(hosts), layout(free)]
        stats = {}
        fill_residual_bands(layouts, ITEMS, BIN, 0.0, stats=stats)
        for l in layouts:
            polys = []
            for p in l["placed_items"]:
                it = BY_ID[p["item_id"]]
                tr = p["transformation"]
                r = math.radians(float(tr["rotation"]))
                c, si = math.cos(r), math.sin(r)
                pts = [(tr["translation"][0] + c * x - si * y,
                        tr["translation"][1] + si * x + c * y)
                       for x, y in it["coords"]]
                polys.append(Polygon(pts))
            for i in range(len(polys)):
                for j in range(i + 1, len(polys)):
                    inter = polys[i].intersection(polys[j])
                    assert inter.area <= 0.01, f"paire {i}-{j} : {inter.area} mm²"


class TestH1CompactRollbackRestoresFullState:
    """A2/A6 (audit 2026-09-03, bloquant) : le rollback de compaction
    restaurait un état post-re-grid — les hôtes re-grillés recouvraient
    les pièces libres d'origine dès qu'une libre était irremplaçable
    (3ᵉ classe, rotation verrouillée, grande pièce). Fixture audit :
    19 hôtes à droite + pièce 700×500 rotation [0] + 120 fans."""

    @pytest.mark.skipif(not HAS_SHAPELY, reason="shapely")
    def test_rollback_restores_original_poses(self):
        from core.residual import _compact_last_sheet
        from shapely.geometry import Polygon

        big = {"id": 2,
               "coords": [[0.0, 0.0], [700.0, 0.0], [700.0, 500.0],
                          [0.0, 500.0], [0.0, 0.0]],
               "holes": [], "rotations": [0.0]}
        items = [HOST, FAN_ITEM, big]
        by_id = {i["id"]: i for i in items}
        # 18 hôtes en 2 colonnes à droite (pas 102 — grille légale), grande
        # pièce verrouillée à gauche, 120 fans légales au-dessus d'elle.
        hosts = [pi(0, 820.0, 52.0 + 102 * k) for k in range(9)]
        hosts += [pi(0, 930.0, 52.0 + 102 * k) for k in range(9)]
        fans = [pi(1, 20.0 + 42 * (k % 18), 520.0 + 32 * (k // 18))
                for k in range(120)]
        big_pi = pi(2, 2.0, 2.0)
        last = layout(hosts + fans + [big_pi])
        def poses_of(layout_):
            # Multi-ensemble de poses (le rollback restaure des COPIES
            # profondes : les id() changent, pas les poses).
            return sorted(
                (p["item_id"], round(float(p["transformation"]["rotation"]), 6),
                 round(float(p["transformation"]["translation"][0]), 6),
                 round(float(p["transformation"]["translation"][1]), 6))
                for p in layout_["placed_items"])
        orig = poses_of(last)
        stats = {}
        _compact_last_sheet([last], 0, by_id, BIN, 2.0, stats=stats)
        # Quel que soit le chemin (compaction ou rollback) : 0 chevauchement
        # sur les paires impliquant une fan (les hôtes du fixture se
        # touchent par construction, état préexistant non rejugé) et, si
        # rollback, les hôtes sont à leur pose d'ORIGINE (pas re-grillés
        # sur la grande pièce).
        polys = []
        for p in last["placed_items"]:
            it = by_id[p["item_id"]]
            tr = p["transformation"]
            r = math.radians(float(tr["rotation"]))
            c, si = math.cos(r), math.sin(r)
            pts = [(tr["translation"][0] + c * x - si * y,
                    tr["translation"][1] + si * x + c * y)
                   for x, y in it["coords"]]
            polys.append((p, Polygon(pts)))
        for i in range(len(polys)):
            for j in range(i + 1, len(polys)):
                ids = {polys[i][0]["item_id"], polys[j][0]["item_id"]}
                if ids == {0}:
                    continue  # hôtes du fixture : grille collée préexistante
                inter = polys[i][1].intersection(polys[j][1])
                assert inter.area <= 0.01, \
                    f"paire {i}-{j} ids {ids} : {inter.area} mm²"
        if stats.get("compactRollback"):
            assert poses_of(last) == orig, \
                "rollback : poses d'origine attendues (état AVANT le re-grid)"


class TestMovedCountsOnlyRealChanges:
    """D16 : `moved` ne compte que les transformations réellement
    modifiées (au 2ᵉ appel sur un état déjà compacté, moved restait à
    son maximum sans rien bouger)."""

    @pytest.mark.skipif(not HAS_SHAPELY, reason="shapely")
    def test_regrid_second_call_reports_zero_moved(self):
        # _regrid_helices sur des hélices DÉJÀ grillées → poses
        # identiques → moved = 0 (l'ancien `moved += 1 + fans`
        # inconditionnel comptait tout, 505 « déplacées » sans mouvement).
        hosts = [pi(0, 820.0, 52.0 + 102 * k) for k in range(9)]
        hosts += [pi(0, 930.0, 52.0 + 102 * k) for k in range(9)]
        last = layout(hosts)
        units, free = _helix_units_and_free(last, BY_ID)
        moved1, _ = _regrid_helices(last, units, BY_ID, 1000.0, 1000.0, 2.0)
        assert moved1 == 18
        poses = [dict(p["transformation"]) for p in last["placed_items"]]
        units2, free2 = _helix_units_and_free(last, BY_ID)
        moved2, _ = _regrid_helices(last, units2, BY_ID, 1000.0, 1000.0, 2.0)
        poses2 = [dict(p["transformation"]) for p in last["placed_items"]]
        assert poses == poses2, "le 2e re-grid doit être idempotent"
        assert moved2 == 0, f"moved = {moved2} sans déplacement"


class TestD3NonQuarterRotationGuard:
    """D3 (audit 2026-09-03) : _rotated_bbox ne sait calculer que les
    quarts de tour — une rotation libre (45°) rend le pass aveugle. No-op
    + erreur tracée, jamais une validation sur géométrie incalculable."""

    def test_non_quarter_rotation_noops_with_error(self):
        item45 = {"id": 1, "coords": SQUARE, "holes": [],
                  "rotations": [0.0, 45.0]}
        layouts = [layout([pi(0, 100.0, 100.0)]),
                   layout([pi(1, 500.0, 500.0)])]
        stats = {"errors": []}
        n = fill_residual_bands(layouts, [HOST, item45], BIN, 2.0,
                                stats=stats)
        assert n == 0
        assert any("quart de tour" in e["message"] for e in stats["errors"])

    def test_placed_non_quarter_rotation_noops(self):
        layouts = [layout([pi(0, 100.0, 100.0)]),
                   layout([pi(1, 500.0, 500.0, rot=30.0)])]
        stats = {"errors": []}
        n = fill_residual_bands(layouts, ITEMS, BIN, 2.0, stats=stats)
        assert n == 0
        assert any("quart de tour" in e["message"] for e in stats["errors"])

    def test_quarter_rotations_still_pass(self):
        hosts = [pi(0, 100.0 + 110 * k, 500.0) for k in range(4)]
        free = [pi(1, 40.0 + 45 * (k % 8), 40.0 + 45 * (k // 8))
                for k in range(16)]
        layouts = [layout(hosts), layout(free)]
        stats = {"errors": []}
        n = fill_residual_bands(layouts, ITEMS, BIN, 2.0, stats=stats)
        assert not stats["errors"]
        assert n >= 0  # le pass a tourné (no-op éventuel, sans erreur)


class TestPipelineTwoSheetsPhysical:
    """Verrou de régression global (plan phase 1.6) : la CHAÎNE complète
    expand_meta → apply_hole_fill → fill_residual_bands sur un corpus
    2 tôles user-like, paramétrée space ∈ {0, 0.1, 1, 2} — 0
    chevauchement d'aire, 0 pose dupliquée, bornes tôle ±1e-6, compte
    PAR CLASSE invariant, < 10 s."""

    @pytest.mark.skipif(not HAS_SHAPELY, reason="shapely")
    @pytest.mark.parametrize("space", [0.0, 0.1, 1.0, 2.0])
    def test_pipeline_physical_all_spacings(self, space):
        import time as _time
        from shapely.geometry import Polygon
        from core.holefill import apply_hole_fill, expand_meta, meta_slots

        # Trou Ø70 en 64-gon (test_holefill) : le 16-gon HOLE_RING coupe
        # les cordes à r=34,3 et le pinwheel du secteur ne valide plus.
        hole64 = [(35.0 * math.cos(2 * math.pi * i / 64),
                   35.0 * math.sin(2 * math.pi * i / 64)) for i in range(64)]
        hole64.append(hole64[0])
        host = {"id": 0,
                "coords": [[-50.0, -50.0], [-50.0, 50.0], [50.0, 50.0],
                           [50.0, -50.0], [-50.0, -50.0]],
                "holes": [hole64], "count": 8, "rotations": QUARTERS}
        # Fan = SECTEUR r=28 (arc 5°..85°) : capacité pinwheel 4 dans un
        # trou Ø70 (la FAN 40×28, elle, ne s'y niche pas — capacité 0).
        a0, a1 = math.radians(5.0), math.radians(85.0)
        sector = [(2.83, 2.83)]
        for k in range(9):
            a = a0 + (a1 - a0) * (k / 8.0)
            sector.append((28.0 * math.cos(a), 28.0 * math.sin(a)))
        sector.append((2.83, 2.83))
        # 8 hôtes posés × 4 secteurs nichés + 20 posés en instance réduite.
        fan = {"id": 1, "coords": sector, "holes": [], "count": 52,
               "rotations": QUARTERS}
        items = [host, fan]
        slots, _remaining = meta_slots(items, 0, 1)

        # Tôle 1 : 8 hôtes en grille légale (2 colonnes de 4, pas 102) ;
        # instance réduite : 1 hôte + 1 fan posés (le solve réduit).
        layouts = [
            {"container_id": 0, "placed_items": [
                {"item_id": 0, "transformation": {
                    "rotation": 0.0, "translation": (52.0 + 102 * (k % 2),
                                                     52.0 + 102 * (k // 2))}}
                for k in range(8)]},
            {"container_id": 0, "placed_items": [
                {"item_id": 1, "transformation": {
                    "rotation": 0.0, "translation": (600.0, 52.0 + 42 * k)}}
                for k in range(20)]},
        ]
        t0 = _time.perf_counter()
        # expand_meta RETOURNE de nouveaux layouts (pas de mutation).
        layouts[:] = expand_meta(items, 0, 1, slots, layouts)
        apply_hole_fill(items, layouts, space)
        stats = {}
        fill_residual_bands(layouts, items, BIN, space, stats=stats)
        elapsed = _time.perf_counter() - t0
        assert elapsed < 10.0

        # Compte PAR CLASSE invariant (garde A4) : demandé = posé avant
        # le pipeline (l'expansion meta rattachait 4 secteurs par hôte).
        from core.metrics import per_class_counts_match
        from collections import namedtuple
        _T = namedtuple("_T", ["item_id"])
        _C = namedtuple("_C", ["transforms"])
        assert per_class_counts_match(
            [_C([_T(p["item_id"]) for l in layouts
                 for p in l["placed_items"]])], {0: 8, 1: 52})

        seen = set()
        for l in layouts:
            for p in l["placed_items"]:
                t = p["transformation"]
                key = (p["item_id"], round(float(t["rotation"]), 6),
                       round(float(t["translation"][0]), 6),
                       round(float(t["translation"][1]), 6))
                assert key not in seen, f"pose dupliquée {key}"
                seen.add(key)
                # Bornes tôle ±1e-6 sur la bbox BRUTE (A15).
                it = {0: host, 1: fan}[p["item_id"]]
                from core.structure import _bbox, _rotated_bbox
                bb = _rotated_bbox(_bbox(it["coords"]),
                                   float(t["rotation"]))
                tx, ty = t["translation"]
                assert tx + bb[0] >= -1e-6 and ty + bb[1] >= -1e-6
                assert tx + bb[2] <= 1000.0 + 1e-6
                assert ty + bb[3] <= 1000.0 + 1e-6

        # 0 chevauchement d'AIRE (> 0,01 mm²) sur TOUTES les paires, tous
        # espacements (le contact est permis à space 0, l'AIRE ne doit
        # jamais être positive).
        polys = []
        for l in layouts:
            for p in l["placed_items"]:
                it = {0: host, 1: fan}[p["item_id"]]
                t = p["transformation"]
                r = math.radians(float(t["rotation"]))
                c, si = math.cos(r), math.sin(r)

                def tf(ring):
                    return [(t["translation"][0] + c * x - si * y,
                             t["translation"][1] + si * x + c * y)
                            for x, y in ring]
                # Piège #4 : anneau externe MOINS les trous — et le trou
                # doit être transformé en monde COMME l'externe (un trou
                # local ne soustrait rien du shell monde).
                polys.append(Polygon(tf(it["coords"]),
                                     [tf(h) for h in it.get("holes") or []]))
        from shapely.strtree import STRtree
        tree = STRtree(polys)
        for i, a in enumerate(polys):
            for j in tree.query(a.buffer(1.0)):
                j = int(j)
                if j <= i:
                    continue
                inter = a.intersection(polys[j])
                assert inter.area <= 0.01, \
                    f"space={space} paire {i}-{j} : {inter.area} mm²"
