//! nest-channels-cli: <file> <space> <difference|splice> — imports the file
//! via nest-import (content sniffing) and prints, for every holed part, the
//! channel-opened ring as JSON {"rings": [...]}. Harness driver
//! (workers/geometry/parity/channels.py).

use serde::Serialize;
use std::io::Read;

#[derive(Serialize)]
struct Out {
    rings: Vec<Vec<[f64; 2]>>,
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.len() < 4 {
        eprintln!("usage: nest-channels-cli <file> <space_mm> <difference|splice>");
        std::process::exit(2);
    }
    let space: f64 = args[2].parse().unwrap_or(2.0);
    let method = args[3].as_str();
    let mut buf = Vec::new();
    if std::fs::File::open(&args[1]).and_then(|mut f| f.read_to_end(&mut buf)).is_err() {
        eprintln!("cannot read {}", args[1]);
        std::process::exit(1);
    }
    let res = match nest_import::import_file(&buf, 0.01) {
        Ok(r) => r,
        Err(e) => {
            eprintln!("import failed: {e}");
            std::process::exit(1);
        }
    };
    if method == "inputs" {
        // Entrées canoniques pour le verrou déterminisme : {outer, holes,
        // space_mm} par part à trous (le driver wasm rejoue open_holes là-dessus).
        let mut inputs = Vec::new();
        for part in &res.parts {
            if part.holes.is_empty() {
                continue;
            }
            inputs.push(serde_json::json!({
                "outer": part.coordinates,
                "holes": part.holes,
                "space_mm": space,
            }));
        }
        println!("{}", serde_json::to_string(&inputs).unwrap());
        return;
    }
    let width = nest_preprocess::channel_width_for_space(space);
    let usable = nest_preprocess::channels_usable(space);
    let mut rings = Vec::new();
    for part in &res.parts {
        if part.holes.is_empty() {
            continue;
        }
        if !usable {
            rings.push(part.coordinates.clone());
            continue;
        }
        let ring = match method {
            "difference" => nest_preprocess::open_holes_difference(
                &part.coordinates,
                &part.holes,
                width,
            ),
            "splice" => {
                nest_preprocess::open_holes_splice(&part.coordinates, &part.holes, width)
            }
            _ => {
                eprintln!("unknown method {method}");
                std::process::exit(2);
            }
        };
        rings.push(ring);
    }
    println!("{}", serde_json::to_string(&Out { rings }).unwrap());
}
