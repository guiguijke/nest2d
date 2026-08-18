//! Writer DXF ASCII — sémantique `build_part` (main.py 208-320) :
//!  - entités SOURCE copiées par handle, groupées par fichier, ordre de
//!    placement préservé, transformées (rotate→translate→scale unité),
//!  - calques source chargés + BIN_BOUNDARY (5) + OUT_SHAPE (1),
//!  - $ACADVER AC1027 (mesuré : ezdxf.new() par défaut, J-071),
//!    $INSUNITS/$MEASUREMENT cohérents (units.rs), pleine précision.
//! Lisible par ezdxf ET par le dxf_parser de l'app (mêmes codes de groupes).

use crate::bbox;
use crate::transform::{Affine, Placement};
use nest_import::dxf::entities::{self, Entity};
use std::collections::HashMap;
use std::fmt::Write as _;

/// (scale from mm, $INSUNITS, $MEASUREMENT) — units.output_scale_and_headers.
pub fn output_scale_and_headers(output_unit: &str) -> (f64, i32, i32) {
    if output_unit == "inch" {
        (1.0 / 25.4, 1, 0)
    } else {
        (1.0, 4, 1)
    }
}

fn num(s: &mut String, code: i32, v: f64) {
    // Pleine précision, jamais arrondi (repr shortest, lisible par ezdxf/Python).
    let _ = writeln!(s, "{}\n{}", code, fmt_dxf(v));
}
fn grp(s: &mut String, code: i32, v: &str) {
    let _ = writeln!(s, "{}\n{}", code, v);
}
fn fmt_dxf(v: f64) -> String {
    // repr le plus court (Python float() round-trip identique).
    crate::pyfloat::py_str(v)
}

/// Émet une entité transformée. Retourne false si type non supporté
/// ou coordonnée non finie (dxf-viewer lève sur `nan`/`inf`).
fn write_entity(s: &mut String, e: &Entity, aff: &Affine, handle: &str) -> bool {
    match e {
        Entity::Line(l) => {
            let a = aff.apply(l.start);
            let b = aff.apply(l.end);
            if !finite_pt(a) || !finite_pt(b) {
                return false;
            }
            grp(s, 0, "LINE");
            common(s, &l.common, handle);
            grp(s, 100, "AcDbLine");
            num(s, 10, a[0]);
            num(s, 20, a[1]);
            num(s, 11, b[0]);
            num(s, 21, b[1]);
            true
        }
        Entity::LwPolyline(p) => {
            let pts: Vec<_> = p.points.iter().map(|pt| aff.apply(*pt)).collect();
            if pts.iter().any(|q| !finite_pt(*q)) {
                return false;
            }
            grp(s, 0, "LWPOLYLINE");
            common(s, &p.common, handle);
            grp(s, 100, "AcDbPolyline");
            num(s, 90, p.points.len() as f64);
            num(s, 70, if p.closed { 1.0 } else { 0.0 });
            for (i, q) in pts.iter().enumerate() {
                num(s, 10, q[0]);
                num(s, 20, q[1]);
                let b = p.bulges.get(i).copied().unwrap_or(0.0);
                if b != 0.0 {
                    num(s, 42, b);
                }
            }
            true
        }
        Entity::Polyline(p) => {
            grp(s, 0, "POLYLINE");
            common(s, &p.common, handle);
            num(s, 70, if p.closed { 1.0 } else { 0.0 });
            num(s, 66, 1.0);
            for pt in &p.points {
                let q = aff.apply(*pt);
                grp(s, 0, "VERTEX");
                num(s, 10, q[0]);
                num(s, 20, q[1]);
                num(s, 70, 0.0);
            }
            grp(s, 0, "SEQEND");
            true
        }
        Entity::Arc(a) => {
            let c = aff.apply(a.center);
            if !finite_pt(c) || !a.radius.is_finite() {
                return false;
            }
            grp(s, 0, "ARC");
            common(s, &a.common, handle);
            grp(s, 100, "AcDbCircle");
            num(s, 10, c[0]);
            num(s, 20, c[1]);
            num(s, 40, a.radius * aff.scale);
            num(s, 50, aff.rotate_deg(a.start_angle));
            num(s, 51, aff.rotate_deg(a.end_angle));
            true
        }
        Entity::Circle(c) => {
            let ce = aff.apply(c.center);
            if !finite_pt(ce) || !c.radius.is_finite() {
                return false;
            }
            grp(s, 0, "CIRCLE");
            common(s, &c.common, handle);
            grp(s, 100, "AcDbCircle");
            num(s, 10, ce[0]);
            num(s, 20, ce[1]);
            num(s, 40, c.radius * aff.scale);
            true
        }
        Entity::Ellipse(e) => {
            let ce = aff.apply(e.center);
            if !finite_pt(ce) {
                return false;
            }
            grp(s, 0, "ELLIPSE");
            common(s, &e.common, handle);
            grp(s, 100, "AcDbEllipse");
            // vecteur majeur tourné + scalé.
            let m0 = aff.apply([0.0, 0.0]);
            let m1 = aff.apply(e.major);
            num(s, 10, ce[0]);
            num(s, 20, ce[1]);
            num(s, 11, m1[0] - m0[0]);
            num(s, 21, m1[1] - m0[1]);
            num(s, 40, e.ratio);
            num(s, 41, e.start_param);
            num(s, 42, e.end_param);
            true
        }
        Entity::Spline(sp) => {
            grp(s, 0, "SPLINE");
            common(s, &sp.common, handle);
            grp(s, 100, "AcDbSpline");
            num(s, 70, 0.0);
            num(s, 71, sp.degree as f64);
            num(s, 72, sp.knots.len() as f64);
            num(s, 73, sp.control.len() as f64);
            for k in &sp.knots {
                num(s, 40, *k);
            }
            for c in &sp.control {
                let q = aff.apply(*c);
                num(s, 10, q[0]);
                num(s, 20, q[1]);
            }
            for (i, w) in sp.weights.iter().enumerate() {
                num(s, 41, *w);
                let _ = i;
            }
            true
        }
        Entity::Point(p) => {
            grp(s, 0, "POINT");
            common(s, &p.common, handle);
            grp(s, 100, "AcDbPoint");
            let q = aff.apply(p.at);
            num(s, 10, q[0]);
            num(s, 20, q[1]);
            true
        }
        _ => false,
    }
}

fn next_handle(n: &mut u64) -> String {
    *n += 1;
    format!("{n:X}")
}

fn common(s: &mut String, c: &entities::Common, handle: &str) {
    grp(s, 5, handle);
    grp(s, 100, "AcDbEntity");
    grp(s, 8, if c.layer.is_empty() { "0" } else { &c.layer });
    if c.color != 256 {
        num(s, 62, c.color as f64);
    }
}

fn finite_pt(p: [f64; 2]) -> bool {
    p[0].is_finite() && p[1].is_finite()
}

/// Sources : file_slug -> (entities, blocks). Construit le DXF de tôle.
pub fn build_part_dxf(
    sources: &HashMap<String, (Vec<Entity>, Vec<entities::Block>)>,
    transforms: &[Placement],
    add_out_shape: bool,
    space: f64,
    bin_width: Option<f64>,
    bin_height: Option<f64>,
    output_unit: &str,
) -> String {
    let (unit_scale, insunits, measurement) = output_scale_and_headers(output_unit);

    let mut body = String::new();
    let mut layers: Vec<(String, i32)> = Vec::new();
    let mut out_bbox: Option<[f64; 4]> = None;
    let mut hid = 0u64;

    // Group by file, preserve order.
    let mut by_file: Vec<(String, Vec<&Placement>)> = Vec::new();
    for t in transforms {
        if let Some(e) = by_file.iter_mut().find(|(s, _)| *s == t.file_slug) {
            e.1.push(t);
        } else {
            by_file.push((t.file_slug.clone(), vec![t]));
        }
    }

    for (slug, file_transforms) in &by_file {
        let (ents, blocks) = match sources.get(slug) {
            Some(v) => v,
            None => continue,
        };
        let by_handle: HashMap<&str, &Entity> =
            ents.iter().map(|e| (handle_of(e), e)).collect();
        for t in file_transforms {
            let aff = Affine::new(t.angle, t.x, t.y, unit_scale);
            for h in &t.handles {
                let e = match by_handle.get(h.as_str()) {
                    Some(e) => *e,
                    None => continue,
                };
                if !layers.iter().any(|(n, _)| *n == layer_of(e)) {
                    layers.push((layer_of(e), 7));
                }
                let hnd = next_handle(&mut hid);
                write_entity(&mut body, e, &aff, &hnd);
            }
            // OUT_SHAPE bbox (avant scale unité : on accumule en mm puis on
            // scale à l'émission).
            if let Some(bb) = bbox::entities_bbox(&collected(ents, &t.handles, &by_handle), blocks, &Affine::new(t.angle, t.x, t.y, 1.0))
            {
                out_bbox = Some(match out_bbox {
                    None => bb,
                    Some(mut o) => {
                        o[0] = o[0].min(bb[0]);
                        o[1] = o[1].min(bb[1]);
                        o[2] = o[2].max(bb[2]);
                        o[3] = o[3].max(bb[3]);
                        o
                    }
                });
            }
        }
    }

    // BIN_BOUNDARY.
    if let (Some(bw), Some(bh)) = (bin_width, bin_height) {
        if !layers.iter().any(|(n, _)| n == "BIN_BOUNDARY") {
            layers.push(("BIN_BOUNDARY".into(), 5));
        }
        grp(&mut body, 0, "LWPOLYLINE");
        grp(&mut body, 5, &next_handle(&mut hid));
        grp(&mut body, 100, "AcDbEntity");
        grp(&mut body, 8, "BIN_BOUNDARY");
        grp(&mut body, 100, "AcDbPolyline");
        num(&mut body, 90, 4.0);
        num(&mut body, 70, 1.0);
        for (x, y) in [(0.0, 0.0), (bw, 0.0), (bw, bh), (0.0, bh)] {
            num(&mut body, 10, x * unit_scale);
            num(&mut body, 20, y * unit_scale);
        }
    }

    // OUT_SHAPE.
    if add_out_shape {
        if let Some(bb) = out_bbox {
            if !layers.iter().any(|(n, _)| n == "OUT_SHAPE") {
                layers.push(("OUT_SHAPE".into(), 1));
            }
            let (x0, y0, x1, y1) = (
                (bb[0] - space) * unit_scale,
                (bb[1] - space) * unit_scale,
                (bb[2] + space) * unit_scale,
                (bb[3] + space) * unit_scale,
            );
            grp(&mut body, 0, "LWPOLYLINE");
            grp(&mut body, 5, &next_handle(&mut hid));
            grp(&mut body, 100, "AcDbEntity");
            grp(&mut body, 8, "OUT_SHAPE");
            grp(&mut body, 100, "AcDbPolyline");
            num(&mut body, 90, 4.0);
            num(&mut body, 70, 1.0);
            for (x, y) in [(x0, y0), (x1, y0), (x1, y1), (x0, y1)] {
                num(&mut body, 10, x);
                num(&mut body, 20, y);
            }
        }
    }

    // Assemble full document.
    let mut s = String::new();
    grp(&mut s, 0, "SECTION");
    grp(&mut s, 2, "HEADER");
    grp(&mut s, 9, "$ACADVER");
    grp(&mut s, 1, "AC1027");
    grp(&mut s, 9, "$INSUNITS");
    num(&mut s, 70, insunits as f64);
    grp(&mut s, 9, "$MEASUREMENT");
    num(&mut s, 70, measurement as f64);
    grp(&mut s, 0, "ENDSEC");

    grp(&mut s, 0, "SECTION");
    grp(&mut s, 2, "TABLES");
    grp(&mut s, 0, "TABLE");
    grp(&mut s, 2, "LAYER");
    for (name, color) in &layers {
        grp(&mut s, 0, "LAYER");
        grp(&mut s, 2, name);
        num(&mut s, 70, 0.0);
        num(&mut s, 62, *color as f64);
    }
    grp(&mut s, 0, "ENDTAB");
    grp(&mut s, 0, "ENDSEC");

    grp(&mut s, 0, "SECTION");
    grp(&mut s, 2, "ENTITIES");
    s.push_str(&body);
    grp(&mut s, 0, "ENDSEC");
    grp(&mut s, 0, "EOF");
    s
}

fn collected<'a>(
    ents: &'a [Entity],
    handles: &[String],
    by_handle: &HashMap<&'a str, &'a Entity>,
) -> Vec<Entity> {
    let _ = (ents,);
    handles
        .iter()
        .filter_map(|h| by_handle.get(h.as_str()).map(|e| (*e).clone()))
        .collect()
}

fn handle_of(e: &Entity) -> &str {
    use Entity::*;
    match e {
        Line(x) => &x.common.handle,
        LwPolyline(x) => &x.common.handle,
        Polyline(x) => &x.common.handle,
        Arc(x) => &x.common.handle,
        Circle(x) => &x.common.handle,
        Ellipse(x) => &x.common.handle,
        Spline(x) => &x.common.handle,
        Point(x) => &x.common.handle,
        Insert(x) => &x.common.handle,
        Unsupported(_) => "",
    }
}
fn layer_of(e: &Entity) -> String {
    use Entity::*;
    let l: &str = match e {
        Line(x) => x.common.layer.as_str(),
        LwPolyline(x) => x.common.layer.as_str(),
        Polyline(x) => x.common.layer.as_str(),
        Arc(x) => x.common.layer.as_str(),
        Circle(x) => x.common.layer.as_str(),
        Ellipse(x) => x.common.layer.as_str(),
        Spline(x) => x.common.layer.as_str(),
        Point(x) => x.common.layer.as_str(),
        Insert(x) => x.common.layer.as_str(),
        Unsupported(_) => "0",
    };
    if l.is_empty() { "0".into() } else { l.to_string() }
}
