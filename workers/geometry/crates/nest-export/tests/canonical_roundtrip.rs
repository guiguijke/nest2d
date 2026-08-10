//! Verrou central J-090 (cohérence handles ↔ bytes canoniques) :
//! import → canonical_dxf → ré-export à transformation IDENTITÉ via
//! nest-export::build_part_dxf — AUCUN handle ne doit manquer à l'export,
//! et la géométrie ré-exportée recouvre la géométrie importée.

use nest_export::Placement;

const BLOCKS_NESTED: &[u8] = include_bytes!("../../../parity/corpus_extra/blocks_nested.dxf");
const PIECE_TROU: &[u8] = include_bytes!("../../../../fileprocessing/tests/fixtures/Piece_Trou.DXF");
const SVG_HOLED: &[u8] = include_bytes!("../../../parity/corpus_svg/svg_holed_plate.svg");

fn count_entities(dxf: &str) -> usize {
    dxf.lines()
        .zip(dxf.lines().skip(1))
        .filter(|(c, v)| c.trim() == "0" && matches!(v.trim(), "LINE" | "LWPOLYLINE" | "POLYLINE" | "ARC" | "CIRCLE" | "ELLIPSE" | "SPLINE" | "POINT"))
        .count()
}

fn roundtrip_identity(name: &str, src: &[u8]) {
    // 1) import → parts + handles canoniques.
    let res = nest_import::import_file(src, 0.01).expect("import");
    assert!(!res.parts.is_empty(), "{name}: aucune pièce");
    // 2) canonical_dxf → bytes canoniques mm.
    let canonical = nest_import::canonical_dxf(src, 0.01).expect("canonical_dxf");
    let doc = nest_import::dxf::Document::parse(&canonical).expect("reparse canonical");
    let canonical_handle_count = doc.entities.len();

    // 3) ré-export à transformation identité : une pièce = un placement,
    //    handles = ceux de la pièce (le contrat de build_part).
    let mut sources = std::collections::HashMap::new();
    sources.insert("src".to_string(), (doc.entities, doc.blocks));
    let transforms: Vec<Placement> = res
        .parts
        .iter()
        .enumerate()
        .map(|(i, p)| Placement {
            item_id: format!("part{i}"),
            file_slug: "src".into(),
            handles: p.handles.clone(),
            angle: 0.0,
            x: 0.0,
            y: 0.0,
            color: None,
        })
        .collect();
    let out = nest_export::build_part_dxf(&sources, &transforms, false, 0.0, None, None, "mm");

    // 4) le nombre d'entités ré-émises doit couvrir TOUTES les entités
    //    référencées par les handles (un handle absent des bytes canoniques
    //    serait SILENCIEUSEMENT sauté par build_part_dxf — c'est ça le verrou).
    let referenced: usize = res.parts.iter().map(|p| p.handles.len()).sum();
    let emitted = count_entities(&out);
    assert_eq!(
        emitted, referenced,
        "{name}: {referenced} handles référencés mais {emitted} entités émises — handle(s) perdu(s)"
    );
    //    et toutes les entités canoniques sont référencées par au moins une
    //    pièce (couverture complète sur ce corpus).
    assert_eq!(
        referenced, canonical_handle_count,
        "{name}: des entités canoniques ne sont rattachées à aucune pièce"
    );
}

#[test]
fn export_identity_finds_every_entity_by_handle_blocks_nested() {
    roundtrip_identity("blocks_nested", BLOCKS_NESTED);
}

#[test]
fn export_identity_finds_every_entity_by_handle_piece_trou() {
    roundtrip_identity("piece_trou", PIECE_TROU);
}

#[test]
fn export_identity_finds_every_entity_by_handle_svg_holed() {
    roundtrip_identity("svg_holed", SVG_HOLED);
}

#[test]
fn export_identity_geometry_matches_part_bbox() {
    // À transformation identité, la bbox des entités émises pour une pièce
    // doit recouvrir la bbox de la pièce importée (± tolérance de flattening
    // : les anneaux de nesting sont des cordes, les entités sources les
    // courbes — l'écart est ≤ tol pour un arc, 0 pour des traits).
    let res = nest_import::import_file(BLOCKS_NESTED, 0.01).expect("import");
    let canonical = nest_import::canonical_dxf(BLOCKS_NESTED, 0.01).expect("canonical");
    let doc = nest_import::dxf::Document::parse(&canonical).expect("reparse");
    let mut sources = std::collections::HashMap::new();
    sources.insert("src".to_string(), (doc.entities, doc.blocks));
    for (i, p) in res.parts.iter().enumerate() {
        let transforms = vec![Placement {
            item_id: format!("part{i}"),
            file_slug: "src".into(),
            handles: p.handles.clone(),
            angle: 0.0,
            x: 0.0,
            y: 0.0,
            color: None,
        }];
        let out = nest_export::build_part_dxf(&sources, &transforms, false, 0.0, None, None, "mm");
        let out_doc = nest_import::dxf::Document::parse(out.as_bytes()).expect("reparse out");
        let mut xs: Vec<f64> = Vec::new();
        let mut ys: Vec<f64> = Vec::new();
        for e in &out_doc.entities {
            match e {
                nest_import::dxf::entities::Entity::LwPolyline(pl) => {
                    xs.extend(pl.points.iter().map(|q| q[0]));
                    ys.extend(pl.points.iter().map(|q| q[1]));
                }
                nest_import::dxf::entities::Entity::Circle(c) => {
                    xs.push(c.center[0] - c.radius);
                    xs.push(c.center[0] + c.radius);
                    ys.push(c.center[1] - c.radius);
                    ys.push(c.center[1] + c.radius);
                }
                _ => {}
            }
        }
        let w = xs.iter().cloned().fold(f64::NEG_INFINITY, f64::max)
            - xs.iter().cloned().fold(f64::INFINITY, f64::min);
        let h = ys.iter().cloned().fold(f64::NEG_INFINITY, f64::max)
            - ys.iter().cloned().fold(f64::INFINITY, f64::min);
        assert!(
            (w - p.width).abs() <= 0.02 && (h - p.height).abs() <= 0.02,
            "part{i}: bbox émise {w}×{h} vs importée {}×{}",
            p.width,
            p.height
        );
    }
}
