//! Cross-target fixture lock (J-093) : `fixtures/merge_spp_input.json` est
//! soumis ici à `merge_alternatives_json` (natif) et, côté Node, à l'export
//! wasm `merge_alternatives` (script `smoke_merge_alternatives.mjs` à la
//! racine de ce workspace) — les deux côtés assertent la MÊME sortie.
//!
//! La fixture exerce : ordre canonique des classes (left champion exporté
//! rank 0 malgré une largeur 80 > 70 du bottom), seed en string ET en number,
//! dédup par fingerprint (le run balanced a exactement le même layout que le
//! champion left => sauté), ranks ré-assignés 0..n-1.

use nest_engine::merge::merge_alternatives_json;

fn fixture_output() -> serde_json::Value {
    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../../fixtures/merge_spp_input.json");
    let raw = std::fs::read_to_string(path).expect("reading merge fixture");
    let input: serde_json::Value = serde_json::from_str(&raw).expect("parsing merge fixture");
    merge_alternatives_json(&input).expect("merge should succeed")
}

#[test]
fn merge_fixture_spp_expected_output() {
    let out = fixture_output();
    assert_eq!(out["problem"], "spp");

    let alts = out["alternatives"].as_array().unwrap();
    assert_eq!(alts.len(), 2, "balanced run must be deduped (same layout as left)");

    // Champion left d'abord (ordre canonique), pas le meilleur global.
    assert_eq!(alts[0]["rank"], 0);
    assert_eq!(alts[0]["seed"], 111);
    assert_eq!(alts[0]["bias"], "left");
    assert_eq!(alts[0]["evaluations"], 1000);
    assert_eq!(alts[0]["used_height"], 40.0);
    assert_eq!(alts[0]["strip_width"], 80.0);

    assert_eq!(alts[1]["rank"], 1);
    assert_eq!(alts[1]["seed"], 222);
    assert_eq!(alts[1]["bias"], "bottom");
    assert_eq!(alts[1]["strip_width"], 70.0);

    // sol_instance = ExtSPOutput aplati (instance + solution du best).
    assert_eq!(out["sol_instance"]["name"], "merge-fixture");
    assert_eq!(out["sol_instance"]["strip_height"], 100.0);
    assert_eq!(out["sol_instance"]["solution"]["strip_width"], 80.0);
    assert_eq!(
        out["sol_instance"]["solution"]["layout"]["placed_items"]
            .as_array()
            .unwrap()
            .len(),
        2
    );
}

#[test]
fn merge_fixture_spp_is_deterministic() {
    assert_eq!(fixture_output(), fixture_output());
}
