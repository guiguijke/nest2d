//! Shape elements → path segments — svgelements Circle/Ellipse (_RoundShape),
//! Rect, SimpleLine, Polyline/Polygon (_Polyshape) twins, INCLUDING the
//! `Path(element.d())` string roundtrip (%.12G / %G formatting is geometry).

use super::matrix::Matrix;
use super::path::{parse_path, PathBuf};
use super::pyfmt::{fmt_g, fmt_length_str};
use super::segment::{ArcSeg, Seg};
use std::f64::consts::TAU;

type Pt = [f64; 2];

/// A parsed shape with its (cascaded) transform, pre-render.
pub enum Shape {
    Circle { cx: f64, cy: f64, rx: f64, ry: f64, transform: Matrix },
    Rect { x: f64, y: f64, width: f64, height: f64, rx: Option<f64>, ry: Option<f64>, transform: Matrix },
    Line { x1: f64, y1: f64, x2: f64, y2: f64, transform: Matrix },
    Poly { points: Vec<Pt>, polygon: bool, transform: Matrix },
}

impl Shape {
    /// segments(transformed=True) + Path(element.d()) roundtrip twin:
    /// returns the final PathBuf as svg_to_drawing sees it.
    pub fn to_path(self) -> PathBuf {
        match self {
            Shape::Line { x1, y1, x2, y2, transform } => {
                // SimpleLine.reify: parfait — les points sont transformés,
                // matrice identité ensuite. segments(): Move+Line.
                let p1 = transform.apply([x1, y1]);
                let p2 = transform.apply([x2, y2]);
                let d = format!(
                    "M {},{} L {},{}",
                    fmt_g(p1[0], 12),
                    fmt_g(p1[1], 12),
                    fmt_g(p2[0], 12),
                    fmt_g(p2[1], 12)
                );
                parse_path(&d)
            }
            Shape::Poly { points, polygon, transform } => {
                // _Polyshape.reify: parfait aussi.
                let pts: Vec<Pt> = if transform.is_identity() {
                    points
                } else {
                    points.iter().map(|&p| transform.apply(p)).collect()
                };
                if pts.is_empty() {
                    return PathBuf::default();
                }
                let mut d = format!("M {},{}", fmt_g(pts[0][0], 12), fmt_g(pts[0][1], 12));
                for p in &pts[1..] {
                    d.push_str(&format!(" L {},{}", fmt_g(p[0], 12), fmt_g(p[1], 12)));
                }
                if polygon {
                    d.push_str(" z");
                }
                parse_path(&d)
            }
            Shape::Circle { cx, cy, rx, ry, transform } => {
                let (cx, cy, rx, ry, transform) = reify_round(cx, cy, rx, ry, transform);
                if rx == 0.0 || ry == 0.0 {
                    return PathBuf::default();
                }
                // _RoundShape.segments: 4 arcs depuis point_at_t quadrants,
                // rotation 0 (forme SVG). Si la matrice restante n'est pas
                // identité, chaque segment la reçoit (s * transform).
                round_shape_path(cx, cy, rx, ry, &transform)
            }
            Shape::Rect { x, y, width, height, rx, ry, transform } => {
                let (x, y, width, height, rx, ry, transform) =
                    reify_rect(x, y, width, height, rx, ry, transform);
                if width == 0.0 || height == 0.0 {
                    return PathBuf::default();
                }
                rect_path(x, y, width, height, rx, ry, &transform)
            }
        }
    }
}

/// _RoundShape.reify twin: translate+scale absorbés si pas de skew/rotation
/// (value_skew = composantes b/c de la matrice) ni flip ; sinon la matrice
/// reste et s'appliquera aux segments dans d().
fn reify_round(cx: f64, cy: f64, rx: f64, ry: f64, m: Matrix) -> (f64, f64, f64, f64, Matrix) {
    let sx = m.value_scale_x();
    let sy = m.value_scale_y();
    if sx * sy < 0.0 {
        return (cx, cy, rx, ry, m);
    }
    if m.value_skew_x() == 0.0 && m.value_skew_y() == 0.0 && sx != 0.0 && sy != 0.0 {
        let tx = m.value_trans_x();
        let ty = m.value_trans_y();
        let mut transform = m;
        let cx = cx * sx + tx;
        let cy = cy * sy + ty;
        // self.transform *= Matrix.translate(-tx,-ty) puis *= scale(1/sx,1/sy)
        transform.post_cat(Matrix::parse(&format!("translate({}, {})", fmt_length_str(-tx), fmt_length_str(-ty))));
        let rx = sx * rx;
        let ry = sy * ry;
        transform.post_cat(Matrix::parse(&format!("scale({}, {})", fmt_length_str(1.0 / sx), fmt_length_str(1.0 / sy))));
        (cx, cy, rx, ry, transform)
    } else {
        (cx, cy, rx, ry, m)
    }
}

#[allow(clippy::too_many_arguments)]
fn reify_rect(
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    rx: Option<f64>,
    ry: Option<f64>,
    m: Matrix,
) -> (f64, f64, f64, f64, Option<f64>, Option<f64>, Matrix) {
    let sx = m.value_scale_x();
    let sy = m.value_scale_y();
    if sx * sy < 0.0 {
        return (x, y, width, height, rx, ry, m);
    }
    if m.value_skew_x() == 0.0 && m.value_skew_y() == 0.0 && sx != 0.0 && sy != 0.0 {
        let tx = m.value_trans_x();
        let ty = m.value_trans_y();
        let mut transform = m;
        let x = x * sx + tx;
        let y = y * sy + ty;
        transform.post_cat(Matrix::parse(&format!("translate({}, {})", fmt_length_str(-tx), fmt_length_str(-ty))));
        let rx = rx.map(|r| sx * r);
        let ry = ry.map(|r| sy * r);
        let width = sx * width;
        let height = sy * height;
        transform.post_cat(Matrix::parse(&format!("scale({}, {})", fmt_length_str(1.0 / sx), fmt_length_str(1.0 / sy))));
        (x, y, width, height, rx, ry, transform)
    } else {
        (x, y, width, height, rx, ry, m)
    }
}

/// point_at_t sur la forme réifiée (rotation 0).
fn point_at_t(cx: f64, cy: f64, a: f64, b: f64, t: f64) -> Pt {
    [cx + a * libm::cos(t), cy + b * libm::sin(t)]
}

fn arc_center_form(start: Pt, end: Pt, center: Pt, rx: f64, ry: f64, rotation: f64, sweep: f64) -> ArcSeg {
    // Arc(start, end, center, rx=, ry=, rotation=, sweep=) : prx/pry polaires.
    let prx = [center[0] + rx * libm::cos(rotation), center[1] + rx * libm::sin(rotation)];
    let pry = [
        center[0] + ry * libm::cos(rotation + TAU / 4.0),
        center[1] + ry * libm::sin(rotation + TAU / 4.0),
    ];
    ArcSeg { start, end, center, prx, pry, sweep }
}

/// _RoundShape.segments → Path → d() → reparse. La génération du d suit
/// Path.d() : "M x,y A rx,ry rot l,s x,y … z" avec les formats pyfmt.
fn round_shape_path(cx: f64, cy: f64, rx: f64, ry: f64, transform: &Matrix) -> PathBuf {
    let steps = 4;
    let mut step_size = TAU / steps as f64;
    if transform.value_scale_x() * transform.value_scale_y() < 0.0 {
        step_size = -step_size;
    }
    let mut segs: Vec<Seg> = Vec::new();
    let p0 = point_at_t(cx, cy, rx, ry, 0.0);
    segs.push(Seg::Move { start: None, end: p0 });
    let mut t_start = 0.0;
    for _ in 0..steps {
        let t_end = t_start + step_size;
        let s = point_at_t(cx, cy, rx, ry, t_start);
        let e = point_at_t(cx, cy, rx, ry, t_end);
        segs.push(Seg::Arc(arc_center_form(s, e, [cx, cy], rx, ry, 0.0, step_size)));
        t_start = t_end;
    }
    segs.push(Seg::Close { start: t_start_point(cx, cy, rx, ry, t_start), end: p0 });
    segments_via_d(segs, transform)
}

fn t_start_point(cx: f64, cy: f64, rx: f64, ry: f64, t: f64) -> Pt {
    point_at_t(cx, cy, rx, ry, t)
}

/// Rect.segments twin (rounded corners = centerless Arc form).
fn rect_path(
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    rx: Option<f64>,
    ry: Option<f64>,
    transform: &Matrix,
) -> PathBuf {
    let mut rx = rx.unwrap_or(0.0);
    let mut ry = ry.unwrap_or(0.0);
    // svgelements: rx<0 ou ry<0 (avec dims>0) → 0 ; un seul fourni → l'autre
    // suit (géré au property_by_values : absent → None → ici miroir SVG :
    // rx sans ry ⇒ ry=rx).
    match (rx > 0.0, ry > 0.0) {
        (true, false) => ry = rx,
        (false, true) => rx = ry,
        _ => {}
    }
    let mut segs: Vec<Seg> = Vec::new();
    if rx <= 0.0 || ry <= 0.0 {
        segs.push(Seg::Move { start: None, end: [x, y] });
        segs.push(Seg::Line { start: [x, y], end: [x + width, y] });
        segs.push(Seg::Line { start: [x + width, y], end: [x + width, y + height] });
        segs.push(Seg::Line { start: [x + width, y + height], end: [x, y + height] });
        segs.push(Seg::Close { start: [x, y + height], end: [x, y] });
    } else {
        // Cap des rayons (SVG 2.0 10.2 appliqué par svgelements ? — il ne
        // cape PAS : Rect.segments utilise rx/ry bruts. On réplique brut.)
        segs.push(Seg::Move { start: None, end: [x + rx, y] });
        segs.push(Seg::Line { start: [x + rx, y], end: [x + width - rx, y] });
        segs.push(Seg::Arc(rect_corner_arc([x + width - rx, y], [x + width, y + ry], rx, ry)));
        segs.push(Seg::Line { start: [x + width, y + ry], end: [x + width, y + height - ry] });
        segs.push(Seg::Arc(rect_corner_arc([x + width, y + height - ry], [x + width - rx, y + height], rx, ry)));
        segs.push(Seg::Line { start: [x + width - rx, y + height], end: [x + rx, y + height] });
        segs.push(Seg::Arc(rect_corner_arc([x + rx, y + height], [x, y + height - ry], rx, ry)));
        segs.push(Seg::Line { start: [x, y + height - ry], end: [x, y + ry] });
        segs.push(Seg::Arc(rect_corner_arc([x, y + ry], [x + rx, y], rx, ry)));
        segs.push(Seg::Close { start: [x + rx, y], end: [x + rx, y] });
    }
    segments_via_d(segs, transform)
}

/// Arc centerless des coins arrondis (branche kwargs rx/ry de Arc.__init__) :
/// sweep = tau/4, center = (start.x, end.y) sauf si orientation ≠ 1 →
/// (end.x, start.y) ; prx/pry = centre + (rx,0)/(0,ry) du RECT.
fn rect_corner_arc(start: Pt, end: Pt, rx: f64, ry: f64) -> ArcSeg {
    let sweep = TAU / 4.0;
    let mut center = [start[0], end[1]];
    // Point.orientation(start, center, end) == 1 → cw
    let val = (center[1] - start[1]) * (end[0] - center[0])
        - (center[0] - start[0]) * (end[1] - center[1]);
    let cw = val > 0.0;
    if !cw {
        center = [end[0], start[1]];
    }
    ArcSeg {
        start,
        end,
        center,
        prx: [center[0] + rx, center[1]],
        pry: [center[0], center[1] + ry],
        sweep,
    }
}

/// Sérialise les segments en d-string (formats svgelements) puis reparse —
/// LE roundtrip `Path(element.d())`, transform résiduel appliqué d'abord.
fn segments_via_d(segs: Vec<Seg>, transform: &Matrix) -> PathBuf {
    let mut segs = segs;
    if !transform.is_identity() {
        for s in segs.iter_mut() {
            s.transform(transform);
        }
    }
    let mut d = String::new();
    for s in &segs {
        match s {
            Seg::Move { end, .. } => {
                d.push_str(&format!("M {},{} ", fmt_g(end[0], 12), fmt_g(end[1], 12)))
            }
            Seg::Line { end, .. } => {
                d.push_str(&format!("L {},{} ", fmt_g(end[0], 12), fmt_g(end[1], 12)))
            }
            Seg::Quad { control, end, .. } => d.push_str(&format!(
                "Q {},{} {},{} ",
                fmt_g(control[0], 12),
                fmt_g(control[1], 12),
                fmt_g(end[0], 12),
                fmt_g(end[1], 12)
            )),
            Seg::Cubic { control1, control2, end, .. } => d.push_str(&format!(
                "C {},{} {},{} {},{} ",
                fmt_g(control1[0], 12),
                fmt_g(control1[1], 12),
                fmt_g(control2[0], 12),
                fmt_g(control2[1], 12),
                fmt_g(end[0], 12),
                fmt_g(end[1], 12)
            )),
            Seg::Arc(a) => {
                d.push_str(&a.d_string(None));
                d.push(' ');
            }
            Seg::Close { .. } => d.push_str("z "),
        }
    }
    parse_path(d.trim())
}
