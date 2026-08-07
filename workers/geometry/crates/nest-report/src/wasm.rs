//! WASM bindings (feature `wasm`) — compute_report, même sémantique native.

use crate::{per_sheet_metrics, report_totals, verify_layout, Container, Item};
use serde::Deserialize;
use wasm_bindgen::prelude::*;

#[derive(Deserialize)]
struct Spec {
    items: Vec<Item>,
    containers: Vec<Container>,
    #[serde(default)]
    space: f64,
}

/// compute_report(spec_json) -> {per_sheet, totals, verify}.
#[wasm_bindgen]
pub fn compute_report(json: &str) -> Result<String, JsError> {
    let s: Spec =
        serde_json::from_str(json).map_err(|e| JsError::new(&format!("bad spec: {e}")))?;
    let sheets = per_sheet_metrics(&s.containers, &s.items);
    let totals = report_totals(&sheets);
    let verify = verify_layout(&s.containers, &s.items, s.space);
    serde_json::to_string(&serde_json::json!({
        "per_sheet": sheets,
        "totals": totals,
        "verify": verify,
    }))
    .map_err(|e| JsError::new(&format!("{e}")))
}
