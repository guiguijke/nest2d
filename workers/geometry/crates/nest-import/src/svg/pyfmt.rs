//! Python float formatting replicas used by the d()-string roundtrip
//! (shapes are serialized to path strings by svgelements then reparsed —
//! the formatting precision is part of the geometry, PIPELINE-MAP §1.2).

/// Python `"%.*G" % v`: `precision` significant digits, trailing zeros
/// stripped, scientific notation when exp < -4 or exp >= precision,
/// exponent at least 2 digits with sign. 0 → "0".
pub fn fmt_g(v: f64, precision: usize) -> String {
    if v == 0.0 {
        return "0".to_string();
    }
    if !v.is_finite() {
        // Python: 'inf' / '-inf' / 'nan' (uppercase with %G).
        return if v.is_nan() {
            "NAN".to_string()
        } else if v > 0.0 {
            "INF".to_string()
        } else {
            "-INF".to_string()
        };
    }
    let exp10 = v.abs().log10().floor() as i32;
    if exp10 < -4 || exp10 >= precision as i32 {
        // Scientific: d.dddE±XX — precision-1 digits after the point.
        let s = format!("{:.*E}", precision.saturating_sub(1), v);
        // Rust gives e.g. "1.5E6" / "1.500000E-5"; Python: "1.5E+06" /
        // "1.50000E-05" → normalize exponent to sign + >= 2 digits and
        // strip trailing zeros of the mantissa.
        let (mant, exp) = s.split_once('E').unwrap();
        let exp: i32 = exp.parse().unwrap();
        let mant = strip_zeros(mant);
        format!("{}E{}{:02}", mant, if exp < 0 { "-" } else { "+" }, exp.abs())
    } else {
        // Fixed notation with (precision - 1 - exp10) decimals, then strip.
        let decimals = (precision as i32 - 1 - exp10).max(0) as usize;
        strip_zeros(&format!("{:.*}", decimals, v))
    }
}

fn strip_zeros(s: &str) -> String {
    if s.contains('.') {
        let s = s.trim_end_matches('0').trim_end_matches('.');
        s.to_string()
    } else {
        s.to_string()
    }
}

/// Python `Length.str(float)`: "%.12f" then trailing zeros stripped.
pub fn fmt_length_str(v: f64) -> String {
    strip_zeros(&format!("{:.12}", v))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fmt_g_matches_python() {
        // Valeurs dorées Python : "%.12G" % v / "%G" % v.
        assert_eq!(fmt_g(100.123456789012, 12), "100.123456789");
        assert_eq!(fmt_g(0.0, 12), "0");
        assert_eq!(fmt_g(1.0 / 3.0, 12), "0.333333333333");
        assert_eq!(fmt_g(10.123456789, 6), "10.1235");
        assert_eq!(fmt_g(1234567.0, 6), "1.23457E+06");
        assert_eq!(fmt_g(0.0000123456789, 6), "1.23457E-05");
        assert_eq!(fmt_g(-45.0, 6), "-45");
        assert_eq!(fmt_g(360.0, 6), "360");
        assert_eq!(fmt_g(5.0, 12), "5");
        assert_eq!(fmt_g(0.1, 12), "0.1");
    }

    #[test]
    fn fmt_length_str_matches_python() {
        assert_eq!(fmt_length_str(0.26458333333333334), "0.264583333333");
        assert_eq!(fmt_length_str(100.0), "100");
        assert_eq!(fmt_length_str(2.5), "2.5");
    }
}
