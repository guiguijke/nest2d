"""Pré-contrôle de capacité avec espacement (plan 2026-09-05 §1.2a).

Constat (captures propriétaire 2026-09-05) : 900 Fillx4 + 100 Piece_Trou
sur 1 tôle 1000×2000 à 4 mm — le test « tout tient sur une tôle »
comparait l'aire NUE (58 %) au seuil de 80 %, alors qu'à 4 mm chaque
fan occupe en réalité ~45 % de plus (contour gonflé de s/2 de chaque
côté, Minkowski). Le job partait en bande, sparrow n'a pas de borne
dure (piège #6) et livrait une bande plus large que la tôle.

Ici tout est calculable en quelques millisecondes AVANT le calcul :

- aire gonflée par pièce : `A + P·s/2 + π·s²/4` (anneau externe, sur
  coords simplifiées) ;
- aire tôle utile : `(W − s)·(H − s)` (jagua déflate le conteneur de
  s/2, piège #49) ;
- ratio `R = Σ aire_gonflée × count / Σ aire_utile × stock` ;
- trois leviers pour la phrase utilisateur : tôles nécessaires, pièces
  max à cet espacement, espacement max qui tient.

Seuils (décision propriétaire 2026-09-05, calibrés sur le corpus —
meilleur taux d'empilement mesuré 0,81-0,87) :
  R > REFUSE_RATIO (0,88) → refus immédiat, sans consommer de quota ;
  R ≤ 0,88 → on lance (BPP livrera une solution partielle propre avec
  `unplaced` explicite si le packing réel échoue).

Miroir JS : app/composables/capacityClient.js (parité chiffrée 1e-9).
"""
import math

# Décision propriétaire 2026-09-05 : au-delà de 0,88 on refuse (le
# meilleur empilement mesuré sur le corpus de torture est 0,81-0,87 —
# au-delà de 0,88 la probabilité d'un échec partiel devient dominante).
REFUSE_RATIO = 0.88
# Taux d'empilement de référence pour les leviers (« il faudrait ≈ N
# tôles ») — atteint par les meilleures configurations du corpus.
REFERENCE_PACKING = 0.85
# Calibration SPP inchangée mais désormais appliquée à l'aire GONFLÉE
# (SPP_MAX_AREA_RATIO reste 0,80, lu par main.py).
_EPS = 1e-9


def _ring_area(coords):
    a = 0.0
    n = len(coords)
    for i in range(n):
        x1, y1 = coords[i]
        x2, y2 = coords[(i + 1) % n]
        a += x1 * y2 - x2 * y1
    return abs(a) / 2.0


def _ring_perimeter(coords):
    p = 0.0
    n = len(coords)
    for i in range(n):
        x1, y1 = coords[i]
        x2, y2 = coords[(i + 1) % n]
        p += math.hypot(x2 - x1, y2 - y1)
    return p


def inflated_area(item, space):
    """Aire Minkowski d'une pièce à l'espacement `space` : le contour
    effectif (occupation au sol incluant l'espacement) est l'anneau
    externe gonflé de s/2 de chaque côté — `A + P·s/2 + π·s²/4`."""
    coords = item.get("coords") or []
    if len(coords) < 3:
        return 0.0
    s = max(0.0, float(space or 0))
    a = _ring_area(coords)
    p = _ring_perimeter(coords)
    return a + p * s / 2.0 + math.pi * s * s / 4.0


def _bbox_grid_capacity(item, width, height, space):
    """Capacité constructive d'une tôle pour une classe : grille au pas
    bbox + space (le plan §1.2a « borne rangées »). Minorante EXACTE pour
    des rectangles — une instance qui tient par cette construction est
    faisable, indépendamment du ratio statistique."""
    coords = item.get("coords") or []
    if len(coords) < 3:
        return 0
    xs = [c[0] for c in coords]
    ys = [c[1] for c in coords]
    w = max(xs) - min(xs)
    h = max(ys) - min(ys)
    s = max(0.0, float(space or 0))
    if w + s <= 0 or h + s <= 0:
        return 0
    cols = int(math.floor((float(width) + s) / (w + s)))
    rows = int(math.floor((float(height) + s) / (h + s)))
    return max(0, cols) * max(0, rows)


def _constructive_fit(parts, sheets, space):
    """True si une construction en grilles par classe tient dans le stock
    (somme des tôles nécessaires par classe ≤ stock total). Optimiste pour
    les classes mixtes (elles partagent mal), mais EXACTE en classe unique
    rectangulaire — c'est la dérogation du garde #49 : un ratio statistique
    de 0,99 sur un carré 8×8 dans une tôle 12×12 à space 2 tient
    exactement et ne doit JAMAIS être refusé."""
    if not parts or not sheets:
        return False
    sheets_needed = 0
    for p in parts:
        count = int(p.get("count") or 0)
        if count <= 0:
            continue
        best_cap = 0
        for sh in sheets:
            cap = _bbox_grid_capacity(
                p, sh.get("width"), sh.get("height"), space)
            best_cap = max(best_cap, cap)
        if best_cap <= 0:
            return False
        sheets_needed += math.ceil(count / best_cap)
    stock = sum(int(sh.get("count") or 1) for sh in sheets)
    return sheets_needed <= stock


def sheet_usable_area(width, height, space):
    """Aire utile d'une tôle : jagua offset space/2 sur le conteneur
    (piège #49) → (W − s)·(H − s)."""
    s = max(0.0, float(space or 0))
    return max(0.0, (float(width) - s) * (float(height) - s))


def capacity_report(parts, sheets, space):
    """Calcule le ratio de capacité et les trois leviers.

    parts : [{coords, count}, ...] (ids libres, coords = anneau externe).
    sheets : [{width, height, count}, ...] formats de tôle.
    Retourne {ratio, totalInflated, totalUsable, sheetsNeeded,
    maxPartsAtSpacing (par classe, proportionnel), maxSpacingForFit,
    refused} ou None si aucune géométrie/tôle.
    """
    s = max(0.0, float(space or 0))
    total_inflated = 0.0
    counts = []
    per_part = []
    for p in parts or []:
        c = int(p.get("count") or 0)
        ia = inflated_area(p, s)
        total_inflated += ia * c
        counts.append(c)
        per_part.append(ia)
    total_usable = 0.0
    stock = 0
    for sh in sheets or []:
        n = int(sh.get("count") or 1)
        total_usable += sheet_usable_area(
            sh.get("width"), sh.get("height"), s) * n
        stock += n
    if total_inflated <= 0 or total_usable <= 0:
        return None
    ratio = total_inflated / total_usable

    # Levier 1 : tôles nécessaires (au taux d'empilement de référence).
    sheets_needed = max(1, math.ceil(ratio * stock / REFERENCE_PACKING))

    # Levier 2 : pièces max à cet espacement, par classe, proportionnel.
    if total_inflated > 0 and ratio > REFERENCE_PACKING:
        scale = (total_usable * REFERENCE_PACKING) / total_inflated
        max_parts = {i: int(math.floor(c * scale)) for i, c in enumerate(counts)}
    else:
        max_parts = {i: c for i, c in enumerate(counts)}

    # Levier 3 : espacement max qui tient (R(s) = REFERENCE_PACKING,
    # dichotomie — R est croissant en s).
    def r_at(sp):
        num = sum(inflated_area(p, sp) * int(p.get("count") or 0)
                  for p in parts or [])
        den = sum(sheet_usable_area(sh.get("width"), sh.get("height"), sp)
                  * int(sh.get("count") or 1) for sh in sheets or [])
        return num / den if den > 0 else float("inf")

    lo, hi = 0.0, max(0.0, s)
    if r_at(0.0) > REFERENCE_PACKING:
        max_spacing = 0.0  # déjà limite sans espacement
    else:
        # Chercher un majorant : doubler jusqu'à dépasser.
        while hi < 1000.0 and r_at(hi) <= REFERENCE_PACKING:
            hi = hi * 2.0 if hi > 0 else 1.0
        for _ in range(40):
            mid = (lo + hi) / 2.0
            if r_at(mid) <= REFERENCE_PACKING:
                lo = mid
            else:
                hi = mid
        max_spacing = round(lo, 2)

    # Dérogation constructive (garde #49) : une instance qui tient par
    # la construction en grilles est faisable — le ratio statistique ne
    # la refuse pas (carré 8×8 / tôle 12×12 / space 2 : ratio 0,99 mais
    # exactement une case).
    constructive = _constructive_fit(parts, sheets, s)

    return {
        "ratio": round(ratio, 4),
        "totalInflatedMm2": round(total_inflated, 1),
        "totalUsableMm2": round(total_usable, 1),
        "sheetsNeeded": sheets_needed,
        "maxPartsAtSpacing": max_parts,
        "maxSpacingForFitMm": max_spacing,
        "refused": ratio > REFUSE_RATIO and not constructive,
    }
