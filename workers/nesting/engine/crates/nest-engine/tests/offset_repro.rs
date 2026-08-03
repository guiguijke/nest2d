//! Lock for the jagua offset path on small parts: a 15x80 mm bar stored CW
//! (GEOS convention, exactly as Mongo serves it) must survive item import
//! (inflate + surrogate) at every supported separation. Born while hunting
//! the "Offset resulted in an empty polygon" panic — root cause was the
//! SPP initial strip width (area/height) being deflated below zero, NOT the
//! item offset; kept as a cheap regression net for both.
//! Run: cargo test --release -p nest-engine --test offset_repro -- --nocapture

use jagua_rs::entities::Item;
use jagua_rs::geometry::fail_fast::SPSurrogateConfig;
use jagua_rs::geometry::geo_enums::RotationRange;
use jagua_rs::geometry::shape_modification::{
    offset_shape, ShapeModifyConfig, ShapeModifyMode,
};
use jagua_rs::geometry::OriginalShape;
use jagua_rs::io::ext_repr::ExtSPolygon;
use jagua_rs::io::import::import_simple_polygon;

const SURROGATE: SPSurrogateConfig = SPSurrogateConfig {
    n_pole_limits: [(64, 0.0), (16, 0.8), (8, 0.9)],
    n_ff_poles: 1,
    n_ff_piers: 0,
};

fn offset_of(ring: &[(f32, f32)], distance: f32) -> String {
    let sp = import_simple_polygon(&ExtSPolygon(ring.to_vec())).unwrap();
    match offset_shape(&sp, ShapeModifyMode::Inflate, distance) {
        Ok(s) => format!("OK area={:.1} vertices={}", s.area, s.vertices.len()),
        Err(e) => format!("ERR {e}"),
    }
}

fn item_new_of(ring: &[(f32, f32)], separation: f32) -> String {
    let sp = import_simple_polygon(&ExtSPolygon(ring.to_vec())).unwrap();
    let orig = OriginalShape {
        shape: sp,
        pre_transform: jagua_rs::geometry::DTransformation::empty(),
        modify_mode: ShapeModifyMode::Inflate,
        modify_config: ShapeModifyConfig {
            offset: Some(separation / 2.0),
            simplify_tolerance: Some(0.001),
            narrow_concavity_cutoff: None,
        },
    };
    match Item::new(0, orig, RotationRange::None, None, SURROGATE) {
        Ok(_) => "OK".to_string(),
        Err(e) => format!("ERR {e}"),
    }
}

#[test]
fn cw_bar_15x80_offsets() {
    // The demo bar, stored CW (GEOS convention) exactly as Mongo serves it.
    let ring: Vec<(f32, f32)> = vec![
        (0.0, 0.0),
        (0.0, 80.0),
        (15.0, 80.0),
        (15.0, 0.0),
        (0.0, 0.0),
    ];
    for distance in [0.25f32, 0.5, 0.75, 1.0, 1.25, 1.5] {
        println!("bar inflate {distance}: {}", offset_of(&ring, distance));
    }
}

#[test]
fn cw_bar_15x80_item_new() {
    let ring: Vec<(f32, f32)> = vec![
        (0.0, 0.0),
        (0.0, 80.0),
        (15.0, 80.0),
        (15.0, 0.0),
        (0.0, 0.0),
    ];
    for separation in [0.5f32, 1.0, 2.0, 3.0] {
        println!("bar item::new separation {separation}: {}", item_new_of(&ring, separation));
    }
}

#[test]
fn ccw_bar_15x80_offsets() {
    let ring: Vec<(f32, f32)> = vec![
        (0.0, 0.0),
        (15.0, 0.0),
        (15.0, 80.0),
        (0.0, 80.0),
        (0.0, 0.0),
    ];
    for distance in [0.25f32, 0.5, 0.75, 1.0, 1.25, 1.5] {
        println!("ccw bar inflate {distance}: {}", offset_of(&ring, distance));
    }
}
