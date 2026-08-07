//! nest-export-cli — driver du harnais de parité exports.
//! Entrée JSON (stdin ou fichier) :
//!   { "sources": {slug: "<chemin dxf>"}, "transforms": [...],
//!     "items": {id: {coords,holes,color}}, "bin_width", "bin_height",
//!     "space", "add_out_shape", "output_unit", "mode": "dxf"|"colored" }
//! Sortie : le texte DXF ou SVG sur stdout.

use nest_export::svg::{build_colored_sheet_svg, Item};
use nest_export::transform::Placement;
use nest_export::{build_part_dxf, dxf_writer};
use nest_import::dxf::Document;
use std::collections::HashMap;
use std::io::Read;

#[derive(serde::Deserialize)]
struct Spec {
    #[serde(default)]
    sources: HashMap<String, String>,
    transforms: Vec<Placement>,
    #[serde(default)]
    items: HashMap<String, Item>,
    bin_width: Option<f64>,
    bin_height: Option<f64>,
    #[serde(default)]
    space: f64,
    #[serde(default)]
    add_out_shape: bool,
    #[serde(default = "default_unit")]
    output_unit: String,
    mode: String,
}
fn default_unit() -> String {
    "mm".into()
}

fn main() {
    let mut buf = String::new();
    std::io::stdin().read_to_string(&mut buf).unwrap();
    let spec: Spec = serde_json::from_str(&buf).unwrap();

    match spec.mode.as_str() {
        "dxf" => {
            let mut sources: HashMap<String, (Vec<_>, Vec<_>)> = HashMap::new();
            for (slug, path) in &spec.sources {
                let bytes = std::fs::read(path).unwrap();
                let doc = Document::parse(&bytes).unwrap();
                sources.insert(slug.clone(), (doc.entities, doc.blocks));
            }
            let (scale, ins, meas) = dxf_writer::output_scale_and_headers(&spec.output_unit);
            let _ = (scale, ins, meas);
            let text = build_part_dxf(
                &sources,
                &spec.transforms,
                spec.add_out_shape,
                spec.space,
                spec.bin_width,
                spec.bin_height,
                &spec.output_unit,
            );
            print!("{text}");
        }
        "colored" => {
            let text = build_colored_sheet_svg(
                &spec.transforms,
                &spec.items,
                spec.bin_width.unwrap_or(0.0),
                spec.bin_height.unwrap_or(0.0),
                1.0,
                "mm",
            );
            print!("{text}");
        }
        other => {
            eprintln!("mode inconnu {other}");
            std::process::exit(2);
        }
    }
}
