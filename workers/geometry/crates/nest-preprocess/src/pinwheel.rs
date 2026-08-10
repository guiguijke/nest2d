//! pinwheel_capacity — miroir EXACT de workers/nesting/core/holefill.py
//! (J-085/J-089), sans crate géométrique lourde (primitives locales).
//!
//! Sémantique verrouillée par goldens Python (piège AGENTS #3 : le trou est
//! érodé de `space` EN ENTIER car le candidat est testé NON inflaté) :
//!   - centroïde du trou = MOYENNE ARITHMÉTIQUE des sommets de l'anneau
//!     (sommet de fermeture dupliqué COMPTÉ — il décale la moyenne), pas le
//!     centroïde d'aire ;
//!   - candidat = rotate(filler, rot°, origine (0,0), ANTI-horaire, y-up)
//!     PUIS translate(centroïde) — shapely.affinity (libm pour sin/cos,
//!     AGENTS #14b) ;
//!   - containment : `inner.contains(cand)` avec inner = trou.buffer(-space)
//!     ⟺ cand dans le trou (bord permis, DE-9IM within) ET
//!     dist(cand, bord du trou) ≥ space (le contact exact de l'érosion est
//!     permis — contains n'est pas strict sur le bord) ; space == 0 : cand
//!     dans le trou, contact de bord permis (mesuré, cf. tests) ;
//!   - siblings (space > 0) : cand.buffer(space/2) ∩ q.buffer(space/2)
//!     ⟺ dist(cand, q) ≤ space → violation (le contact EXACT viole) ;
//!     passer exige dist > space strictement ;
//!   - siblings (space == 0) : intersection.area > OVERLAP_EPS → violation,
//!     approximée (brief J-090) par croisement propre d'arêtes OU sommet
//!     strictement interne — les positions pinwheel (quarts de tour autour
//!     du même centre) se chevauchent franchement ou pas du tout.

use nest_import::assemble as ga;

pub type Pt = [f64; 2];

/// holefill.PINWHEEL — ordre conservé dans la sortie.
pub const PINWHEEL: [f64; 4] = [0.0, 90.0, 180.0, 270.0];

/// Bande « sur l'arête » (bruit de rotation libm ~1e-16·amplitude des coords,
/// très en dessous des seuils mm — cf. attach.rs côté import).
const ON_EDGE_EPS: f64 = 1e-9;

fn sub(a: Pt, b: Pt) -> Pt {
    [a[0] - b[0], a[1] - b[1]]
}
fn cross(a: Pt, b: Pt) -> f64 {
    a[0] * b[1] - a[1] * b[0]
}
fn dot(a: Pt, b: Pt) -> f64 {
    a[0] * b[0] + a[1] * b[1]
}
fn norm(a: Pt) -> f64 {
    (a[0] * a[0] + a[1] * a[1]).sqrt()
}

/// p ∈ [a,b] au sens large (colinéarité exacte + entre, extrémités incluses).
fn on_seg_incl(p: Pt, a: Pt, b: Pt) -> bool {
    let ab = sub(b, a);
    cross(ab, sub(p, a)) == 0.0 && dot(sub(p, a), sub(p, b)) <= 0.0
}

/// p dans la bande ON_EDGE_EPS du segment [a,b] (robuste au bruit libm).
fn on_edge_band(p: Pt, a: Pt, b: Pt) -> bool {
    let ab = sub(b, a);
    let len = norm(ab);
    if len == 0.0 {
        return norm(sub(p, a)) <= ON_EDGE_EPS;
    }
    cross(ab, sub(p, a)).abs() <= ON_EDGE_EPS * len && dot(sub(p, a), sub(p, b)) <= 0.0
}

fn point_seg_dist(p: Pt, a: Pt, b: Pt) -> f64 {
    let ab = sub(b, a);
    let d2 = dot(ab, ab);
    if d2 == 0.0 {
        return norm(sub(p, a));
    }
    let t = (dot(sub(p, a), ab) / d2).clamp(0.0, 1.0);
    norm(sub(p, [a[0] + t * ab[0], a[1] + t * ab[1]]))
}

fn segs_meet(a1: Pt, a2: Pt, b1: Pt, b2: Pt) -> bool {
    if ga::seg_intersection(a1, a2, b1, b2).is_some() {
        return true;
    }
    on_seg_incl(a1, b1, b2)
        || on_seg_incl(a2, b1, b2)
        || on_seg_incl(b1, a1, a2)
        || on_seg_incl(b2, a1, a2)
}

fn seg_seg_dist(a1: Pt, a2: Pt, b1: Pt, b2: Pt) -> f64 {
    if segs_meet(a1, a2, b1, b2) {
        return 0.0;
    }
    point_seg_dist(a1, b1, b2)
        .min(point_seg_dist(a2, b1, b2))
        .min(point_seg_dist(b1, a1, a2))
        .min(point_seg_dist(b2, a1, a2))
}

/// Arêtes d'un anneau comme CYCLE (dernier → premier inclus si l'anneau
/// n'est pas explicitement fermé) — la convention pipeline est first==last,
/// mais un appelant wasm peut passer un anneau ouvert : l'arête de bouclage
/// compte dans tous les tests (containment, distances, croisements).
fn ring_edges(ring: &[Pt]) -> Vec<(Pt, Pt)> {
    let n = ring.len();
    if n < 2 {
        return Vec::new();
    }
    (0..n - 1)
        .map(|i| (ring[i], ring[i + 1]))
        .chain(if ring.first() != ring.last() {
            Some((ring[n - 1], ring[0]))
        } else {
            None
        })
        .filter(|(a, b)| a != b)
        .collect()
}

/// Distance polygone↔polygone (0 si contact/chevauchement/containment,
/// sinon min arête↔arête).
fn poly_dist(a: &[Pt], b: &[Pt]) -> f64 {
    for (a1, a2) in ring_edges(a) {
        for (b1, b2) in ring_edges(b) {
            if segs_meet(a1, a2, b1, b2) {
                return 0.0;
            }
        }
    }
    // containment sans contact d'arêtes.
    if ga::point_in_ring(a[0], b) || ga::point_in_ring(b[0], a) {
        return 0.0;
    }
    let mut best = f64::INFINITY;
    for (a1, a2) in ring_edges(a) {
        for (b1, b2) in ring_edges(b) {
            best = best.min(seg_seg_dist(a1, a2, b1, b2));
        }
    }
    best
}

/// Chevauchement franc pour space == 0 (approximation de
/// `intersection.area > OVERLAP_EPS`, voir l'en-tête) : croisement propre
/// d'arêtes OU sommet strictement interne OU sonde intérieure garantie
/// (bissectrice d'un sommet convexe, jumeau GEOS representative_point)
/// strictement interne à l'autre — la simple superposition parfaite (anneaux
/// identiques : aucun croisement propre, aucun sommet strict) est ainsi
/// détectée, et le simple CONTACT ne viole rien (contact permis à space=0).
fn overlaps_proper(a: &[Pt], b: &[Pt]) -> bool {
    for (a1, a2) in ring_edges(a) {
        for (b1, b2) in ring_edges(b) {
            if ga::seg_intersection(a1, a2, b1, b2).is_some() {
                return true;
            }
        }
    }
    let strictly_in = |p: Pt, ring: &[Pt]| {
        ga::point_in_ring(p, ring) && !ring_edges(ring).iter().any(|&(c, d)| on_edge_band(p, c, d))
    };
    if ring_edges(a).iter().any(|&(p, _)| strictly_in(p, b)) || ring_edges(b).iter().any(|&(p, _)| strictly_in(p, a)) {
        return true;
    }
    interior_probes(a).iter().any(|&p| strictly_in(p, b))
        || interior_probes(b).iter().any(|&p| strictly_in(p, a))
}

/// Sondes strictement intérieures : pas le long de la bissectrice de CHAQUE
/// sommet convexe (même construction que ga::interior_probe, itérée).
fn interior_probes(ring: &[Pt]) -> Vec<Pt> {
    let n = ring.len();
    let turn_sign = if ga::ring_signed_area(ring) < 0.0 { -1.0 } else { 1.0 };
    let mut out = Vec::new();
    for i in 0..n.saturating_sub(1) {
        let a = ring[i];
        let b = ring[(i + 1) % n];
        let c = ring[(i + 2) % n];
        let ba = sub(a, b);
        let bc = sub(c, b);
        if cross(bc, ba) * turn_sign > 0.0 {
            let la = norm(ba);
            let lc = norm(bc);
            if la == 0.0 || lc == 0.0 {
                continue;
            }
            let ux = ba[0] / la + bc[0] / lc;
            let uy = ba[1] / la + bc[1] / lc;
            let ul = (ux * ux + uy * uy).sqrt();
            if ul == 0.0 {
                continue;
            }
            let eps = (la.min(lc) / 4.0).clamp(1e-3, 1.0);
            out.push([b[0] + ux / ul * eps, b[1] + uy / ul * eps]);
        }
    }
    out
}

/// cand ⊆ trou (DE-9IM within, bord permis) : chaque arête du candidat est
/// découpée aux intersections avec le bord du trou et le midpoint de chaque
/// tronçon doit être dedans ou sur le bord.
fn within_hole(cand: &[Pt], hole: &[Pt]) -> bool {
    let hole_edges = ring_edges(hole);
    let in_or_on = |p: Pt| {
        ga::point_in_ring(p, hole) || hole_edges.iter().any(|&(c, d)| on_edge_band(p, c, d))
    };
    for (a, b) in ring_edges(cand) {
        let len = norm(sub(b, a));
        if len == 0.0 {
            if !in_or_on(a) {
                return false;
            }
            continue;
        }
        let mut ts: Vec<f64> = vec![0.0, 1.0];
        for &(c, d) in &hole_edges {
            if let Some(p) = ga::seg_intersection(a, b, c, d) {
                ts.push(dot(sub(p, a), sub(b, a)) / (len * len));
            }
            for &p in &[c, d] {
                if on_seg_incl(p, a, b) {
                    ts.push(dot(sub(p, a), sub(b, a)) / (len * len));
                }
            }
        }
        ts.sort_by(f64::total_cmp);
        ts.dedup_by(|x, y| (*x - *y).abs() < 1e-12);
        for w in ts.windows(2) {
            if w[1] - w[0] < 1e-15 {
                continue;
            }
            let tm = (w[0] + w[1]) / 2.0;
            let mid = [a[0] + tm * (b[0] - a[0]), a[1] + tm * (b[1] - a[1])];
            if !in_or_on(mid) {
                return false;
            }
        }
    }
    true
}

/// `inner.contains(cand)` avec inner = trou ⊖ space (space > 0).
fn contained_in_eroded(cand: &[Pt], hole: &[Pt], space: f64) -> bool {
    if !within_hole(cand, hole) {
        return false;
    }
    if space <= 0.0 {
        return true;
    }
    // cand ⊆ trou ⊖ D(space) ⟺ dist(bord de cand, bord du trou) ≥ space
    // (cand est déjà dedans ; contact exact de l'érosion permis).
    for (a1, a2) in ring_edges(cand) {
        for (b1, b2) in ring_edges(hole) {
            if seg_seg_dist(a1, a2, b1, b2) < space {
                return false;
            }
        }
    }
    true
}

/// holefill._centroid — moyenne arithmétique des sommets TELS QUELS (le
/// sommet de fermeture dupliqué pèse double, c'est voulu : parité Python).
fn arithmetic_centroid(ring: &[Pt]) -> Pt {
    let n = ring.len() as f64;
    [
        ring.iter().map(|p| p[0]).sum::<f64>() / n,
        ring.iter().map(|p| p[1]).sum::<f64>() / n,
    ]
}

/// shapely.affinity.rotate(geom, rot_degrés, origin=(0,0)) CCW, puis
/// translate(geom, cx, cy) — libm (AGENTS #14b).
fn rotate_then_translate(coords: &[Pt], rot_deg: f64, cx: f64, cy: f64) -> Vec<Pt> {
    let theta = rot_deg * (std::f64::consts::PI / 180.0);
    let (s, c) = libm::sincos(theta);
    coords
        .iter()
        .map(|p| [p[0] * c - p[1] * s + cx, p[0] * s + p[1] * c + cy])
        .collect()
}

/// Rotations du pinwheel validées pour un filler dans un trou — miroir de
/// holefill.pinwheel_capacity. `allowed` restreint les orientations (défaut :
/// les 4) ; [] si aucune ne valide (trou trop petit, forme inadaptée).
pub fn pinwheel_capacity(
    hole_ring: &[Pt],
    filler_coords: &[Pt],
    space: f64,
    allowed: Option<&[f64]>,
) -> Vec<f64> {
    if hole_ring.len() < 3 || filler_coords.len() < 3 {
        return Vec::new();
    }
    let [cx, cy] = arithmetic_centroid(hole_ring);
    let mut valid: Vec<f64> = Vec::new();
    let mut placed: Vec<Vec<Pt>> = Vec::new();
    for rot in PINWHEEL {
        if let Some(a) = allowed {
            if !a.contains(&rot) {
                continue;
            }
        }
        let cand = rotate_then_translate(filler_coords, rot, cx, cy);
        if !contained_in_eroded(&cand, hole_ring, space) {
            continue;
        }
        let violates = placed.iter().any(|q| {
            if space > 0.0 {
                poly_dist(&cand, q) <= space
            } else {
                overlaps_proper(&cand, q)
            }
        });
        if violates {
            continue;
        }
        valid.push(rot);
        placed.push(cand);
    }
    valid
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hole(size: f64) -> Vec<Pt> {
        vec![
            [-size, -size],
            [size, -size],
            [size, size],
            [-size, size],
            [-size, -size],
        ]
    }

    /// Goldens générés par workers/nesting/core/holefill.py (shapely) le
    /// 2026-08-10 — ne pas « corriger » sans régénérer côté Python.

    #[test]
    fn square_in_square_centered_single_slot() {
        // Carré centré : les 4 rotations tombent sur la MÊME position (le
        // filler est centré sur l'origine) → la 1re gagne, les autres
        // violent le spacing. Python : [0.0].
        let sq = vec![[-5.0, -5.0], [5.0, -5.0], [5.0, 5.0], [-5.0, 5.0], [-5.0, -5.0]];
        assert_eq!(pinwheel_capacity(&hole(20.0), &sq, 2.0, None), vec![0.0]);
    }

    #[test]
    fn offcenter_filler_four_rotations() {
        // Filler 8×8 excentré (rayon 20 sur +x) : 4 positions espacées.
        // Python : [0.0, 90.0, 180.0, 270.0].
        let f = vec![[16.0, -4.0], [24.0, -4.0], [24.0, 4.0], [16.0, 4.0], [16.0, -4.0]];
        assert_eq!(
            pinwheel_capacity(&hole(50.0), &f, 2.0, None),
            vec![0.0, 90.0, 180.0, 270.0]
        );
    }

    #[test]
    fn offcenter_filler_four_rotations_space0() {
        let f = vec![[16.0, -4.0], [24.0, -4.0], [24.0, 4.0], [16.0, 4.0], [16.0, -4.0]];
        assert_eq!(
            pinwheel_capacity(&hole(50.0), &f, 0.0, None),
            vec![0.0, 90.0, 180.0, 270.0]
        );
    }

    #[test]
    fn rectangle_two_rotations() {
        // Trou ±30 (érosion ±28), filler 8×8 à rayon 20 : rot 180/270 hors
        // du trou érodé → [0.0, 90.0] (vérité Python).
        let f = vec![[16.0, -4.0], [24.0, -4.0], [24.0, 4.0], [16.0, 4.0], [16.0, -4.0]];
        assert_eq!(pinwheel_capacity(&hole(30.0), &f, 2.0, None), vec![0.0, 90.0]);
    }

    #[test]
    fn allowed_restricts_rotations() {
        let f = vec![[16.0, -4.0], [24.0, -4.0], [24.0, 4.0], [16.0, 4.0], [16.0, -4.0]];
        assert_eq!(
            pinwheel_capacity(&hole(50.0), &f, 2.0, Some(&[90.0, 270.0])),
            vec![90.0, 270.0]
        );
        // allowed vide → aucune rotation testée (Python : []).
        assert!(pinwheel_capacity(&hole(50.0), &f, 2.0, Some(&[])).is_empty());
    }

    #[test]
    fn too_big_filler_is_empty() {
        let big = vec![[-25.0, -25.0], [25.0, -25.0], [25.0, 25.0], [-25.0, 25.0], [-25.0, -25.0]];
        assert!(pinwheel_capacity(&hole(20.0), &big, 2.0, None).is_empty());
    }

    #[test]
    fn space_sealing_the_hole_is_empty() {
        // buffer(-60) d'un trou ±50 est vide → [] (Python idem).
        let f = vec![[16.0, -4.0], [24.0, -4.0], [24.0, 4.0], [16.0, 4.0], [16.0, -4.0]];
        assert!(pinwheel_capacity(&hole(50.0), &f, 60.0, None).is_empty());
    }

    #[test]
    fn space0_centered_square_overlaps() {
        // space=0 : rot 90/180/270 recouvrent rot 0 (aire 100 > 0.01) → [0.0].
        let sq = vec![[-5.0, -5.0], [5.0, -5.0], [5.0, 5.0], [-5.0, 5.0], [-5.0, -5.0]];
        assert_eq!(pinwheel_capacity(&hole(20.0), &sq, 0.0, None), vec![0.0]);
    }

    #[test]
    fn boundary_touch_is_allowed_at_space0_rejected_when_eroded() {
        // Trou 0..20 → centroïde arithmétique (8,8) (fermeture comptée).
        // Filler dont rot0 touche le bord y=0 : valide à space=0 (contains
        // n'est pas strict), rejeté à space=0.5 (dist 0 < 0.5).
        // Python : touch_space0 = [0,90,180,270], touch_space05 = [90,180].
        let h = vec![[0.0, 0.0], [20.0, 0.0], [20.0, 20.0], [0.0, 20.0], [0.0, 0.0]];
        let f = vec![[0.0, -8.0], [4.0, -8.0], [4.0, -4.0], [0.0, -4.0], [0.0, -8.0]];
        assert_eq!(
            pinwheel_capacity(&h, &f, 0.0, None),
            vec![0.0, 90.0, 180.0, 270.0]
        );
        assert_eq!(pinwheel_capacity(&h, &f, 0.5, None), vec![90.0, 180.0]);
    }

    #[test]
    fn arithmetic_centroid_shifts_positions() {
        // Le sommet de fermeture dupliqué décale le centroïde à (-4,-4) :
        // le rectangle centré ±15/±5 sort du trou érodé → [] (Python idem).
        let rect = vec![[-15.0, -5.0], [15.0, -5.0], [15.0, 5.0], [-15.0, 5.0], [-15.0, -5.0]];
        assert!(pinwheel_capacity(&hole(20.0), &rect, 2.0, None).is_empty());
    }
}
