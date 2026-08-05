//! nest-engine as a library — the optimization logic, decoupled from the
//! filesystem. The native CLI (main.rs) and the wasm-bindgen wrapper
//! (nest-wasm) both call [`run_json`]; stdout still carries the JSON event
//! stream (a silent sink on wasm32).

pub mod bpp;
pub mod config;
pub mod gravity;
pub mod progress;
pub mod spp;

use anyhow::{Context, Result, bail};
use config::EngineConfig;
use jagua_rs::probs::spp::io::ext_repr::{ExtSPInstance, ExtSPSolution};
use sparrow::util::io::ExtSPOutput;

/// The two documents the file-based CLI writes, as in-memory values.
pub struct EngineOutput {
    pub sol_instance: serde_json::Value,
    pub alternatives: Vec<serde_json::Value>,
}

/// Runs the engine on JSON strings, returns JSON values. No filesystem.
pub fn run_json(problem: &str, instance_json: &str, config_json: &str) -> Result<EngineOutput> {
    let config: EngineConfig =
        serde_json::from_str(config_json).context("parsing engine config")?;
    match problem {
        "spp" => {
            let (ext_instance, _warm_start) = parse_spp_input(instance_json)?;
            spp::run_spp_mem(ext_instance, &config)
        }
        "bpp" => {
            let ext_instance = serde_json::from_str(instance_json)
                .context("parsing BPP instance")?;
            bpp::run_bpp_mem(ext_instance, &config)
        }
        other => bail!("unsupported problem type: {other}"),
    }
}

/// Same acceptance rule as the file CLI: a full output (instance + solution)
/// or a bare instance.
fn parse_spp_input(s: &str) -> Result<(ExtSPInstance, Option<ExtSPSolution>)> {
    match serde_json::from_str::<ExtSPOutput>(s) {
        Ok(ext_output) => Ok((ext_output.instance, Some(ext_output.solution))),
        Err(_) => {
            let ext_instance = serde_json::from_str::<ExtSPInstance>(s)
                .context("could not parse SPP instance")?;
            Ok((ext_instance, None))
        }
    }
}

/// Worker fan-out: rayon multi-thread on native, sequential when a single
/// worker is requested, always sequential on wasm32 (no OS threads). The
/// sequential path is bit-identical across targets — the cross-target
/// determinism locks compare native-1T against wasm-1T.
pub fn map_workers<T, F>(n_workers: usize, f: F) -> Vec<T>
where
    F: Fn(usize) -> T + Sync + Send,
    T: Send,
{
    #[cfg(not(target_arch = "wasm32"))]
    if n_workers > 1 {
        use rayon::prelude::*;
        return (0..n_workers).into_par_iter().map(f).collect();
    }
    let _ = &f;
    (0..n_workers).map(f).collect()
}
