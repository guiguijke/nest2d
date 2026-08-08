//! Réplique exacte du formatage flottant de Python (`str(float)` = repr le
//! plus court, et `:.Nf`) — indispensable à la parité BYTE-LEVEL des SVG
//! (mission v2 PR3, régime 2). Rust `Display`/`{:e}` ne matchent PAS Python
//! (pas de `.0` pour les entiers, seuils scientifique différents, exposant
//! `e-05` vs `1e-05`…). On reconstruit la représentation Python à partir des
//! chiffres les-plus-courts de `{:e}` (même round-trip que repr Python).

/// `str(v)` Python (repr shortest-round-trip), règles exactes :
///  - entier → `X.0` (et `-0.0` conservé),
///  - décimal si exposant décimal ∈ [-4, 15],
///  - scientifique `1e-05` / `1e+16` sinon (exposant signé, ≥ 2 chiffres).
pub fn py_str(v: f64) -> String {
    if v == 0.0 {
        return if v.is_sign_negative() { "-0.0".into() } else { "0.0".into() };
    }
    if !v.is_finite() {
        return if v.is_nan() { "nan".into() } else if v > 0.0 { "inf".into() } else { "-inf".into() };
    }
    let sign = if v < 0.0 { "-" } else { "" };
    let a = v.abs();
    // {:e} = mantisse la plus courte "d.ddd" + exposant décimal e.
    let efmt = format!("{:e}", a);
    let (mant, exp): (&str, i32) = match efmt.split_once('e') {
        Some((m, x)) => (m, x.parse().unwrap_or(0)),
        None => (efmt.as_str(), 0),
    };
    let digits: String = mant.chars().filter(|c| *c != '.').collect();
    format_py(sign, &digits, exp)
}

fn format_py(sign: &str, digits: &str, exp: i32) -> String {
    // valeur = 0.digits * 10^(exp+1)  ≡  d.ddd * 10^exp
    if exp >= -4 && exp <= 15 {
        // forme décimale
        let n = digits.len() as i32;
        let int_len = exp + 1; // nb de chiffres avant la virgule
        let mut s = String::from(sign);
        if int_len >= n {
            s.push_str(digits);
            for _ in 0..(int_len - n) {
                s.push('0');
            }
            s.push_str(".0");
        } else if int_len <= 0 {
            s.push('0');
            s.push('.');
            for _ in 0..(-int_len) {
                s.push('0');
            }
            s.push_str(digits);
        } else {
            let (ip, fp) = digits.split_at(int_len as usize);
            s.push_str(ip);
            s.push('.');
            s.push_str(fp);
        }
        s
    } else {
        // scientifique
        let mut s = String::from(sign);
        let (d0, rest) = digits.split_at(1);
        s.push_str(d0);
        if !rest.is_empty() {
            s.push('.');
            s.push_str(rest);
        }
        s.push('e');
        s.push(if exp < 0 { '-' } else { '+' });
        s.push_str(&format!("{:02}", exp.abs()));
        s
    }
}

/// `f"{v:.N}"` Python (arrondi half-even sur la décimale, zéros de padding).
pub fn py_fixed(v: f64, prec: usize) -> String {
    // Rust `format!("{:.*}")` utilise l'arrondi half-even comme Python.
    format!("{:.*}", prec, v)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn py_str_matches_python() {
        // Goldens générés depuis CPython (repr/str).
        assert_eq!(py_str(0.0), "0.0");
        assert_eq!(py_str(-0.0), "-0.0");
        assert_eq!(py_str(1.0), "1.0");
        assert_eq!(py_str(-1.0), "-1.0");
        assert_eq!(py_str(300.0), "300.0");
        assert_eq!(py_str(0.002), "0.002");
        assert_eq!(py_str(0.6), "0.6");
        assert_eq!(py_str(11.811023622047244), "11.811023622047244");
        assert_eq!(py_str(0.30000000000000004), "0.30000000000000004");
        assert_eq!(py_str(1e-5), "1e-05");
        assert_eq!(py_str(1e-4), "0.0001");
        assert_eq!(py_str(1e16), "1e+16");
        assert_eq!(py_str(123456.789), "123456.789");
        assert_eq!(py_str(2.5), "2.5");
        assert_eq!(py_str(0.35), "0.35");
        assert_eq!(py_str(0.18), "0.18");
        assert_eq!(py_str(59.05511811023622), "59.05511811023622");
        assert_eq!(py_str(3.141592653589793), "3.141592653589793");
        assert_eq!(py_str(0.0006), "0.0006");
        assert_eq!(py_str(1e-7), "1e-07");
        assert_eq!(py_str(2e-5), "2e-05");
        assert_eq!(py_str(0.0024), "0.0024");
    }

    #[test]
    fn py_fixed_matches_python() {
        assert_eq!(py_fixed(11.811023622047244, 3), "11.811");
        assert_eq!(py_fixed(0.0, 3), "0.000");
        assert_eq!(py_fixed(90.0, 3), "90.000");
        assert_eq!(py_fixed(37.5, 3), "37.500");
        assert_eq!(py_fixed(-12.3456, 3), "-12.346");
    }
}
