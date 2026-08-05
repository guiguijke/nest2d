//! wasm-bindgen entry point — run the nesting engine in the browser.
//! In-memory JSON in / JSON out; the problem type is inferred ("bins" in the
//! instance ⇒ BPP, otherwise SPP) unless params_json carries "problem".

use wasm_bindgen::prelude::*;

/// Current wasm linear-memory size, in 64 KiB pages (exact, unlike
/// performance.memory which excludes wasm memory) — the UI guardrail.
#[wasm_bindgen]
pub fn wasm_memory_pages() -> usize {
    #[cfg(target_arch = "wasm32")]
    return core::arch::wasm32::memory_size(0);
    #[cfg(not(target_arch = "wasm32"))]
    0
}

/// run_nesting(instance_json, params_json, seed) -> result_json
///
/// - `instance_json`: jagua-rs external instance (SPP: name/items/strip_height;
///   BPP: name/items/bins).
/// - `params_json`: EngineConfig fields (time_budget_sec, n_workers, biases, …).
///   `prng_seed` may be omitted/zero — the `seed` argument wins.
/// - `seed`: master PRNG seed (explicit determinism contract).
///
/// Returns `{ "problem": "spp"|"bpp", "sol_instance": …, "alternatives": […] }`.
#[wasm_bindgen]
pub fn run_nesting(
    instance_json: &str,
    params_json: &str,
    seed: u64,
) -> Result<String, JsError> {
    console_error_panic_hook::set_once();

    let mut params: serde_json::Value = serde_json::from_str(params_json)
        .map_err(|e| JsError::new(&format!("parsing params_json: {e}")))?;
    params["prng_seed"] = serde_json::Value::from(seed);

    let problem = params
        .get("problem")
        .and_then(|p| p.as_str())
        .map(str::to_owned)
        .unwrap_or_else(|| {
            if serde_json::from_str::<serde_json::Value>(instance_json)
                .ok()
                .and_then(|v| v.get("bins").cloned())
                .is_some()
            {
                "bpp".to_owned()
            } else {
                "spp".to_owned()
            }
        });

    let params_str = serde_json::to_string(&params)
        .map_err(|e| JsError::new(&format!("serializing params: {e}")))?;

    let out = nest_engine::run_json(&problem, instance_json, &params_str)
        .map_err(|e| JsError::new(&format!("{e:#}")))?;

    serde_json::to_string(&serde_json::json!({
        "problem": problem,
        "sol_instance": out.sol_instance,
        "alternatives": out.alternatives,
    }))
    .map_err(|e| JsError::new(&format!("serializing output: {e}")))
}
