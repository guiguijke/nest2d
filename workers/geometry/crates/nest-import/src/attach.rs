//! Attachement des handles aux pièces — jumeau de la passe finale de
//! `build_geometry.py` (workers/fileprocessing, lignes ~328-367) :
//!
//!   « An entity belongs to the part whose MATERIAL body its ink touches »
//!
//! Pour chaque footprint (handle, encre aplatie), dans l'ordre modelspace :
//!   1. candidats = corps dont le buffer(probe_tol) intersecte l'encre
//!      (⟺ distance corps↔encre ≤ probe_tol, corps = matière AVEC trous
//!      soustraits) ;
//!   2. mesure = longueur d'encre ∩ corps (le contour fermé dessine son
//!      OUTLINE, pas un disque plein — le cercle d'un trou « touche » la
//!      pièce qui l'entoure, pas l'îlot qu'il contient) ; le meilleur
//!      argmax gagne (premier en cas d'égalité, `max` Python) ;
//!   3. sinon (encre dans le vide : POINT, annotation…) : la plus PETITE
//!      silhouette (anneau externe plein) contenant le centroïde de
//!      l'entité gagne (`min` sur l'aire, première en cas d'égalité).
//!
//! **Encre snappée** : les footprints sont mis sur la grille 1e-4 au moment
//! de la collecte (assemble.rs). Les corps sont construits depuis le même
//! linework snappé — l'encre d'une entité contributrice coïncide alors
//! EXACTEMENT avec le bord du corps (cross == 0.0 exploitable), ce que le
//! Python obtient via les prédicats robustes de GEOS sur encre brute. Les
//! DÉCISIONS (argmax / > 0 / fallback) sont identiques : le snap déplace un
//! point de ≤ 7,1e-5 mm, trois ordres de grandeur sous probe_tol (0,01).

use crate::assemble as ga;
use ga::Pt;

/// Tolérance de perpendicularité pour « sur le bord » = le quantum de la
/// grille de snap (1e-4). L'encre est snappée mais les jonctions nodées des
/// corps (points de split calculés pré-snap PUIS snappés indépendamment)
/// peuvent dévier d'environ le quantum par rapport à la droite de l'encre
/// (ligne inclinée : verrou Piece_Fillx4 — 1e-9 y perdait un LINE entier).
/// En dessous du quantum, le pipeline lui-même (set_precision) fusionne les
/// features : l'attachement suit la même résolution — c'est l'équivalent
/// maison des prédicats robustes de GEOS sur encre brute.
const ON_EDGE_EPS: f64 = 1e-4;

/// Un footprint : handle canonique + encre (points snappés) + nature.
#[derive(Debug, Clone)]
pub struct Footprint {
    pub handle: String,
    pub ink: Vec<Pt>,
    /// true si l'entité source est un contour FERMÉ (Polygon Python :
    /// len>2 et |first−last| < tol) — pilote le centroïde du fallback
    /// (aire) vs LineString (longueur).
    pub closed: bool,
}

/// Corps matière : anneau externe + anneaux de trous (conventions pipeline).
pub struct Body<'a> {
    pub outer: &'a [Pt],
    pub holes: &'a [Vec<Pt>],
}

// ------------------------------------------------------------ primitives

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

/// p ∈ [a,b] au sens large (colinéaire EXACT + entre, extrémités incluses).
/// La grille 1e-4 rend l'égalité exacte exploitable sur l'encre snappée.
fn on_seg_incl(p: Pt, a: Pt, b: Pt) -> bool {
    let ab = sub(b, a);
    let ap = sub(p, a);
    cross(ab, ap) == 0.0 && dot(ap, sub(p, b)) <= 0.0
}

/// Distance perpendiculaire de p à la droite (a,b) ≤ eps, avec p projeté
/// dans [a,b] (test « sur l'arête » robuste au lerp f64, cf. ON_EDGE_EPS).
fn on_edge_band(p: Pt, a: Pt, b: Pt) -> bool {
    let ab = sub(b, a);
    let len = norm(ab);
    if len == 0.0 {
        return norm(sub(p, a)) <= ON_EDGE_EPS;
    }
    cross(ab, sub(p, a)).abs() <= ON_EDGE_EPS * len && dot(sub(p, a), sub(p, b)) <= 0.0
}

/// Distance point–segment.
fn point_seg_dist(p: Pt, a: Pt, b: Pt) -> f64 {
    let ab = sub(b, a);
    let d2 = dot(ab, ab);
    if d2 == 0.0 {
        return norm(sub(p, a));
    }
    let t = (dot(sub(p, a), ab) / d2).clamp(0.0, 1.0);
    norm(sub(p, [a[0] + t * ab[0], a[1] + t * ab[1]]))
}

/// Les deux segments se touchent (croisement strict, contact d'extrémité
/// ou recouvrement colinéaire).
fn segs_meet(a1: Pt, a2: Pt, b1: Pt, b2: Pt) -> bool {
    if ga::seg_intersection(a1, a2, b1, b2).is_some() {
        return true;
    }
    on_seg_incl(a1, b1, b2)
        || on_seg_incl(a2, b1, b2)
        || on_seg_incl(b1, a1, a2)
        || on_seg_incl(b2, a1, a2)
}

/// Distance segment–segment (0 si contact).
fn seg_seg_dist(a1: Pt, a2: Pt, b1: Pt, b2: Pt) -> f64 {
    if segs_meet(a1, a2, b1, b2) {
        return 0.0;
    }
    point_seg_dist(a1, b1, b2)
        .min(point_seg_dist(a2, b1, b2))
        .min(point_seg_dist(b1, a1, a2))
        .min(point_seg_dist(b2, a1, a2))
}

/// Arêtes d'un anneau comme CYCLE (dernier → premier inclus) : les anneaux
/// issus de polygonize sont OUVERTS (pas de sommet de fermeture) — un
/// simple windows(2) perdrait l'arête de bouclage (verrou Piece_Fillx4 :
/// LINE31 était l'arête de bouclage du corps, mesure 0 avant ce correctif).
fn cycle_edges(ring: &[Pt]) -> Vec<(Pt, Pt)> {
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

fn edges_of<'a>(body: &Body<'a>) -> impl Iterator<Item = (Pt, Pt)> + 'a {
    cycle_edges(body.outer)
        .into_iter()
        .chain(body.holes.iter().flat_map(|h| cycle_edges(h).into_iter()))
}

/// p dans la matière du corps (bord INCLUS — GEOS ensembles fermés) :
/// dans/sur l'externe ET pas strictement dans un trou (le bord d'un trou
/// fait partie du corps : l'encre du trou « touche » la pièce hôte).
fn point_in_body(p: Pt, body: &Body) -> bool {
    let in_outer = ga::point_in_ring(p, body.outer)
        || cycle_edges(body.outer)
            .into_iter()
            .any(|(a, b)| on_edge_band(p, a, b));
    if !in_outer {
        return false;
    }
    for h in body.holes {
        let on_hole_edge = cycle_edges(h).into_iter().any(|(a, b)| on_edge_band(p, a, b));
        if !on_hole_edge && ga::point_in_ring(p, h) {
            return false; // strictement dans le vide
        }
    }
    true
}

/// distance(encre, corps) — 0 dès qu'un point d'encre est dans le corps ou
/// qu'une arête croise/touche le bord du corps ; sinon min des distances
/// arête↔arête (couvre « encre dans un trou » : distance à la paroi).
fn ink_body_dist(ink: &[(Pt, Pt)], body: &Body) -> f64 {
    let mut best = f64::INFINITY;
    for &(a, b) in ink {
        if point_in_body(a, body) || point_in_body(b, body) {
            return 0.0;
        }
        for (c, d) in edges_of(body) {
            let dd = seg_seg_dist(a, b, c, d);
            if dd == 0.0 {
                return 0.0;
            }
            best = best.min(dd);
        }
    }
    // Encre ponctuelle gérée par l'appelant (len==1).
    best
}

/// Longueur d'encre ∩ corps (mesure GEOS `intersection.length`) : chaque
/// segment d'encre est découpé aux croisements avec le bord du corps, puis
/// le midpoint de chaque tronçon est classé (bord du corps = compté).
fn clip_length_in_body(ink: &[(Pt, Pt)], body: &Body) -> f64 {
    let bedges: Vec<(Pt, Pt)> = edges_of(body).collect();
    let mut total = 0.0;
    for &(a, b) in ink {
        let len = norm(sub(b, a));
        if len == 0.0 {
            continue;
        }
        let mut ts: Vec<f64> = vec![0.0, 1.0];
        for &(c, d) in &bedges {
            if let Some(p) = ga::seg_intersection(a, b, c, d) {
                ts.push(dot(sub(p, a), sub(b, a)) / (len * len));
            }
            // recouvrements colinéaires : les extrémités de l'arête du
            // corps SUR le segment d'encre bornent la zone de recouvrement.
            for &p in &[c, d] {
                if on_seg_incl(p, a, b) {
                    ts.push(dot(sub(p, a), sub(b, a)) / (len * len));
                }
            }
        }
        ts.sort_by(f64::total_cmp);
        ts.dedup_by(|x, y| (*x - *y).abs() < 1e-12);
        for w in ts.windows(2) {
            let (t0, t1) = (w[0], w[1]);
            if t1 - t0 < 1e-15 {
                continue;
            }
            let tm = (t0 + t1) / 2.0;
            let mid = [a[0] + tm * (b[0] - a[0]), a[1] + tm * (b[1] - a[1])];
            if point_in_body(mid, body) {
                total += (t1 - t0) * len;
            }
        }
    }
    total
}

// ------------------------------------------------------------ centroïdes

/// Centroïde shapely du footprint pour le fallback :
/// Polygon → centroïde d'AIRE (repli longueur si aire nulle, GEOS),
/// LineString → moyenne pondérée par la longueur des milieux,
/// Point → lui-même.
fn footprint_centre(fp: &Footprint) -> Pt {
    let pts = &fp.ink;
    if pts.len() == 1 {
        return pts[0];
    }
    if fp.closed && pts.len() > 2 {
        let mut sx = 0.0;
        let mut sy = 0.0;
        let mut sa = 0.0;
        for w in pts.windows(2) {
            let (x0, y0) = (w[0][0], w[0][1]);
            let (x1, y1) = (w[1][0], w[1][1]);
            let cr = x0 * y1 - x1 * y0;
            sa += cr;
            sx += (x0 + x1) * cr;
            sy += (y0 + y1) * cr;
        }
        if sa != 0.0 {
            return [sx / (3.0 * sa), sy / (3.0 * sa)];
        }
        // aire nulle → GEOS retombe sur le centroïde de ligne.
    }
    let mut total_len = 0.0;
    let mut sx = 0.0;
    let mut sy = 0.0;
    for w in pts.windows(2) {
        let l = norm(sub(w[1], w[0]));
        total_len += l;
        sx += (w[0][0] + w[1][0]) / 2.0 * l;
        sy += (w[0][1] + w[1][1]) / 2.0 * l;
    }
    if total_len > 0.0 {
        [sx / total_len, sy / total_len]
    } else {
        let n = pts.len() as f64;
        [
            pts.iter().map(|p| p[0]).sum::<f64>() / n,
            pts.iter().map(|p| p[1]).sum::<f64>() / n,
        ]
    }
}

// ------------------------------------------------------------ attachement

fn bbox_of(pts: &[Pt]) -> [f64; 4] {
    pts.iter().fold(
        [f64::INFINITY, f64::INFINITY, f64::NEG_INFINITY, f64::NEG_INFINITY],
        |acc, p| [
            acc[0].min(p[0]),
            acc[1].min(p[1]),
            acc[2].max(p[0]),
            acc[3].max(p[1]),
        ],
    )
}

fn bbox_dist(a: &[f64; 4], b: &[f64; 4]) -> f64 {
    let dx = (a[0] - b[2]).max(b[0] - a[2]).max(0.0);
    let dy = (a[1] - b[3]).max(b[1] - a[3]).max(0.0);
    (dx * dx + dy * dy).sqrt()
}

/// Attache les footprints aux corps — renvoie, par corps (même ordre), les
/// handles dans l'ordre modelspace. `probe_tol` = max(tolerance, 1e-6)
/// côté Python (= tol de flattening en pratique).
pub fn attach_handles(
    footprints: &[Footprint],
    bodies: &[Body],
    probe_tol: f64,
) -> Vec<Vec<String>> {
    let body_bboxes: Vec<[f64; 4]> = bodies.iter().map(|b| bbox_of(b.outer)).collect();
    let mut assigned: Vec<Vec<String>> = vec![Vec::new(); bodies.len()];

    for fp in footprints {
        if fp.ink.is_empty() {
            continue;
        }
        // L'encre d'un contour FERMÉ est son boundary shapely — Polygon()
        // boucle l'anneau même si |first−last| < tol sans être identiques :
        // l'arête de bouclage compte (cycle complet). Contours ouverts :
        // segments droits tels quels.
        let ink_edges: Vec<(Pt, Pt)> = if fp.closed {
            cycle_edges(&fp.ink)
        } else {
            fp.ink.windows(2).map(|w| (w[0], w[1])).collect()
        };
        let ink_bb = bbox_of(&fp.ink);

        // 1+2) mesure d'encre par corps (avec rejet bbox — le buffer
        // probe_tol ne peut pas franchir un gap bbox > probe_tol).
        let mut best: Option<(usize, f64)> = None;
        for (idx, body) in bodies.iter().enumerate() {
            let mut bb = body_bboxes[idx];
            bb[0] -= probe_tol;
            bb[1] -= probe_tol;
            bb[2] += probe_tol;
            bb[3] += probe_tol;
            if bbox_dist(&bb, &ink_bb) > 0.0 {
                continue;
            }
            let near = if ink_edges.is_empty() {
                // footprint ponctuel : intersects ⟺ dist ≤ probe_tol
                point_in_body(fp.ink[0], body)
                    || edges_of(body)
                        .map(|(c, d)| point_seg_dist(fp.ink[0], c, d))
                        .fold(f64::INFINITY, f64::min)
                        <= probe_tol
            } else {
                ink_body_dist(&ink_edges, body) <= probe_tol
            };
            if !near {
                continue;
            }
            if ink_edges.is_empty() {
                continue; // mesure d'un point = 0 → jamais un hit (GEOS)
            }
            let measure = clip_length_in_body(&ink_edges, body);
            if std::env::var("NI_DEBUG").is_ok() {
                eprintln!("[attach] fp={} body={} measure={}", fp.handle, idx, measure);
            }
            if measure > 0.0 && best.map(|(_, m)| measure > m).unwrap_or(true) {
                best = Some((idx, measure));
            }
        }
        if let Some((idx, _)) = best {
            assigned[idx].push(fp.handle.clone());
            continue;
        }
        if std::env::var("NI_DEBUG").is_ok() {
            eprintln!("[attach] fp={} → fallback centroïde", fp.handle);
        }

        // 3) fallback : plus petite silhouette contenant le centroïde.
        let centre = footprint_centre(fp);
        let mut best_idx: Option<(usize, f64)> = None;
        for (idx, body) in bodies.iter().enumerate() {
            let outer_edges = cycle_edges(body.outer);
            let silhouette_hit = ga::point_in_ring(centre, body.outer)
                || outer_edges
                    .iter()
                    .any(|&(a, b)| on_edge_band(centre, a, b))
                || outer_edges
                    .iter()
                    .map(|&(a, b)| point_seg_dist(centre, a, b))
                    .fold(f64::INFINITY, f64::min)
                    <= probe_tol;
            if !silhouette_hit {
                continue;
            }
            let area = ga::ring_signed_area(body.outer).abs();
            // min Python : la PREMIÈRE aire strictement minimale gagne.
            if best_idx.map(|(_, a)| area < a).unwrap_or(true) {
                best_idx = Some((idx, area));
            }
        }
        if let Some((idx, _)) = best_idx {
            assigned[idx].push(fp.handle.clone());
        }
        // sinon : entité hors de toute pièce — handle non attaché (warning
        // de couverture côté Python, jamais une erreur).
    }
    assigned
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rect(x0: f64, y0: f64, x1: f64, y1: f64) -> Vec<Pt> {
        vec![[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]
    }

    fn fp(handle: &str, ink: Vec<Pt>, closed: bool) -> Footprint {
        Footprint { handle: handle.into(), ink, closed }
    }

    #[test]
    fn hole_outline_attaches_to_host_part_not_island() {
        // Corps : hôte 100×100 troué (trou 40..60) + îlot 45..55 dans le trou.
        let host_outer = rect(0.0, 0.0, 100.0, 100.0);
        let host_hole = rect(40.0, 40.0, 60.0, 60.0);
        let island_outer = rect(45.0, 45.0, 55.0, 55.0);
        let bodies = [
            Body { outer: &host_outer, holes: std::slice::from_ref(&host_hole) },
            Body { outer: &island_outer, holes: &[] },
        ];
        // Encre = contour du trou (anneau fermé) : boundary ∩ hôte = toute la
        // longueur (bord du corps), ∩ îlot = 0 → hôte gagne.
        let fps = vec![
            fp("host_outline", host_outer.clone(), true),
            fp("hole_ring", host_hole.clone(), true),
            fp("island_ring", island_outer.clone(), true),
        ];
        let got = attach_handles(&fps, &bodies, 0.01);
        assert_eq!(got[0], vec!["host_outline", "hole_ring"]);
        assert_eq!(got[1], vec!["island_ring"]);
    }

    #[test]
    fn point_in_void_falls_back_to_smallest_silhouette() {
        let host_outer = rect(0.0, 0.0, 100.0, 100.0);
        let host_hole = rect(40.0, 40.0, 60.0, 60.0);
        let island_outer = rect(45.0, 45.0, 55.0, 55.0);
        let bodies = [
            Body { outer: &host_outer, holes: std::slice::from_ref(&host_hole) },
            Body { outer: &island_outer, holes: &[] },
        ];
        // Point dans le vide (trou, hors îlot) : mesure 0 partout → fallback
        // centroïde ; l'îlot (petite silhouette) ne contient pas (50±6) → hôte.
        let fps = vec![fp("p", vec![[50.0, 42.0]], false)];
        let got = attach_handles(&fps, &bodies, 0.01);
        assert_eq!(got[0], vec!["p"]);
        assert!(got[1].is_empty());
        // Point dans l'îlot : plus petite silhouette = îlot.
        let fps = vec![fp("p2", vec![[50.0, 50.0]], false)];
        let got = attach_handles(&fps, &bodies, 0.01);
        assert!(got[0].is_empty());
        assert_eq!(got[1], vec!["p2"]);
    }

    #[test]
    fn crossing_line_attaches_to_dominant_body() {
        let a_outer = rect(0.0, 0.0, 10.0, 10.0);
        let b_outer = rect(20.0, 0.0, 30.0, 10.0);
        let bodies = [
            Body { outer: &a_outer, holes: &[] },
            Body { outer: &b_outer, holes: &[] },
        ];
        // Ligne de (5,5) à (25,5) : 5 mm dans A, 5 mm dans B, 10 mm dehors.
        // Égalité de mesure → max Python garde le PREMIER (corps A).
        let fps = vec![fp("line", vec![[5.0, 5.0], [25.0, 5.0]], false)];
        let got = attach_handles(&fps, &bodies, 0.01);
        assert_eq!(got[0], vec!["line"]);
        assert!(got[1].is_empty());
        // Ligne de (5,5) à (28,5) : 5 mm dans A, 8 mm dans B → B gagne.
        let fps = vec![fp("line2", vec![[5.0, 5.0], [28.0, 5.0]], false)];
        let got = attach_handles(&fps, &bodies, 0.01);
        assert!(got[0].is_empty());
        assert_eq!(got[1], vec!["line2"]);
    }

    #[test]
    fn entity_outside_everything_is_dropped() {
        let a_outer = rect(0.0, 0.0, 10.0, 10.0);
        let bodies = [Body { outer: &a_outer, holes: &[] }];
        let fps = vec![fp("far", vec![[500.0, 500.0]], false)];
        let got = attach_handles(&fps, &bodies, 0.01);
        assert!(got[0].is_empty());
    }
}
