//! Affine de placement — sémantique `build_part` (main.py) validée
//! empiriquement (J-069) : `matrix = z_rotate(angle) * translate(x, y)` en
//! convention vecteur-LIGNE ezdxf = **rotate puis translate** :
//!   p' = R(θ)·p + (x, y)
//! puis scaling d'unité uniforme appliqué à tout le modelspace en fin :
//!   p'' = unit_scale · p'
//! Composition NON devinée : vérifiée contre ezdxf sur 90°/180°/37°.

pub type Pt = [f64; 2];

/// Placement d'une pièce (jumeau du Transform Python : item_id, file_slug,
/// handles, angle (radians), x, y, color).
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct Placement {
    pub item_id: String,
    pub file_slug: String,
    pub handles: Vec<String>,
    /// angle en radians (convention moteur, CCW).
    pub angle: f64,
    pub x: f64,
    pub y: f64,
    pub color: Option<String>,
}

#[derive(Debug, Clone, Copy)]
pub struct Affine {
    pub cos: f64,
    pub sin: f64,
    pub tx: f64,
    pub ty: f64,
    pub scale: f64,
    pub angle: f64,
}

impl Affine {
    pub fn new(angle: f64, x: f64, y: f64, scale: f64) -> Affine {
        Affine { cos: libm::cos(angle), sin: libm::sin(angle), tx: x, ty: y, scale, angle }
    }

    /// p'' = scale · (R·p + t)
    pub fn apply(&self, p: Pt) -> Pt {
        let x = self.cos * p[0] - self.sin * p[1] + self.tx;
        let y = self.sin * p[0] + self.cos * p[1] + self.ty;
        [x * self.scale, y * self.scale]
    }

    /// Rotation appliquée à un angle (degrés CCW) — pour ARC.
    pub fn rotate_deg(&self, deg: f64) -> f64 {
        deg + self.angle * 180.0 / std::f64::consts::PI
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rotate_then_translate_matches_ezdxf() {
        // Validé contre ezdxf : p(1,0) sous angle=90°, t=(10,20) => (10,21).
        let m = Affine::new(std::f64::consts::FRAC_PI_2, 10.0, 20.0, 1.0);
        let q = m.apply([1.0, 0.0]);
        assert!((q[0] - 10.0).abs() < 1e-9, "x={}", q[0]);
        assert!((q[1] - 21.0).abs() < 1e-9, "y={}", q[1]);
    }

    #[test]
    fn scale_applied_last() {
        let m = Affine::new(0.0, 10.0, 20.0, 0.5);
        let q = m.apply([2.0, 4.0]);
        assert!((q[0] - 6.0).abs() < 1e-9);
        assert!((q[1] - 12.0).abs() < 1e-9);
    }
}
