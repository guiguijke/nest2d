//! Bounding box des entités placés — pour OUT_SHAPE (build_part).
//! Les courbes sont échantillonnées denses SUR la courbe (jamais à
//! l'extérieur), donc la bbox Rust sous-estime la bbox vraie d'ezdxf de
//! < sagitta(N) (~1e-3 mm ici) ; le comparateur DXF tolère 1e-2 mm sur
//! OUT_SHAPE (J-070). Les sommets droits sont exacts.

use crate::transform::Affine;
use nest_import::dxf::entities::{self, Entity};

pub type BBox = [f64; 4]; // minx, miny, maxx, maxy

fn add(b: &mut Option<BBox>, p: [f64; 2]) {
    *b = Some(match *b {
        None => [p[0], p[1], p[0], p[1]],
        Some(mut o) => {
            o[0] = o[0].min(p[0]);
            o[1] = o[1].min(p[1]);
            o[2] = o[2].max(p[0]);
            o[3] = o[3].max(p[1]);
            o
        }
    });
}

const CURVE_N: usize = 512;

/// Points extrêmes source-space d'une entité (échantillonnage dense).
fn entity_extrema(e: &Entity) -> Vec<[f64; 2]> {
    let mut v: Vec<[f64; 2]> = Vec::new();
    match e {
        Entity::Line(l) => {
            v.push(l.start);
            v.push(l.end);
        }
        Entity::Point(p) => v.push(p.at),
        Entity::LwPolyline(p) => {
            let n = p.points.len();
            let count = if p.closed { n } else { n - 1 };
            for i in 0..count {
                let a = p.points[i];
                let b = p.points[(i + 1) % n];
                let bulge = p.bulges.get(i).copied().unwrap_or(0.0);
                v.push(a);
                if bulge.abs() > 1e-12 {
                    sample_bulge(a, b, bulge, &mut v);
                }
            }
            if !p.closed {
                v.push(p.points[n - 1]);
            }
        }
        Entity::Polyline(p) => v.extend(p.points.iter().copied()),
        Entity::Circle(c) => {
            for i in 0..CURVE_N {
                let a = i as f64 / CURVE_N as f64 * 2.0 * std::f64::consts::PI;
                v.push([c.center[0] + c.radius * libm::cos(a), c.center[1] + c.radius * libm::sin(a)]);
            }
        }
        Entity::Arc(a) => {
            let (s, mut e) = (a.start_angle, a.end_angle);
            let mut e2 = e;
            if e2 <= s {
                e2 += 360.0;
            }
            let _ = e;
            for i in 0..=CURVE_N {
                let t = s + (e2 - s) * i as f64 / CURVE_N as f64;
                let rad = t * std::f64::consts::PI / 180.0;
                v.push([a.center[0] + a.radius * libm::cos(rad), a.center[1] + a.radius * libm::sin(rad)]);
            }
        }
        Entity::Ellipse(e) => {
            let a_mag = (e.major[0] * e.major[0] + e.major[1] * e.major[1]).sqrt();
            let b_mag = a_mag * e.ratio;
            let base = libm::atan2(e.major[1], e.major[0]);
            for i in 0..=CURVE_N {
                let t = e.start_param + (e.end_param - e.start_param) * i as f64 / CURVE_N as f64;
                let lx = a_mag * libm::cos(t);
                let ly = b_mag * libm::sin(t);
                v.push([
                    e.center[0] + lx * libm::cos(base) - ly * libm::sin(base),
                    e.center[1] + lx * libm::sin(base) + ly * libm::cos(base),
                ]);
            }
        }
        Entity::Spline(sp) => v.extend(sp.control.iter().copied()),
        _ => {}
    }
    v
}

fn sample_bulge(a: [f64; 2], b: [f64; 2], bulge: f64, out: &mut Vec<[f64; 2]>) {
    let theta = 4.0 * libm::atan(bulge);
    let dx = b[0] - a[0];
    let dy = b[1] - a[1];
    let d = (dx * dx + dy * dy).sqrt();
    if d < 1e-12 || theta.abs() < 1e-12 {
        return;
    }
    let r = d / (2.0 * libm::sin(theta / 2.0));
    let mx = (a[0] + b[0]) / 2.0;
    let my = (a[1] + b[1]) / 2.0;
    let s = bulge.signum();
    let cx = mx + dy / d * s * r * libm::cos(theta / 2.0);
    let cy = my - dx / d * s * r * libm::cos(theta / 2.0);
    let a0 = libm::atan2(a[1] - cy, a[0] - cx);
    for i in 1..128 {
        let t = a0 + theta * i as f64 / 128.0;
        out.push([cx + r * libm::cos(t), cy + r * libm::sin(t)]);
    }
}

/// BBox des entités SOURCE transformés par `aff` (chaque point extrême).
pub fn entities_bbox(
    entities: &[entities::Entity],
    _blocks: &[entities::Block],
    aff: &Affine,
) -> Option<BBox> {
    let mut bb: Option<BBox> = None;
    for e in entities {
        for p in entity_extrema(e) {
            add(&mut bb, aff.apply(p));
        }
    }
    bb
}
