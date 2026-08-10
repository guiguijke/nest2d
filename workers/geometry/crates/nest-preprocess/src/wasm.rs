//! WASM bindings (feature `wasm`) — même contrat que la lib native,
//! jamais de forme browser-only (PIPELINE-MAP §3).
//!
//! open_holes({outer, holes, space_mm}) -> {ring}
//! Sémantique main.py : width = channel_width_for_space(space) ; canaux
//! scellés (D-MOT-2) → anneau externe plein retourné tel quel.

use serde::{Deserialize, Serialize};
use wasm_bindgen::prelude::*;

#[derive(Deserialize)]
struct OpenHolesIn {
    outer: Vec<[f64; 2]>,
    holes: Vec<Vec<[f64; 2]>>,
    space_mm: f64,
}

#[derive(Serialize)]
struct OpenHolesOut {
    ring: Vec<[f64; 2]>,
    /// false si les canaux étaient scellés à cet espacement (trous fermés).
    channels_opened: bool,
}

#[wasm_bindgen]
pub fn open_holes(json: &str) -> Result<String, JsError> {
    let input: OpenHolesIn =
        serde_json::from_str(json).map_err(|e| JsError::new(&format!("bad input: {e}")))?;
    if !crate::channels_usable(input.space_mm) {
        return serde_json::to_string(&OpenHolesOut {
            ring: input.outer,
            channels_opened: false,
        })
        .map_err(|e| JsError::new(&format!("{e}")));
    }
    let width = crate::channel_width_for_space(input.space_mm);
    let ring = crate::open_holes_difference(&input.outer, &input.holes, width);
    serde_json::to_string(&OpenHolesOut { ring, channels_opened: true })
        .map_err(|e| JsError::new(&format!("{e}")))
}

#[derive(Deserialize)]
struct PinwheelIn {
    hole_ring: Vec<[f64; 2]>,
    filler_coords: Vec<[f64; 2]>,
    space_mm: f64,
    #[serde(default)]
    allowed: Option<Vec<f64>>,
}

/// pinwheel_capacity({hole_ring, filler_coords, space_mm, allowed?})
///   -> {rotations: [...]}
/// Miroir EXACT de holefill.pinwheel_capacity (J-085) — trou érodé de
/// space en entier (piège #3), espacement > space strict entre fillers.
#[wasm_bindgen]
pub fn pinwheel_capacity(json: &str) -> Result<String, JsError> {
    let input: PinwheelIn =
        serde_json::from_str(json).map_err(|e| JsError::new(&format!("bad input: {e}")))?;
    let rotations = crate::pinwheel::pinwheel_capacity(
        &input.hole_ring,
        &input.filler_coords,
        input.space_mm,
        input.allowed.as_deref(),
    );
    serde_json::to_string(&serde_json::json!({ "rotations": rotations }))
        .map_err(|e| JsError::new(&format!("{e}")))
}
