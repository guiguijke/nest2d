"""Post-pass BPP « remplissage des bandes résiduelles » (D-MOT-19).

Constat (2026-08-31, docs/PLAN-bpp-remplissage-residuel.md) : en
multi-tôles, le constructif place chaque petite pièce là où la croissance
marginale de bbox est minimale → elles s'empilent toutes sur la DERNIÈRE
tôle et les bandes libres (~80-100 mm) des tôles précédentes restent
vides ; le recuit ne backfill pas (remnant MOYEN : chaque déplacement
individuel est non améliorant — optimum local structurel).

Ce pass — APRÈS apply_hole_fill, AVANT reveal/artefacts — prend les
pièces LIBRES de la tôle la moins remplie et les pose au lattice
(`small_lattice`, déjà calibré) dans les bandes vides des tôles plus
remplies : 4 côtés clippés à l'AABB + coin haut-droit, inset `space`.
Objectif produit : remplir les tôles précédentes, garder la dernière
comme chute réutilisable propre.

Contrats :
- déterministe (lattice analytique, tri stables) ;
- hôtes (pièces à trous) et pièces nichées dans un trou : JAMAIS déplacés ;
- compte global de placed_items invariant (le part-loss guard reste le
  filet final) ;
- toute exception ou batch invalide → rollback, alternative intacte
  (même contrat que apply_hole_fill / pass grille) ;
- < 2 layouts → no-op (SPP, BPP 1 tôle).

Miroir JS : app/composables/residualClient.js.
"""

import copy
import logging
import os

from core.structure import _bbox, _rotated_bbox, _shoelace, small_lattice

logger = logging.getLogger(__name__)

# Le moteur garantit l'espacement sur les anneaux SIMPLIFIÉS (même env que
# main.py SIMPLIFY_MM / structure.py LATTICE_SIMPLIFY_MM) : en ring brut,
# les layouts préexistants tombent à ~0,005 mm sous space et une validation
# exacte rejeterait TOUT batch (no-op silencieux — constaté au banc).
_SIMPLIFY_MM = float(os.environ.get("NEST_SIMPLIFY_MM", "0.05"))

# Bornes anti-boucle : au-delà, les bandes restantes sont trop petites
# pour intéresser qui que ce soit (mesuré : 2 itérations suffisent sur le
# corpus 100+800 ; 4 couvre les retraits en cascade de la tôle last).
N_ITER = 4
_EPS = 1e-6


def _placed_poly(item, rot, tx, ty, simplify=True):
    from shapely.affinity import rotate, translate
    from shapely.geometry import Polygon
    # Pièce AVEC ses trous (un hôte sans ses trous intersecte ses propres
    # fillers nichés) et SIMPLIFIÉE : le moteur solve sur anneaux
    # simplifiés — c'est à cette échelle que l'espacement est garanti.
    # simplify=False : anneau BRUT — le test de couverture tôle l'exige
    # (le simplify peut plonger un sommet de ~0,05 sous un bord touché
    # exactement, cf. compaction ancre au bord, 2026-09-02).
    poly = Polygon(item["coords"], item.get("holes") or [])
    poly = translate(rotate(poly, float(rot), origin=(0, 0)), float(tx), float(ty))
    if simplify:
        poly = poly.simplify(_SIMPLIFY_MM, preserve_topology=True)
    return poly


def layout_aabb(layout, items_by_id):
    """AABB EXTERNE des placements (translation externe + bbox tournée —
    piège #48). None si le layout est vide."""
    minx = miny = float("inf")
    maxx = maxy = float("-inf")
    for pi in layout.get("placed_items", []):
        it = items_by_id[pi["item_id"]]
        tr = pi["transformation"]
        bb = _rotated_bbox(_bbox(it["coords"]), float(tr["rotation"]))
        tx, ty = tr["translation"][0], tr["translation"][1]
        minx = min(minx, tx + bb[0])
        miny = min(miny, ty + bb[1])
        maxx = max(maxx, tx + bb[2])
        maxy = max(maxy, ty + bb[3])
    if minx == float("inf"):
        return None
    return (minx, miny, maxx, maxy)


def residual_bands(used, sheet_w, sheet_h, space):
    """5 rectangles libres autour du bloc utilisé (4 côtés CLIPPÉS à
    l'AABB + coin haut-droit), inset `space` des deux bords (AABB et
    tôle) — sans inset la 1re colonne est à distance 0 des hôtes et la
    validation rejette tout le batch (no-op silencieux).

    Pas de bande pleine tôle (elle tuerait la bande adjacente dès la
    1re pièce posée) et PAS de L (small_lattice exige un rectangle).
    Tri : aire décroissante, tie-break nom (déterminisme).
    """
    minx, miny, maxx, maxy = used
    defs = (
        ("corner", (maxx + space, maxy + space, sheet_w - space, sheet_h - space), "y"),
        ("right", (maxx + space, miny, sheet_w - space, maxy), "x"),
        ("top", (minx, maxy + space, maxx, sheet_h - space), "y"),
        ("left", (space, miny, minx - space, maxy), "x"),
        ("bottom", (minx, space, maxx, miny - space), "y"),
    )
    out = []
    for name, rect, axis in defs:
        w = rect[2] - rect[0]
        h = rect[3] - rect[1]
        if w > _EPS and h > _EPS:
            out.append({"name": name, "rect": rect, "axis": axis, "area": w * h})
    out.sort(key=lambda b: (-b["area"], b["name"]))
    return out


def _fill_ratio(layout, items_by_id, bin_dims):
    """Taux de remplissage en AIRES OUTER (pas AABB) — un ratio, pas une
    aire absolue, sinon une 2000×3000 à moitié vide gagne toujours."""
    w, h = bin_dims[layout["container_id"]]
    if w <= 0 or h <= 0:
        return 0.0
    area = sum(_shoelace(items_by_id[pi["item_id"]]["coords"])
               for pi in layout.get("placed_items", []))
    return area / (w * h)


def _free_pis(layout, items_by_id):
    """Pièces LIBRES du layout : item sans trous ET dont le centroïde
    n'est dans aucun trou d'un hôte du MÊME layout (miroir du nested_hole
    d'apply_hole_fill, restreint au layout — les coords trous sont locales
    à leur tôle). Les hôtes ne bougent JAMAIS (leur hélice les suit)."""
    from shapely.affinity import rotate as sh_rotate, translate as sh_translate
    from shapely.geometry import Polygon

    entries = []
    for idx, pi in enumerate(layout.get("placed_items", [])):
        it = items_by_id[pi["item_id"]]
        tr = pi["transformation"]
        entries.append((idx, pi, it,
                        _placed_poly(it, tr["rotation"],
                                     tr["translation"][0], tr["translation"][1])))
    hole_polys = []
    for _idx, pi, it, _poly in entries:
        if not (it.get("holes") or []):
            continue
        tr = pi["transformation"]
        for h in it["holes"]:
            hole_polys.append(sh_translate(
                sh_rotate(Polygon(h), float(tr["rotation"]), origin=(0, 0)),
                tr["translation"][0], tr["translation"][1]))
    free = []
    for idx, pi, it, poly in entries:
        if it.get("holes"):
            continue
        c = poly.centroid
        if any(hp.contains(c) for hp in hole_polys):
            continue
        free.append(pi)
    return free


def _pick_class(free_pis, items_by_id, band_w, band_h):
    """Classe la plus nombreuse dont UNE rotation permise tient dans la
    bande (bbox tournée, piège #48). Pas de cap « 50 % de la bande »
    (D3 : le corpus Fillx4 / 81 mm ≈ 51 % serait exclu). Tie : id croissant."""
    counts = {}
    for pi in free_pis:
        counts[pi["item_id"]] = counts.get(pi["item_id"], 0) + 1
    best = None
    for cls_id in sorted(counts):
        it = items_by_id[cls_id]
        bb = _bbox(it["coords"])
        fits = False
        for r in (it.get("rotations") or [0.0, 90.0, 180.0, 270.0]):
            rb = _rotated_bbox(bb, float(r))
            if (rb[2] - rb[0] <= band_w + _EPS
                    and rb[3] - rb[1] <= band_h + _EPS):
                fits = True
                break
        if fits and (best is None or counts[cls_id] > counts[best]):
            best = cls_id
    return best


def _pair_violates(poly, other, space):
    """Une paire pose-t-elle un problème physique ? A1 (audit 2026-09-03) :
    à space 0, `d < space − ε` est toujours faux → le batch n'excluait
    PLUS RIEN (3 136 chevauchements livrés au banc). Politique §8.1 :
    à space 0 le contact est PERMIS, seul le chevauchement d'aire
    > OVERLAP_EPS est rejeté.
    V4 (vérif 2026-09-04) : à space > 0, TOUTE paire plus proche que
    space − ε est une violation — y compris le contact bord à bord à
    distance 0 sans aire (l'implémentation du 03/09 l'avait admis par
    régression : `if d > 0 … else aire`). Miroir JS :
    residualClient.pairViolates."""
    d = poly.distance(other)
    if space > _EPS:
        return d < space - _EPS
    return d == 0.0 and poly.intersection(other).area > _OVERLAP_EPS_MM2


# Miroir de metrics.OVERLAP_EPS_MM2 : aire d'intersection sous ce seuil =
# contact/bruit, pas un chevauchement (A1).
_OVERLAP_EPS_MM2 = 0.01


def _sheet_bounds_ok(item, tr, sheet_w, sheet_h):
    """Couverture tôle sur l'anneau BRUT et par bornes ±_EPS (miroir exact
    du bbox-check JS) : le simplify peut plonger un sommet sous un bord
    exactement touché, et le lattice cale ses rangées au bord avec un bruit
    flottant (ty=-2.8000000000000007 → y_min = -6.7e-16) — `covers` strict
    refusait les deux (2026-09-02)."""
    raw = _placed_poly(item, tr["rotation"], tr["translation"][0],
                       tr["translation"][1], simplify=False)
    bminx, bminy, bmaxx, bmaxy = raw.bounds
    return not (bminx < -_EPS or bminy < -_EPS
                or bmaxx > sheet_w + _EPS or bmaxy > sheet_h + _EPS)


def _occupancy(layout, items_by_id, exclude=()):
    """(entries, tree) des pièces posées du layout — STRtree construit UNE
    fois (A7 : l'ancienne boucle re-construisait tous les polygones pour
    CHAQUE pose candidate, et le retry take//2 rejouait les mêmes premières
    poses). `exclude` : ids() à ignorer (donneuses du batch en cours)."""
    from shapely.strtree import STRtree

    excl = frozenset(exclude)
    entries = []
    for pi in layout.get("placed_items", []):
        if id(pi) in excl:
            continue
        it = items_by_id[pi["item_id"]]
        tr = pi["transformation"]
        entries.append((pi, _placed_poly(it, tr["rotation"],
                                         tr["translation"][0],
                                         tr["translation"][1])))
    tree = STRtree([p for _pi, p in entries]) if entries else None
    return entries, tree


def _pose_conflicts(poly, entries, tree, space):
    """La pose `poly` viole-t-elle l'espacement/chevauchement contre
    l'occupancy (entries, tree) ? Requête bbox élargie puis distance exacte
    — toute paire plus proche que space+1 est garantie candidate."""
    if tree is None:
        return False
    for j in tree.query(poly.buffer(max(space, 0.0) + 1.0)):
        if _pair_violates(poly, entries[int(j)][1], space):
            return True
    return False


def _validate_batch(new_pis, layout, items_by_id, sheet_w, sheet_h, space):
    """Ceinture du BATCH : chaque pièce AJOUTÉE doit être couverte par la
    tôle et à distance ≥ space de TOUTES les pièces du layout (y compris
    entre nouvelles ; à space 0 le contact est permis, seuls les
    chevauchements d'aire sont rejetés — A1). Les paires PRÉEXISTANTES ne
    sont pas re-jugées : un défaut amont (constaté au banc 2026-08-31 : les
    poses pinwheel d'expand_meta à space > 0 se touchent — jumeaux distance
    0 sur la tôle la moins remplie) ne doit pas paralyser le pass. Le
    retrait de pièces de la tôle source, lui, ne peut jamais créer de
    violation. Les `new_pis` peuvent déjà être appendées au layout
    (restauration de compaction) : elles sont exclues de l'occupancy et
    jugées entre elles."""
    entries, tree = _occupancy(layout, items_by_id,
                               exclude=[id(pi) for pi in new_pis])
    new_polys = []
    for pi in new_pis:
        it = items_by_id[pi["item_id"]]
        tr = pi["transformation"]
        if not _sheet_bounds_ok(it, tr, sheet_w, sheet_h):
            return False
        poly = _placed_poly(it, tr["rotation"], tr["translation"][0],
                            tr["translation"][1])
        if _pose_conflicts(poly, entries, tree, space):
            return False
        for _pi, p in new_polys:
            if _pair_violates(poly, p, space):
                return False
        new_polys.append((pi, poly))
    return True


def _remove_by_identity(lst, pi):
    """list.remove comparant les dicts PAR VALEUR : la transformation du
    donneur vient d'être écrasée par la pose lattice — un remove par valeur
    détruit alors une pièce DÉJÀ POSÉE à la pose jumelle au lieu de lever
    ValueError, et la boucle de compaction pose/dépose les mêmes pièces à
    l'infini (constaté audit 2026-09-02, fixture T10). Identité uniquement."""
    for k, x in enumerate(lst):
        if x is pi:
            del lst[k]
            return True
    return False


def _fill_one_batch(layouts, dst_i, src_i, items_by_id, bin_dims, space,
                    free=None, bands=None):
    """Un batch : une bande de layouts[dst_i] remplie depuis les libres de
    layouts[src_i]. Retourne le nombre de pièces déplacées (0 = plus rien
    à faire sur cette tôle). `free` surcharge la liste des donneuses
    (compaction : donneuses détachées, src == dst). `bands` surcharge les
    zones à remplir (compaction : poches internes du re-grid AVANT les
    bandes classiques — audit 2026-09-02 F1). NB (A8, audit 2026-09-03) :
    dès que `bands` est fourni, min_poses = 1 (la compaction EST toujours
    en mode zones explicites) — le seuil 2 ne vaut QUE pour les bandes
    classiques.

    A7 (audit 2026-09-03) : plus de retry `take //= 2` — il rejouait les
    MÊMES premières poses (lat[0] fautive = bande perdue). L'occupancy de
    la tôle cible est construite UNE fois (STRtree), puis chaque pose est
    validée individuellement : une pose fautive n'en coûte que'elle-même.
    """
    dst = layouts[dst_i]
    src = layouts[src_i]
    sw, sh = bin_dims[dst["container_id"]]
    used = layout_aabb(dst, items_by_id)
    if used is None:
        return 0
    if free is None:
        free = _free_pis(src, items_by_id)
    if not free:
        return 0

    for band in (bands if bands is not None
                 else residual_bands(used, sw, sh, space)):
        x0, y0, x1, y1 = band["rect"]
        cls_id = _pick_class(free, items_by_id, x1 - x0, y1 - y0)
        if cls_id is None:
            continue
        it = items_by_id[cls_id]
        # P-m.1 : jamais de rotations vides au lattice (P-1 en dépend).
        small = {"id": cls_id, "coords": it["coords"],
                 "rotations": it.get("rotations") or [0.0, 90.0, 180.0, 270.0]}
        donors = [pi for pi in free if pi["item_id"] == cls_id]
        lat = small_lattice(small, space, band["rect"], want=len(donors),
                            axis=band["axis"])
        # Batches d'une pose : UNIQUEMENT en zones explicites (poches de la
        # compaction — audit F2a). Les bandes classiques gardent le seuil 2 :
        # un balayage complet par pièce isolée coûte un small_lattice par
        # bande et ralentit la queue du remplissage (constaté : T10 ×10).
        min_poses = 1 if bands is not None else 2
        if not lat or len(lat) < min_poses:
            continue
        # Donors anti-compacts d'abord (plus excentrés du centre de la
        # tôle source) : la bbox du last se rétracte au fil des batchs.
        used_src = layout_aabb(src, items_by_id)
        if used_src:
            cx = (used_src[0] + used_src[2]) / 2
            cy = (used_src[1] + used_src[3]) / 2
        else:
            cx, cy = sw / 2, sh / 2
        order = sorted(
            donors,
            key=lambda pi: -(((pi["transformation"]["translation"][0] - cx) ** 2
                              + (pi["transformation"]["translation"][1] - cy) ** 2)),
        )
        # Occupancy de dst SANS les donneuses (elles n'y sont pas encore) ;
        # les poses commitées s'ajoutent au fil de l'eau (nouvelles-vs-
        # nouvelles validées par construction, piège #51) — le STRtree
        # couvre le préexistant, les nouvelles (peu nombreuses) en linéaire.
        entries, tree = _occupancy(dst, items_by_id)
        new_entries = []
        committed = 0
        for pi, lp in zip(order, lat):
            tr = lp["transformation"]
            poly = _placed_poly(it, tr["rotation"],
                                tr["translation"][0], tr["translation"][1])
            if not _sheet_bounds_ok(it, tr, sw, sh):
                continue
            if _pose_conflicts(poly, entries, tree, space):
                continue
            if any(_pair_violates(poly, _p, space) for _pi, _p in new_entries):
                continue
            old_tr = pi["transformation"]
            pi["transformation"] = {"rotation": tr["rotation"],
                                    "translation": tuple(tr["translation"])}
            if src is not dst:
                _remove_by_identity(src["placed_items"], pi)
            dst["placed_items"].append(pi)
            new_entries.append((pi, poly))
            # V18 : seules les transformations RÉELLEMENT modifiées
            # comptent (une fan re-posée à sa propre pose lattice n'a pas
            # bougé — le 2ᵉ appel comptait 422 « déplacées » sans mouvement).
            if (abs(float(tr["rotation"]) - float(old_tr.get("rotation", 0.0))) > 1e-9
                    or abs(float(tr["translation"][0])
                           - float(old_tr.get("translation", (0.0, 0.0))[0])) > 1e-9
                    or abs(float(tr["translation"][1])
                           - float(old_tr.get("translation", (0.0, 0.0))[1])) > 1e-9):
                committed += 1
        if committed:
            return committed
    return 0


class _CompactRollback(Exception):
    """Compaction avortée : restauration complète de la tôle (no-op)."""


def _helix_units_and_free(layout, items_by_id):
    """Classe la tôle en unités RIGIDES : une hélice = hôte (item à trous)
    + les fans dont le centroïde est dans UN de ses trous (classification
    miroir de _free_pis, mais groupée par hôte). Retourne
    (units [{host, fans}], free)."""
    from shapely.affinity import rotate as sh_rotate, translate as sh_translate
    from shapely.geometry import Polygon

    hosts = []      # [(pi, hole_polys_world)]
    others = []     # [(pi, poly)]
    for pi in layout.get("placed_items", []):
        it = items_by_id[pi["item_id"]]
        tr = pi["transformation"]
        poly = _placed_poly(it, tr["rotation"],
                            tr["translation"][0], tr["translation"][1],
                            simplify=False)
        if it.get("holes"):
            hp = []
            for h in it["holes"]:
                q = sh_translate(sh_rotate(Polygon(h), tr["rotation"],
                                           origin=(0, 0)),
                                 tr["translation"][0], tr["translation"][1])
                hp.append(q)
            hosts.append((pi, hp))
        else:
            others.append((pi, poly))
    units = []
    free = []
    for pi, poly in others:
        c = poly.centroid
        unit = None
        for host_pi, hp in hosts:
            if any(h.covers(c) for h in hp):
                unit = host_pi
                break
        if unit is None:
            free.append(pi)
        else:
            for u in units:
                if u["host"] is unit:
                    u["fans"].append(pi)
                    break
            else:
                units.append({"host": unit, "fans": [pi]})
    for host_pi, _hp in hosts:
        if not any(u["host"] is host_pi for u in units):
            units.append({"host": host_pi, "fans": []})
    return units, free


def _regrid_helices(last, units, items_by_id, sw, sh, space):
    """Phase 1 de la compaction : les hélices re-grillées en colonnes
    DEPUIS le bord gauche (−X) par small_lattice (validation STRtree sur
    anneaux réels ; rotations permises seulement). Les fans nichées
    suivent en TRANSFORMATION RIGIDE (rotation relative + translation
    conservées) — elles vivent dans le polygone externe de leur hôte,
    leur distance aux autres unités est celle des hôtes. Tout-ou-rien :
    si une classe d'hôtes ne tient pas entièrement, aucun hôte ne bouge.

    Retourne (pièces déplacées, rects libres des colonnes PARTIELLES de
    la grille — « poches » internes à l'AABB, invisibles de
    residual_bands qui n'extrait que des bandes extérieures ; audit
    2026-09-02 F1 : 19 hélices = colonnes 9+9+1, ~80 000 mm² au-dessus
    de la 19e restent vides sans ce retour). Les poches sont consommées
    par la compaction via _fill_one_batch(bands=...) : chaque pose y est
    validée par _validate_batch, un rect malvenu ne coûte qu'un no-op."""
    from math import cos, radians, sin

    by_cls = {}
    for u in units:
        by_cls.setdefault(u["host"]["item_id"], []).append(u)
    saved = [(u, dict(u["host"]["transformation"]),
              [dict(f["transformation"]) for f in u["fans"]])
             for u in units]
    x_from = space
    moved = 0
    free_rects = []
    for cls in sorted(by_cls, key=lambda c: (-len(by_cls[c]), c)):
        group = by_cls[cls]
        it = items_by_id[cls]
        small = {"id": cls, "coords": it["coords"],
                 "rotations": it.get("rotations") or [0.0]}
        rect = (x_from, space, sw - space, sh - space)
        lat = small_lattice(small, space, rect, want=len(group), axis="x")
        if not lat or len(lat) < len(group):
            # Ne tient pas : restauration complète des hôtes (tout-ou-rien).
            for u, host_tr, fan_trs in saved:
                u["host"]["transformation"] = host_tr
                for f, ft in zip(u["fans"], fan_trs):
                    f["transformation"] = ft
            return 0, []
        order = sorted(group, key=lambda u: (
            u["host"]["transformation"]["translation"][0],
            u["host"]["transformation"]["translation"][1]))
        # Poches des colonnes partielles : les poses d'une même colonne
        # partagent l'abscisse du centroïde (pas périodique exact). Seule
        # la DERNIÈRE colonne (x max) peut être incomplète sans chevaucher
        # ses voisines (grilles et zigzags remplissent colonne par
        # colonne) ; son rect est clippé à droite du maxx des autres
        # colonnes (le brick/zigzag décale les colonnes d'un demi-pas).
        pose_bb = [(_rotated_bbox(_bbox(it["coords"]),
                                  float(lp["transformation"]["rotation"])),
                    lp["transformation"]["translation"])
                   for lp in lat]
        # D14 (audit 2026-09-03) : clé de colonne par TOLÉRANCE 1e-6 — un
        # round(x,3) half-even peut séparer deux x quasi égaux selon le
        # bruit flottant (miroir JS : groupement par tolérance).
        def _col_key(v):
            return round(v + 1e-9, 6)
        cols = {}
        for k, (bb, (tx, _ty)) in enumerate(pose_bb):
            cols.setdefault(_col_key(tx), []).append(k)
        cap = max(len(v) for v in cols.values())
        last_key = sorted(cols)[-1]
        if len(cols[last_key]) < cap:
            idxs = cols[last_key]
            x0 = min(pose_bb[k][1][0] + pose_bb[k][0][0] for k in idxs)
            x1 = max(pose_bb[k][1][0] + pose_bb[k][0][2] for k in idxs)
            top = max(pose_bb[k][1][1] + pose_bb[k][0][3] for k in idxs)
            others_maxx = 0.0
            # P1 (audit 2026-09-03) : la poche est CLIPPÉE au sommet des
            # colonnes PLEINES — l'ancienne poche montait jusqu'au bord de
            # tôle (sh − space) : une fois remplie, l'AABB atteignait y≈990
            # et la bande haute au-dessus des colonnes pleines dégénérait en
            # bande de ~10 mm, jamais remplie (~20 000 mm² perdus, coin
            # haut-gauche blanc sur les 4 rendus de référence). La bande
            # haute reste une bande classique pleine largeur (gravité −X).
            full_top = 0.0
            for key, ks in cols.items():
                if key == last_key:
                    continue
                others_maxx = max(
                    others_maxx,
                    max(pose_bb[k][1][0] + pose_bb[k][0][2] for k in ks))
                full_top = max(
                    full_top,
                    max(pose_bb[k][1][1] + pose_bb[k][0][3] for k in ks))
            pocket = (max(x0, others_maxx + space), top + space, x1,
                      min(sh - space, full_top))
            if (pocket[2] - pocket[0] > _EPS
                    and pocket[3] - pocket[1] > _EPS):
                free_rects.append(pocket)
        cls_maxx = 0.0
        for u, lp in zip(order, lat):
            new = lp["transformation"]
            old = u["host"]["transformation"]
            dr = float(new["rotation"]) - float(old["rotation"])
            r = radians(dr)
            ox, oy = float(old["translation"][0]), float(old["translation"][1])
            nx, ny = new["translation"]
            # D16 (audit 2026-09-03) : moved ne compte que les
            # transformations RÉELLEMENT modifiées — au 2e appel (idempotence
            # ou re-grille identique), `moved = 505` sans rien bouger.
            host_changed = (abs(dr) > 1e-9 or abs(nx - ox) > 1e-9
                            or abs(ny - oy) > 1e-9)
            u["host"]["transformation"] = {
                "rotation": new["rotation"],
                "translation": (nx, ny)}
            for f in u["fans"]:
                ft = f["transformation"]
                fx, fy = float(ft["translation"][0]), float(ft["translation"][1])
                dx, dy = fx - ox, fy - oy
                nfx = nx + cos(r) * dx - sin(r) * dy
                nfy = ny + sin(r) * dx + cos(r) * dy
                if host_changed:
                    moved += 1
                f["transformation"] = {
                    "rotation": ft["rotation"] + dr,
                    "translation": (nfx, nfy)}
            if host_changed:
                moved += 1
            bb = _rotated_bbox(_bbox(it["coords"]), float(new["rotation"]))
            cls_maxx = max(cls_maxx, nx + bb[2])
        x_from = cls_maxx + space
    return moved, free_rects


def _compact_last_sheet(layouts, sheet_i, items_by_id, bin_dims, space,
                        stats=None):
    """Compaction −X de la tôle donneuse (constats 2026-09-02). Le moteur
    BPP ne compacte PAS la dernière tôle (coût = tôles + remnant, pas la
    direction par tôle) : v1 re-posait seulement les libres derrière
    l'ancre — les hôtes restaient épars et le principe « tout au bord
    −X » n'était pas appliqué. v2 :

    1. les HÉLICES (hôte + fans nichées, groupe rigide) sont re-grillées
       en colonnes depuis le bord gauche (_regrid_helices, tout-ou-rien) ;
    2. les LIBRES sont détachées puis re-posées en lattice derrière la
       grille des hélices (bandes autour de l'ancre = AABB des non-libres)
       — colonnes depuis l'ancre, chute rectangulaire unique ; les
       non-placées retournent à leur pose d'origine VALIDÉE, sinon
       restauration complète (no-op sur les libres).

    Audit 2026-09-02 F1/F2 : les libres remplissent d'abord les POCHES
    des colonnes partielles du re-grid (rects internes, retournés par
    _regrid_helices) PUIS les bandes classiques — la bande droite ne
    monopolise plus les donneuses, la poche au-dessus de la colonne
    partielle d'hélices est comblée (front −X réduit d'autant).

    Audit 2026-09-02 (soir, « trou haut-gauche ») : GRAVITÉ −X — poches
    et bandes sont consommées par x0 CROISSANT (recalculées après chaque
    batch, l'AABB bouge). L'ancien tri par aire décroissante envoyait
    toutes les libres dans la grande bande DROITE et laissait la bande
    haute au-dessus de la grille d'hélices vide (~6 % de la tôle sur le
    corpus 100+999) ; en ordre x-croissant, le haut-gauche se remplit
    avant que la bande droite n'étende le front.

    A2/A6 (audit 2026-09-03, bloquant) : le snapshot était pris APRÈS le
    re-grid → dès qu'une libre était irremplaçable, le rollback
    restaurait les hôtes RE-GRILLÉS SUR les libres d'origine (47 à 62
    chevauchements livrés selon l'espacement). Contrat : snapshot complet
    AVANT toute mutation ; sur échec, restauration COMPLÈTE de la tôle,
    moved = 0, stats['compactRollback'] = True. On ne retourne JAMAIS
    moved > 0 après un rollback."""
    last = layouts[sheet_i]
    sw, sh = bin_dims[last["container_id"]]
    units, free = _helix_units_and_free(last, items_by_id)
    if not units and not free:
        return 0
    # Phase 3.1 (plan 2026-09-03) + V7 (vérif 2026-09-04) : compaction
    # CONDITIONNELLE — no-op quand il n'y a VRAIMENT rien à compacter.
    # Le critère du 03/09 comparait l'étalement des hôtes au X MAX de la
    # bbox (Python) vs la LARGEUR (JS) — décisions divergentes — et était
    # aveugle à la POSITION : une colonne d'hôtes collée au bord +X avec
    # des libres au milieu passait pour « rien à compacter ». Unifié :
    # (a) hôtes en colonnes (étalement ≤ 1 largeur + tol) ET ancrés au
    # bord −X ; (b) libres déjà en colonne(s) démarrées derrière
    # l'ancre. Miroir EXACT JS (mêmes tolérances).
    tol = 4 * space + 1.0
    if units:
        hosts_x = [float(u["host"]["transformation"]["translation"][0])
                   for u in units]
        host_w = max(
            _rotated_bbox(_bbox(items_by_id[u["host"]["item_id"]]["coords"]),
                          float(u["host"]["transformation"]["rotation"]))[2]
            - _rotated_bbox(_bbox(items_by_id[u["host"]["item_id"]]["coords"]),
                            float(u["host"]["transformation"]["rotation"]))[0]
            for u in units)
        hosts_col = (max(hosts_x) - min(hosts_x)) <= host_w + tol
        hosts_left = min(hosts_x) <= space + tol
    else:
        hosts_col = True
        hosts_left = True
    anchor_maxx = 0.0
    for u in units:
        it = items_by_id[u["host"]["item_id"]]
        bb = _rotated_bbox(_bbox(it["coords"]),
                           float(u["host"]["transformation"]["rotation"]))
        anchor_maxx = max(anchor_maxx,
                          u["host"]["transformation"]["translation"][0] + bb[2])
    if free:
        free_geo = []
        for pi in free:
            it = items_by_id[pi["item_id"]]
            bb = _rotated_bbox(_bbox(it["coords"]),
                               float(pi["transformation"]["rotation"]))
            free_geo.append((pi["transformation"]["translation"][0],
                             pi["transformation"]["translation"][0] + bb[2],
                             bb[2] - bb[0]))
        min_free_w = min(g[2] for g in free_geo)
        frees_col = (max(g[1] for g in free_geo)
                     - min(g[0] for g in free_geo)) <= 2 * min_free_w + tol
        frees_left = min(g[0] for g in free_geo) <= anchor_maxx + space + tol
    else:
        frees_col = True
        frees_left = True
    if hosts_col and hosts_left and frees_col and frees_left:
        return 0
    full_snapshot = copy.deepcopy(last.get("placed_items", []))
    try:
        moved, pocket_rects = _regrid_helices(last, units, items_by_id, sw,
                                              sh, space)
        if not free:
            return moved
        free_ids = {id(pi) for pi in free}
        anchor = [pi for pi in last.get("placed_items", [])
                  if id(pi) not in free_ids]
        if not anchor:
            return moved
        pocket_bands = [
            {"name": f"pocket{i}", "rect": r, "axis": "x"}
            for i, r in enumerate(sorted(pocket_rects, key=lambda r: (r[0], r)))
        ]
        pockets_left = bool(pocket_bands)
        bands = pocket_bands or None
        saved_poses = {id(pi): dict(pi["transformation"]) for pi in free}
        for pi in free:
            last["placed_items"] = [x for x in last["placed_items"]
                                    if x is not pi]
        while True:
            remaining = [pi for pi in free
                         if not any(x is pi for x in last["placed_items"])]
            if not remaining:
                break
            if bands is None:
                # Bandes classiques recalculées à chaque tour (l'AABB a
                # bougé au batch précédent), ordonnées en gravité −X.
                used = layout_aabb(last, items_by_id)
                bl = residual_bands(used, sw, sh, space)
                bl.sort(key=lambda b: (b["rect"][0], -b["area"]))
                bands = bl
            n = _fill_one_batch(layouts, sheet_i, sheet_i, items_by_id,
                                bin_dims, space, free=remaining, bands=bands)
            if not n:
                # Poches épuisées (ou absentes) : une seule bascule vers
                # les bandes classiques, puis arrêt au premier échec.
                if pockets_left:
                    pockets_left = False
                    bands = None
                    continue
                break
            moved += n
            if not pockets_left:
                bands = None  # force le recalcul −X au tour suivant
        # Libres non replacées (capacité < donneuses) : retour à la pose
        # d'origine — validé contre le layout final, les nouvelles colonnes
        # ont pu recouvrir leur ancienne position.
        restore = [pi for pi in free
                   if not any(x is pi for x in last["placed_items"])]
        for pi in restore:
            pi["transformation"] = saved_poses[id(pi)]
            last["placed_items"].append(pi)
        if restore and not _validate_batch(restore, last, items_by_id,
                                           sw, sh, space):
            raise _CompactRollback()
        return moved
    except _CompactRollback:
        # A2 : restauration COMPLÈTE de la tôle (hôtes et libres à leur
        # pose d'origine) — l'ancien rollback ne restauration que la liste
        # post-re-grid : les hôtes re-grillés recouvraient les libres
        # d'origine. moved = 0 : ce pass n'a rien produit.
        last["placed_items"] = copy.deepcopy(full_snapshot)
        if stats is not None:
            stats["compactRollback"] = True
        return 0


def _has_non_quarter_rotation(layouts, input_items):
    """D3 (audit 2026-09-03) : _rotated_bbox ne sait calculer que les
    quarts de tour — toute rotation placée ou permise ≢ 0 mod 90 rend le
    pass aveugle (bbox fausse → poses chevauchantes acceptées). L'UI
    autorise rotationCount 1..360 (45°, 30°…) : no-op prudent + erreur
    tracée, on ne « valide » jamais sur une géométrie qu'on ne sait pas
    calculer. Miroir JS : residualClient.hasNonQuarterRotation."""
    for item in input_items:
        for r in (item.get("rotations") or [0.0]):
            if abs(float(r) % 90.0) > 1e-6 and abs(float(r) % 90.0 - 90.0) > 1e-6:
                return True
    for l in layouts:
        for pi in l.get("placed_items", []):
            rot = float(pi.get("transformation", {}).get("rotation", 0.0))
            if abs(rot % 90.0) > 1e-6 and abs(rot % 90.0 - 90.0) > 1e-6:
                return True
    return False


def fill_residual_bands(layouts, input_items, bin_dims, space, stats=None):
    """Mutate layouts in place. Retourne le nombre de pièces déplacées
    (0 = no-op). Voir le module docstring pour le contrat complet.

    A5 (audit 2026-09-03) : `stats` (dict optionnel, additif) reçoit
    residualMoved / residualRounds / compactRollback / errors — le
    post-pass ne peut plus échouer SILENCIEUSEMENT (rollback muet,
    `except Exception` sans trace). Miroir JS : fillResidualBands(payload,
    stats)."""
    if stats is None:
        stats = {}
    stats.setdefault("residualMoved", 0)
    stats.setdefault("residualRounds", 0)
    stats.setdefault("compactRollback", False)
    stats.setdefault("errors", [])
    if not layouts or len(layouts) < 2:
        return 0
    items_by_id = {i["id"]: i for i in input_items}
    if any(pi["item_id"] not in items_by_id
           for l in layouts for pi in l.get("placed_items", [])):
        return 0
    if _has_non_quarter_rotation(layouts, input_items):
        stats["errors"].append({
            "stage": "residual",
            "message": "rotations non quart de tour : pass ignoré (bbox "
                       "tournée non calculable, D3)"})
        logger.warning("residual-band pass skipped: non-quarter rotations")
        return 0
    space = float(space or 0)
    snapshot = copy.deepcopy(layouts)
    try:
        moved = 0
        for _round in range(N_ITER):
            stats["residualRounds"] = _round + 1
            ratios = [_fill_ratio(l, items_by_id, bin_dims) for l in layouts]
            last = min(range(len(layouts)), key=lambda i: (ratios[i], -i))
            order = sorted((i for i in range(len(layouts)) if i != last),
                           key=lambda i: (-ratios[i], i))
            progress = False
            for i in order:
                while True:
                    n = _fill_one_batch(layouts, i, last, items_by_id,
                                        bin_dims, space)
                    if not n:
                        break
                    moved += n
                    progress = True
            # Tôle source entièrement vidée de ses libres : on la retire
            # (layoutCount-- = une tôle de moins à couper). Seule `last`
            # peut se vider — par sécurité, retire tout layout vide.
            before = len(layouts)
            layouts[:] = [l for l in layouts if l.get("placed_items")]
            if len(layouts) < 2 or not progress:
                break
        # Compaction de la tôle la moins remplie (la donneuse — ses libres
        # non consommées par les bandes des tôles précédentes) : le moteur
        # BPP ne la compacte pas dans la direction d'optimisation, la
        # « chute » y serait un amas dispersé à front dentelé (constat
        # user 2026-09-02 : « pas optimisé −X »). Uniquement s'il reste
        # PLUSIEURS tôles : une tôle unique = la donneuse a été vidée et
        # retirée, rien à compacter (contrat T8). Miroir JS :
        # residualClient._compactLastSheet.
        if len(layouts) >= 2:
            ratios = [_fill_ratio(l, items_by_id, bin_dims) for l in layouts]
            last = min(range(len(layouts)), key=lambda i: (ratios[i], -i))
            moved += _compact_last_sheet(layouts, last, items_by_id,
                                         bin_dims, space, stats=stats)
        stats["residualMoved"] = moved
        return moved
    except Exception as e:
        # Filet : l'alternative reste INTACTE (contrat apply_hole_fill) —
        # mais PLUS en silence (A5) : erreur tracée + compteur.
        layouts[:] = snapshot
        stats["residualMoved"] = 0
        stats["errors"].append({"stage": "residual", "message": str(e)})
        logger.warning("residual-band pass failed, layouts restored",
                       extra={"error": str(e)})
        return 0
