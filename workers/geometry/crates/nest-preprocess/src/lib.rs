//! nest-preprocess — ouverture des trous par canal capillaire, jumeau de
//! workers/nesting/core/holed_polygons.py (jagua n'a pas de pièces à trous,
//! AGENTS #2). Deux implémentations prototypées (mission v2 PR2) :
//!
//!   (a) `open_holes_difference` — sémantique GEOS répliquée sur notre
//!       arrangement maison : rectangle buffer(width/2, cap=flat) le long du
//!       segment allongé ±2·width, UNE difference (union des rectangles),
//!       plus grand morceau si éclaté, fallback outer.
//!   (b) `open_holes_splice` — splice d'anneaux : coupure des deux anneaux
//!       aux points les plus proches, rails droits décalés de ±width/2 le
//!       long des tangentes. Arithmétique pure, zéro booléen.
//!
//! Le harnais (parity/channels.py) tranche sur parité + qualité ; le
//! gagnant est porté DES DEUX CÔTÉS (décision actée mission v2).

use nest_import::assemble as ga; // géométrie d'arrangement partagée

#[cfg(feature = "wasm")]
mod wasm;

pub type Pt = [f64; 2];

/// holed_polygons.CHANNEL_WIDTH / SEPARATION_MARGIN / MAX_WIDTH.
pub const CHANNEL_WIDTH: f64 = 0.01;
pub const CHANNEL_SEPARATION_MARGIN: f64 = 0.1;
pub const CHANNEL_MAX_WIDTH: f64 = 2.5;

/// channel_width_for_space twin.
pub fn channel_width_for_space(space: f64) -> f64 {
    let space = if space.is_nan() { 0.0 } else { space };
    CHANNEL_WIDTH.max(space + CHANNEL_SEPARATION_MARGIN).min(CHANNEL_MAX_WIDTH)
}

/// channels_usable twin (D-MOT-2 : scellé ⇒ trous fermés, dégradation sûre).
pub fn channels_usable(space: f64) -> bool {
    channel_width_for_space(space) > space
}

// ------------------------------------------------------- nearest points

/// LineSegment.closestPoint twin: projection clampée aux extrémités
/// (r ≤ 0 → p0, r ≥ 1 → p1, l'ordre des tests compte comme chez GEOS).
fn closest_point_on_seg(p: Pt, a: Pt, b: Pt) -> Pt {
    let dx = b[0] - a[0];
    let dy = b[1] - a[1];
    let len2 = dx * dx + dy * dy;
    if len2 == 0.0 {
        return a;
    }
    let r = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2;
    if r <= 0.0 {
        return a;
    }
    if r >= 1.0 {
        return b;
    }
    [a[0] + r * dx, a[1] + r * dy]
}

fn dist(a: Pt, b: Pt) -> f64 {
    let dx = a[0] - b[0];
    let dy = a[1] - b[1];
    (dx * dx + dy * dy).sqrt()
}

/// nearest_points(hole.exterior, poly.exterior) twin : double boucle
/// segments (ordre des anneaux), mise à jour STRICTE (<) — le premier
/// couple à distance minimale gagne, comme GEOS DistanceOp.
/// Retourne (point sur le trou, point sur l'extérieur).
pub fn nearest_points(hole_ring: &[Pt], outer_ring: &[Pt]) -> Option<(Pt, Pt)> {
    let mut best: Option<(f64, Pt, Pt)> = None;
    let nh = hole_ring.len();
    let no = outer_ring.len();
    if nh < 2 || no < 2 {
        return None;
    }
    for i in 0..nh {
        let ha = hole_ring[i];
        let hb = hole_ring[(i + 1) % nh];
        for j in 0..no {
            let oa = outer_ring[j];
            let ob = outer_ring[(j + 1) % no];
            // Candidats (point sur trou, point sur ext) — ordre GEOS :
            // endpoints du trou projetés, puis endpoints de l'extérieur.
            let cands = [
                (ha, closest_point_on_seg(ha, oa, ob)),
                (hb, closest_point_on_seg(hb, oa, ob)),
            ];
            for (on_hole, on_outer) in cands {
                let d = dist(on_hole, on_outer);
                if best.map(|(bd, _, _)| d < bd).unwrap_or(true) {
                    best = Some((d, on_hole, on_outer));
                }
            }
            let cands2 = [
                (oa, closest_point_on_seg(oa, ha, hb)),
                (ob, closest_point_on_seg(ob, ha, hb)),
            ];
            for (on_outer, on_hole) in cands2 {
                let d = dist(on_hole, on_outer);
                if best.map(|(bd, _, _)| d < bd).unwrap_or(true) {
                    best = Some((d, on_hole, on_outer));
                }
            }
        }
    }
    best.map(|(_, ph, po)| (ph, po))
}

/// Rectangle GEOS buffer(width/2, cap=flat) du segment allongé de ±2·width.
/// Anneau fermé (premier == dernier), 5 points.
fn channel_rectangle(p_in: Pt, p_out: Pt, width: f64) -> Option<Vec<Pt>> {
    let dx = p_out[0] - p_in[0];
    let dy = p_out[1] - p_in[1];
    let length = (dx * dx + dy * dy).sqrt();
    if length < 1e-9 {
        return None;
    }
    let ux = dx / length;
    let uy = dy / length;
    let ext = width * 2.0;
    let s = [p_in[0] - ux * ext, p_in[1] - uy * ext];
    let e = [p_out[0] + ux * ext, p_out[1] + uy * ext];
    // Normale gauche du segment s→e, demi-largeur.
    let nx = -uy * (width / 2.0);
    let ny = ux * (width / 2.0);
    Some(vec![
        [s[0] + nx, s[1] + ny],
        [e[0] + nx, e[1] + ny],
        [e[0] - nx, e[1] - ny],
        [s[0] - nx, s[1] - ny],
        [s[0] + nx, s[1] + ny],
    ])
}

// ------------------------------------------------- (a) différence GEOS

/// Ouvre chaque trou vers l'extérieur par un canal rectangulaire soustrait
/// (difference GEOS répliquée sur l'arrangement maison). Retourne l'anneau
/// extérieur du corps résultant (premier == dernier), ou l'anneau externe
/// d'origine si tout échoue (fallbacks Python : plus grand morceau, outer).
pub fn open_holes_difference(outer_ring: &[Pt], hole_rings: &[Vec<Pt>], width: f64) -> Vec<Pt> {
    if hole_rings.is_empty() {
        return outer_ring.to_vec();
    }
    let mut rects: Vec<Vec<Pt>> = Vec::new();
    for hole in hole_rings {
        let Some((p_in, p_out)) = nearest_points(hole, outer_ring) else {
            continue;
        };
        if let Some(r) = channel_rectangle(p_in, p_out, width) {
            rects.push(r);
        }
    }
    if rects.is_empty() {
        return outer_ring.to_vec();
    }

    // Arrangement : arêtes de tous les anneaux (outer + trous + rectangles),
    // nodage complet, puis faces minimales.
    let mut edges: Vec<(Pt, Pt)> = Vec::new();
    let mut push_ring = |ring: &[Pt]| {
        for w in ring.windows(2) {
            if w[0] != w[1] {
                edges.push((w[0], w[1]));
            }
        }
    };
    push_ring(outer_ring);
    for h in hole_rings {
        push_ring(h);
    }
    for r in &rects {
        push_ring(r);
    }
    let noded = ga::node_segments(&edges);
    let faces = ga::polygonize(&[], &noded);

    // Classifiant : matière = profondeur impaire sur (outer + trous) ET
    // hors de tout rectangle.
    let mut matter: Vec<Vec<Pt>> = Vec::new();
    for f in &faces {
        if ga::ring_signed_area(f) <= 1e-12 {
            continue;
        }
        let probe = ga::interior_probe(f);
        let mut depth = 0usize;
        if ga::point_in_ring(probe, outer_ring) {
            depth += 1;
        }
        for h in hole_rings {
            if ga::point_in_ring(probe, h) {
                depth += 1;
            }
        }
        if depth % 2 == 0 {
            continue;
        }
        if rects.iter().any(|r| ga::point_in_ring(probe, r)) {
            continue;
        }
        matter.push(f.clone());
    }
    if std::env::var("NI_DEBUG").is_ok() {
        eprintln!("[dbg] faces={} matter={}", faces.len(), matter.len());
        for f in &faces {
            eprintln!("[dbg] face n={} area={:.4}", f.len(), ga::ring_signed_area(f));
        }
    }
    if matter.is_empty() {
        return outer_ring.to_vec();
    }

    // Frontière de l'union des faces matière (XOR des arêtes) puis outlines
    // = cycles à aire négative (même règle que build_parts).
    let mut counts: std::collections::HashMap<((u64, u64), (u64, u64)), (Pt, Pt)> =
        std::collections::HashMap::new();
    let mut multi: std::collections::HashSet<((u64, u64), (u64, u64))> =
        std::collections::HashSet::new();
    for ring in &matter {
        let n = ring.len();
        for i in 0..n {
            let a = ring[i];
            let b = ring[(i + 1) % n];
            let ka = (a[0].to_bits(), a[1].to_bits());
            let kb = (b[0].to_bits(), b[1].to_bits());
            let key = if ka <= kb { (ka, kb) } else { (kb, ka) };
            if counts.insert(key, (a, b)).is_some() {
                multi.insert(key);
            }
        }
    }
    let mut keyed: Vec<_> = counts.into_iter().filter(|(k, _)| !multi.contains(k)).collect();
    keyed.sort_by(|(ka, _), (kb, _)| ka.cmp(kb)); // J-062 : ordre déterministe
    let boundary: Vec<(Pt, Pt)> = keyed.into_iter().map(|(_, ab)| ab).collect();
    let outlines: Vec<Vec<Pt>> = ga::polygonize(&[], &boundary)
        .into_iter()
        .filter(|f| ga::ring_signed_area(f) < -1e-12)
        .collect();
    if std::env::var("NI_DEBUG").is_ok() {
        eprintln!("[dbg] boundary={} outlines={}", boundary.len(), outlines.len());
        for o in &outlines {
            eprintln!("[dbg] outline n={} area={:.4}", o.len(), ga::ring_signed_area(o));
        }
    }
    if outlines.is_empty() {
        return outer_ring.to_vec();
    }
    // Plus grand morceau (fallback make_valid Python).
    let best = outlines
        .into_iter()
        .max_by(|a, b| {
            ga::ring_signed_area(a).abs().total_cmp(&ga::ring_signed_area(b).abs())
        })
        .unwrap();
    close_ring(best)
}

fn close_ring(mut ring: Vec<Pt>) -> Vec<Pt> {
    if ring.len() >= 3 && ring.first() != ring.last() {
        ring.push(ring[0]);
    }
    ring
}

// ------------------------------------------------------ (b) ring-splice

/// Insère p dans l'anneau (au milieu du segment qui le contient) et
/// retourne (anneau, index de p). Si p n'est sur aucun segment → None.
fn insert_in_ring(ring: &[Pt], p: Pt) -> Option<(Vec<Pt>, usize)> {
    let n = ring.len();
    for i in 0..n.saturating_sub(1) {
        let a = ring[i];
        let b = ring[i + 1];
        if p == a || ga::point_on_segment(p, a, b) {
            let mut out = Vec::with_capacity(n + 1);
            out.extend_from_slice(&ring[..=i]);
            if p != a && p != b {
                out.push(p);
            }
            out.extend_from_slice(&ring[i + 1..]);
            let idx = out.iter().position(|&q| q == p)?;
            return Some((out, idx));
        }
    }
    None
}

/// Splice d'anneaux : coupe outer au point le plus proche du trou, coupe le
/// trou symétriquement, relie par deux rails droits décalés de ±width/2 le
/// long des tangentes locales. Arithmétique pure (aucun booléen).
pub fn open_holes_splice(outer_ring: &[Pt], hole_rings: &[Vec<Pt>], width: f64) -> Vec<Pt> {
    if hole_rings.is_empty() {
        return outer_ring.to_vec();
    }
    // Travail sur une copie "ouverte" (sans sommet de fermeture dupliqué).
    let mut work: Vec<Pt> = outer_ring.to_vec();
    if work.len() > 1 && work.first() == work.last() {
        work.pop();
    }
    for hole in hole_rings {
        let Some((p_in, p_out)) = nearest_points(hole, &work) else {
            continue;
        };
        // Insère p_out dans l'anneau de travail.
        let Some((ring2, idx_out)) = insert_in_ring(&work, p_out) else {
            if std::env::var("NI_DEBUG").is_ok() { eprintln!("[dbg] splice: insert p_out FAILED {p_out:?}"); }
            continue;
        };
        work = ring2;
        // Tangentes : au point de sortie (segment de l'outer) et au point
        // d'entrée (segment du trou).
        let n = work.len();
        let Some(to) = unit_between(work[(idx_out + n - 1) % n], work[(idx_out + 1) % n]) else {
            continue;
        };
        let Some(ti) = hole_tangent(hole, p_in) else {
            if std::env::var("NI_DEBUG").is_ok() { eprintln!("[dbg] splice: tangent FAILED"); }
            continue;
        };
        let h = width / 2.0;
        // Points de coupure décalés le long des anneaux.
        let q1 = [p_out[0] + to[0] * h, p_out[1] + to[1] * h];
        let q2 = [p_out[0] - to[0] * h, p_out[1] - to[1] * h];
        let r1 = [p_in[0] + ti[0] * h, p_in[1] + ti[1] * h];
        let r2 = [p_in[0] - ti[0] * h, p_in[1] - ti[1] * h];
        // Anneau du trou ouvert en p_in, parcouru en entier (sans sommet de
        // fermeture).
        let Some((hole_open, idx_in)) = insert_in_ring(hole, p_in) else {
            if std::env::var("NI_DEBUG").is_ok() { eprintln!("[dbg] splice: insert p_in FAILED {p_in:?}"); }
            continue;
        };
        let hn = if hole_open.len() > 1 && hole_open.first() == hole_open.last() {
            hole_open.len() - 1
        } else {
            hole_open.len()
        };
        // Le trou doit être parcouru dans le sens INVERSE de l'anneau
        // externe (sinon son aire s'additionne au lieu de se soustraire).
        let mut hole_walk: Vec<Pt> = (0..hn).map(|k| hole_open[(idx_in + k) % hn]).collect();
        let outer_ccw = ga::ring_signed_area(&work) > 0.0;
        let hole_ccw = ga::ring_signed_area(&hole_walk) > 0.0;
        if outer_ccw == hole_ccw {
            // Renverse en gardant p_in en tête.
            hole_walk = std::iter::once(hole_walk[0])
                .chain(hole_walk[1..].iter().rev().copied())
                .collect();
        }
        // Construction : outer de q2 → q1, rail q1→r1, trou r1→…→r2 (walk
        // complet recalé), rail r2→q2.
        let mut out: Vec<Pt> = Vec::with_capacity(work.len() + hn + 4);
        out.push(q2);
        for k in 1..n {
            out.push(work[(idx_out + k) % n]);
        }
        out.push(q1);
        out.push(r1);
        for &p in hole_walk.iter().skip(1) {
            out.push(p);
        }
        out.push(r2);
        out.push(q2);
        out.pop(); // close_ring à la fin
        if std::env::var("NI_DEBUG").is_ok() { eprintln!("[dbg] splice: out n={}", out.len()); }
        work = out;
    }
    close_ring(work)
}

fn unit_between(a: Pt, b: Pt) -> Option<Pt> {
    let d = dist(a, b);
    if d < 1e-12 {
        return None;
    }
    Some([(b[0] - a[0]) / d, (b[1] - a[1]) / d])
}

/// Tangente de l'anneau de trou au point p (direction du segment porteur ;
/// les extrémités comptent — nearest_points tombe souvent sur un sommet).
fn hole_tangent(hole: &[Pt], p: Pt) -> Option<Pt> {
    let n = hole.len();
    for i in 0..n.saturating_sub(1) {
        if p == hole[i] || ga::point_on_segment(p, hole[i], hole[i + 1]) {
            return unit_between(hole[i], hole[i + 1]);
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rect(x0: f64, y0: f64, x1: f64, y1: f64) -> Vec<Pt> {
        vec![[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]
    }

    #[test]
    fn channel_width_rules() {
        assert_eq!(channel_width_for_space(0.0), 0.1); // max(0.01, 0+0.1)
        assert_eq!(channel_width_for_space(2.0), 2.1);
        assert_eq!(channel_width_for_space(3.0), 2.5); // cap
        assert!(channels_usable(2.0));
        assert!(!channels_usable(2.5)); // 2.5 > 2.5 faux → scellé
    }

    #[test]
    fn nearest_points_axis_aligned() {
        let outer = rect(0.0, 0.0, 100.0, 100.0);
        let hole = rect(40.0, 40.0, 60.0, 60.0);
        let (p_in, p_out) = nearest_points(&hole, &outer).unwrap();
        let d = dist(p_in, p_out);
        assert!((d - 40.0).abs() < 1e-9, "d={d}");
    }

    #[test]
    fn difference_opens_channel() {
        let outer = rect(0.0, 0.0, 100.0, 100.0);
        let hole = rect(40.0, 40.0, 60.0, 60.0);
        let ring = open_holes_difference(&outer, &[hole], 2.1);
        // Le résultat est un anneau simple : outer − trou − canal.
        let area = ga::ring_signed_area(&ring).abs();
        let expected = 10000.0 - 400.0 - 40.0 * 2.1;
        assert!((area - expected).abs() / expected < 0.02, "area={area} vs {expected}");
        assert!(ring.first() == ring.last());
    }

    #[test]
    fn splice_opens_channel() {
        let outer = rect(0.0, 0.0, 100.0, 100.0);
        let hole = rect(40.0, 40.0, 60.0, 60.0);
        let ring = open_holes_splice(&outer, &[hole], 2.1);
        let area = ga::ring_signed_area(&ring).abs();
        let expected = 10000.0 - 400.0 - 40.0 * 2.1;
        assert!((area - expected).abs() / expected < 0.05, "area={area} vs {expected}");
        assert!(ring.first() == ring.last());
    }

    #[test]
    fn sealed_channels_stay_closed_semantics() {
        // D-MOT-2 : à space 3.0 le canal est scellé → l'appelant garde les
        // trous fermés (channels_usable = false) — jamais d'ouverture.
        assert!(!channels_usable(3.0));
    }
}
