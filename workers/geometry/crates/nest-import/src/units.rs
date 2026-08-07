//! $INSUNITS normalization — canonical mm (worker_common/geometry/units.py twin).

/// $INSUNITS code → multiplication factor to millimeters.
pub fn insunits_factor(code: i32) -> Option<f64> {
    match code {
        1 => Some(25.4),      // inches
        2 => Some(304.8),     // feet
        4 => Some(1.0),       // millimeters
        5 => Some(10.0),      // centimeters
        6 => Some(1000.0),    // meters
        8 => Some(2.54e-5),   // microinches
        9 => Some(0.0254),    // mils
        _ => None,
    }
}

/// Unitless (0) / mm (4) / unknown → 1.0 (historical behavior: assume mm).
pub fn factor_to_mm(code: i32) -> (f64, bool) {
    if code == 0 || code == 4 {
        return (1.0, false);
    }
    match insunits_factor(code) {
        Some(f) => (f, false),
        None => (1.0, true), // unknown → warn
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn known_factors_are_exact() {
        // Jumeau de worker_common/geometry/units.py — valeurs figées.
        assert_eq!(insunits_factor(1), Some(25.4)); // inches
        assert_eq!(insunits_factor(2), Some(304.8)); // feet
        assert_eq!(insunits_factor(4), Some(1.0)); // mm
        assert_eq!(insunits_factor(5), Some(10.0)); // cm
        assert_eq!(insunits_factor(6), Some(1000.0)); // meters
        assert_eq!(insunits_factor(8), Some(2.54e-5)); // microinches
        assert_eq!(insunits_factor(9), Some(0.0254)); // mils
    }

    #[test]
    fn unitless_and_mm_do_not_warn() {
        assert_eq!(factor_to_mm(0), (1.0, false));
        assert_eq!(factor_to_mm(4), (1.0, false));
    }

    #[test]
    fn unknown_code_warns_and_assumes_mm() {
        assert_eq!(factor_to_mm(3), (1.0, true));
        assert_eq!(factor_to_mm(7), (1.0, true));
        assert_eq!(factor_to_mm(99), (1.0, true));
        assert_eq!(factor_to_mm(-1), (1.0, true));
    }
}
