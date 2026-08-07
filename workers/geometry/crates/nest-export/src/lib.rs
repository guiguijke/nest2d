//! nest-export — exports de résultat (DXF de tôle cut-ready, SVG coloré /
//! preview) en Rust dual-cible, parité avec les workers Python
//! (docs/PIPELINE-MAP.md §1.6). Voir dxf_writer / svg / pyfloat.

pub mod bbox;
pub mod dxf_writer;
pub mod pyfloat;
pub mod svg;
pub mod transform;

#[cfg(feature = "wasm")]
pub mod wasm;

pub use dxf_writer::build_part_dxf;
pub use transform::Placement;
