//! Verrous J-090 sur corpus réel : handles par pièce (parité avec le
//! pipeline Python : build_geometry sur le document canonique rebuildé) et
//! `canonical_dxf` (bytes canoniques mm, séquence de handles ezdxf fraîche).
//!
//! Les valeurs attendues ont été générées le 2026-08-10 via
//! workers/fileprocessing (read_dxf_file + build_geometry.to_mongo_dict) —
//! NE PAS « corriger » sans régénérer côté Python.

use nest_import::dxf::decompose;
use nest_import::dxf::entities::Entity;
use nest_import::dxf::Document;

const BLOCKS_NESTED: &[u8] = include_bytes!("../../../parity/corpus_extra/blocks_nested.dxf");
const TWO_PARTS: &[u8] = include_bytes!("../../../parity/corpus_extra/two_parts.dxf");
const UNITS_IN: &[u8] = include_bytes!("../../../parity/corpus_extra/units_in.dxf");
const LEGACY_POLYLINE: &[u8] = include_bytes!("../../../parity/corpus_extra/legacy_polyline.dxf");
const PIECE_TROU: &[u8] = include_bytes!("../../../../fileprocessing/tests/fixtures/Piece_Trou.DXF");
const PIECE_FILLX4: &[u8] = include_bytes!("../../../../fileprocessing/tests/fixtures/Piece_Fillx4.DXF");
const CURVES_CLOSED: &[u8] = include_bytes!("../../../parity/corpus_extra/curves_closed.dxf");
const CURVES_MIX: &[u8] = include_bytes!("../../../parity/corpus_extra/curves_mix.dxf");
const SVG_HOLED: &[u8] = include_bytes!("../../../parity/corpus_svg/svg_holed_plate.svg");

fn handles_of(res: &nest_import::ImportResult) -> Vec<&[String]> {
    res.parts.iter().map(|p| p.handles.as_slice()).collect()
}

#[test]
fn blocks_nested_handles_match_python() {
    // INSERTs (dont un IMBRIQUÉ) : les entités décomposées reçoivent la
    // séquence canonique fraîche 2F/30/31 dans l'ordre modelspace — PAS les
    // handles source (36/32/32) ni ceux des INSERTs (37/39/3B). Le carré 0..20
    // vient du 2e INSERT (handle canonique 31), le cercle du 1er (2F).
    let r = nest_import::import_file(BLOCKS_NESTED, 0.01).expect("import");
    assert_eq!(r.parts.len(), 3);
    assert_eq!(
        handles_of(&r),
        vec![&["31".to_string()][..], &["2F".to_string()][..], &["30".to_string()][..]]
    );
}

#[test]
fn two_parts_handles_match_python() {
    let r = nest_import::import_file(TWO_PARTS, 0.01).expect("import");
    assert_eq!(
        handles_of(&r),
        vec![&["2F".to_string()][..], &["30".to_string()][..]]
    );
}

#[test]
fn units_inch_handles_match_python_and_geometry_is_mm() {
    let r = nest_import::import_file(UNITS_IN, 0.01).expect("import");
    assert_eq!(r.parts.len(), 1);
    assert_eq!(r.parts[0].handles, vec!["2F"]);
    assert!((r.parts[0].width - 100.0).abs() < 1e-9, "w={}", r.parts[0].width);
    assert!((r.parts[0].height - 50.0).abs() < 1e-9);
}

#[test]
fn legacy_polyline_handle_match_python() {
    let r = nest_import::import_file(LEGACY_POLYLINE, 0.01).expect("import");
    assert_eq!(r.parts.len(), 1);
    assert_eq!(r.parts[0].handles, vec!["2F"]);
}

#[test]
fn piece_trou_handles_match_python() {
    // CERCLE (contour du trou) + 4 LINEs (carré externe) + POINT (dans le
    // vide, fallback centroïde) : les 6 handles sur l'unique pièce, dans
    // l'ordre modelspace. Verrou de l'attachement (encre↔corps + fallback).
    let r = nest_import::import_file(PIECE_TROU, 0.01).expect("import");
    assert_eq!(r.parts.len(), 1);
    assert_eq!(r.parts[0].holes.len(), 1);
    assert_eq!(
        r.parts[0].handles,
        vec!["2F", "30", "31", "32", "33", "34"]
    );
}

#[test]
fn piece_fillx4_handles_match_python() {
    // ARC + 2 LINEs inclinés (jonctions à √2 — le snap y décale les points
    // de split nodés) + POINT hors de toute silhouette (non attaché, comme
    // Python). Verrou de l'arête de bouclage (cycle_edges) et de la bande
    // « sur le bord » au quantum de la grille.
    let r = nest_import::import_file(PIECE_FILLX4, 0.01).expect("import");
    assert_eq!(r.parts.len(), 1);
    assert_eq!(r.parts[0].handles, vec!["2F", "30", "31"]);
}

#[test]
fn invalid_spline_is_dropped_like_ezdxf_recover() {
    // ezdxf.recover retire à l'audit les SPLINEs à vecteur de nœuds invalide
    // (knots < control + degree + 1) — hors modelspace, hors entity_count,
    // hors séquence de handles (verrou : curves_closed / curves_mix).
    let r = nest_import::import_file(CURVES_CLOSED, 0.01).expect("import");
    assert_eq!(r.entity_count, 1);
    assert_eq!(r.parts.len(), 1);
    assert_eq!(r.parts[0].handles, vec!["2F"]);
    let r = nest_import::import_file(CURVES_MIX, 0.01).expect("import");
    assert_eq!(r.entity_count, 2);
    assert_eq!(r.parts.len(), 1);
    assert_eq!(r.parts[0].handles, vec!["2F", "30"]);
}

#[test]
fn svg_holed_plate_handles_match_python() {
    let r = nest_import::import_file(SVG_HOLED, 0.01).expect("import");
    assert_eq!(r.parts.len(), 1);
    assert_eq!(r.parts[0].holes.len(), 1);
    assert_eq!(r.parts[0].handles, vec!["2F", "30"]);
}

// ------------------------------------------------------------ canonical_dxf

#[test]
fn canonical_dxf_blocks_nested_carries_canonical_handles() {
    let bytes = nest_import::canonical_dxf(BLOCKS_NESTED, 0.01).expect("canonical");
    let doc = Document::parse(&bytes).expect("reparse");
    assert_eq!(doc.source_insunits, 4, "$INSUNITS=4 canonique");
    let kinds: Vec<(&str, &str)> = doc
        .entities
        .iter()
        .map(|e| match e {
            Entity::Circle(c) => ("CIRCLE", c.common.handle.as_str()),
            Entity::LwPolyline(p) => ("LWPOLYLINE", p.common.handle.as_str()),
            other => panic!("unexpected entity {other:?}"),
        })
        .collect();
    // Mêmes entités, même ordre, mêmes handles que la vérité Python.
    assert_eq!(kinds, vec![("CIRCLE", "2F"), ("LWPOLYLINE", "30"), ("LWPOLYLINE", "31")]);
    // INSERTs résolus : plus aucun bloc utile ni INSERT dans les bytes.
    assert!(doc.blocks.is_empty());
}

#[test]
fn canonical_dxf_scales_foreign_units_to_mm() {
    let bytes = nest_import::canonical_dxf(UNITS_IN, 0.01).expect("canonical");
    let doc = Document::parse(&bytes).expect("reparse");
    match &doc.entities[0] {
        Entity::LwPolyline(p) => {
            let xs: Vec<f64> = p.points.iter().map(|q| q[0]).collect();
            let ys: Vec<f64> = p.points.iter().map(|q| q[1]).collect();
            let w = xs.iter().cloned().fold(f64::NEG_INFINITY, f64::max)
                - xs.iter().cloned().fold(f64::INFINITY, f64::min);
            let h = ys.iter().cloned().fold(f64::NEG_INFINITY, f64::max)
                - ys.iter().cloned().fold(f64::INFINITY, f64::min);
            assert!((w - 100.0).abs() < 1e-9, "w={w} mm attendu (×25.4)");
            assert!((h - 50.0).abs() < 1e-9, "h={h}");
        }
        other => panic!("expected LwPolyline, got {other:?}"),
    }
}

#[test]
fn canonical_dxf_legacy_polyline_consumes_vertex_handles() {
    let bytes = nest_import::canonical_dxf(LEGACY_POLYLINE, 0.01).expect("canonical");
    let doc = Document::parse(&bytes).expect("reparse");
    match &doc.entities[0] {
        Entity::Polyline(p) => {
            assert_eq!(p.common.handle, "2F");
            assert_eq!(p.points.len(), 4);
        }
        other => panic!("expected POLYLINE, got {other:?}"),
    }
}

#[test]
fn canonical_dxf_svg_synthesizes_lwpolylines_with_handles() {
    let bytes = nest_import::canonical_dxf(SVG_HOLED, 0.01).expect("canonical");
    let doc = Document::parse(&bytes).expect("reparse");
    assert_eq!(doc.source_insunits, 4);
    let handles: Vec<&str> = doc
        .entities
        .iter()
        .map(|e| match e {
            Entity::LwPolyline(p) => p.common.handle.as_str(),
            other => panic!("unexpected entity {other:?}"),
        })
        .collect();
    assert_eq!(handles, vec!["2F", "30"]);
}

#[test]
fn canonical_dxf_is_idempotent() {
    // Sources DXF : point fixe byte-level (le chemin DXF→DXF est stable).
    for (name, src) in [
        ("blocks_nested", BLOCKS_NESTED),
        ("two_parts", TWO_PARTS),
        ("units_in", UNITS_IN),
        ("legacy_polyline", LEGACY_POLYLINE),
    ] {
        let once = nest_import::canonical_dxf(src, 0.01).expect("canonical");
        let twice = nest_import::canonical_dxf(&once, 0.01).expect("re-canonical");
        assert_eq!(once, twice, "idempotence brisée sur {name}");
    }
    // Source SVG : la synthèse déclare AC1024 (ezdxf.new("R2010") côté
    // Python) ; relue par le chemin DXF elle est réémise en AC1027
    // (ezdxf.new() — exactement comme une copie validDxf relue par read_dxf
    // côté Python). Les ENTITÉS (ordre, handles, géométrie) sont stables :
    // c'est ça l'idempotence qui importe pour l'export par handle.
    let once = nest_import::canonical_dxf(SVG_HOLED, 0.01).expect("canonical");
    let twice = nest_import::canonical_dxf(&once, 0.01).expect("re-canonical");
    let thrice = nest_import::canonical_dxf(&twice, 0.01).expect("re-re-canonical");
    assert_eq!(twice, thrice, "le point fixe DXF doit être stable");
    let d1 = Document::parse(&once).expect("reparse once");
    let d2 = Document::parse(&twice).expect("reparse twice");
    let sig = |d: &Document| {
        d.entities
            .iter()
            .map(|e| format!("{:?}", decompose::primitive_of(e)))
            .collect::<Vec<_>>()
    };
    assert_eq!(sig(&d1), sig(&d2), "entités canoniques SVG instables");
}

#[test]
fn import_handles_match_canonical_bytes_handles() {
    // Le verrou central : chaque handle de parts[].handles EXISTE dans les
    // bytes canoniques (re-parsés) — condition de l'export par handle.
    for (name, src) in [
        ("blocks_nested", BLOCKS_NESTED),
        ("two_parts", TWO_PARTS),
        ("units_in", UNITS_IN),
        ("legacy_polyline", LEGACY_POLYLINE),
        ("piece_trou", PIECE_TROU),
        ("svg_holed", SVG_HOLED),
    ] {
        let res = nest_import::import_file(src, 0.01).expect("import");
        let bytes = nest_import::canonical_dxf(src, 0.01).expect("canonical");
        let doc = Document::parse(&bytes).expect("reparse");
        let present: std::collections::HashSet<&str> =
            doc.entities.iter().map(|e| e.handle()).collect();
        for p in &res.parts {
            for h in &p.handles {
                assert!(present.contains(h.as_str()), "{name}: handle {h} absent des bytes canoniques");
            }
        }
    }
}
