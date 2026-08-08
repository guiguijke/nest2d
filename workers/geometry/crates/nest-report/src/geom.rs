//! Géométrie 2D minimale pour le rapport (distances, intersections,
//! containment) — jumeau shapely pour les besoins de metrics.py.

pub type Pt = [f64; 2];

/// Shoelace avec fermeture implicite (Python/shapely auto-ferme les anneaux).
pub fn ring_area_abs(ring: &[Pt]) -> f64 {
    let n = ring.len();
    if n < 3 {
        return 0.0;
    }
    let mut a = 0.0;
    for i in 0..n {
        let j = (i + 1) % n;
        a += ring[i][0] * ring[j][1] - ring[j][0] * ring[i][1];
    }
    a.abs() / 2.0
}

/// Aire matière = anneau externe − trous (Polygon(coords, holes).area).
pub fn material_area(outer: &[Pt], holes: &[Vec<Pt>]) -> f64 {
    let mut a = ring_area_abs(outer);
    for h in holes {
        a -= ring_area_abs(h);
    }
    a.max(0.0)
}

pub fn ring_bounds(ring: &[Pt]) -> [f64; 4] {
    let (mut x0, mut y0) = (f64::INFINITY, f64::INFINITY);
    let (mut x1, mut y1) = (f64::NEG_INFINITY, f64::NEG_INFINITY);
    for p in ring {
        x0 = x0.min(p[0]);
        y0 = y0.min(p[1]);
        x1 = x1.max(p[0]);
        y1 = y1.max(p[1]);
    }
    [x0, y0, x1, y1]
}

fn seg_seg_intersects(a: Pt, b: Pt, c: Pt, d: Pt) -> bool {
    let d1 = cross(sub(d, c), sub(a, c));
    let d2 = cross(sub(d, c), sub(b, c));
    let d3 = cross(sub(b, a), sub(c, a));
    let d4 = cross(sub(b, a), sub(d, a));
    if ((d1 > 0.0 && d2 < 0.0) || (d1 < 0.0 && d2 > 0.0))
        && ((d3 > 0.0 && d4 < 0.0) || (d3 < 0.0 && d4 > 0.0))
    {
        return true;
    }
    false
}

fn sub(a: Pt, b: Pt) -> Pt {
    [a[0] - b[0], a[1] - b[1]]
}
fn cross(a: Pt, b: Pt) -> f64 {
    a[0] * b[1] - a[1] * b[0]
}

pub fn point_in_ring(p: Pt, ring: &[Pt]) -> bool {
    let mut inside = false;
    for i in 0..ring.len() - 1 {
        let a = ring[i];
        let b = ring[i + 1];
        if (a[1] > p[1]) != (b[1] > p[1]) {
            let x = a[0] + (p[1] - a[1]) * (b[0] - a[0]) / (b[1] - a[1]);
            if p[0] < x {
                inside = !inside;
            }
        }
    }
    inside
}

/// Distance min entre deux anneaux (polygones disjoints) : min des distances
/// sommet↔segment croisées. 0 si intersection.
pub fn ring_distance(a: &[Pt], b: &[Pt]) -> f64 {
    if rings_overlap(a, b) {
        return 0.0;
    }
    let mut best = f64::INFINITY;
    for p in a {
        for i in 0..b.len() - 1 {
            best = best.min(point_seg_dist(*p, b[i], b[i + 1]));
        }
    }
    for p in b {
        for i in 0..a.len() - 1 {
            best = best.min(point_seg_dist(*p, a[i], a[i + 1]));
        }
    }
    best
}

pub fn point_seg_dist(p: Pt, a: Pt, b: Pt) -> f64 {
    let ab = sub(b, a);
    let l2 = ab[0] * ab[0] + ab[1] * ab[1];
    if l2 == 0.0 {
        return (sub(p, a)[0].powi(2) + sub(p, a)[1].powi(2)).sqrt();
    }
    let t = ((p[0] - a[0]) * ab[0] + (p[1] - a[1]) * ab[1]) / l2;
    let t = t.clamp(0.0, 1.0);
    let q = [a[0] + t * ab[0], a[1] + t * ab[1]];
    (sub(p, q)[0].powi(2) + sub(p, q)[1].powi(2)).sqrt()
}

/// Chevauchement (intérieur) de deux anneaux simples.
pub fn rings_overlap(a: &[Pt], b: &[Pt]) -> bool {
    for i in 0..a.len() - 1 {
        for j in 0..b.len() - 1 {
            if seg_seg_intersects(a[i], a[i + 1], b[j], b[j + 1]) {
                return true;
            }
        }
    }
    // containment sans crossing
    if point_in_ring(a[0], b) || point_in_ring(b[0], a) {
        return true;
    }
    false
}

/// Intersection non-vide polygone ∩ rectangle axis-aligned (pour le scan
/// offcut : "un placed part intersectant le strip bloque tout son y-range").
pub fn poly_intersects_rect(ring: &[Pt], x1: f64, y1: f64, x2: f64, y2: f64) -> bool {
    let rect = [[x1, y1], [x2, y1], [x2, y2], [x1, y2], [x1, y1]];
    if rings_overlap(ring, &rect) {
        return true;
    }
    // anneau entièrement dans le rect ou rect entièrement dans l'anneau
    if point_in_ring([x1, y1], ring) || point_in_ring(ring[0], &rect) {
        return true;
    }
    false
}
