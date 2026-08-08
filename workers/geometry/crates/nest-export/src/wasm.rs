//! WASM bindings (feature `wasm`) — même API que la lib native, jamais de
//! forme browser-only (contrat dual-target, PIPELINE-MAP §3).

use crate::svg::{build_colored_sheet_svg, Item};
use crate::transform::Placement;
use serde::Deserialize;
use wasm_bindgen::prelude::*;

#[derive(Deserialize)]
struct SheetSpec {
    transforms: Vec<Placement>,
    #[serde(default)]
    items: std::collections::HashMap<String, Item>,
    bin_width: f64,
    bin_height: f64,
    #[serde(default = "one")]
    unit_scale: f64,
    #[serde(default = "mm")]
    unit_attr: String,
}
fn one() -> f64 {
    1.0
}
fn mm() -> String {
    "mm".into()
}

/// export_svg_sheet(spec_json) -> SVG coloré de la tôle.
#[wasm_bindgen]
pub fn export_svg_sheet(json: &str) -> Result<String, JsError> {
    let s: SheetSpec =
        serde_json::from_str(json).map_err(|e| JsError::new(&format!("bad spec: {e}")))?;
    Ok(build_colored_sheet_svg(
        &s.transforms,
        &s.items,
        s.bin_width,
        s.bin_height,
        s.unit_scale,
        &s.unit_attr,
    ))
}
