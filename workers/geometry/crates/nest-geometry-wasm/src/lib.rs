//! Bundle WASM unique de la géométrie (mission v2 PR4) : import (DXF+SVG),
//! pré-traitement (canaux), exports (DXF tôle + SVG), rapport — une seule
//! instantiation côté navigateur, à côté de `nest_wasm` (moteur).
//!
//! Toutes les fonctions sont JSON-in/JSON-out (ou &[u8] pour les fichiers),
//! mêmes sémantiques que les libs natives — le verrou déterminisme natif↔wasm
//! (tol. 0) et exports_check (natif vs Python) impliquent navigateur == serveur.

use wasm_bindgen::prelude::*;

/// Pages mémoire wasm courantes (garde-fou du worker géométrie) — même
/// sémantique que nest_wasm::wasm_memory_pages (memory_size, exact).
#[wasm_bindgen]
pub fn wasm_memory_pages() -> usize {
    #[cfg(target_arch = "wasm32")]
    return core::arch::wasm32::memory_size(0);
    #[cfg(not(target_arch = "wasm32"))]
    0
}

/// import_file(bytes, tol) -> JSON ImportResult (détection par signature).
#[wasm_bindgen]
pub fn import_file(bytes: &[u8], tol: f64) -> Result<String, JsError> {
    let r = nest_import::import_file(bytes, tol).map_err(|e| JsError::new(&format!("{e}")))?;
    serde_json::to_string(&r).map_err(|e| JsError::new(&format!("{e}")))
}

/// import_svg(bytes, tol) -> JSON ImportResult.
#[wasm_bindgen]
pub fn import_svg(bytes: &[u8], tol: f64) -> Result<String, JsError> {
    let r = nest_import::import_svg(bytes, tol).map_err(|e| JsError::new(&format!("{e}")))?;
    serde_json::to_string(&r).map_err(|e| JsError::new(&format!("{e}")))
}

/// open_holes(json {outer, holes, space_mm}) -> JSON {ring, channels_opened}.
#[wasm_bindgen]
pub fn open_holes(json: &str) -> Result<String, JsError> {
    #[derive(serde::Deserialize)]
    struct In {
        outer: Vec<[f64; 2]>,
        #[serde(default)]
        holes: Vec<Vec<[f64; 2]>>,
        space_mm: f64,
    }
    let i: In = serde_json::from_str(json).map_err(|e| JsError::new(&format!("{e}")))?;
    if !nest_preprocess::channels_usable(i.space_mm) {
        return serde_json::to_string(&serde_json::json!({
            "ring": i.outer, "channels_opened": false
        }))
        .map_err(|e| JsError::new(&format!("{e}")));
    }
    let w = nest_preprocess::channel_width_for_space(i.space_mm);
    let ring = nest_preprocess::open_holes_difference(&i.outer, &i.holes, w);
    serde_json::to_string(&serde_json::json!({ "ring": ring, "channels_opened": true }))
        .map_err(|e| JsError::new(&format!("{e}")))
}

/// export_svg_sheet(json spec) -> SVG coloré de la tôle.
#[wasm_bindgen]
pub fn export_svg_sheet(json: &str) -> Result<String, JsError> {
    #[derive(serde::Deserialize)]
    struct Spec {
        transforms: Vec<nest_export::Placement>,
        #[serde(default)]
        items: std::collections::HashMap<String, nest_export::svg::Item>,
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
    let s: Spec = serde_json::from_str(json).map_err(|e| JsError::new(&format!("{e}")))?;
    Ok(nest_export::svg::build_colored_sheet_svg(
        &s.transforms,
        &s.items,
        s.bin_width,
        s.bin_height,
        s.unit_scale,
        &s.unit_attr,
    ))
}

/// compute_report(json {items, containers, space}) -> rapport JSON.
#[wasm_bindgen]
pub fn compute_report(json: &str) -> Result<String, JsError> {
    #[derive(serde::Deserialize)]
    struct Spec {
        items: Vec<nest_report::Item>,
        containers: Vec<nest_report::Container>,
        #[serde(default)]
        space: f64,
    }
    let s: Spec = serde_json::from_str(json).map_err(|e| JsError::new(&format!("{e}")))?;
    let sheets = nest_report::per_sheet_metrics(&s.containers, &s.items);
    let totals = nest_report::report_totals(&sheets);
    let verify = nest_report::verify_layout(&s.containers, &s.items, s.space);
    serde_json::to_string(&serde_json::json!({
        "per_sheet": sheets,
        "totals": totals,
        "verify": verify,
    }))
    .map_err(|e| JsError::new(&format!("{e}")))
}

/// Spec commune aux exports DXF (une source ou tôle combinée multi-sources).
#[derive(serde::Deserialize)]
struct DxfSheetSpec {
    transforms: Vec<nest_export::Placement>,
    #[serde(default)]
    space: f64,
    #[serde(default)]
    add_out_shape: bool,
    bin_width: Option<f64>,
    bin_height: Option<f64>,
    #[serde(default = "mm_default")]
    output_unit: String,
}

fn mm_default() -> String {
    "mm".into()
}

/// export_dxf(dxf_bytes_source, json {transforms, space, add_out_shape,
/// bin_width, bin_height, output_unit}) -> DXF texte (une source).
#[wasm_bindgen]
pub fn export_dxf(source: &[u8], json: &str) -> Result<String, JsError> {
    let i: DxfSheetSpec = serde_json::from_str(json).map_err(|e| JsError::new(&format!("{e}")))?;
    let doc = nest_import::dxf::Document::parse(source).map_err(|e| JsError::new(&format!("{e}")))?;
    let mut sources = std::collections::HashMap::new();
    sources.insert("src".to_string(), (doc.entities, doc.blocks));
    let mut t = i.transforms;
    for p in t.iter_mut() {
        p.file_slug = "src".into();
    }
    Ok(nest_export::build_part_dxf(
        &sources,
        &t,
        i.add_out_shape,
        i.space,
        i.bin_width,
        i.bin_height,
        &i.output_unit,
    ))
}

/// export_dxf_sheet(slugs, sources, json) -> DXF texte d'une TÔLE COMBINÉE,
/// jumeau navigateur de build_part (core/main.py) : plusieurs fichiers
/// source (un par slug, bytes DXF canoniques mm), transforms portant leur
/// file_slug — les entités sont copiées PAR HANDLE depuis chaque source.
/// J-082 : parité byte-level des téléchargements Mode Local multi-fichiers.
#[wasm_bindgen]
pub fn export_dxf_sheet(
    slugs: Box<[String]>,
    sources: Box<[js_sys::Uint8Array]>,
    json: &str,
) -> Result<String, JsError> {
    let i: DxfSheetSpec = serde_json::from_str(json).map_err(|e| JsError::new(&format!("{e}")))?;
    if slugs.len() != sources.len() {
        return Err(JsError::new("slugs/sources length mismatch"));
    }
    let mut map = std::collections::HashMap::new();
    for (slug, bytes) in slugs.iter().zip(sources.iter()) {
        let doc = nest_import::dxf::Document::parse(&bytes.to_vec())
            .map_err(|e| JsError::new(&format!("parsing source {slug}: {e}")))?;
        map.insert(slug.clone(), (doc.entities, doc.blocks));
    }
    Ok(nest_export::build_part_dxf(
        &map,
        &i.transforms,
        i.add_out_shape,
        i.space,
        i.bin_width,
        i.bin_height,
        &i.output_unit,
    ))
}
