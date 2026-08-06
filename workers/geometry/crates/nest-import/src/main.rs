//! nest-import-cli: reads a DXF file and prints the ImportResult JSON on
//! stdout — the parity-harness driver (workers/geometry/parity/).

use std::io::Read;

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.len() < 2 {
        eprintln!("usage: nest-import-cli <file.dxf> [flatten_tol]");
        std::process::exit(2);
    }
    let tol: f64 = args.get(2).and_then(|s| s.parse().ok()).unwrap_or(0.01);
    let mut buf = Vec::new();
    match std::fs::File::open(&args[1]).and_then(|mut f| f.read_to_end(&mut buf)) {
        Ok(_) => {}
        Err(e) => {
            eprintln!("cannot read {}: {e}", args[1]);
            std::process::exit(1);
        }
    }
    match nest_import::import_dxf(&buf, tol) {
        Ok(res) => {
            println!("{}", serde_json::to_string(&res).unwrap());
        }
        Err(e) => {
            eprintln!("import failed: {e}");
            std::process::exit(1);
        }
    }
}
