//! Tessellation — exact replication of ezdxf's flattening (the Python
//! pipeline's convert_entity_to_shapely). Every formula is transcribed from
//! ezdxf 1.4.4; transcendentals go through `libm` (AGENTS #14b) so the
//! output is bit-identical on every target.

use std::f64::consts::{PI, TAU};

/// Primitives after INSERT resolution + unit scaling, before tessellation.
#[derive(Debug, Clone)]
pub enum Primitive {
    Line { start: [f64; 2], end: [f64; 2], handle: String, layer: String },
    Polyline { points: Vec<[f64; 2]>, closed: bool, handle: String, layer: String },
    Arc { center: [f64; 2], radius: f64, start_angle: f64, end_angle: f64, handle: String, layer: String },
    /// Kept distinct from Arc: the full-circle span is math.tau exactly
    /// (360*(π/180) may differ by 1 ulp), matching ezdxf's CIRCLE path.
    Circle { center: [f64; 2], radius: f64, handle: String, layer: String },
    Ellipse { center: [f64; 2], major: [f64; 2], ratio: f64, start_param: f64, end_param: f64, handle: String, layer: String },
    Spline { degree: i32, knots: Vec<f64>, control: Vec<[f64; 2]>, weights: Vec<f64>, handle: String, layer: String },
    Point { at: [f64; 2], handle: String, layer: String },
    Unsupported(String),
}

impl Primitive {
    pub fn scaled(&self, k: f64) -> Primitive {
        match self {
            Primitive::Line { start, end, handle, layer } => Primitive::Line {
                start: [start[0] * k, start[1] * k],
                end: [end[0] * k, end[1] * k],
                handle: handle.clone(),
                layer: layer.clone(),
            },
            Primitive::Polyline { points, closed, handle, layer } => Primitive::Polyline {
                points: points.iter().map(|p| [p[0] * k, p[1] * k]).collect(),
                closed: *closed,
                handle: handle.clone(),
                layer: layer.clone(),
            },
            Primitive::Arc { center, radius, start_angle, end_angle, handle, layer } => Primitive::Arc {
                center: [center[0] * k, center[1] * k],
                radius: radius * k,
                start_angle: *start_angle,
                end_angle: *end_angle,
                handle: handle.clone(),
                layer: layer.clone(),
            },
            Primitive::Circle { center, radius, handle, layer } => Primitive::Circle {
                center: [center[0] * k, center[1] * k],
                radius: radius * k,
                handle: handle.clone(),
                layer: layer.clone(),
            },
            Primitive::Ellipse { center, major, ratio, start_param, end_param, handle, layer } => Primitive::Ellipse {
                center: [center[0] * k, center[1] * k],
                major: [major[0] * k, major[1] * k],
                ratio: *ratio,
                start_param: *start_param,
                end_param: *end_param,
                handle: handle.clone(),
                layer: layer.clone(),
            },
            Primitive::Spline { degree, knots, control, weights, handle, layer } => Primitive::Spline {
                degree: *degree,
                knots: knots.clone(),
                control: control.iter().map(|p| [p[0] * k, p[1] * k]).collect(),
                weights: weights.clone(),
                handle: handle.clone(),
                layer: layer.clone(),
            },
            Primitive::Point { at, handle, layer } => Primitive::Point {
                at: [at[0] * k, at[1] * k],
                handle: handle.clone(),
                layer: layer.clone(),
            },
            Primitive::Unsupported(k) => Primitive::Unsupported(k.clone()),
        }
    }

    pub fn handle(&self) -> &str {
        match self {
            Primitive::Line { handle, .. } => handle,
            Primitive::Polyline { handle, .. } => handle,
            Primitive::Arc { handle, .. } => handle,
            Primitive::Circle { handle, .. } => handle,
            Primitive::Ellipse { handle, .. } => handle,
            Primitive::Spline { handle, .. } => handle,
            Primitive::Point { handle, .. } => handle,
            Primitive::Unsupported(_) => "",
        }
    }
}

/// Python math.isclose default (rel_tol=1e-9, abs_tol=0).
fn isclose(a: f64, b: f64) -> bool {
    (a - b).abs() <= 1e-9 * a.abs().max(b.abs())
}

/// Python floored modulo for positive divisor (Python `%` semantics).
fn py_mod(x: f64, m: f64) -> f64 {
    x.rem_euclid(m)
}

/// numpy linspace(start, stop, num, endpoint=True):
/// y[i] = i * ((stop-start)/(num-1)) + start, y[num-1] = stop.
fn linspace(start: f64, stop: f64, num: usize) -> Vec<f64> {
    if num == 0 {
        return Vec::new();
    }
    if num == 1 {
        return vec![start];
    }
    let div = (num - 1) as f64;
    let step = (stop - start) / div;
    let mut y: Vec<f64> = (0..num).map(|i| i as f64 * step + start).collect();
    y[num - 1] = stop;
    y
}

/// ezdxf arc_chord_length: 2*sqrt(2*r*s - s²), 0 on domain error.
fn arc_chord_length(radius: f64, sagitta: f64) -> f64 {
    let v = 2.0 * radius * sagitta - sagitta * sagitta;
    if v < 0.0 { 0.0 } else { 2.0 * v.sqrt() }
}

/// ezdxf arc_segment_count: ceil(span_rad / alpha), alpha = 2*asin(chord/2r).
fn arc_segment_count(radius: f64, angle_rad: f64, sagitta: f64) -> usize {
    let chord = arc_chord_length(radius, sagitta);
    let x = chord / 2.0 / radius;
    if x > 1.0 || radius == 0.0 {
        return 1;
    }
    let alpha = libm::asin(x) * 2.0;
    ((angle_rad / alpha).ceil() as i64).max(1) as usize
}

/// math.radians = deg * (π/180) (single multiplication by the f64 constant).
fn radians(deg: f64) -> f64 {
    deg * (PI / 180.0)
}

fn arc_vertex(center: [f64; 2], radius: f64, angle_deg: f64) -> [f64; 2] {
    let a = radians(angle_deg);
    [
        center[0] + libm::cos(a) * radius,
        center[1] + libm::sin(a) * radius,
    ]
}

/// Point-to-line distance (ezdxf distance_point_line_3d via Pythagoras).
/// Returns None when start == end (ZeroDivisionError twin → caller treats as 0).
fn distance_point_line(p: [f64; 2], s: [f64; 2], e: [f64; 2]) -> Option<f64> {
    if s == e {
        return None;
    }
    let v1 = [p[0] - s[0], p[1] - s[1]];
    let se = [e[0] - s[0], e[1] - s[1]];
    let dot = se[0] * v1[0] + se[1] * v1[1];
    let mag2 = se[0] * se[0] + se[1] * se[1];
    let proj = [se[0] * (dot / mag2), se[1] * (dot / mag2)];
    let diff = (v1[0] * v1[0] + v1[1] * v1[1]) - (proj[0] * proj[0] + proj[1] * proj[1]);
    Some(if diff <= 0.0 { 0.0 } else { diff.sqrt() })
}

/// Tessellate one primitive into a polyline vertex list (empty = dropped),
/// the convert_entity_to_shapely twin. `tol` is the caller's flattening
/// tolerance (clamped ≥ 0.001 like Python).
pub fn flatten_primitive(p: &Primitive, tol: f64) -> Vec<[f64; 2]> {
    let tol = tol.max(0.001);
    match p {
        Primitive::Line { start, end, .. } => vec![*start, *end],
        Primitive::Polyline { points, closed, .. } => {
            let mut pts = points.clone();
            if *closed && !pts.is_empty() {
                pts.push(pts[0]);
            }
            pts
        }
        Primitive::Point { at, .. } => vec![*at],
        Primitive::Circle { center, radius, .. } => {
            // ezdxf CIRCLE: count over math.tau, linspace(0, 360, count+1).
            let count = arc_segment_count(radius.abs(), TAU, tol);
            linspace(0.0, 360.0, count + 1)
                .iter()
                .map(|&a| arc_vertex(*center, *radius, a))
                .collect()
        }
        Primitive::Arc { center, radius, start_angle, end_angle, .. } => {
            if *radius < tol {
                return Vec::new();
            }
            let mut start = *start_angle;
            let mut stop = *end_angle;
            if isclose(start, stop) {
                return Vec::new();
            }
            start = py_mod(start, 360.0);
            stop = py_mod(stop, 360.0);
            if stop <= start {
                stop += 360.0;
            }
            let span = radians(stop - start);
            let count = arc_segment_count(radius.abs(), span, tol);
            linspace(start, stop, count + 1)
                .iter()
                .map(|&a| arc_vertex(*center, *radius, a))
                .collect()
        }
        Primitive::Ellipse { center, major, ratio, start_param, end_param, .. } => {
            flatten_ellipse(*center, *major, *ratio, *start_param, *end_param, tol)
        }
        Primitive::Spline { degree, knots, control, weights, .. } => {
            flatten_spline(*degree, knots, control, weights, tol)
        }
        Primitive::Unsupported(_) => Vec::new(),
    }
}

/// ezdxf ConstructionEllipse.flattening: adaptive recursive subdivision,
/// min `segments` spans across the param range.
fn flatten_ellipse(
    center: [f64; 2],
    major: [f64; 2],
    ratio: f64,
    start_param: f64,
    end_param: f64,
    distance: f64,
) -> Vec<[f64; 2]> {
    const SEGMENTS: f64 = 8.0;

    let major_mag = (major[0] * major[0] + major[1] * major[1]).sqrt();
    if major_mag == 0.0 {
        return Vec::new();
    }
    let x_axis = [major[0] / major_mag, major[1] / major_mag];
    // minor axis = extrusion(+Z) × major, scaled to major_mag*ratio
    let minor_dir = [-x_axis[1], x_axis[0]];
    let radius_y = major_mag * ratio;
    let y_axis = minor_dir;

    let vertex = |p: f64| -> [f64; 2] {
        let x = libm::cos(p) * major_mag;
        let y = libm::sin(p) * radius_y;
        [
            center[0] + x * x_axis[0] + y * y_axis[0],
            center[1] + x * x_axis[1] + y * y_axis[1],
        ]
    };

    // arc_angle_span_rad(start, end), RAD_ABS_TOL = 1e-15 — faithful
    // transcription of ezdxf _construct.py (isclose: rel 1e-9, abs 1e-15).
    let span = {
        let isclose_abs = |a: f64, b: f64| (a - b).abs() <= (1e-9 * a.abs().max(b.abs())).max(1e-15);
        if isclose_abs(start_param, end_param) {
            0.0
        } else {
            let s = py_mod(start_param, TAU);
            if isclose_abs(s, py_mod(end_param, TAU)) {
                TAU
            } else {
                let mut e = end_param;
                if !isclose_abs(e, TAU) {
                    e = py_mod(e, TAU);
                }
                if e < s {
                    e += TAU;
                }
                e - s
            }
        }
    };
    let delta = span / SEGMENTS;
    if delta == 0.0 {
        return Vec::new();
    }

    let mut param = py_mod(start_param, TAU);
    let mut end = if isclose(end_param, TAU) { TAU } else { py_mod(end_param, TAU) };
    if isclose(param, end) {
        return Vec::new();
    }
    if param > end {
        end += TAU;
    }

    fn subdiv(
        out: &mut Vec<[f64; 2]>,
        vertex: &dyn Fn(f64) -> [f64; 2],
        s: [f64; 2],
        e: [f64; 2],
        s_param: f64,
        e_param: f64,
        distance: f64,
    ) {
        let m_param = (s_param + e_param) * 0.5;
        let m = vertex(m_param);
        let d = distance_point_line(m, s, e).unwrap_or(0.0);
        if d < distance {
            out.push(e);
        } else {
            subdiv(out, vertex, s, m, s_param, m_param, distance);
            subdiv(out, vertex, m, e, m_param, e_param, distance);
        }
    }

    let mut out = Vec::new();
    let mut start_point = vertex(param);
    out.push(start_point);
    while param < end {
        let mut next_end = param + delta;
        if isclose(next_end, end) {
            next_end = end;
        }
        let end_point = vertex(next_end);
        subdiv(&mut out, &vertex, start_point, end_point, param, next_end, distance);
        param = next_end;
        start_point = end_point;
    }
    out
}

/// NURBS basis functions (The NURBS Book A2.2, ezdxf _bspline.Basis twin).
struct Basis {
    knots: Vec<f64>,
    order: usize, // degree + 1
}

impl Basis {
    fn find_span(&self, u: f64) -> usize {
        let knots = &self.knots;
        let count = self.control_count_expected();
        if u >= knots[count] {
            return count - 1;
        }
        let p = self.order - 1;
        if knots[p] == 0.0 {
            // bisect_right(knots, u, p, count) - 1
            let mut lo = p;
            let mut hi = count;
            while lo < hi {
                let mid = (lo + hi) / 2;
                if u < knots[mid] {
                    hi = mid;
                } else {
                    lo = mid + 1;
                }
            }
            lo - 1
        } else {
            let mut span = 0usize;
            while span < count && knots[span] <= u {
                span += 1;
            }
            span - 1
        }
    }

    fn control_count_expected(&self) -> usize {
        self.knots.len() - self.order
    }

    fn basis_funcs(&self, span: usize, u: f64) -> Vec<f64> {
        let order = self.order;
        let knots = &self.knots;
        let mut n = vec![0.0; order];
        let mut left = vec![0.0; order];
        let mut right = vec![0.0; order];
        n[0] = 1.0;
        for j in 1..order {
            let idx = span as i64 + 1 - j as i64;
            left[j] = u - knots[idx.max(0) as usize];
            right[j] = knots[span + j] - u;
            let mut saved = 0.0;
            for r in 0..j {
                let temp = n[r] / (right[r + 1] + left[j - r]);
                n[r] = saved + right[r + 1] * temp;
                saved = left[j - r] * temp;
            }
            n[j] = saved;
        }
        n
    }
}

/// ezdxf BSpline.flattening: adaptive subdivision between unique knots,
/// min `segments` spans per knot interval.
fn flatten_spline(
    degree: i32,
    knots: &[f64],
    control: &[[f64; 2]],
    weights: &[f64],
    distance: f64,
) -> Vec<[f64; 2]> {
    const SEGMENTS: usize = 4;
    if control.is_empty() || knots.len() < 2 {
        return Vec::new();
    }
    let order = (degree + 1) as usize;
    let basis = Basis {
        knots: knots.to_vec(),
        order,
    };
    let rational = !weights.is_empty() && weights.len() >= control.len();

    let point = |u: f64| -> [f64; 2] {
        // Evaluator.point: clamp u≈max_t; span; basis; weighted sum.
        let max_t = knots[knots.len() - 1];
        let u = if isclose(u, max_t) { max_t } else { u };
        let span = basis.find_span(u);
        let mut n = basis.basis_funcs(span, u);
        if rational {
            // span_weighting: weights of the active control points.
            let p = order - 1;
            let start = span as i64 - p as i64;
            let mut products = Vec::with_capacity(order);
            for (i, nb) in n.iter().enumerate() {
                let idx = start + i as i64;
                let w = if idx >= 0 && (idx as usize) < weights.len() {
                    weights[idx as usize]
                } else {
                    1.0
                };
                products.push(nb * w);
            }
            let s: f64 = products.iter().sum();
            if s != 0.0 {
                n = products.iter().map(|p| p / s).collect();
            } else {
                n = products;
            }
        }
        let p = order - 1;
        let mut x = 0.0;
        let mut y = 0.0;
        for i in 0..order {
            let idx = span as i64 - p as i64 + i as i64;
            if idx < 0 || idx as usize >= control.len() {
                continue;
            }
            let cp = control[idx as usize];
            x += n[i] * cp[0];
            y += n[i] * cp[1];
        }
        [x, y]
    };

    // np.unique(knots): sorted dedup with exact equality.
    let mut unique: Vec<f64> = knots.to_vec();
    unique.sort_by(|a, b| a.total_cmp(b));
    unique.dedup();
    if unique.len() < 2 {
        return Vec::new();
    }

    fn subdiv(
        out: &mut Vec<[f64; 2]>,
        point: &dyn Fn(f64) -> [f64; 2],
        s: [f64; 2],
        e: [f64; 2],
        start_t: f64,
        end_t: f64,
        distance: f64,
    ) {
        let mid_t = (start_t + end_t) * 0.5;
        let m = point(mid_t);
        let dist = distance_point_line(m, s, e).unwrap_or(0.0);
        if dist < distance {
            out.push(e);
        } else {
            subdiv(out, point, s, m, start_t, mid_t, distance);
            subdiv(out, point, m, e, mid_t, end_t, distance);
        }
    }

    let mut out = Vec::new();
    let mut t = unique[0];
    let mut start_point = point(t);
    out.push(start_point);
    for &t1 in &unique[1..] {
        let delta = (t1 - t) / SEGMENTS as f64;
        while t < t1 {
            let mut next_t = t + delta;
            if isclose(next_t, t1) {
                next_t = t1;
            }
            let end_point = point(next_t);
            subdiv(&mut out, &point, start_point, end_point, t, next_t, distance);
            t = next_t;
            start_point = end_point;
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    // Valeurs dorées générées par ezdxf 1.4.4 / numpy (la référence que ce
    // module réplique) — ne pas « corriger » un écart sans régénérer.

    #[test]
    fn py_mod_matches_python_percent() {
        assert_eq!(py_mod(-30.0, 360.0), 330.0);
        assert_eq!(py_mod(370.0, 360.0), 10.0);
        assert_eq!(py_mod(0.0, 360.0), 0.0);
    }

    #[test]
    fn isclose_is_python_default() {
        assert!(isclose(1.0, 1.0 + 5e-10));
        assert!(!isclose(1.0, 1.0 + 2e-9));
        // abs_tol = 0 : tout écart depuis 0.0 est « loin ».
        assert!(!isclose(0.0, 1e-12));
        assert!(isclose(0.0, 0.0));
    }

    #[test]
    fn linspace_matches_numpy() {
        assert_eq!(linspace(0.0, 360.0, 0), Vec::<f64>::new());
        assert_eq!(linspace(2.0, 9.0, 1), vec![2.0]);
        assert_eq!(
            linspace(0.0, 360.0, 13),
            vec![0.0, 30.0, 60.0, 90.0, 120.0, 150.0, 180.0, 210.0, 240.0, 270.0, 300.0, 330.0, 360.0]
        );
        // y[num-1] = stop exactement (pas d'accumulation de pas).
        let y = linspace(0.1, 0.3, 7);
        assert_eq!(y[6].to_bits(), 0.3f64.to_bits());
    }

    #[test]
    fn radians_is_deg_times_pi_over_180() {
        assert_eq!(radians(90.0).to_bits(), 1.5707963267948966f64.to_bits());
    }

    #[test]
    fn arc_chord_length_golden_and_domain() {
        assert_eq!(
            arc_chord_length(10.0, 0.01).to_bits(),
            0.8942035562443263f64.to_bits()
        );
        assert_eq!(arc_chord_length(0.001, 1.0), 0.0); // domaine vide → 0
    }

    #[test]
    fn arc_segment_count_goldens() {
        assert_eq!(arc_segment_count(10.0, TAU, 0.01), 71); // cercle r=10
        assert_eq!(arc_segment_count(35.0, radians(90.0), 0.01), 33);
        assert_eq!(arc_segment_count(1000.0, radians(5.0), 0.01), 10);
        assert_eq!(arc_segment_count(0.0, 1.0, 0.01), 1); // rayon nul → 1
    }

    #[test]
    fn distance_point_line_pythagoras() {
        assert_eq!(distance_point_line([0.0, 1.0], [0.0, 0.0], [2.0, 0.0]), Some(1.0));
        assert_eq!(distance_point_line([3.0, 4.0], [1.0, 1.0], [1.0, 1.0]), None);
    }

    #[test]
    fn circle_flattening_vertex_count_and_start() {
        let pts = flatten_primitive(
            &Primitive::Circle { center: [0.0, 0.0], radius: 10.0, handle: "h".into(), layer: "0".into() },
            0.01,
        );
        assert_eq!(pts.len(), 71 + 1);
        assert_eq!(pts[0], [10.0, 0.0]);
    }

    #[test]
    fn arc_wrapping_past_360() {
        // start 270°, end 90° → span 180° par le bas (ezdxf py_mod + wrap).
        let pts = flatten_primitive(
            &Primitive::Arc {
                center: [0.0, 0.0],
                radius: 5.0,
                start_angle: 270.0,
                end_angle: 90.0,
                handle: "h".into(),
                layer: "0".into(),
            },
            0.01,
        );
        assert!(!pts.is_empty());
        assert!((pts[0][0]).abs() < 1e-9 && (pts[0][1] + 5.0).abs() < 1e-9);
        let last = pts.last().unwrap();
        assert!(last[0].abs() < 1e-9 && (last[1] - 5.0).abs() < 1e-9);
    }

    #[test]
    fn arc_degenerate_isclose_drops() {
        let pts = flatten_primitive(
            &Primitive::Arc {
                center: [0.0, 0.0],
                radius: 5.0,
                start_angle: 45.0,
                end_angle: 45.0 + 1e-10,
                handle: "h".into(),
                layer: "0".into(),
            },
            0.01,
        );
        assert!(pts.is_empty());
    }

    #[test]
    fn ellipse_full_span_golden() {
        // ConstructionEllipse(major=(5,0), ratio=0.5, 0..tau).flattening(0.01)
        let pts = flatten_ellipse([0.0, 0.0], [5.0, 0.0], 0.5, 0.0, TAU, 0.01);
        assert_eq!(pts.len(), 65);
        assert_eq!(pts[0], [5.0, 0.0]);
    }

    #[test]
    fn spline_bezier_golden() {
        // BSpline(cps, order=4, knots clampés).flattening(0.01)
        let pts = flatten_spline(
            3,
            &[0.0, 0.0, 0.0, 0.0, 1.0, 1.0, 1.0, 1.0],
            &[[0.0, 0.0], [10.0, 20.0], [30.0, -5.0], [40.0, 10.0]],
            &[],
            0.01,
        );
        assert_eq!(pts.len(), 54);
        assert_eq!(pts[0], [0.0, 0.0]);
        assert_eq!(*pts.last().unwrap(), [40.0, 10.0]);
    }

    #[test]
    fn basis_find_span_and_funcs_nurbs_book() {
        // Exemple A2.2 du NURBS Book (knots clampés, degré 3).
        let basis = Basis {
            knots: vec![0.0, 0.0, 0.0, 0.0, 1.0, 2.0, 3.0, 4.0, 5.0, 5.0, 5.0, 5.0],
            order: 4,
        };
        assert_eq!(basis.find_span(2.5), 5);
        assert_eq!(basis.find_span(0.0), 3);
        assert_eq!(basis.find_span(5.0), 7);
        let n = basis.basis_funcs(5, 2.5);
        let golden = [
            0.020833333333333332f64,
            0.47916666666666663,
            0.47916666666666663,
            0.020833333333333332,
        ];
        for (a, b) in n.iter().zip(golden.iter()) {
            assert_eq!(a.to_bits(), b.to_bits());
        }
    }
}
