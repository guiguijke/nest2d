//! Dump a 100-host + 400-filler style DXF for the JS viewer probe.
use nest_export::Placement;
use std::collections::HashMap;

#[test]
fn write_trou_fill_sheet() {
    let trou = include_bytes!("../../../../fileprocessing/tests/fixtures/Piece_Trou.DXF");
    let fill = include_bytes!("../../../../fileprocessing/tests/fixtures/Piece_Fillx4.DXF");
    let t_can = nest_import::canonical_dxf(trou, 0.01).unwrap();
    let f_can = nest_import::canonical_dxf(fill, 0.01).unwrap();
    let t_doc = nest_import::dxf::Document::parse(&t_can).unwrap();
    let f_doc = nest_import::dxf::Document::parse(&f_can).unwrap();
    let t_imp = nest_import::import_file(trou, 0.01).unwrap();
    let f_imp = nest_import::import_file(fill, 0.01).unwrap();
    let t_h = t_imp.parts[0].handles.clone();
    let f_h = f_imp.parts[0].handles.clone();

    let mut sources = HashMap::new();
    sources.insert("trou".into(), (t_doc.entities, t_doc.blocks));
    sources.insert("fill".into(), (f_doc.entities, f_doc.blocks));

    let mut transforms = Vec::new();
    for i in 0..100 {
        let col = i / 17;
        let row = i % 17;
        transforms.push(Placement {
            item_id: format!("h{i}"),
            file_slug: "trou".into(),
            handles: t_h.clone(),
            angle: 0.0,
            x: 2.0 + col as f64 * 102.0,
            y: 2.0 + row as f64 * 102.0,
            color: None,
        });
        for k in 0..4 {
            transforms.push(Placement {
                item_id: format!("f{i}-{k}"),
                file_slug: "fill".into(),
                handles: f_h.clone(),
                angle: (k as f64) * std::f64::consts::FRAC_PI_2,
                x: 2.0 + col as f64 * 102.0 + 50.0,
                y: 2.0 + row as f64 * 102.0 + 50.0,
                color: None,
            });
        }
    }
    let out = nest_export::build_part_dxf(&sources, &transforms, false, 2.0, Some(1000.0), Some(2000.0), "mm");
    let n = out.matches("\nCIRCLE\n").count() + out.matches("\nARC\n").count() + out.matches("\nLINE\n").count();
    assert!(n > 1000, "entities {n}");
    assert!(!out.contains("\nnan\n") && !out.contains("\ninf\n"), "non-finite");
    let mut handles = Vec::new();
    let lines: Vec<&str> = out.lines().collect();
    for i in 0..lines.len().saturating_sub(1) {
        if lines[i].trim() == "5" {
            handles.push(lines[i + 1].trim().to_string());
        }
    }
    let uniq: std::collections::BTreeSet<_> = handles.iter().cloned().collect();
    // ≥ 1 handle par pièce (100×5 + 400×3 + BIN) ; l'unicité porte sur
    // les valeurs, pas le décompte naïf des lignes « 5 » (une cote peut
    // valoir 5.0 et n'est pas un handle).
    assert!(uniq.len() >= 1700, "unique handles {} (want ≥ 1700)", uniq.len());
}
