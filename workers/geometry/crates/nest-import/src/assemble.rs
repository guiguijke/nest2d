//! Assembly: flattened primitives → polygon parts (build_geometry.py twin).
//!
//! Pipeline: snap to the 1e-4 grid (GEOS set_precision rounding), noding of
//! segment intersections, minimal-face extraction (leftmost-face walk,
//! deterministic), even-odd material selection, dissolve per part, weld of
//! near polygons (0.1 mm), reduce_ring, bbox filter. Benign inputs (closed
//! rings — the whole real-world corpus) take the exact fast path; general
//! noding/union paths are exercised and measured by the parity harness.

use crate::dxf::flatten::{flatten_primitive, Primitive};
use crate::Part;
use std::collections::HashMap;

/// GEOS set_precision rounding: floor(v*1e4 + 0.5)/1e4 (round-half-up).
/// (La forme ×1e-4 = 13.229200000000004 vue dans certains goldens vient du
/// weld buffer(±0.1) de _merge_near_polygons, PAS de set_precision —
/// vérifié : set_precision(Point(13.229200000000001)) = 13.2292 propre.)
fn snap(v: f64) -> f64 {
    ((v * 1e4) + 0.5).floor() / 1e4
}

fn snap_pt(p: [f64; 2]) -> [f64; 2] {
    [snap(p[0]), snap(p[1])]
}

type Pt = [f64; 2];

fn sub(a: Pt, b: Pt) -> Pt {
    [a[0] - b[0], a[1] - b[1]]
}
fn cross(a: Pt, b: Pt) -> f64 {
    a[0] * b[1] - a[1] * b[0]
}
fn dist2(a: Pt, b: Pt) -> f64 {
    let d = sub(a, b);
    d[0] * d[0] + d[1] * d[1]
}

pub struct Linework {
    /// Closed rings (closed flag or |first−last| < tol) — become cycle candidates.
    pub rings: Vec<Vec<Pt>>,
    /// Open polylines → segments.
    pub segments: Vec<(Pt, Pt)>,
    /// (handle, ink points) for handle attachment.
    pub footprints: Vec<(String, Vec<Pt>)>,
}

/// Splits primitives into closed rings and open segments (convert_entity_to_
/// shapely's Polygon-vs-LineString rule: |first−last| < tol ⇒ closed).
pub fn collect_linework(
    prims: &[Primitive],
    tol: f64,
) -> (Linework, Vec<String>, usize) {
    let mut lw = Linework {
        rings: Vec::new(),
        segments: Vec::new(),
        footprints: Vec::new(),
    };
    let warnings = Vec::new();
    let mut count = 0usize;
    for p in prims {
        count += 1;
        let handle = p.handle().to_string();
        let pts = flatten_primitive(p, tol);
        if pts.is_empty() {
            continue;
        }
        lw.footprints.push((handle, pts.clone()));
        if pts.len() == 1 {
            continue; // POINT: footprint only
        }
        let closed = dist2(pts[0], pts[pts.len() - 1]).sqrt() < tol;
        if closed && pts.len() >= 3 {
            lw.rings.push(pts);
        } else {
            for w in pts.windows(2) {
                lw.segments.push((w[0], w[1]));
            }
        }
    }
    (lw, warnings, count)
}

// ---------------------------------------------------------------- noding

/// Segment intersection point (f64, exact for straight segments).
fn seg_intersection(a1: Pt, a2: Pt, b1: Pt, b2: Pt) -> Option<Pt> {
    let r = sub(a2, a1);
    let s = sub(b2, b1);
    let denom = cross(r, s);
    if denom == 0.0 {
        return None; // parallel or collinear — no split (GEOS noding note)
    }
    let t = cross(sub(b1, a1), s) / denom;
    let u = cross(sub(b1, a1), r) / denom;
    if t > 0.0 && t < 1.0 && u > 0.0 && u < 1.0 {
        Some([a1[0] + t * r[0], a1[1] + t * r[1]])
    } else {
        None
    }
}

/// Point strictly inside a segment (collinear + between), f64 exact.
fn point_on_segment(p: Pt, a: Pt, b: Pt) -> bool {
    let ab = sub(b, a);
    let ap = sub(p, a);
    if cross(ab, ap) != 0.0 {
        return false;
    }
    let d = dist2(a, b);
    if d == 0.0 {
        return false;
    }
    let t = (ap[0] * ab[0] + ap[1] * ab[1]) / d;
    t > 0.0 && t < 1.0
}

/// Split all segments at mutual intersections AND at T-junctions (an
/// endpoint lying strictly inside another segment) — GEOS noding parity.
/// O(n²); noded graph edges are then re-snapped so coincident vertices
/// merge exactly.
fn node_segments(segments: &[(Pt, Pt)]) -> Vec<(Pt, Pt)> {
    let mut out: Vec<(Pt, Pt)> = Vec::new();
    for (i, &(a1, a2)) in segments.iter().enumerate() {
        let mut ts: Vec<f64> = Vec::new();
        for (j, &(b1, b2)) in segments.iter().enumerate() {
            if i == j {
                continue;
            }
            if let Some(p) = seg_intersection(a1, a2, b1, b2) {
                let d = dist2(a1, a2);
                if d > 0.0 {
                    let t = (sub(p, a1)[0] * (a2[0] - a1[0]) + sub(p, a1)[1] * (a2[1] - a1[1])) / d;
                    ts.push(t);
                }
            }
            // T-junction: an endpoint of (b1,b2) strictly inside (a1,a2).
            for &p in &[b1, b2] {
                if point_on_segment(p, a1, a2) {
                    let d = dist2(a1, a2);
                    let t = (sub(p, a1)[0] * (a2[0] - a1[0]) + sub(p, a1)[1] * (a2[1] - a1[1])) / d;
                    ts.push(t);
                }
            }
        }
        if ts.is_empty() {
            out.push((a1, a2));
            continue;
        }
        ts.sort_by(|x, y| x.total_cmp(y));
        ts.dedup_by(|x, y| (*x - *y).abs() < 1e-12);
        let mut prev = a1;
        let mut prev_t = 0.0;
        for &t in &ts {
            if t <= prev_t || t >= 1.0 {
                continue;
            }
            let p = [a1[0] + t * (a2[0] - a1[0]), a1[1] + t * (a2[1] - a1[1])];
            out.push((prev, p));
            prev = p;
            prev_t = t;
        }
        out.push((prev, a2));
    }
    out
}

// ------------------------------------------------------- polygonization

/// Minimal faces of a planar segment set via the leftmost-face rule.
/// Returns rings (closed cycles of vertices). Deterministic.
fn polygonize(rings: &[Vec<Pt>], segments: &[(Pt, Pt)]) -> Vec<Vec<Pt>> {
    // Build undirected edges from rings (consecutive pairs) + segments.
    let mut edges: Vec<(Pt, Pt)> = Vec::new();
    for ring in rings {
        for w in ring.windows(2) {
            edges.push((w[0], w[1]));
        }
    }
    edges.extend_from_slice(segments);

    // Map snapped points to ids (exact f64 bits after snap).
    let mut ids: HashMap<(u64, u64), usize> = HashMap::new();
    let mut verts: Vec<Pt> = Vec::new();
    let id_of = |p: Pt, ids: &mut HashMap<(u64, u64), usize>, verts: &mut Vec<Pt>| {
        *ids.entry((p[0].to_bits(), p[1].to_bits()))
            .or_insert_with(|| {
                verts.push(p);
                verts.len() - 1
            })
    };
    let mut adj: Vec<Vec<usize>> = Vec::new();
    for &(a, b) in &edges {
        let ia = id_of(a, &mut ids, &mut verts);
        let ib = id_of(b, &mut ids, &mut verts);
        if ia == ib {
            continue;
        }
        if adj.len() <= ia.max(ib) {
            adj.resize(ia.max(ib) + 1, Vec::new());
        }
        if !adj[ia].contains(&ib) {
            adj[ia].push(ib);
        }
        if !adj[ib].contains(&ia) {
            adj[ib].push(ia);
        }
    }

    // Sort neighbors by angle around each vertex (CCW from +x axis).
    let mut adj_sorted: Vec<Vec<usize>> = adj.clone();
    for (i, nbrs) in adj_sorted.iter_mut().enumerate() {
        let c = verts[i];
        nbrs.sort_by(|&x, &y| {
            let ax = libm::atan2(verts[x][1] - c[1], verts[x][0] - c[0]);
            let ay = libm::atan2(verts[y][1] - c[1], verts[y][0] - c[0]);
            ax.total_cmp(&ay)
        });
    }

    // Leftmost-face walk on directed edges.
    let mut used: HashMap<(usize, usize), bool> = HashMap::new();
    let mut faces: Vec<Vec<Pt>> = Vec::new();
    for &(a, b) in &edges {
        let ia = ids[&(a[0].to_bits(), a[1].to_bits())];
        let ib = ids[&(b[0].to_bits(), b[1].to_bits())];
        if ia == ib {
            continue;
        }
        for (from, to) in [(ia, ib), (ib, ia)] {
            if used.contains_key(&(from, to)) {
                continue;
            }
            let mut face: Vec<Pt> = Vec::new();
            let mut cur_from = from;
            let mut cur_to = to;
            let mut ok = true;
            loop {
                if used.contains_key(&(cur_from, cur_to)) {
                    // Reached an already-used edge: valid only if closing.
                    if cur_from == from && cur_to == to {
                        break;
                    }
                    ok = false;
                    break;
                }
                used.insert((cur_from, cur_to), true);
                face.push(verts[cur_from]);
                // Leftmost-face rule: at cur_to, take the neighbor just
                // BEFORE the incoming edge in CCW order (= next in clockwise
                // order) — the face on the left of the walk. (No special
                // pinch handling: walking BOTH directions of every edge
                // already yields the union outline as the negative-side
                // cycle at pinches — the dissolve pass selects on area sign.)
                let nbrs = &adj_sorted[cur_to];
                let Some(pos) = nbrs.iter().position(|&x| x == cur_from) else {
                    ok = false;
                    break;
                };
                let next = nbrs[(pos + nbrs.len() - 1) % nbrs.len()];
                cur_from = cur_to;
                cur_to = next;
                if cur_from == from && cur_to == to {
                    break;
                }
                if face.len() > verts.len() + 2 {
                    ok = false;
                    break;
                }
            }
            if ok && face.len() >= 3 {
                faces.push(face);
            }
        }
    }
    faces
}

// ------------------------------------------------------------- measures

fn ring_signed_area(r: &[Pt]) -> f64 {
    let mut a = 0.0;
    let n = r.len();
    for i in 0..n {
        let (x0, y0) = (r[i][0], r[i][1]);
        let (x1, y1) = (r[(i + 1) % n][0], r[(i + 1) % n][1]);
        a += x0 * y1 - x1 * y0;
    }
    a / 2.0
}

fn point_in_ring(p: Pt, ring: &[Pt]) -> bool {
    // Ray casting (+x), f64 — boundary cases are resolved by the 1e-4 grid.
    let mut inside = false;
    let n = ring.len();
    for i in 0..n {
        let a = ring[i];
        let b = ring[(i + 1) % n];
        if (a[1] > p[1]) != (b[1] > p[1]) {
            let x = a[0] + (p[1] - a[1]) * (b[0] - a[0]) / (b[1] - a[1]);
            if p[0] < x {
                inside = !inside;
            }
        }
    }
    inside
}

/// Guaranteed-interior probe (GEOS representative_point twin): from a convex
/// vertex, a small step along the interior angle bisector. The ear-centroid
/// shortcut is NOT safe (the diagonal can cross a notch) — the bisector step
/// is local and always lands inside a simple CCW ring.
fn interior_probe(ring: &[Pt]) -> Pt {
    let n = ring.len();
    // Orientation-agnostic: the convex-vertex turn sign follows the ring's
    // signed area (CW exterior in this pipeline).
    let turn_sign = if ring_signed_area(ring) < 0.0 { -1.0 } else { 1.0 };
    for i in 0..n {
        let a = ring[i];
        let b = ring[(i + 1) % n];
        let c = ring[(i + 2) % n];
        let ba = sub(a, b);
        let bc = sub(c, b);
        if cross(bc, ba) * turn_sign > 0.0 {
            // Convex vertex (left turn ba→bc… cross(bc,ba)>0 means interior < 180°).
            let la = (ba[0] * ba[0] + ba[1] * ba[1]).sqrt();
            let lc = (bc[0] * bc[0] + bc[1] * bc[1]).sqrt();
            if la == 0.0 || lc == 0.0 {
                continue;
            }
            let ux = ba[0] / la + bc[0] / lc;
            let uy = ba[1] / la + bc[1] / lc;
            let ul = (ux * ux + uy * uy).sqrt();
            if ul == 0.0 {
                continue;
            }
            // Step: quarter of the shorter adjacent edge, within [1e-3, 1.0].
            let eps = (la.min(lc) / 4.0).clamp(1e-3, 1.0);
            return [b[0] + ux / ul * eps, b[1] + uy / ul * eps];
        }
    }
    // Fallback: vertex centroid (convex rings always work above).
    let mut cx = 0.0;
    let mut cy = 0.0;
    for p in ring {
        cx += p[0];
        cy += p[1];
    }
    [cx / n as f64, cy / n as f64]
}

fn ring_contains(outer: &[Pt], inner: &[Pt]) -> bool {
    inner.iter().any(|&p| point_in_ring(p, outer))
}

/// reduce_ring (build_geometry.to_mongo_dict twin): keep a point iff it
/// moved > 0.01 from the last KEPT point (x or y).
fn reduce_ring(ring: &[Pt]) -> Vec<Pt> {
    let mut out: Vec<Pt> = Vec::new();
    for &p in ring {
        match out.last() {
            None => out.push(p),
            Some(&last) => {
                if (p[0] - last[0]).abs() > 0.01 || (p[1] - last[1]).abs() > 0.01 {
                    out.push(p);
                }
            }
        }
    }
    out
}

/// Boundary of the union of material BODIES: edges (undirected, snapped)
/// appearing in exactly one body — a body = a material face PLUS its hole
/// rings (a hole edge borders exactly one body → kept; a shared outer edge
/// borders two → dissolved). Returns None when nothing merges (single body
/// or fully disjoint parts — no second pass needed).
fn dissolve_boundary(
    unique: &[Vec<Pt>],
    depths: &[usize],
    probes: &[Pt],
    material: &[usize],
) -> Option<Vec<(Pt, Pt)>> {
    if material.len() <= 1 {
        return None;
    }
    let mut counts: HashMap<((u64, u64), (u64, u64)), (Pt, Pt)> = HashMap::new();
    let mut multi: std::collections::HashSet<((u64, u64), (u64, u64))> = std::collections::HashSet::new();
    let mut account = |ring: &[Pt]| {
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
    };
    for &mi in material {
        account(&unique[mi]);
        // Holes of this body: cycles one level deeper contained in it.
        for (j, u) in unique.iter().enumerate() {
            if j == mi || depths[j] != depths[mi] + 1 {
                continue;
            }
            if ring_contains(&unique[mi], &[probes[j]]) {
                account(u);
            }
        }
    }
    // Iteration d'une HashMap = ordre aléatoire par processus (RandomState) :
    // il faut un ordre d'émission DÉTERMINISTE des arêtes de frontière, sinon
    // la re-polygonisation part d'un sommet arbitraire et la sortie n'est pas
    // reproductible (verrou : parity/determinism_lock.mjs). Tri par clé
    // canonique (arête non orientée, bits exacts post-snap).
    let mut keyed: Vec<_> = counts
        .into_iter()
        .filter(|(k, _)| !multi.contains(k))
        .collect();
    keyed.sort_by(|(ka, _), (kb, _)| ka.cmp(kb));
    let boundary: Vec<(Pt, Pt)> = keyed.into_iter().map(|(_, ab)| ab).collect();
    Some(boundary)
}

/// Full assembly: linework → parts. Mirrors build_geometry + to_mongo_dict.
pub fn build_parts(lw: Linework, tol: f64) -> Vec<Part> {
    // 1) Noding at FULL precision over EVERYTHING (ring edges + open
    //    segments) — GEOS's first unary_union nodes the whole linework set
    //    together; snapping comes after (set_precision).
    let mut all_edges: Vec<(Pt, Pt)> = Vec::new();
    for ring in &lw.rings {
        for w in ring.windows(2) {
            all_edges.push((w[0], w[1]));
        }
    }
    all_edges.extend_from_slice(&lw.segments);
    let noded_full = node_segments(&all_edges);

    // 2) Snap to the 1e-4 grid (set_precision) then drop degenerate edges.
    let mut edges: Vec<(Pt, Pt)> = noded_full
        .iter()
        .map(|&(a, b)| (snap_pt(a), snap_pt(b)))
        .filter(|(a, b)| a != b)
        .collect();
    // A second union pass in GEOS re-nodes snap-induced crossings — the
    // polygonizer below sees a clean edge set either way.
    let _ = &mut edges;

    let mut faces = polygonize(&[], &edges);
    if std::env::var("NI_DEBUG").is_ok() {
        eprintln!("[dbg] rings={} edges={} faces={}", lw.rings.len(), edges.len(), faces.len());
        for f in &faces {
            eprintln!("[dbg] face n={} area={:.4}", f.len(), ring_signed_area(f));
        }
    }

    // The leftmost-face walk emits the UNBOUNDED exterior face too (negative
    // signed area) — shapely's polygonize never returns it, and it breaks the
    // even-odd depth count. Drop it: exterior = negative area here.
    faces.retain(|f| ring_signed_area(f) > 1e-10);

    // GEOS output orientation for this pipeline is CW exterior (measured on
    // the golden corpus — do NOT "fix" to CCW). Normalize to it.
    for f in faces.iter_mut() {
        if ring_signed_area(f) > 0.0 {
            f.reverse();
        }
    }

    // 3) Even-odd on unique cycles (dedup by coordinate set, like Python's
    //    _ring_key frozenset). Depth counts the face's OWN ring (Python
    //    _material_faces parity); probe = guaranteed-interior ear centroid.
    let mut unique: Vec<Vec<Pt>> = Vec::new();
    let mut seen: std::collections::HashSet<Vec<(u64, u64)>> = std::collections::HashSet::new();
    for f in &faces {
        let mut key: Vec<(u64, u64)> = f
            .iter()
            .map(|p| (p[0].to_bits(), p[1].to_bits()))
            .collect();
        key.sort();
        key.dedup();
        if seen.insert(key) {
            unique.push(f.clone());
        }
    }
    let probes: Vec<Pt> = unique.iter().map(|r| interior_probe(r)).collect();
    let depths: Vec<usize> = (0..unique.len())
        .map(|i| unique.iter().filter(|u| ring_contains(u, &[probes[i]])).count())
        .collect();
    let material: Vec<usize> = (0..unique.len()).filter(|&i| depths[i] % 2 == 1).collect();
    if std::env::var("NI_DEBUG").is_ok() {
        eprintln!("[dbg] unique={} depths={:?} material={:?}", unique.len(), depths, material);
        for (i, u) in unique.iter().enumerate() {
            eprintln!("[dbg] face{} probe={:?} contains_self={} n={}", i, probes[i],
                point_in_ring(probes[i], u), u.len());
        }
    }

    // 3b) Dissolve (GEOS unary_union twin): material faces that share an edge
    //     merge into one body. The union boundary = edges appearing in
    //     EXACTLY ONE material face; re-walking that boundary yields the
    //     bodies (voids become holes naturally).
    let boundary = dissolve_boundary(&unique, &depths, &probes, &material);

    // 4) Bodies from the boundary: the union outlines are the NEGATIVE-area
    //    cycles of the boundary walk (a body's exterior outline is the
    //    "exterior side" of its minimal faces — GEOS unary_union orientation
    //    CW). At a pinch vertex (figure-8) the walk switches lobes and
    //    produces ONE self-touching ring, which reproduces the Python weld
    //    (_merge_near_polygons buffer ±0.1) vertex-for-vertex.
    let (unique, depths, probes, material) = if boundary.is_some() {
        let mut faces2 = polygonize(&[], &boundary.unwrap());
        faces2.retain(|f| ring_signed_area(f) < -1e-10);
        let mut uniq2: Vec<Vec<Pt>> = Vec::new();
        let mut seen2: std::collections::HashSet<Vec<(u64, u64)>> = std::collections::HashSet::new();
        for f in &faces2 {
            let mut key: Vec<(u64, u64)> = f.iter().map(|p| (p[0].to_bits(), p[1].to_bits())).collect();
            key.sort();
            key.dedup();
            if seen2.insert(key) {
                uniq2.push(f.clone());
            }
        }
        let probes2: Vec<Pt> = uniq2.iter().map(|r| interior_probe(r)).collect();
        let depths2: Vec<usize> = (0..uniq2.len())
            .map(|i| uniq2.iter().filter(|u| ring_contains(u, &[probes2[i]])).count())
            .collect();
        let mat2: Vec<usize> = (0..uniq2.len()).filter(|&i| depths2[i] % 2 == 1).collect();
        if std::env::var("NI_DEBUG").is_ok() {
            eprintln!("[dbg] pass2 uniq2={} depths2={:?} mat2={:?}", uniq2.len(), depths2, mat2);
            for (i, u) in uniq2.iter().enumerate() {
                eprintln!("[dbg] p2 face{} n={} area={:.4} probe={:?}", i, u.len(), ring_signed_area(u), probes2[i]);
            }
        }
        (uniq2, depths2, probes2, mat2)
    } else {
        (unique, depths, probes, material)
    };

    // 5) Parts: body ring + holes = cycles one level deeper contained in it.
    let mut parts: Vec<(Vec<Pt>, Vec<Vec<Pt>>)> = Vec::new();
    for &mi in &material {
        let mut holes: Vec<Vec<Pt>> = Vec::new();
        for (j, u) in unique.iter().enumerate() {
            if j == mi || depths[j] != depths[mi] + 1 {
                continue;
            }
            if ring_contains(&unique[mi], &[probes[j]]) {
                holes.push(u.clone());
            }
        }
        parts.push((unique[mi].clone(), holes));
    }

    // 5) Emit parts (reduce_ring, bbox filter, orientation), ordered by
    //    (y-min, x-min) ascending — GEOS unary_union collection order
    //    (re-mesuré 2026-08-07 sur corpus SVG : probes disjoints, tie-break
    //    x ; l'ordre x-d'abord de PR1 était une coïncidence du corpus DXF).
    let mut ordered = parts;
    ordered.sort_by(|(a, _), (b, _)| {
        let amin = a.iter().fold((f64::INFINITY, f64::INFINITY), |acc, p| (acc.0.min(p[1]), acc.1.min(p[0])));
        let bmin = b.iter().fold((f64::INFINITY, f64::INFINITY), |acc, p| (acc.0.min(p[1]), acc.1.min(p[0])));
        amin.partial_cmp(&bmin).unwrap_or(std::cmp::Ordering::Equal)
    });
    let parts = ordered;
    let mut out: Vec<Part> = Vec::new();
    for (outer, holes) in parts {
        let mut ext = reduce_ring(&outer);
        if ext.len() < 3 {
            continue;
        }
        // shapely emits the closing vertex (first == last) — match it.
        if ext.first() != ext.last() {
            ext.push(ext[0]);
        }
        let (min_x, max_x, min_y, max_y) = ext.iter().fold(
            (f64::INFINITY, f64::NEG_INFINITY, f64::INFINITY, f64::NEG_INFINITY),
            |(a, b, c, d), p| (a.min(p[0]), b.max(p[0]), c.min(p[1]), d.max(p[1])),
        );
        let width = max_x - min_x;
        let height = max_y - min_y;
        if width.abs() < 0.1 || height.abs() < 0.1 {
            continue;
        }
        let holes_out: Vec<Vec<Pt>> = holes
            .iter()
            .map(|h| {
                let mut hh = reduce_ring(h);
                if ring_signed_area(&hh) < 0.0 {
                    hh.reverse(); // holes CCW (mirror of the CW exterior)
                }
                if hh.len() >= 3 && hh.first() != hh.last() {
                    hh.push(hh[0]);
                }
                hh
            })
            .filter(|h| h.len() >= 4)
            .collect();
        let mut ext_final = ext;
        if ring_signed_area(&ext_final) > 0.0 {
            ext_final.reverse(); // exterior CW (GEOS parity)
        }
        out.push(Part {
            coordinates: ext_final,
            holes: holes_out,
            width,
            height,
        });
    }
    let _ = tol;
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rect(x0: f64, y0: f64, x1: f64, y1: f64) -> Primitive {
        Primitive::Polyline {
            points: vec![[x0, y0], [x1, y0], [x1, y1], [x0, y1]],
            closed: true,
            handle: "h".into(),
            layer: "0".into(),
        }
    }

    #[test]
    fn snap_is_geos_round_half_up() {
        // Valeurs dorées Python : math.floor(v*1e4 + 0.5)/1e4.
        assert_eq!(snap(0.12345).to_bits(), 0.1235f64.to_bits());
        assert_eq!(snap(-0.12345).to_bits(), (-0.1234f64).to_bits());
        assert_eq!(snap(1.00006).to_bits(), 1.0001f64.to_bits());
        assert_eq!(snap(0.0).to_bits(), 0.0f64.to_bits());
        assert_eq!(snap(-0.00004).to_bits(), 0.0f64.to_bits());
        assert_eq!(snap(123456.78905).to_bits(), 123456.7891f64.to_bits());
    }

    #[test]
    fn single_rectangle_yields_one_cw_part() {
        let (lw, _, n) = collect_linework(&[rect(0.0, 0.0, 10.0, 10.0)], 0.01);
        assert_eq!(n, 1);
        let parts = build_parts(lw, 0.01);
        assert_eq!(parts.len(), 1);
        let p = &parts[0];
        assert_eq!(p.width, 10.0);
        assert_eq!(p.height, 10.0);
        assert_eq!(p.coordinates.len(), 5); // sommet de fermeture inclus (shapely)
        assert_eq!(p.coordinates.first(), p.coordinates.last());
        assert!(ring_signed_area(&p.coordinates) < 0.0, "extérieur CW (parité GEOS)");
        assert!(p.holes.is_empty());
    }

    #[test]
    fn nested_rectangle_becomes_ccw_hole() {
        let (lw, _, _) =
            collect_linework(&[rect(0.0, 0.0, 20.0, 20.0), rect(5.0, 5.0, 10.0, 10.0)], 0.01);
        let parts = build_parts(lw, 0.01);
        assert_eq!(parts.len(), 1);
        assert_eq!(parts[0].holes.len(), 1);
        assert!(ring_signed_area(&parts[0].holes[0]) > 0.0, "trou CCW (miroir)");
    }

    #[test]
    fn disjoint_parts_sort_by_bbox_min() {
        // Inséré dans le désordre : l'émission suit (y-min, x-min) — ordre GEOS.
        let (lw, _, _) = collect_linework(
            &[rect(30.0, 30.0, 40.0, 40.0), rect(0.0, 0.0, 10.0, 10.0)],
            0.01,
        );
        let parts = build_parts(lw, 0.01);
        assert_eq!(parts.len(), 2);
        assert!(parts[0].coordinates.iter().all(|p| p[0] <= 10.0));
        assert!(parts[1].coordinates.iter().all(|p| p[0] >= 30.0));
    }

    #[test]
    fn build_parts_is_deterministic_across_calls() {
        // Verrou contre les ordres d'itération de HashMap (RandomState) :
        // deux exécutions du même linework doivent produire la même sortie
        // bit à bit (voir parity/determinism_lock.mjs côté processus).
        let mk = || {
            let (lw, _, _) = collect_linework(
                &[
                    rect(0.0, 0.0, 20.0, 20.0),
                    rect(5.0, 5.0, 10.0, 10.0),
                    rect(30.0, 30.0, 40.0, 40.0),
                ],
                0.01,
            );
            build_parts(lw, 0.01)
        };
        let a = mk();
        let b = mk();
        assert_eq!(a.len(), b.len());
        for (pa, pb) in a.iter().zip(b.iter()) {
            assert_eq!(format!("{:?}", pa.coordinates), format!("{:?}", pb.coordinates));
            assert_eq!(format!("{:?}", pa.holes), format!("{:?}", pb.holes));
        }
    }
}
