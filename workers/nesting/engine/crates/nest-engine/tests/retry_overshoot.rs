//! Lock for the J-092-suite balanced retry path: when the phase-2 transposed
//! compaction overshoots the sheet height, the engine must NOT fall back
//! directly to the narrow phase-1 column — it retries ONCE with a widened
//! corridor (midpoint corridor/sheet), budget permitting, then keeps the best
//! feasible result. Without this test the path is dead and unmeasured
//! (spec 90-decisions J-092 ③).
//!
//! Forcing recipe (tuned on the capsule bench, see bench/fixtures) :
//! - 56 capsules 200x100 on a 1000x1310 sheet (strip_height = 1310) ;
//! - `phase1_ratio` 0.98 -> phase 2 gets ~0.3 s, not enough to compact the
//!   transposed layout below 1310 mm -> overshoot (~1323 mm measured) ;
//! - `plateau_patience_sec` 0.5 -> phases stop as soon as they stall, leaving
//!   most of the 16 s envelope to the retry (which then converges under
//!   1310 mm at the widened corridor ~963 mm).
//!
//! Assertions are wall-clock tolerant by design: the retry event must fire
//! and the exported alternative must fit the sheet, whether the retry itself
//! converged (widened-corridor layout) or safely fell back to phase 1
//! ("jamais pire qu'avant").

use nest_engine::config::EngineConfig;
use nest_engine::spp::run_spp_mem;
use std::sync::{Arc, Mutex};

/// Capsule 200x100 : rectangle central [50,150]x[0,100] + deux demi-cercles
/// de rayon 50 (16 segments chacun, comme la fixture banc capsule_instance_56).
fn capsule_ring() -> Vec<(f32, f32)> {
    let mut pts = Vec::new();
    for i in 0..=16 {
        let t = (-90.0f32 + i as f32 * 11.25).to_radians();
        pts.push((150.0 + 50.0 * t.cos(), 50.0 + 50.0 * t.sin()));
    }
    for i in 1..=16 {
        let t = (90.0f32 + i as f32 * 11.25).to_radians();
        pts.push((50.0 + 50.0 * t.cos(), 50.0 + 50.0 * t.sin()));
    }
    pts.push(pts[0]);
    pts
}

// W8/Y-résidu (vérif tours 4-6) : ce verrou J-092 repose sur des durées
// mur (phases temps-mur, retry dans l'enveloppe restante) — sous charge
// CI il échoue (2/2 à vide). Il se joue EXPLICITEMENT :
//   cargo test --release -p nest-engine --test retry_overshoot --
//     --ignored
#[test]
#[ignore = "budget temps mur : flaky sous charge CI (W8), vert à vide"]
fn balanced_phase2_overshoot_retries_with_widened_corridor() {
    let instance = serde_json::json!({
        "name": "retry-overshoot-test",
        "strip_height": 1310.0,
        "items": [{
            "id": 0,
            "demand": 56,
            "allowed_orientations": [0.0, 90.0],
            "shape": {"type": "simple_polygon", "data": capsule_ring()}
        }]
    });
    let ext_instance = serde_json::from_value(instance).expect("valid SPP instance");
    let config: EngineConfig = serde_json::from_value(serde_json::json!({
        // W8 (vérif 2026-09-04) : budget élargi — à 16 s le test échouait
        // sous charge CPU (phases temps-mur volées par l'OS) puis passait
        // à vide : flaky. 24 s garde la recette (phase 2 ~0,3 s grâce au
        // ratio, retry convergent) avec de la marge.
        "time_budget_sec": if std::env::var("NEST_TEST_FAST").is_ok() { 16 } else { 24 },
        "prng_seed": 6520169418772123398u64,
        "n_alternatives": 1,
        "poly_simpl_tolerance": 0.001,
        "min_item_separation": 2.0,
        "narrow_concavity_cutoff": [0.01, 0.01],
        "max_strip_width": 1000.0,
        "n_workers": 1,
        "biases": ["balanced"],
        "plateau_patience_sec": 0.5,
        "phase1_ratio": 0.98,
        "column_fill": true
    }))
    .expect("valid engine config");

    let events: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));
    let sink_events = Arc::clone(&events);
    let sink: nest_engine::progress::EventSink =
        Arc::new(move |line: &str| sink_events.lock().unwrap().push(line.to_owned()));

    let out = run_spp_mem(ext_instance, &config, &sink).expect("a feasible solution exists");

    let events = events.lock().unwrap();
    let retry = events
        .iter()
        .find(|l| l.contains("\"type\":\"retry\""))
        .expect("phase 2 overshoot must trigger the widened-corridor retry");
    assert!(retry.contains("\"bias\":\"balanced\""), "retry event: {retry}");

    // Jamais pire qu'avant : quelle que soit l'issue (retry abouti ou repli
    // phase 1), l'alternative exportée tient dans la tôle (piège #6).
    let alt = &out.alternatives[0];
    let w = alt["solution"]["strip_width"].as_f64().unwrap();
    let uh = alt["used_height"].as_f64().unwrap();
    assert!(w <= 1000.0 + 1e-3, "strip_width {w} exceeds sheet width");
    assert!(uh <= 1310.0 + 1.0, "used_height {uh} exceeds sheet height");
}
