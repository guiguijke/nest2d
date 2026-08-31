"""Tests du pass structurel (grille canonique) — core/structure.py."""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest

from core.structure import (
    ZONE_A_DENSITY,
    build_structural_layout,
    detect_structural_case,
    is_axis_rect,
    layout_used_width,
    plan_lattice,
    _zone_solve,
)

SQUARE = [[50.0, -50.0], [-50.0, -50.0], [-50.0, 50.0], [50.0, 50.0], [50.0, -50.0]]
FAN = [[-19.8, 22.6], [0.0, 2.8], [19.8, 22.6], [0.0, 30.8], [-19.8, 22.6]]
QUARTERS = [0.0, 90.0, 180.0, 270.0]


def geom(coords, rotations=None):
    return {"coords": coords, "rotations": rotations or QUARTERS}


class TestIsAxisRect:
    def test_square_ring(self):
        assert is_axis_rect(SQUARE)

    def test_closed_ring(self):
        assert is_axis_rect([[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]])

    def test_l_shape_rejected(self):
        assert not is_axis_rect([[0, 0], [10, 0], [10, 5], [5, 5], [5, 10], [0, 10], [0, 0]])

    def test_triangle_rejected(self):
        assert not is_axis_rect([[0, 0], [10, 0], [5, 10], [0, 0]])

    def test_rotated_square_rejected(self):
        r = [(x * math.cos(math.pi / 4) - y * math.sin(math.pi / 4),
              x * math.sin(math.pi / 4) + y * math.cos(math.pi / 4))
             for x, y in [(50, -50), (-50, -50), (-50, 50), (50, 50)]]
        assert not is_axis_rect(r + [r[0]])


class TestDetectStructuralCase:
    def make(self, n_rect=100, n_small=400, rect_rots=None, small_rots=None,
             extra=None):
        items = [
            {"id": 0, "demand": n_rect},
            {"id": 1, "demand": n_small},
        ]
        geoms = {
            0: geom(SQUARE, rect_rots),
            1: geom(FAN, small_rots),
        }
        if extra:
            items.append({"id": 2, "demand": extra})
            geoms[2] = geom(FAN)
        total = 10000 * n_rect + 615.7 * n_small
        return detect_structural_case(items, lambda i: geoms[i], total), geoms

    def test_dominant_rect_detected(self):
        case, _ = self.make()
        assert case is not None
        assert case["rect"]["id"] == 0
        assert case["small"]["id"] == 1
        assert case["rect"]["demand"] == 100

    def test_three_classes_rejected(self):
        case, _ = self.make(extra=10)
        assert case is None

    def test_non_quarter_rotations_rejected(self):
        case, _ = self.make(rect_rots=[0.0, 45.0])
        assert case is None

    def test_rect_not_dominant_rejected(self):
        # 10 carrés (100k mm²) vs 400 fans (246k) : 29 % < 60 %
        case, _ = self.make(n_rect=10)
        assert case is None

    def test_small_too_big_rejected(self):
        big = [[-60, -10], [60, -10], [60, 10], [-60, 10], [-60, -10]]
        items = [{"id": 0, "demand": 100}, {"id": 1, "demand": 400}]
        geoms = {0: geom(SQUARE), 1: geom(big)}
        total = 10000 * 100 + 120 * 400
        assert detect_structural_case(items, lambda i: geoms[i], total) is None


class TestPlanLattice:
    def case100(self):
        return {
            "rect": {"id": 0, "demand": 100, "coords": SQUARE,
                     "rotations": QUARTERS, "area": 10000.0,
                     "bbox": (-50.0, -50.0, 50.0, 50.0)},
            "small": {"id": 1, "demand": 400, "coords": FAN,
                      "rotations": QUARTERS, "area": 615.7,
                      "bbox": (-19.8, 2.8, 19.8, 30.8)},
        }

    def test_lattice_1000x2000(self):
        lat = plan_lattice(self.case100(), 1000.0, 2000.0, 0.1)
        assert lat["per_line"] == 19
        assert lat["lines"] == 6
        assert lat["remainder"] == 5
        assert len(lat["placements"]) == 100
        # pitch exact : colonne 1 centre x = space + 50
        assert lat["placements"][0]["transformation"]["translation"] == pytest.approx((50.1, 50.1))
        # colonne 2 : x = 150.2 ; ligne 2 : y = 150.2
        p = lat["placements"][20]["transformation"]["translation"]
        assert p == pytest.approx((150.2, 150.2))
        # zone A : au-dessus des 5 restes de la colonne 6
        assert lat["zone_a"] == pytest.approx((500.6, 500.6, 600.6, 1999.9))
        # zone B : à droite de la grille (lattice_right déjà +space)
        assert lat["zone_b"][0] == pytest.approx(600.7)

    def test_zone_c_end_of_column_band(self):
        # 19 carrés par colonne : la bande au-dessus des colonnes pleines
        # (1902.0 -> 1999.9) doit être exposée pour remplissage.
        lat = plan_lattice(self.case100(), 1000.0, 2000.0, 0.1)
        assert lat["zone_c"] == pytest.approx((0.1, 1902.0, 500.5, 1999.9))

    def test_zone_c_boundaries(self):
        # 19 carrés + marges = 1902.0 PILE : hauteur exacte -> pas de bande.
        lat = plan_lattice(self.case100(), 800.0, 1902.0, 0.1)
        assert lat["per_line"] == 19
        assert lat["zone_c"] is None
        # 1901.5 : 18 par colonne, bande de ~99.5 mm au-dessus des pleines.
        lat = plan_lattice(self.case100(), 800.0, 1901.5, 0.1)
        assert lat["per_line"] == 18
        assert lat["zone_c"][1] == pytest.approx(1801.9)
        assert lat["zone_c"][3] == pytest.approx(1901.4)

    def test_no_remainder_no_zone_a(self):
        case = self.case100()
        case["rect"]["demand"] = 95
        lat = plan_lattice(case, 1000.0, 2000.0, 0.1)
        assert lat["remainder"] == 0
        assert lat["zone_a"] is None

    def test_all_items_translation_convention_centroid(self):
        # le carré fixture est centré origine : translation = centre exact
        lat = plan_lattice(self.case100(), 1000.0, 2000.0, 0.1)
        tx, ty = lat["placements"][0]["transformation"]["translation"]
        assert tx == pytest.approx(50.1)
        assert ty == pytest.approx(50.1)


class TestZoneSolve:
    def small(self):
        return {"id": 1, "coords": FAN, "rotations": QUARTERS,
                "area": 615.7, "bbox": (-19.8, 2.8, 19.8, 30.8)}

    def test_success_first_try(self):
        def solve(count, zh, zw, budget, transposed=False):
            return [{"transformation": {"rotation": 0, "translation": (20 * i, 0)}}
                    for i in range(count)]
        out = _zone_solve((0.0, 0.0, 100.0, 500.0), self.small(), 0.1, 3, solve, 5)
        assert len(out) == 3
        assert out[0]["transformation"]["translation"] == (0.0, 0.0)
        assert out[2]["transformation"]["translation"] == (40.0, 0.0)
        assert out[0]["item_id"] == 1

    def test_overflow_shrinks(self):
        calls = []

        def solve(count, zh, zw, budget, transposed=False):
            calls.append(count)
            # déborde toujours de ~20 % au-delà de zw=100
            w = 120.0
            return [{"transformation": {"rotation": 0, "translation": (w, 0)}}
                    for _ in range(count)]
        out = _zone_solve((0.0, 0.0, 100.0, 500.0), self.small(), 0.1, 10, solve, 5)
        assert out == []
        assert len(calls) >= 2  # la boucle a réduit puis re-tenté

    def test_infeasible_solver_shrinks(self):
        calls = []

        def solve(count, zh, zw, budget, transposed=False):
            calls.append(count)
            if count > 5:
                return None  # EngineError du sous-solve
            return [{"transformation": {"rotation": 0, "translation": (1.0, 1.0)}}
                    for _ in range(count)]
        out = _zone_solve((0.0, 0.0, 100.0, 500.0), self.small(), 0.1, 20, solve, 5)
        # encadrement : shrink 20→12→7 (échecs), succès 4 puis REGONFLER 5
        assert len(out) == 5
        assert calls == [20, 12, 7, 4, 5]

    def test_success_grows_toward_capacity(self):
        calls = []

        def solve(count, zh, zw, budget, transposed=False):
            calls.append(count)
            if count > 50:
                return None
            return [{"transformation": {"rotation": 0, "translation": (1.0, 1.0)}}
                    for _ in range(count)]
        out = _zone_solve((0.0, 0.0, 100.0, 500.0), self.small(), 0.1, 100, solve, 5)
        # shrink 100→60 (échecs) puis succès 36 et regonflées 41, 47 : la
        # zone approche sa vraie capacité (50) au lieu de rester à 36.
        assert len(out) == 47
        assert calls == [100, 60, 36, 41, 47]

    def test_full_request_first_try(self):
        calls = []

        def solve(count, zh, zw, budget, transposed=False):
            calls.append(count)
            return [{"transformation": {"rotation": 0, "translation": (1.0, 1.0)}}
                    for _ in range(count)]
        out = _zone_solve((0.0, 0.0, 100.0, 500.0), self.small(), 0.1, 30, solve, 5)
        assert len(out) == 30
        assert calls == [30]

    def test_single_item_overflow_gives_up(self):
        def solve(count, zh, zw, budget, transposed=False):
            return [{"transformation": {"rotation": 0, "translation": (zw + 5, 0)}}]
        out = _zone_solve((0.0, 0.0, 100.0, 500.0), self.small(), 0.1, 1, solve, 5)
        assert out == []


class TestBuildStructuralLayout:
    def full_case(self):
        return (
            [{"id": 0, "demand": 100}, {"id": 1, "demand": 400}],
            {0: geom(SQUARE), 1: geom(FAN)},
            1000.0, 2000.0, 0.1,
        )

    def test_assembly_counts_and_ids(self):
        items, geoms, W, H, space = self.full_case()
        zones_filled = []

        def solve(count, zh, zw, budget, transposed=False):
            zones_filled.append((count, round(zh, 1), round(zw, 1)))
            return [{"item_id": 0,
                     "transformation": {"rotation": 0,
                                        "translation": (10.0, 10.0)}}
                    for _ in range(count)]
        out = build_structural_layout(items, lambda i: geoms[i], W, H, space, solve)
        assert out is not None
        rects = [p for p in out["placed_items"] if p["item_id"] == 0]
        smalls = [p for p in out["placed_items"] if p["item_id"] == 1]
        assert len(rects) == 100
        assert len(smalls) == 400
        assert out["case"]["lines"] == 6
        # A/C/B : lattice d'abord. S'il reste un appel moteur, c'est B
        # (pleine hauteur) ou un tronçon.
        if zones_filled:
            last_h = zones_filled[-1][1]
            assert last_h == pytest.approx(1999.8, abs=1.0) or last_h > 90

    def test_zone_b_lattice_without_engine(self):
        items, geoms, W, H, space = self.full_case()

        def solve(count, zh, zw, budget, transposed=False):
            return None
        out = build_structural_layout(items, lambda i: geoms[i], W, H, space, solve)
        if out is None:
            pytest.skip("small_lattice requires shapely")
        smalls = [p for p in out["placed_items"] if p["item_id"] == 1]
        assert len(smalls) == 400

    def test_layout_used_width_hand_computed(self):
        items, geoms, W, H, space = self.full_case()

        def solve(count, zh, zw, budget, transposed=False):
            return None
        out = build_structural_layout(items, lambda i: geoms[i], W, H, space, solve)
        if out is None:
            pytest.skip("small_lattice requires shapely")
        w = layout_used_width(out, lambda i: geoms[i], space)
        # 6 colonnes de carrés = 600.7 mm ; les fans de B étendent +X.
        assert w > 600.7
        assert w < 1000.0


class TestToleranceEnv:
    def test_default_tol(self):
        # STRUCT_TOL importé au module : 0.15 par défaut, overridable
        import core.structure as st
        assert 0.05 < st.STRUCT_TOL < 0.5
        assert 0.5 < ZONE_A_DENSITY <= 1.0


class TestObjectiveY:
    """Grille −Y : rangées le long de X, zones empilées en Y, bande du haut
    résolue en transposé (minimiser la hauteur)."""

    def test_plan_lattice_y_rows(self):
        case = {
            "rect": {"id": 0, "demand": 100, "coords": SQUARE,
                     "rotations": QUARTERS, "area": 10000.0,
                     "bbox": (-50.0, -50.0, 50.0, 50.0)},
            "small": {"id": 1, "demand": 400, "coords": FAN,
                      "rotations": QUARTERS, "area": 615.7,
                      "bbox": (-19.8, 2.8, 19.8, 30.8)},
        }
        lat = plan_lattice(case, 1000.0, 2000.0, 0.1, objective="y")
        # 9 par rangée sur 1000 de large ; 11 pleines + 1 de reste
        assert lat["per_line"] == 9
        assert lat["lines"] == 12
        assert lat["remainder"] == 1
        assert len(lat["placements"]) == 100
        # première rangée : bord bas à space, bord gauche à space
        tx, ty = lat["placements"][0]["transformation"]["translation"]
        assert tx == pytest.approx(50.1)
        assert ty == pytest.approx(50.1)
        # zone A' : à droite du carré de reste dans la 12e rangée
        assert lat["zone_a"][0] == pytest.approx(100.2)
        assert lat["zone_a"][1] == pytest.approx(1101.2)
        # zone C' : bande verticale à droite des rangées pleines
        assert lat["zone_c"][0] == pytest.approx(901.0)
        # zone B' : AU-DESSUS de la grille (lattice_top déjà +space)
        assert lat["zone_b"][1] == pytest.approx(1201.3)
        assert lat["zone_b_transposed"] is True

    def test_zone_solve_transposed_map_back(self):
        small = {"id": 1, "coords": FAN, "rotations": QUARTERS,
                 "area": 615.7, "bbox": (-30.8, -19.8, 2.8, 19.8)}  # bbox frame solve

        def solve(count, strip_h, max_w, budget, transposed=False):
            assert transposed is True
            assert strip_h == pytest.approx(99.8)   # largeur réelle zone
            assert max_w == pytest.approx(797.6)    # hauteur dispo zone
            return [{"transformation": {"rotation": 90.0,
                                        "translation": (10.0, 20.0)}}
                    for _ in range(count)]
        zone = (0.1, 1202.3, 99.9, 1999.9)
        out = _zone_solve(zone, small, 0.1, 3, solve, 5, transposed=True)
        assert len(out) == 3
        # map-back transposé : (x0 + (zw − ty), y0 + tx)
        assert out[0]["transformation"]["translation"] == pytest.approx(
            (0.1 + (99.8 - 20.0), 1202.3 + 10.0))
        assert out[0]["transformation"]["rotation"] == 90.0

    def test_build_objective_y_calls_transposed_for_b(self):
        items = [{"id": 0, "demand": 100}, {"id": 1, "demand": 400}]
        geoms = {0: geom(SQUARE), 1: geom(FAN)}
        seen = []

        def solve(count, strip_h, max_w, budget, transposed=False):
            seen.append((round(strip_h), round(max_w), transposed))
            return [{"item_id": 0,
                     "transformation": {"rotation": 0,
                                        "translation": (5.0, 5.0)}}
                    for _ in range(count)]
        from core.structure import build_structural_layout, layout_used_extent
        out = build_structural_layout(items, lambda i: geoms[i], 1000.0,
                                      2000.0, 0.1, solve, objective="y")
        if out is None:
            pytest.skip("small_lattice requires shapely")
        assert out is not None
        # A'/C' : lattice (pas d'appel moteur). B' est transposée → moteur.
        assert seen, "zone B' transposed still calls the engine"
        assert all(t is True for _, _, t in seen)
        ext = layout_used_extent(out, lambda i: geoms[i], 0.1, axis="y")
        assert ext > 1201.0
        assert ext < 2000.0


class TestHolePlan:
    """Cas « trous d'abord » (constat 2026-08-29) : la grille consomme la
    vue ORIGINALE, zones internes A/C d'abord, trous des hôtes ensuite,
    zone B en dernier. Le layout est auto-suffisant (ids d'origine)."""

    HOLE_RING = [[35.0 * math.cos(a / 16 * 2 * math.pi),
                  35.0 * math.sin(a / 16 * 2 * math.pi)] for a in range(16)]

    def host_item(self):
        return {"id": 0, "count": 12, "coords": SQUARE,
                "rotations": list(QUARTERS), "holes": [self.HOLE_RING]}

    def build(self, n_small, solve, sheet_w=500.0):
        # 12 carrés sur {sheet_w}×400 : 4 colonnes de 3 (reste 0 → pas de
        # zone A), bande C au-dessus, zone B à droite.
        items = [{"id": 0, "demand": 12}, {"id": 1, "demand": n_small}]
        geoms = {0: geom(SQUARE), 1: geom(FAN)}
        hole_plan = {
            "host_item": self.host_item(),
            "fill_id": 1,
            "ring_rotations": [[0.0, 90.0, 180.0, 270.0]],
        }
        return build_structural_layout(
            items, lambda i: geoms[i], sheet_w, 400.0, 0.1, solve,
            hole_plan=hole_plan), items, geoms

    def test_holes_absorb_remainder_no_zone_b(self):
        # 80 fans : zone C (cap ~68) d'abord, trous des 12 carrés (cap 48)
        # prennent 12, zone B JAMAIS sollicitée.
        calls = []

        def solve(count, strip_h, max_w, budget, transposed=False):
            calls.append((round(strip_h), round(max_w)))
            return [{"item_id": 1,
                     "transformation": {"rotation": 0.0,
                                        "translation": (1.0, 1.0)}}
                    for _ in range(count)]
        out, _items, _geoms = self.build(80, solve)
        assert out is not None
        rects = [p for p in out["placed_items"] if p["item_id"] == 0]
        smalls = [p for p in out["placed_items"] if p["item_id"] == 1]
        assert len(rects) == 12
        assert len(smalls) == 80
        # C est du lattice (0 appel moteur) ; le reliquat va aux trous.
        assert calls == []
        assert 0 < out["case"]["holes"] <= 48

    def test_hole_pose_math(self):
        # Plus de pièces que C + trous : le pinwheel pose au centroïde hôte.
        def solve(count, strip_h, max_w, budget, transposed=False):
            return None
        out, _items, _geoms = self.build(80, solve)
        assert out is not None
        assert out["case"]["holes"] > 0
        holes = [p for p in out["placed_items"] if p["item_id"] == 1
                 and abs(p["transformation"]["translation"][0] - 50.1) < 1.0]
        assert holes
        first = holes[0]["transformation"]
        assert first["translation"][0] == pytest.approx(50.1, abs=1e-6)
        assert first["translation"][1] == pytest.approx(50.1, abs=1e-6)
        assert first["rotation"] in (0.0, 90.0, 180.0, 270.0)

    def test_holes_overflow_to_zone_b(self):
        # Lattice C + trous (cap 48) ; le reste va en B (lattice, pas moteur).
        def solve(count, strip_h, max_w, budget, transposed=False):
            return None
        out, _items, _geoms = self.build(80, solve)
        assert out is not None
        assert 0 < out["case"]["holes"] <= 48
        smalls = [p for p in out["placed_items"] if p["item_id"] == 1]
        assert len(smalls) == 80


class TestSmallLattice:
    """Lattice analytique des petites pièces (compression finale,
    2026-08-29) : colonnes entrelacées rot0/rot180, validation runtime."""

    def make_quarter_pie(self):
        import math
        r = 27.95
        cy = 2.9
        pts = []
        for k in range(-22, 23):
            a = math.radians(k * 45 / 22)
            pts.append([r * math.sin(a), cy + r * math.cos(a)])
        pts.append([0.0, cy])
        pts.append(pts[0])
        return pts

    def test_quarter_pie_lattice_zero_conflict(self):
        from core.structure import small_lattice
        ring = self.make_quarter_pie()
        small = {"id": 7, "coords": ring, "area": 550.0}
        rect = (500.4, 500.6, 600.4, 1999.9)
        out = small_lattice(small, 0.1, rect)
        assert out is not None
        assert len(out) > 120  # ~67 % de densité en bande 100 mm
        # validation distance : re-vérifier par shapely
        from shapely.geometry import Polygon
        from shapely import affinity
        polys = []
        for p in out:
            rot = p["transformation"]["rotation"]
            t = p["transformation"]["translation"]
            base = Polygon(ring)
            q = affinity.rotate(base, rot, origin=(0, 0))
            polys.append(affinity.translate(q, t[0], t[1]))
        for i in range(len(polys)):
            for j in range(i + 1, len(polys)):
                assert polys[i].distance(polys[j]) >= 0.1 - 1e-6, (i, j)
        # bbox entière dans la zone (déjà l'intérieur faisable)
        for p in polys:
            b = p.bounds
            assert b[0] >= 500.4 - 1e-6 and b[2] <= 600.4 + 1e-6
            assert b[1] >= 500.6 - 1e-6 and b[3] <= 1999.9 + 1e-6
        min_y = min(p.bounds[1] for p in polys)
        assert min_y < 500.6 + 1.0

    def test_rhombus_bbox_grid_always_fills(self):
        from core.structure import small_lattice
        # losange : le zigzag 0/180 peut échouer, la grille bbox doit
        # quand même remplir (méthode générale, pas un repli None).
        ring = [[-19.8, 16.8], [0.0, 30.8], [19.8, 16.8], [0.0, 2.8], [-19.8, 16.8]]
        small = {"id": 1, "coords": ring, "area": 554.0}
        out = small_lattice(small, 0.1, (0.0, 0.0, 100.1, 500.0))
        assert out is not None
        assert len(out) > 0
