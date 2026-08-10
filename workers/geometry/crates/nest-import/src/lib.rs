//! nest-import — DXF → polygon parts in canonical millimeters.
//!
//! Dual-target (native lib + wasm32) and bit-exact against the Python
//! pipeline (workers/fileprocessing): same entity subset, same tessellation
//! formulas (ezdxf replication), same assembly rules (build_geometry).
//! Reference: docs/PIPELINE-MAP.md, AGENTS.md #14b (libm everywhere).

pub mod assemble;
pub mod attach;
pub mod dxf;
#[cfg(feature = "svg")]
pub mod svg;
pub mod units;
#[cfg(feature = "wasm")]
mod wasm;

use serde::Serialize;

/// One imported part: closed outer ring (CW) + hole rings (CCW), mm, y-up —
/// the orientation GEOS emits on this pipeline (measured on the golden
/// corpus, see assemble.rs). Coordinates carry the pipeline's reduction
/// (reduce_ring, 0.01 mm) and the 1e-4 precision grid — identical to the
/// Python output.
#[derive(Debug, Clone, Serialize)]
pub struct Part {
    pub coordinates: Vec<[f64; 2]>,
    pub holes: Vec<Vec<[f64; 2]>>,
    /// Handles DXF CANONIQUES des entités sources de la pièce (J-090) —
    /// jumeau de `ClosedPolygon.handles` (build_geometry.py). Ce sont les
    /// handles du document REBUILDÉ (séquence ezdxf fraîche, dxf/canonical.rs),
    /// les mêmes que portent les bytes de `canonical_dxf` — verrou de
    /// l'export DXF par handle (nest-export::build_part_dxf).
    /// Champ ADDITIF : les consommateurs JSON actuels l'ignorent.
    pub handles: Vec<String>,
    pub width: f64,
    pub height: f64,
}

/// Warnings mirror the Python logger's user-visible outcomes (skipped
/// entities, repairs) — the app surfaces them identically.
#[derive(Debug, Clone, Serialize)]
pub struct ImportResult {
    pub parts: Vec<Part>,
    /// $INSUNITS code of the source document (0 = unitless).
    pub source_units: i32,
    /// Modelspace entity count after cleanup (MAX_ENTITY_LIMIT gate input).
    pub entity_count: usize,
    pub warnings: Vec<String>,
}

#[derive(Debug)]
pub enum ImportError {
    /// Unreadable / severely corrupt document (ezdxf recover failure twin).
    Corrupt(String),
}

impl std::fmt::Display for ImportError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ImportError::Corrupt(msg) => write!(f, "{msg}"),
        }
    }
}
impl std::error::Error for ImportError {}

/// Import a DXF document (bytes) to polygon parts in canonical mm.
/// `flatten_tol` = sagitta/distance tolerance in mm (the job's `flattening`
/// parameter — 0.01 in production, clamped to ≥ 0.001 like the Python side).
pub fn import_dxf(bytes: &[u8], flatten_tol: f64) -> Result<ImportResult, ImportError> {
    let doc = dxf::Document::parse(bytes)?;
    let (entities, mut warnings) = dxf::flattened_modelspace(&doc);
    let (linework, w2, entity_count) = assemble::collect_linework(&entities, flatten_tol);
    warnings.extend(w2);
    let parts = assemble::build_parts(linework, flatten_tol);
    Ok(ImportResult {
        parts,
        source_units: doc.source_insunits,
        entity_count,
        warnings,
    })
}

/// Import an SVG document (bytes) to polygon parts in canonical mm.
/// Same output contract as import_dxf (y flipped, px→mm upstream).
#[cfg(feature = "svg")]
pub fn import_svg(bytes: &[u8], flatten_tol: f64) -> Result<ImportResult, ImportError> {
    svg::import_svg(bytes, flatten_tol)
}

/// Format detection by CONTENT signature (AGENTS #31 — jamais l'extension) :
/// BOM/whitespace then '<' = SVG (XML), anything else = DXF.
#[cfg(feature = "svg")]
pub fn import_file(bytes: &[u8], flatten_tol: f64) -> Result<ImportResult, ImportError> {
    if is_svg_signature(bytes) {
        return svg::import_svg(bytes, flatten_tol);
    }
    import_dxf(bytes, flatten_tol)
}

#[cfg(not(feature = "svg"))]
pub fn import_file(bytes: &[u8], flatten_tol: f64) -> Result<ImportResult, ImportError> {
    import_dxf(bytes, flatten_tol)
}

/// Détection de format par signature de contenu (AGENTS #31) — `true` si SVG.
#[cfg(feature = "svg")]
fn is_svg_signature(bytes: &[u8]) -> bool {
    let head = &bytes[..bytes.len().min(1024)];
    let mut i = 0;
    // UTF-8 BOM
    if head.starts_with(&[0xEF, 0xBB, 0xBF]) {
        i = 3;
    }
    while i < head.len() && (head[i] as char).is_whitespace() {
        i += 1;
    }
    i < head.len() && head[i] == b'<'
}

/// Bytes DXF canoniques mm (J-090) — jumeau de `_make_dxf_copy`
/// (workers/fileprocessing/core/main.py) : la copie `validDxf` est TOUJOURS
/// un DXF rebuildé en mm ($INSUNITS=4, $MEASUREMENT=1), entities décomposées
/// (INSERTs résolus), handles frais séquentiels ezdxf (2F, 30, 31, … —
/// voir dxf/canonical.rs). SVG → LWPOLYLINEs synthétisés depuis les rings
/// (même flattening 0,5 px que l'import, svg_bytes_to_drawing twin).
/// `flatten_tol` est accepté pour symétrie d'API mais inutilisé : la copie
/// canonique garde les courbes ENTIÈRES (ARC/SPLINE…), le flattening n'agit
/// que dans build_geometry — pareil côté Python.
#[cfg(feature = "svg")]
pub fn canonical_dxf(bytes: &[u8], _flatten_tol: f64) -> Result<Vec<u8>, ImportError> {
    if is_svg_signature(bytes) {
        return svg::canonical_dxf(bytes);
    }
    let doc = dxf::Document::parse(bytes)?;
    Ok(dxf::canonical::canonical_dxf_bytes(&doc))
}

#[cfg(not(feature = "svg"))]
pub fn canonical_dxf(bytes: &[u8], _flatten_tol: f64) -> Result<Vec<u8>, ImportError> {
    let doc = dxf::Document::parse(bytes)?;
    Ok(dxf::canonical::canonical_dxf_bytes(&doc))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// DXF minimal embarqué : une LWPOLYLINE fermée 100×50, sans HEADER
    /// ($INSUNITS absent → 0, mm supposés).
    const RECT_DXF: &str = "0\nSECTION\n2\nENTITIES\n\
        0\nLWPOLYLINE\n90\n4\n70\n1\n\
        10\n0.0\n20\n0.0\n10\n100.0\n20\n0.0\n\
        10\n100.0\n20\n50.0\n10\n0.0\n20\n50.0\n\
        0\nENDSEC\n0\nEOF\n";

    #[test]
    fn end_to_end_minimal_dxf() {
        let r = import_dxf(RECT_DXF.as_bytes(), 0.01).expect("parse");
        assert_eq!(r.source_units, 0);
        assert_eq!(r.entity_count, 1);
        assert_eq!(r.parts.len(), 1);
        let p = &r.parts[0];
        assert_eq!(p.width, 100.0);
        assert_eq!(p.height, 50.0);
        assert_eq!(p.coordinates.len(), 5);
    }

    #[test]
    fn corrupt_input_is_a_clean_error() {
        assert!(matches!(import_dxf(b"\x00\x01\x02", 0.01), Err(ImportError::Corrupt(_))));
    }

    /// Preservation channel (PR3): bulges + color + closed are kept for the
    /// export DXF, while the NESTING rings stay straight-chorded (D-IMP-8).
    #[test]
    fn preservation_keeps_bulges_color_closed_without_touching_rings() {
        let dxf = "0\nSECTION\n2\nENTITIES\n\
            0\nLWPOLYLINE\n5\nAA\n8\nCUT\n62\n3\n70\n1\n\
            10\n0.0\n20\n0.0\n42\n0.5\n\
            10\n100.0\n20\n0.0\n42\n0.0\n\
            10\n100.0\n20\n50.0\n42\n0.0\n\
            10\n0.0\n20\n50.0\n42\n0.0\n\
            0\nENDSEC\n0\nEOF\n";
        let doc = dxf::Document::parse(dxf.as_bytes()).expect("parse");
        let e = &doc.entities[0];
        match e {
            dxf::entities::Entity::LwPolyline(p) => {
                assert!(p.closed);
                assert_eq!(p.common.layer, "CUT");
                assert_eq!(p.common.color, 3);
                assert_eq!(p.bulges, vec![0.5, 0.0, 0.0, 0.0]);
            }
            other => panic!("expected LwPolyline, got {other:?}"),
        }
        // The nesting rings ignore bulges: same part bbox as the chorded rect.
        let r = import_dxf(dxf.as_bytes(), 0.01).expect("import");
        assert_eq!(r.parts.len(), 1);
        assert_eq!(r.parts[0].width, 100.0);
        assert_eq!(r.parts[0].height, 50.0);
    }

    #[cfg(feature = "svg")]
    #[test]
    fn end_to_end_minimal_svg() {
        // Rectangle 96×48 px = 25.4×12.7 mm, y inversé (le signe disparaît
        // dans width/height mais l'aire le prouve).
        let svg = br#"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 48"><rect x="0" y="0" width="96" height="48"/></svg>"#;
        let r = import_svg(svg, 0.01).expect("parse");
        assert_eq!(r.parts.len(), 1);
        assert!((r.parts[0].width - 25.4).abs() < 1e-9, "w={}", r.parts[0].width);
        assert!((r.parts[0].height - 12.7).abs() < 1e-9);
    }

    #[cfg(feature = "svg")]
    #[test]
    fn svg_without_geometry_is_a_clean_error() {
        let svg = br#"<svg xmlns="http://www.w3.org/2000/svg"><text>hi</text></svg>"#;
        assert!(matches!(import_svg(svg, 0.01), Err(ImportError::Corrupt(_))));
    }
}
