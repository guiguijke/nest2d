//! Path segments — svgelements PathSegment twins: Line / QuadraticBezier /
//! CubicBezier / Arc, with their exact point() and length() algorithms
//! (prod = no scipy: cubic & non-circular arc use the recursive chord
//! bisector `segment_length`, min_depth 5, error 1e-12; quadratic uses the
//! closed form; circular arcs use |r·sweep|).

use super::matrix::Matrix;
use std::f64::consts::TAU;

pub const ERROR: f64 = 1e-12;
pub const MIN_DEPTH: usize = 5;

pub type Pt = [f64; 2];

fn sub(a: Pt, b: Pt) -> Pt {
    [a[0] - b[0], a[1] - b[1]]
}
fn abs(a: Pt) -> f64 {
    (a[0] * a[0] + a[1] * a[1]).sqrt()
}
fn dist(a: Pt, b: Pt) -> f64 {
    abs(sub(a, b))
}

#[derive(Debug, Clone)]
pub struct ArcSeg {
    pub start: Pt,
    pub end: Pt,
    pub center: Pt,
    /// Point at t=0 (center + rotated rx direction).
    pub prx: Pt,
    /// Point at t=tau/4.
    pub pry: Pt,
    pub sweep: f64,
}

impl ArcSeg {
    pub fn rx(&self) -> f64 {
        dist(self.center, self.prx)
    }
    pub fn ry(&self) -> f64 {
        dist(self.center, self.pry)
    }
    /// angle(center -> prx)
    pub fn rotation(&self) -> f64 {
        libm::atan2(self.prx[1] - self.center[1], self.prx[0] - self.center[0])
    }

    pub fn point_at_t(&self, t: f64) -> Pt {
        let rotation = self.rotation();
        let a = self.rx();
        let b = self.ry();
        let cos_rot = libm::cos(rotation);
        let sin_rot = libm::sin(rotation);
        let cos_t = libm::cos(t);
        let sin_t = libm::sin(t);
        [
            self.center[0] + a * cos_t * cos_rot - b * sin_t * sin_rot,
            self.center[1] + a * cos_t * sin_rot + b * sin_t * cos_rot,
        ]
    }

    fn angle_at_point(&self, p: Pt) -> f64 {
        libm::atan2(p[1] - self.center[1], p[0] - self.center[0])
    }

    fn point_at_angle(&self, angle: f64) -> Pt {
        let angle = angle - self.rotation();
        let a = self.rx();
        let b = self.ry();
        if a == b {
            return self.point_at_t(angle);
        }
        let t = quadrant_fixed_t(angle, a, b);
        self.point_at_t(t)
    }

    fn t_at_point(&self, p: Pt) -> f64 {
        let angle = self.angle_at_point(p) - self.rotation();
        quadrant_fixed_t(angle, self.rx(), self.ry())
    }

    pub fn start_t(&self) -> f64 {
        self.t_at_point(self.point_at_angle(self.angle_at_point(self.start)))
    }

    /// Arc.length() twin: exact |r·sweep| for (near-)circles, recursive
    /// chord bisection otherwise (scipy absent in prod).
    pub fn length(&self) -> f64 {
        if self.sweep == 0.0 {
            return 0.0;
        }
        if self.start == self.end && self.sweep == 0.0 {
            return 0.0;
        }
        let a = self.rx();
        let b = self.ry();
        if (a - b).abs() < ERROR {
            return (a * self.sweep).abs();
        }
        segment_length(&|t| self.point(t), 0.0, 1.0, None, None, ERROR, MIN_DEPTH, 0)
    }

    /// _points_numpy twin: t = start_t + sweep·pos, endpoints exact.
    pub fn point(&self, pos: f64) -> Pt {
        if self.start == self.end && self.sweep == 0.0 {
            return self.start;
        }
        if pos == 0.0 {
            return self.start;
        }
        if pos == 1.0 {
            return self.end;
        }
        self.point_at_t(self.start_t() + self.sweep * pos)
    }

    /// __imul__ twin: transform all five points, flip sweep on mirror.
    pub fn transform(&mut self, m: &Matrix) {
        self.start = m.apply(self.start);
        self.end = m.apply(self.end);
        self.center = m.apply(self.center);
        self.prx = m.apply(self.prx);
        self.pry = m.apply(self.pry);
        if m.determinant() < 0.0 {
            self.sweep = -self.sweep;
        }
    }

    /// d() twin: "A rx,ry rot_deg large,sweep end" with %G radii/rotation
    /// and %.12G endpoint — the string roundtrip IS the geometry.
    pub fn d_string(&self, current_point: Option<Pt>) -> String {
        let rx = super::pyfmt::fmt_g(self.rx(), 6);
        let ry = super::pyfmt::fmt_g(self.ry(), 6);
        let rot_deg = super::pyfmt::fmt_g(self.rotation() * 360.0 / TAU, 6);
        let large = (self.sweep.abs() > TAU / 2.0) as i32;
        let sweep = (self.sweep >= 0.0) as i32;
        let _ = current_point; // forme absolue uniquement (d(relative=False))
        format!(
            "A {},{} {} {},{} {},{}",
            rx,
            ry,
            rot_deg,
            large,
            sweep,
            super::pyfmt::fmt_g(self.end[0], 12),
            super::pyfmt::fmt_g(self.end[1], 12)
        )
    }

    /// _svg_parameterize twin (W3C impl notes, svgelements code path):
    /// endpoint parameterization → center form.
    pub fn from_svg(
        start: Pt,
        rx: f64,
        ry: f64,
        rotation_deg: f64,
        large_arc: bool,
        sweep_flag: bool,
        end: Pt,
    ) -> ArcSeg {
        let rotation = rotation_deg * (TAU / 360.0); // math.radians
        let mut rx = rx;
        let mut ry = ry;
        if start == end || rx == 0.0 || ry == 0.0 {
            return ArcSeg { start, end, center: start, prx: start, pry: start, sweep: 0.0 };
        }
        let cosr = libm::cos(rotation);
        let sinr = libm::sin(rotation);
        let dx = (start[0] - end[0]) / 2.0;
        let dy = (start[1] - end[1]) / 2.0;
        let x1p = cosr * dx + sinr * dy;
        let y1p = -sinr * dx + cosr * dy;
        let mut rx_sq = rx * rx;
        let mut ry_sq = ry * ry;
        let radius_check = (x1p * x1p) / rx_sq + (y1p * y1p) / ry_sq;
        if radius_check > 1.0 {
            let s = radius_check.sqrt();
            rx *= s;
            ry *= s;
            rx_sq = rx * rx;
            ry_sq = ry * ry;
        }
        let t1 = rx_sq * y1p * y1p;
        let t2 = ry_sq * x1p * x1p;
        let mut c = ((rx_sq * ry_sq - t1 - t2) / (t1 + t2)).abs().sqrt();
        if large_arc == sweep_flag {
            c = -c;
        }
        let cxp = c * rx * y1p / ry;
        let cyp = -c * ry * x1p / rx;
        let center = [
            (cosr * cxp - sinr * cyp) + ((start[0] + end[0]) / 2.0),
            (sinr * cxp + cosr * cyp) + ((start[1] + end[1]) / 2.0),
        ];
        let ux = (x1p - cxp) / rx;
        let uy = (y1p - cyp) / ry;
        let vx = (-x1p - cxp) / rx;
        let vy = (-y1p - cyp) / ry;
        let n = ((ux * ux + uy * uy) * (vx * vx + vy * vy)).sqrt();
        let p = ux * vx + uy * vy;
        let mut d = p / n;
        if d > 1.0 {
            d = 1.0;
        } else if d < -1.0 {
            d = -1.0;
        }
        let mut delta = libm::acos(d) * (360.0 / TAU); // degrees(acos(d))
        if ux * vy - uy * vx < 0.0 {
            delta = -delta;
        }
        // Python % 360 (floored), then sweep_flag adjust.
        delta = delta.rem_euclid(360.0);
        if !sweep_flag {
            delta -= 360.0;
        }
        let sweep = delta * (TAU / 360.0); // Angle.degrees(delta).as_radians

        // prx/pry: rotate matrix about center applied to (center+(rx,0)) /
        // (center+(0,ry)) — post_rotate(rotation, cx, cy) de svgelements.
        let mut rm = Matrix::identity();
        rm.post_rotate(rotation, center[0], center[1]);
        let prx = rm.apply([center[0] + rx, center[1]]);
        let pry = rm.apply([center[0], center[1] + ry]);
        ArcSeg { start, end, center, prx, pry, sweep }
    }
}

/// atan2(a·tan(angle), b) + quadrant fix (t_at_point/point_at_angle shared).
fn quadrant_fixed_t(angle: f64, a: f64, b: f64) -> f64 {
    let mut t = libm::atan2(a * libm::tan(angle), b);
    let tau_1_4 = TAU / 4.0;
    let tau_3_4 = 3.0 * tau_1_4;
    let am = angle.abs().rem_euclid(TAU); // Python abs(angle) % tau
    if am > tau_1_4 && am <= tau_3_4 {
        t += TAU / 2.0;
    }
    t
}

#[derive(Debug, Clone)]
pub enum Seg {
    Move { start: Option<Pt>, end: Pt },
    Line { start: Pt, end: Pt },
    Quad { start: Pt, control: Pt, end: Pt },
    Cubic { start: Pt, control1: Pt, control2: Pt, end: Pt },
    Arc(ArcSeg),
    Close { start: Pt, end: Pt },
}

impl Seg {
    /// Transform in place (segment __imul__ twins). Close inherits
    /// PathSegment's (start/end) — same as Line.
    pub fn transform(&mut self, m: &Matrix) {
        match self {
            Seg::Move { start, end } => {
                if let Some(s) = start {
                    *s = m.apply(*s);
                }
                *end = m.apply(*end);
            }
            Seg::Line { start, end } | Seg::Close { start, end } => {
                *start = m.apply(*start);
                *end = m.apply(*end);
            }
            Seg::Quad { start, control, end } => {
                *start = m.apply(*start);
                *control = m.apply(*control);
                *end = m.apply(*end);
            }
            Seg::Cubic { start, control1, control2, end } => {
                *start = m.apply(*start);
                *control1 = m.apply(*control1);
                *control2 = m.apply(*control2);
                *end = m.apply(*end);
            }
            Seg::Arc(a) => a.transform(m),
        }
    }

    /// point(t) twins (npoint single-position forms).
    pub fn point(&self, t: f64) -> Pt {
        match self {
            // np.interp: slope=(e-s)/1.0 ; result = s + slope*(t-0.0)
            Seg::Line { start, end } | Seg::Close { start, end } => {
                let sx = end[0] - start[0];
                let sy = end[1] - start[1];
                [start[0] + sx * t, start[1] + sy * t]
            }
            Seg::Quad { start, control, end } => {
                let n = 1.0 - t;
                let t2 = t * t;
                let n2 = n * n;
                let nt = n * t;
                [
                    n2 * start[0] + 2.0 * nt * control[0] + t2 * end[0],
                    n2 * start[1] + 2.0 * nt * control[1] + t2 * end[1],
                ]
            }
            Seg::Cubic { start, control1, control2, end } => {
                let t3 = t * t * t;
                let n = 1.0 - t;
                let n3 = n * n * n;
                let t2n = t * t * n;
                let n2t = n * n * t;
                [
                    n3 * start[0] + 3.0 * (n2t * control1[0] + t2n * control2[0]) + t3 * end[0],
                    n3 * start[1] + 3.0 * (n2t * control1[1] + t2n * control2[1]) + t3 * end[1],
                ]
            }
            Seg::Arc(a) => a.point(t),
            Seg::Move { end, .. } => *end,
        }
    }

    /// length() twins (see module docs).
    pub fn length(&self) -> f64 {
        match self {
            Seg::Line { start, end } | Seg::Close { start, end } => dist(*start, *end),
            Seg::Move { .. } => 0.0,
            Seg::Quad { start, control, end } => quad_length(*start, *control, *end),
            Seg::Cubic { .. } => {
                segment_length(&|t| self.point(t), 0.0, 1.0, None, None, ERROR, MIN_DEPTH, 0)
            }
            Seg::Arc(a) => a.length(),
        }
    }
}

/// QuadraticBezier.length twin (malczak closed form + fallbacks).
fn quad_length(start: Pt, control: Pt, end: Pt) -> f64 {
    let a = [start[0] - 2.0 * control[0] + end[0], start[1] - 2.0 * control[1] + end[1]];
    let b = [2.0 * (control[0] - start[0]), 2.0 * (control[1] - start[1])];
    let big_a = 4.0 * (a[0] * a[0] + a[1] * a[1]);
    let big_b = 4.0 * (a[0] * b[0] + a[1] * b[1]);
    let big_c = b[0] * b[0] + b[1] * b[1];
    let a2 = big_a.sqrt();
    // Python: ZeroDivisionError/ValueError → fallback.
    if a2 == 0.0 {
        return quad_length_fallback(a, b);
    }
    let sabc = 2.0 * (big_a + big_b + big_c).sqrt();
    let a32 = 2.0 * big_a * a2;
    let c2 = 2.0 * big_c.sqrt();
    let ba = big_b / a2;
    let num = 2.0 * a2 + ba + sabc;
    let den = ba + c2;
    if den == 0.0 || num / den <= 0.0 {
        return quad_length_fallback(a, b);
    }
    (a32 * sabc + a2 * big_b * (sabc - c2) + (4.0 * big_c * big_a - big_b * big_b) * libm::log(num / den))
        / (4.0 * a32)
}

fn quad_length_fallback(a: Pt, b: Pt) -> f64 {
    let abs_a = abs(a);
    let abs_b = abs(b);
    if abs_a < 1e-10 {
        abs_b
    } else {
        let k = abs_b / abs_a;
        if k >= 2.0 {
            abs_b - abs_a
        } else {
            abs_a * (k * k / 2.0 - k + 1.0)
        }
    }
}

/// PathSegment.segment_length twin: recursive chord bisection; subdivides
/// while (poly2chord improvement > error) OR depth < min_depth.
#[allow(clippy::too_many_arguments)]
pub fn segment_length(
    point: &dyn Fn(f64) -> Pt,
    start: f64,
    end: f64,
    start_point: Option<Pt>,
    end_point: Option<Pt>,
    error: f64,
    min_depth: usize,
    depth: usize,
) -> f64 {
    let sp = start_point.unwrap_or_else(|| point(start));
    let ep = end_point.unwrap_or_else(|| point(end));
    let mid = (start + end) / 2.0;
    let mid_point = point(mid);
    let length = dist(ep, sp);
    let first_half = dist(mid_point, sp);
    let second_half = dist(ep, mid_point);
    let length2 = first_half + second_half;
    if (length2 - length > error) || (depth < min_depth) {
        return segment_length(point, start, mid, Some(sp), Some(mid_point), error, min_depth, depth + 1)
            + segment_length(point, mid, end, Some(mid_point), Some(ep), error, min_depth, depth + 1);
    }
    length2
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cubic_length_golden() {
        // Golden Python : CubicBezier((0,0),(10,20),(30,-5),(40,10)).length()
        // avec scipy ABSENT (segment_length récursif — chemin prod).
        let c = Seg::Cubic {
            start: [0.0, 0.0],
            control1: [10.0, 20.0],
            control2: [30.0, -5.0],
            end: [40.0, 10.0],
        };
        let l = c.length();
        assert!((l - 45.548189935821824).abs() < 1e-9, "len={l}");
    }

    #[test]
    fn quad_length_golden() {
        let q = Seg::Quad { start: [0.0, 0.0], control: [15.0, 25.0], end: [40.0, 10.0] };
        let l = q.length();
        assert!((l - 47.32474144878197).abs() < 1e-9, "len={l}");
    }

    #[test]
    fn arc_circle_length_exact() {
        // Quart de cercle r=10 : |r·sweep| = 10·tau/4.
        let a = ArcSeg {
            start: [10.0, 0.0],
            end: [0.0, 10.0],
            center: [0.0, 0.0],
            prx: [10.0, 0.0],
            pry: [0.0, 10.0],
            sweep: TAU / 4.0,
        };
        assert_eq!(a.length(), 10.0 * TAU / 4.0);
    }

    #[test]
    fn arc_svg_parameterize_and_back() {
        // A 20,20 0 0,1 de (0,0) à (30,40) — golden svgelements :
        // demi-cercle (sweep = pi), centre (15, 20), point(0.5) = (35, 5).
        let a = ArcSeg::from_svg([0.0, 0.0], 20.0, 20.0, 0.0, false, true, [30.0, 40.0]);
        assert!((a.sweep - std::f64::consts::PI).abs() < 1e-12, "sweep={}", a.sweep);
        assert!((a.center[0] - 15.0).abs() < 1e-9 && (a.center[1] - 20.0).abs() < 1e-9);
        let p = a.point(0.5);
        assert!((p[0] - 35.0).abs() < 1e-9 && (p[1] - 5.0).abs() < 1e-9, "p={p:?}");
    }
}
