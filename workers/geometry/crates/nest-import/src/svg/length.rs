//! svgelements `Length` twin: parse "12.5mm" / "30%" / bare floats, resolve
//! to px at 96 dpi. The mm/cm conversion constants are svgelements' own
//! TRUNCATED values (0.0393701 / 0.393701) — not the exact ratios.

/// A length as parsed: amount + unit ("" = px). Percentages and font units
/// stay symbolic until resolved against a viewport (render()).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Length {
    pub amount: f64,
    pub units: Unit,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Unit {
    Px,
    Mm,
    Cm,
    In,
    Pt,
    Pc,
    Percent,
    Em,
    Ex,
    /// Unit inconnue (traitée comme px par svgelements via float() brut ?
    /// non — inconnue = gardée littérale ; notre subset la traite en px).
    Other,
}

const PPI: f64 = 96.0; // DEFAULT_PPI

impl Length {
    /// REGEX_LENGTH: first float + alpha/% suffix. Unparseable → 0px
    /// (svgelements: no match → amount=0.0 units="").
    pub fn parse(s: &str) -> Length {
        let s = s.trim();
        let mut end = 0usize;
        let bytes = s.as_bytes();
        // float token: [-+]?[0-9]*\.?[0-9]+(?:[eE][-+]?[0-9]+)?
        let mut i = 0;
        if i < bytes.len() && (bytes[i] == b'+' || bytes[i] == b'-') {
            i += 1;
        }
        let mut digits = 0;
        while i < bytes.len() && bytes[i].is_ascii_digit() {
            i += 1;
            digits += 1;
        }
        if i < bytes.len() && bytes[i] == b'.' {
            i += 1;
            while i < bytes.len() && bytes[i].is_ascii_digit() {
                i += 1;
                digits += 1;
            }
        }
        if digits > 0 && i < bytes.len() && (bytes[i] == b'e' || bytes[i] == b'E') {
            let mut j = i + 1;
            if j < bytes.len() && (bytes[j] == b'+' || bytes[j] == b'-') {
                j += 1;
            }
            let mut edigits = 0;
            while j < bytes.len() && bytes[j].is_ascii_digit() {
                j += 1;
                edigits += 1;
            }
            if edigits > 0 {
                i = j;
            }
        }
        if digits > 0 {
            end = i;
        }
        if end == 0 {
            return Length { amount: 0.0, units: Unit::Px };
        }
        let amount: f64 = s[..end].parse().unwrap_or(0.0);
        let units = match s[end..].trim() {
            "" | "px" => Unit::Px,
            "mm" => Unit::Mm,
            "cm" => Unit::Cm,
            "in" => Unit::In,
            "pt" => Unit::Pt,
            "pc" => Unit::Pc,
            "%" => Unit::Percent,
            "em" => Unit::Em,
            "ex" => Unit::Ex,
            _ => Unit::Other,
        };
        Length { amount, units }
    }

    /// Resolve to px. `relative` = viewport dim for percentages (None → the
    /// svgelements behavior is to KEEP the symbolic Length; our callers then
    /// treat the value as plain amount — divergence documented au corpus).
    pub fn value_px(&self, relative: Option<f64>) -> f64 {
        match self.units {
            Unit::Percent => match relative {
                Some(rel) => self.amount / 100.0 * rel,
                None => self.amount, // symbolic fallback (rare root case)
            },
            Unit::Mm => self.amount * PPI * 0.0393701,
            Unit::Cm => self.amount * PPI * 0.393701,
            Unit::In => self.amount * PPI,
            Unit::Px | Unit::Other => self.amount,
            Unit::Pt => self.amount * 4.0 / 3.0,
            Unit::Pc => self.amount * 16.0,
            Unit::Em | Unit::Ex => self.amount, // font-size inconnu → px
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_units() {
        assert_eq!(Length::parse("12.5mm").units, Unit::Mm);
        assert_eq!(Length::parse("100%").units, Unit::Percent);
        assert_eq!(Length::parse("-3.2e1").amount, -32.0);
        assert_eq!(Length::parse("5").units, Unit::Px);
    }

    #[test]
    fn px_values_use_svgelements_constants() {
        assert_eq!(Length::parse("25.4mm").value_px(None), 25.4 * 96.0 * 0.0393701);
        assert_eq!(Length::parse("1in").value_px(None), 96.0);
        assert_eq!(Length::parse("12pt").value_px(None), 16.0);
        assert_eq!(Length::parse("50%").value_px(Some(200.0)), 100.0);
    }
}
