//! svgelements `Matrix` twin: 2×3 affine, transform-string parsing with the
//! exact pre_* composition order, Angle parsing (deg/grad/rad/turn/%).

/// [a c e; b d f; 0 0 1] like svgelements (b = skew/rotation y component).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Matrix {
    pub a: f64,
    pub b: f64,
    pub c: f64,
    pub d: f64,
    pub e: f64,
    pub f: f64,
}

impl Matrix {
    pub fn identity() -> Matrix {
        Matrix { a: 1.0, b: 0.0, c: 0.0, d: 1.0, e: 0.0, f: 0.0 }
    }

    /// matrix_multiply(m, s) twin: returns m · s in svgelements' op order.
    pub fn multiply(m: &Matrix, s: &Matrix) -> Matrix {
        Matrix {
            a: s.a * m.a + s.c * m.b,
            c: s.a * m.c + s.c * m.d,
            e: s.a * m.e + s.c * m.f + s.e,
            b: s.b * m.a + s.d * m.b,
            d: s.b * m.c + s.d * m.d,
            f: s.b * m.e + s.d * m.f + s.f,
        }
    }

    pub fn pre_cat(&mut self, mx: Matrix) {
        *self = Matrix::multiply(&mx, self);
    }

    pub fn post_cat(&mut self, mx: Matrix) {
        *self = Matrix::multiply(self, &mx);
    }

    fn scale_mx(sx: f64, sy: f64) -> Matrix {
        Matrix { a: sx, b: 0.0, c: 0.0, d: sy, e: 0.0, f: 0.0 }
    }
    fn translate_mx(tx: f64, ty: f64) -> Matrix {
        Matrix { a: 1.0, b: 0.0, c: 0.0, d: 1.0, e: tx, f: ty }
    }
    fn rotate_mx(angle: f64) -> Matrix {
        // svgelements Matrix.rotate: a=cos, b=sin, c=-sin, d=cos.
        Matrix {
            a: libm::cos(angle),
            b: libm::sin(angle),
            c: -libm::sin(angle),
            d: libm::cos(angle),
            e: 0.0,
            f: 0.0,
        }
    }
    fn skew_mx(angle_a: f64, angle_b: f64) -> Matrix {
        Matrix {
            a: 1.0,
            b: libm::tan(angle_a),
            c: libm::tan(angle_b),
            d: 1.0,
            e: 0.0,
            f: 0.0,
        }
    }

    pub fn pre_translate(&mut self, tx: f64, ty: f64) {
        self.pre_cat(Matrix::translate_mx(tx, ty));
    }
    pub fn pre_scale(&mut self, sx: f64, sy: Option<f64>, x: f64, y: f64) {
        let sy = sy.unwrap_or(sx);
        if x == 0.0 && y == 0.0 {
            self.pre_cat(Matrix::scale_mx(sx, sy));
        } else {
            self.pre_translate(x, y);
            self.pre_scale(sx, Some(sy), 0.0, 0.0);
            self.pre_translate(-x, -y);
        }
    }
    pub fn pre_rotate(&mut self, angle: f64, x: f64, y: f64) {
        if x == 0.0 && y == 0.0 {
            self.pre_cat(Matrix::rotate_mx(angle));
        } else {
            self.pre_translate(x, y);
            self.pre_rotate(angle, 0.0, 0.0);
            self.pre_translate(-x, -y);
        }
    }
    pub fn pre_skew(&mut self, aa: f64, ab: f64, x: f64, y: f64) {
        if x == 0.0 && y == 0.0 {
            self.pre_cat(Matrix::skew_mx(aa, ab));
        } else {
            self.pre_translate(x, y);
            self.pre_skew(aa, ab, 0.0, 0.0);
            self.pre_translate(-x, -y);
        }
    }

    /// Post-variants (used by Arc's svg_parameterize rotate matrix).
    pub fn post_translate(&mut self, tx: f64, ty: f64) {
        self.post_cat(Matrix::translate_mx(tx, ty));
    }
    pub fn post_rotate(&mut self, angle: f64, x: f64, y: f64) {
        if x == 0.0 && y == 0.0 {
            self.post_cat(Matrix::rotate_mx(angle));
        } else {
            let mut m = Matrix::identity();
            m.post_translate(-x, -y);
            m.post_cat(Matrix::rotate_mx(angle));
            m.post_translate(x, y);
            self.post_cat(m);
        }
    }

    pub fn determinant(&self) -> f64 {
        self.a * self.d - self.c * self.b
    }
    pub fn is_identity(&self) -> bool {
        // svgelements compares against identity word for word.
        *self == Matrix::identity()
    }
    pub fn value_trans_x(&self) -> f64 {
        self.e
    }
    pub fn value_trans_y(&self) -> f64 {
        self.f
    }
    pub fn value_scale_x(&self) -> f64 {
        self.a
    }
    pub fn value_scale_y(&self) -> f64 {
        self.d
    }
    pub fn value_skew_x(&self) -> f64 {
        self.b
    }
    pub fn value_skew_y(&self) -> f64 {
        self.c
    }

    pub fn apply(&self, p: [f64; 2]) -> [f64; 2] {
        [
            p[0] * self.a + p[1] * self.c + self.e,
            p[0] * self.b + p[1] * self.d + self.f,
        ]
    }

    /// Angle.parse twin: deg/grad/rad/turn/% suffixes, default degrees.
    /// Returns radians.
    fn parse_angle(s: &str) -> f64 {
        let s = s.trim();
        let (v, mult) = if let Some(x) = s.strip_suffix("deg") {
            (x, std::f64::consts::TAU / 360.0)
        } else if let Some(x) = s.strip_suffix("grad") {
            (x, std::f64::consts::TAU / 400.0)
        } else if let Some(x) = s.strip_suffix("rad") {
            (x, 1.0)
        } else if let Some(x) = s.strip_suffix("turn") {
            (x, std::f64::consts::TAU)
        } else if let Some(x) = s.strip_suffix('%') {
            (x, std::f64::consts::TAU / 100.0)
        } else {
            (s, std::f64::consts::TAU / 360.0)
        };
        v.trim().parse::<f64>().unwrap_or(0.0) * mult
    }

    /// Matrix(transform_str) twin: commands split on the REGEX_TEMPLATE
    /// semantics (name + parenthesized params), applied left-to-right with
    /// pre_* composition (later commands apply FIRST to points).
    pub fn parse(transform_str: &str) -> Matrix {
        let mut m = Matrix::identity();
        let s = transform_str.to_lowercase();
        let bytes = s.as_bytes();
        let mut i = 0;
        while i < bytes.len() {
            // find next alphabetic run (command name)
            let start = i;
            while i < bytes.len() && bytes[i].is_ascii_alphabetic() {
                i += 1;
            }
            if i == start {
                i += 1;
                continue;
            }
            let name = &s[start..i];
            // skip whitespace
            while i < bytes.len() && (bytes[i] as char).is_whitespace() {
                i += 1;
            }
            if i >= bytes.len() || bytes[i] != b'(' {
                continue;
            }
            // params until ')'
            let pstart = i + 1;
            let mut depth = 1;
            i += 1;
            while i < bytes.len() && depth > 0 {
                if bytes[i] == b'(' {
                    depth += 1;
                }
                if bytes[i] == b')' {
                    depth -= 1;
                }
                i += 1;
            }
            let params_str = &s[pstart..i - 1];
            let params = split_params(params_str);
            apply_command(&mut m, name, &params);
        }
        m
    }
}

/// REGEX_TRANSFORM_PARAMETER twin: float + optional unit suffix tokens.
fn split_params(s: &str) -> Vec<String> {
    let mut out = Vec::new();
    let bytes = s.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        let c = bytes[i];
        if c == b',' || (c as char).is_whitespace() {
            i += 1;
            continue;
        }
        let start = i;
        while i < bytes.len() && bytes[i] != b',' && !(bytes[i] as char).is_whitespace() {
            i += 1;
        }
        out.push(s[start..i].to_string());
    }
    out
}

/// Bare float value of a param (Length(...).value() with no ppi: px/bare →
/// amount; units without ppi stay symbolic — svgelements would keep a
/// Length object and break later; our subset reads the amount).
fn param_value(s: &str) -> f64 {
    crate::svg::length::Length::parse(s).value_px(None)
}

fn apply_command(m: &mut Matrix, name: &str, params: &[String]) {
    let f = |i: usize| -> Option<f64> { params.get(i).map(|s| param_value(s)) };
    match name {
        "matrix" => {
            if params.len() >= 6 {
                let v: Vec<f64> = params.iter().take(6).map(|s| s.parse().unwrap_or(0.0)).collect();
                m.pre_cat(Matrix {
                    a: v[0],
                    b: v[1],
                    c: v[2],
                    d: v[3],
                    e: v[4],
                    f: v[5],
                });
            }
        }
        "translate" => match f(0) {
            None => {}
            Some(x) => match f(1) {
                Some(y) => m.pre_translate(x, y),
                None => m.pre_translate(x, 0.0),
            },
        },
        "translatex" => {
            if let Some(x) = f(0) {
                m.pre_translate(x, 0.0);
            }
        }
        "translatey" => {
            if let Some(y) = f(0) {
                m.pre_translate(0.0, y);
            }
        }
        "scale" => {
            let v: Vec<f64> = params.iter().filter_map(|s| s.parse().ok()).collect();
            match v.len() {
                0 => {}
                1 => m.pre_scale(v[0], None, 0.0, 0.0),
                _ => m.pre_scale(v[0], Some(v[1]), 0.0, 0.0),
            }
        }
        "scalex" => {
            if let Some(x) = f(0) {
                m.pre_scale(x, Some(1.0), 0.0, 0.0);
            }
        }
        "scaley" => {
            if let Some(y) = f(0) {
                m.pre_scale(1.0, Some(y), 0.0, 0.0);
            }
        }
        "rotate" => {
            if params.is_empty() {
                return;
            }
            let angle = Matrix::parse_angle(&params[0]);
            match (f(1), f(2)) {
                (Some(x), Some(y)) => m.pre_rotate(angle, x, y),
                (Some(x), None) => m.pre_rotate(angle, x, 0.0),
                _ => m.pre_rotate(angle, 0.0, 0.0),
            }
        }
        "skew" => {
            if params.len() < 2 {
                return;
            }
            let aa = Matrix::parse_angle(&params[0]);
            let ab = Matrix::parse_angle(&params[1]);
            match (f(2), f(3)) {
                (Some(x), Some(y)) => m.pre_skew(aa, ab, x, y),
                (Some(x), None) => m.pre_skew(aa, ab, x, 0.0),
                _ => m.pre_skew(aa, ab, 0.0, 0.0),
            }
        }
        "skewx" => {
            if !params.is_empty() {
                let aa = Matrix::parse_angle(&params[0]);
                m.pre_skew(aa, 0.0, 0.0, 0.0);
            }
        }
        "skewy" => {
            if !params.is_empty() {
                let ab = Matrix::parse_angle(&params[0]);
                m.pre_skew(0.0, ab, 0.0, 0.0);
            }
        }
        _ => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_translate_scale_order() {
        // "translate(10, 20) scale(2)" → M = T·S (produit standard) : le
        // scale s'applique d'ABORD au point, puis la translation.
        // Vérifié contre svgelements : Point(1,1) → (12, 22).
        let m = Matrix::parse("translate(10, 20) scale(2)");
        let p = m.apply([1.0, 1.0]);
        assert_eq!(p, [12.0, 22.0]);
    }

    #[test]
    fn rotate_degrees_default() {
        let m = Matrix::parse("rotate(90)");
        let p = m.apply([1.0, 0.0]);
        assert!(p[0].abs() < 1e-12 && (p[1] - 1.0).abs() < 1e-12);
    }

    #[test]
    fn rotate_about_point() {
        let m = Matrix::parse("rotate(90 10 10)");
        let p = m.apply([20.0, 10.0]);
        assert!((p[0] - 10.0).abs() < 1e-9 && (p[1] - 20.0).abs() < 1e-9);
    }
}
