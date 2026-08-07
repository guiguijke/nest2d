//! nest-report — réplique de workers/nesting/core/metrics.py (rapport de
//! nesting : comptabilité matière mesurée, offcut, verify_layout).
//! Dual-cible (natif + wasm). Parité valeurs contre goldens Python (J-072).

pub mod geom;
#[cfg(feature = "wasm")]
mod wasm;

use geom::Pt;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Item {
    pub id: String,
    pub coords: Vec<Pt>,
    #[serde(default)]
    pub holes: Vec<Vec<Pt>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Transform {
    pub item_id: String,
    pub angle: f64,
    pub x: f64,
    pub y: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Container {
    pub bin_width: f64,
    pub bin_height: f64,
    pub transforms: Vec<Transform>,
}

fn rotate_translate(ring: &[Pt], angle: f64, x: f64, y: f64) -> Vec<Pt> {
    let (c, s) = (libm::cos(angle), libm::sin(angle));
    ring.iter()
        .map(|p| [c * p[0] - s * p[1] + x, s * p[0] + c * p[1] + y])
        .collect()
}

fn placed(item: &Item, t: &Transform) -> (Vec<Pt>, Vec<Vec<Pt>>) {
    (
        rotate_translate(&item.coords, t.angle, t.x, t.y),
        item.holes
            .iter()
            .map(|h| rotate_translate(h, t.angle, t.x, t.y))
            .collect(),
    )
}

/// Arrondi décimal half-even comme Python `round(v, p)` (le formatage Rust
/// `{:.*}` est aussi half-even sur la représentation décimale du binaire).
fn round(v: f64, p: i32) -> f64 {
    format!("{:.*}", p as usize, v).parse::<f64>().unwrap_or(v)
}

/// per_sheet_metrics — comptabilité matière mesurée par tôle.
pub fn per_sheet_metrics(containers: &[Container], items: &[Item]) -> Vec<serde_json::Value> {
    let by_id: std::collections::HashMap<&str, &Item> =
        items.iter().map(|i| (i.id.as_str(), i)).collect();
    let mut sheets = Vec::new();
    for (index, c) in containers.iter().enumerate() {
        let sheet_area = c.bin_width * c.bin_height;
        let mut parts_area = 0.0;
        let mut part_count = 0;
        for t in &c.transforms {
            if let Some(item) = by_id.get(t.item_id.as_str()) {
                let (o, h) = placed(item, t);
                parts_area += geom::material_area(&o, &h);
                part_count += 1;
            }
        }
        let offcut = largest_empty_rectangle(&[c.clone()], items);
        sheets.push(serde_json::json!({
            "index": index,
            "widthMm": round(c.bin_width, 3),
            "heightMm": round(c.bin_height, 3),
            "sheetAreaMm2": round(sheet_area, 1),
            "partsAreaMm2": round(parts_area, 1),
            "freeAreaMm2": round((sheet_area - parts_area).max(0.0), 1),
            "densityPct": if sheet_area > 0.0 { Some(round(parts_area / sheet_area * 100.0, 1)) } else { None },
            "partCount": part_count,
            "offcut": enrich_offcut(offcut.as_ref()),
        }));
    }
    sheets
}

/// report_totals — totaux inter-tôles + formats distincts.
pub fn report_totals(sheets: &[serde_json::Value]) -> serde_json::Value {
    let sheet_area: f64 = sheets.iter().map(|s| s["sheetAreaMm2"].as_f64().unwrap_or(0.0)).sum();
    let parts_area: f64 = sheets.iter().map(|s| s["partsAreaMm2"].as_f64().unwrap_or(0.0)).sum();
    let mut formats: Vec<(f64, f64, i64)> = Vec::new();
    for s in sheets {
        let w = s["widthMm"].as_f64().unwrap_or(0.0);
        let h = s["heightMm"].as_f64().unwrap_or(0.0);
        if let Some(e) = formats.iter_mut().find(|e| e.0 == w && e.1 == h) {
            e.2 += 1;
        } else {
            formats.push((w, h, 1));
        }
    }
    formats.sort_by(|a, b| (b.0 * b.1).partial_cmp(&(a.0 * a.1)).unwrap());
    serde_json::json!({
        "sheetCount": sheets.len(),
        "formats": formats.iter().map(|(w, h, n)| serde_json::json!({"widthMm": w, "heightMm": h, "count": n})).collect::<Vec<_>>(),
        "sheetAreaMm2": round(sheet_area, 1),
        "partsAreaMm2": round(parts_area, 1),
        "freeAreaMm2": round((sheet_area - parts_area).max(0.0), 1),
        "densityPct": if sheet_area > 0.0 { Some(round(parts_area / sheet_area * 100.0, 1)) } else { None },
    })
}

/// compute_used_sheet_share.
pub fn compute_used_sheet_share(containers: &[Container], items: &[Item]) -> Option<f64> {
    let by_id: std::collections::HashMap<&str, &Item> =
        items.iter().map(|i| (i.id.as_str(), i)).collect();
    let mut bbox_total = 0.0;
    let mut sheet_total = 0.0;
    for c in containers {
        bbox_total += used_bbox_area(c, &by_id);
        sheet_total += c.bin_width * c.bin_height;
    }
    if sheet_total <= 0.0 {
        return None;
    }
    Some((bbox_total / sheet_total).min(1.0))
}

fn used_bbox_area(c: &Container, by_id: &std::collections::HashMap<&str, &Item>) -> f64 {
    let (mut x0, mut y0) = (f64::INFINITY, f64::INFINITY);
    let (mut x1, mut y1) = (f64::NEG_INFINITY, f64::NEG_INFINITY);
    let mut any = false;
    for t in &c.transforms {
        if let Some(item) = by_id.get(t.item_id.as_str()) {
            let (o, _h) = placed(item, t);
            let b = geom::ring_bounds(&o);
            x0 = x0.min(b[0]);
            y0 = y0.min(b[1]);
            x1 = x1.max(b[2]);
            y1 = y1.max(b[3]);
            any = true;
        }
    }
    if !any {
        return 0.0;
    }
    (x1 - x0) * (y1 - y0)
}

pub const OFFCUT_REUSABLE_MIN_MM: f64 = 100.0;
pub const EXACT_OFFCUT_MAX_PARTS: usize = 60;
pub const EXACT_OFFCUT_MAX_VERTICES: usize = 600;

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Offcut {
    pub width: f64,
    pub height: f64,
    pub area: f64,
}

pub fn enrich_offcut(o: Option<&Offcut>) -> serde_json::Value {
    match o {
        None => serde_json::Value::Null,
        Some(o) => serde_json::json!({
            "widthMm": round(o.width, 3),
            "heightMm": round(o.height, 3),
            "areaMm2": round(o.area, 1),
            "reusable": o.width.min(o.height) >= OFFCUT_REUSABLE_MIN_MM,
        }),
    }
}

fn band_offcut(
    containers: &[Container],
    by_id: &std::collections::HashMap<&str, &Item>,
) -> Option<Offcut> {
    let mut best: Option<Offcut> = None;
    for c in containers {
        let (sw, sh) = (c.bin_width, c.bin_height);
        if sw <= 0.0 || sh <= 0.0 || c.transforms.is_empty() {
            continue;
        }
        let (mut x0, mut y0) = (f64::INFINITY, f64::INFINITY);
        let (mut x1, mut y1) = (f64::NEG_INFINITY, f64::NEG_INFINITY);
        let mut any = false;
        for t in &c.transforms {
            if let Some(item) = by_id.get(t.item_id.as_str()) {
                let b = geom::ring_bounds(&placed(item, t).0);
                x0 = x0.min(b[0]);
                y0 = y0.min(b[1]);
                x1 = x1.max(b[2]);
                y1 = y1.max(b[3]);
                any = true;
            }
        }
        if !any {
            continue;
        }
        for (w, h) in [(sw - x1, sh), (sw, sh - y1), (sw, y0), (x0, sh)] {
            let area = w * h;
            if w > 0.0 && h > 0.0 && best.as_ref().map_or(true, |b| area > b.area) {
                best = Some(Offcut { width: w, height: h, area });
            }
        }
    }
    best
}

/// largest_empty_rectangle — scan exact (petits layouts) sinon band offcut.
pub fn largest_empty_rectangle(containers: &[Container], items: &[Item]) -> Option<Offcut> {
    let by_id: std::collections::HashMap<&str, &Item> =
        items.iter().map(|i| (i.id.as_str(), i)).collect();
    let mut total_parts = 0;
    let mut total_vertices = 0;
    for c in containers {
        total_parts += c.transforms.len();
        for t in &c.transforms {
            if let Some(item) = by_id.get(t.item_id.as_str()) {
                total_vertices +=
                    item.coords.len() + item.holes.iter().map(|h| h.len()).sum::<usize>();
            }
        }
    }
    if total_parts > EXACT_OFFCUT_MAX_PARTS || total_vertices > EXACT_OFFCUT_MAX_VERTICES {
        return band_offcut(containers, &by_id);
    }

    let mut best: Option<Offcut> = None;
    let mut bailed = false;
    for c in containers {
        let (sw, sh) = (c.bin_width, c.bin_height);
        if sw <= 0.0 || sh <= 0.0 {
            continue;
        }
        let mut placed_polys: Vec<Vec<Pt>> = Vec::new();
        for t in &c.transforms {
            if let Some(item) = by_id.get(t.item_id.as_str()) {
                placed_polys.push(placed(item, t).0);
            }
        }
        // Candidats xs/ys = sommets de l'espace LIBRE (sheet − placed), comme
        // Python qui lit les coordonnées des anneaux du polygone free.
        let (mut xs, mut ys) = free_space_vertices(sw, sh, &placed_polys);
        xs.push(0.0);
        xs.push(sw);
        ys.push(0.0);
        ys.push(sh);
        xs.sort_by(|a, b| a.partial_cmp(b).unwrap());
        xs.dedup();
        ys.sort_by(|a, b| a.partial_cmp(b).unwrap());
        ys.dedup();
        if xs.len() * ys.len() > 40_000 {
            bailed = true;
            break;
        }
        for i in 0..xs.len() {
            for j in (i + 1)..xs.len() {
                let (x1, x2) = (xs[i], xs[j]);
                if x2 - x1 <= 0.0 {
                    continue;
                }
                let mut blockers: Vec<(f64, f64)> = Vec::new();
                for poly in &placed_polys {
                    if geom::poly_intersects_rect(poly, x1, 0.0, x2, sh) {
                        let b = geom::ring_bounds(poly);
                        blockers.push((b[1], b[3]));
                    }
                }
                let span = if blockers.is_empty() {
                    sh
                } else {
                    blockers.sort_by(|a, b| a.partial_cmp(b).unwrap());
                    let mut merged: Vec<[f64; 2]> = vec![[blockers[0].0, blockers[0].1]];
                    for blk in &blockers[1..] {
                        let last = merged.len() - 1;
                        if blk.0 <= merged[last][1] {
                            merged[last][1] = merged[last][1].max(blk.1);
                        } else {
                            merged.push([blk.0, blk.1]);
                        }
                    }
                    let mut span = merged[0][0];
                    for k in 0..merged.len() - 1 {
                        span = span.max(merged[k + 1][0] - merged[k][1]);
                    }
                    span.max(sh - merged[merged.len() - 1][1])
                };
                let area = (x2 - x1) * span;
                if area > 0.0 && best.as_ref().map_or(true, |b| area > b.area) {
                    best = Some(Offcut { width: x2 - x1, height: span, area });
                }
            }
        }
    }
    if bailed {
        return band_offcut(containers, &by_id);
    }
    best
}

pub const VERIFY_MAX_PARTS_PER_SHEET: usize = 250;
pub const OVERLAP_EPS_MM2: f64 = 0.01;

/// verify_layout — validation physique mesurée.
pub fn verify_layout(containers: &[Container], items: &[Item], space: f64) -> serde_json::Value {
    let by_id: std::collections::HashMap<&str, &Item> =
        items.iter().map(|i| (i.id.as_str(), i)).collect();
    let mut smallest_gap = f64::INFINITY;
    let mut overlap_free = true;
    let mut pair_checks_done = true;
    let mut inside_sheet = true;
    let mut holes_filled = 0i64;
    let mut holes_total = 0i64;

    for c in containers {
        let (sw, sh) = (c.bin_width, c.bin_height);
        let mut placed_polys: Vec<(Vec<Pt>, Vec<Vec<Pt>>)> = Vec::new();
        for t in &c.transforms {
            if let Some(item) = by_id.get(t.item_id.as_str()) {
                placed_polys.push(placed(item, t));
            }
        }
        for (o, _h) in &placed_polys {
            let b = geom::ring_bounds(o);
            if b[0] < 0.0 || b[1] < 0.0 || b[2] > sw || b[3] > sh {
                inside_sheet = false;
            }
        }
        holes_total += placed_polys.iter().map(|(_o, h)| h.len() as i64).sum::<i64>();
        for (idx, (o, _h)) in placed_polys.iter().enumerate() {
            let cc = ring_centroid(o);
            for (host_idx, (_ho, hh)) in placed_polys.iter().enumerate() {
                if host_idx == idx {
                    continue;
                }
                if hh.iter().any(|hole| geom::point_in_ring(cc, hole)) {
                    holes_filled += 1;
                    break;
                }
            }
        }
        if placed_polys.len() > VERIFY_MAX_PARTS_PER_SHEET {
            pair_checks_done = false;
            continue;
        }
        let n = placed_polys.len();
        for i in 0..n {
            let gap_edge = ring_to_sheet_edge_dist(&placed_polys[i].0, sw, sh);
            if gap_edge < smallest_gap {
                smallest_gap = gap_edge;
            }
            for j in (i + 1)..n {
                let d = geom::ring_distance(&placed_polys[i].0, &placed_polys[j].0);
                if d < smallest_gap {
                    smallest_gap = d;
                }
                if d <= 0.0 && overlap_area(&placed_polys[i], &placed_polys[j]) > OVERLAP_EPS_MM2 {
                    overlap_free = false;
                }
            }
        }
    }

    let mut report = serde_json::json!({
        "smallestGapMm": serde_json::Value::Null,
        "overlapFree": serde_json::Value::Null,
        "insideSheet": inside_sheet,
        "spacingOk": serde_json::Value::Null,
        "holesFilled": holes_filled,
        "holesTotal": holes_total,
    });
    if pair_checks_done && smallest_gap != f64::INFINITY {
        report["smallestGapMm"] = serde_json::json!(round(smallest_gap, 3));
        report["overlapFree"] = serde_json::json!(overlap_free);
        report["spacingOk"] = serde_json::json!(smallest_gap >= (space - 0.01));
    }
    report
}

fn ring_centroid(ring: &[Pt]) -> Pt {
    let mut a = 0.0;
    let mut cx = 0.0;
    let mut cy = 0.0;
    for i in 0..ring.len() - 1 {
        let cr = ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
        a += cr;
        cx += (ring[i][0] + ring[i + 1][0]) * cr;
        cy += (ring[i][1] + ring[i + 1][1]) * cr;
    }
    a /= 2.0;
    if a.abs() < 1e-12 {
        return ring[0];
    }
    [cx / (6.0 * a), cy / (6.0 * a)]
}

fn ring_to_sheet_edge_dist(ring: &[Pt], sw: f64, sh: f64) -> f64 {
    let b = geom::ring_bounds(ring);
    b[0].min(b[1]).min(sw - b[2]).min(sh - b[3])
}

/// Sommets de l'espace libre (sheet − placed) via l'arrangement partagé
/// (nest_import::assemble) — jumeau de `sheet.difference(unary_union(placed))`.
fn free_space_vertices(sw: f64, sh: f64, placed_polys: &[Vec<Pt>]) -> (Vec<f64>, Vec<f64>) {
    use nest_import::assemble as ga;
    let mut edges: Vec<(Pt, Pt)> = Vec::new();
    let sheet = [[0.0, 0.0], [sw, 0.0], [sw, sh], [0.0, sh], [0.0, 0.0]];
    for w in sheet.windows(2) {
        edges.push((w[0], w[1]));
    }
    for poly in placed_polys {
        if poly.len() >= 2 {
            let closed = if poly.first() == poly.last() { poly.to_vec() } else {
                let mut p = poly.to_vec();
                p.push(poly[0]);
                p
            };
            for w in closed.windows(2) {
                edges.push((w[0], w[1]));
            }
        }
    }
    let noded = ga::node_segments(&edges);
    let faces = ga::polygonize(&[], &noded);
    let mut xs = Vec::new();
    let mut ys = Vec::new();
    for f in &faces {
        if ga::ring_signed_area(f) <= 1e-12 {
            continue;
        }
        let c = face_centroid(f);
        let in_placed = placed_polys.iter().any(|p| geom::point_in_ring(c, p));
        if in_placed {
            continue;
        }
        for p in f {
            xs.push(p[0]);
            ys.push(p[1]);
        }
    }
    (xs, ys)
}

fn face_centroid(ring: &[Pt]) -> Pt {
    let n = ring.len();
    let mut a = 0.0;
    let mut cx = 0.0;
    let mut cy = 0.0;
    for i in 0..n {
        let j = (i + 1) % n;
        let cr = ring[i][0] * ring[j][1] - ring[j][0] * ring[i][1];
        a += cr;
        cx += (ring[i][0] + ring[j][0]) * cr;
        cy += (ring[i][1] + ring[j][1]) * cr;
    }
    a /= 2.0;
    if a.abs() < 1e-12 {
        return ring[0];
    }
    [cx / (6.0 * a), cy / (6.0 * a)]
}

fn overlap_area(a: &(Vec<Pt>, Vec<Vec<Pt>>), b: &(Vec<Pt>, Vec<Vec<Pt>>)) -> f64 {
    if !geom::rings_overlap(&a.0, &b.0) {
        return 0.0;
    }
    let ba = geom::ring_bounds(&a.0);
    let bb = geom::ring_bounds(&b.0);
    let ix = (ba[2].min(bb[2]) - ba[0].max(bb[0])).max(0.0);
    let iy = (ba[3].min(bb[3]) - ba[1].max(bb[1])).max(0.0);
    ix * iy
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_matches_python() {
        // Goldens CPython round().
        assert_eq!(round(2.675, 2), 2.67); // Python round(2.675,2)=2.67 (float)
        assert_eq!(round(0.5, 0), 0.0); // half-even
        assert_eq!(round(1.5, 0), 2.0);
        assert_eq!(round(123.456, 1), 123.5);
        assert_eq!(round(41231.25, 1), 41231.2); // half-even au .1
        assert_eq!(round(2.5, 0), 2.0);
    }

    #[test]
    fn per_sheet_area_simple() {
        let items = vec![Item {
            id: "a".into(),
            coords: vec![[0.0, 0.0], [10.0, 0.0], [10.0, 10.0], [0.0, 10.0], [0.0, 0.0]],
            holes: vec![],
        }];
        let c = Container {
            bin_width: 100.0,
            bin_height: 100.0,
            transforms: vec![Transform { item_id: "a".into(), angle: 0.0, x: 0.0, y: 0.0 }],
        };
        let sheets = per_sheet_metrics(&[c], &items);
        assert_eq!(sheets[0]["partsAreaMm2"], serde_json::json!(100.0));
        assert_eq!(sheets[0]["densityPct"], serde_json::json!(1.0));
        assert_eq!(sheets[0]["partCount"], serde_json::json!(1));
    }

    #[test]
    fn used_share_and_totals() {
        let items = vec![Item {
            id: "a".into(),
            coords: vec![[0.0, 0.0], [10.0, 0.0], [10.0, 10.0], [0.0, 10.0], [0.0, 0.0]],
            holes: vec![],
        }];
        let c = Container {
            bin_width: 100.0,
            bin_height: 100.0,
            transforms: vec![Transform { item_id: "a".into(), angle: 0.0, x: 0.0, y: 0.0 }],
        };
        let share = compute_used_sheet_share(&[c.clone()], &items).unwrap();
        assert!((share - 0.01).abs() < 1e-9, "share={share}");
        let sheets = per_sheet_metrics(&[c], &items);
        let totals = report_totals(&sheets);
        assert_eq!(totals["sheetCount"], serde_json::json!(1));
    }
}
