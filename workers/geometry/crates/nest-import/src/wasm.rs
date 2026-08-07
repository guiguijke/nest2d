//! WASM bindings (feature `wasm`). Same API as the native lib — never a
//! browser-only shape (mission v2, règle 1).

use wasm_bindgen::prelude::*;

/// import_dxf(bytes, flatten_tol_mm) -> JSON ImportResult
/// (parts: coordinates/holes/width/height, sourceUnits, entityCount, warnings)
#[wasm_bindgen]
pub fn import_dxf(bytes: &[u8], flatten_tol: f64) -> Result<String, JsError> {
    let out = crate::import_dxf(bytes, flatten_tol)
        .map_err(|e| JsError::new(&format!("{e}")))?;
    serde_json::to_string(&out).map_err(|e| JsError::new(&format!("{e}")))
}

/// import_svg(bytes, flatten_tol_mm) -> JSON ImportResult — feature `svg`
/// (opt-in wasm : le bundle DXF-only reste léger).
#[cfg(feature = "svg")]
#[wasm_bindgen]
pub fn import_svg(bytes: &[u8], flatten_tol: f64) -> Result<String, JsError> {
    let out = crate::import_svg(bytes, flatten_tol)
        .map_err(|e| JsError::new(&format!("{e}")))?;
    serde_json::to_string(&out).map_err(|e| JsError::new(&format!("{e}")))
}

/// import_file(bytes, flatten_tol_mm) -> JSON ImportResult — détection par
/// signature de contenu (AGENTS #31), jamais l'extension.
#[wasm_bindgen]
pub fn import_file(bytes: &[u8], flatten_tol: f64) -> Result<String, JsError> {
    let out = crate::import_file(bytes, flatten_tol)
        .map_err(|e| JsError::new(&format!("{e}")))?;
    serde_json::to_string(&out).map_err(|e| JsError::new(&format!("{e}")))
}
