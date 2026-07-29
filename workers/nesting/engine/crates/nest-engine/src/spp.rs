use crate::config::EngineConfig;
use crate::progress::ProgressListener;
use anyhow::{Context, Result, bail};
use jagua_rs::io::import::Importer;
use jagua_rs::probs::spp::entities::SPSolution;
use jagua_rs::probs::spp::io::ext_repr::ExtSPSolution;
use rand::SeedableRng;
use rand::rngs::Xoshiro256PlusPlus;
use rayon::prelude::*;
use sparrow::optimizer::optimize;
use sparrow::util::io::{ExtSPOutput, read_spp_input, write_json};
use sparrow::util::terminator::BasicTerminator;
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::path::Path;
use std::time::Instant;

/// One finished multi-start worker run.
struct WorkerRun {
    seed: u64,
    solution: SPSolution,
}

/// Splitmix-style derivation of independent per-worker seeds from the master
/// seed. Deterministic and stable across runs/machines.
pub fn derive_seed(master: u64, worker: usize) -> u64 {
    let mut z = master.wrapping_add((worker as u64).wrapping_mul(0x9E37_79B9_7F4A_7C15));
    z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
    z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
    z ^ (z >> 31)
}

/// Fingerprint of a layout: two runs producing the same placements (to 0.1 mm
/// / 0.1°) are the same alternative and must not be exported twice.
fn solution_fingerprint(solution: &ExtSPSolution) -> u64 {
    let mut hasher = DefaultHasher::new();
    ((solution.strip_width * 10.0).round() as u64).hash(&mut hasher);
    let mut items: Vec<(u64, i64, i64, i64)> = solution
        .layout
        .placed_items
        .iter()
        .map(|pi| {
            (
                pi.item_id,
                (pi.transformation.rotation * 10.0).round() as i64,
                (pi.transformation.translation.0 * 10.0).round() as i64,
                (pi.transformation.translation.1 * 10.0).round() as i64,
            )
        })
        .collect();
    items.sort_unstable();
    items.hash(&mut hasher);
    hasher.finish()
}

pub fn run_spp(instance_path: &Path, out_dir: &Path, config: &EngineConfig) -> Result<()> {
    let started = Instant::now();
    let (ext_instance, _warm_start) = read_spp_input(instance_path)
        .with_context(|| format!("reading SPP instance {}", instance_path.display()))?;

    let sparrow_config = config.sparrow_config();
    let importer = Importer::new(
        sparrow_config.cde_config,
        sparrow_config.poly_simpl_tolerance,
        sparrow_config.min_item_separation,
        sparrow_config.narrow_concavity_cutoff_ratio,
    );
    let instance = jagua_rs::probs::spp::io::import_instance(&importer, &ext_instance)
        .context("importing SPP instance into jagua-rs")?;

    let n_workers = config.n_workers();
    println!(
        "{{\"type\":\"start\",\"problem\":\"spp\",\"name\":\"{}\",\"items\":{},\"workers\":{},\"budget_sec\":{}}}",
        ext_instance.name,
        instance.total_item_qty(),
        n_workers,
        config.time_budget_sec
    );

    // Parallel multi-start: every worker runs the full explore+compress
    // pipeline with its own derived seed. Each run is deterministic on its
    // own, so the final ranking is deterministic regardless of scheduling.
    let instance = &instance;
    let sparrow_cfg = &sparrow_config;
    let mut runs: Vec<WorkerRun> = (0..n_workers)
        .into_par_iter()
        .map(|w| {
            let seed = derive_seed(config.prng_seed, w);
            let rng = Xoshiro256PlusPlus::seed_from_u64(seed);
            let mut listener = ProgressListener::new(w, started);
            let mut terminator = BasicTerminator::new();
            let solution = optimize(
                instance.clone(),
                rng,
                &mut listener,
                &mut terminator,
                &sparrow_cfg.expl_cfg,
                &sparrow_cfg.cmpr_cfg,
                None,
            );
            WorkerRun { seed, solution }
        })
        .collect();

    // Rank: narrowest strip first; stable tie-break on seed for determinism.
    runs.sort_by(|a, b| {
        a.solution
            .strip_width()
            .total_cmp(&b.solution.strip_width())
            .then(a.seed.cmp(&b.seed))
    });

    let max_width = config.max_strip_width;
    let feasible: Vec<&WorkerRun> = runs
        .iter()
        .filter(|r| max_width.is_none_or(|mw| r.solution.strip_width() <= mw + 1e-4))
        .collect();

    if feasible.is_empty() {
        let best = runs.first().map(|r| r.solution.strip_width()).unwrap_or(f32::NAN);
        println!(
            "{{\"type\":\"error\",\"reason\":\"infeasible\",\"best_strip_width\":{:.3},\"max_strip_width\":{},\"elapsed_sec\":{}}}",
            best,
            max_width.unwrap_or(f32::NAN),
            started.elapsed().as_secs()
        );
        bail!(
            "no feasible solution: narrowest strip {:.3} exceeds limit {}",
            best,
            max_width.unwrap_or(f32::NAN)
        );
    }

    // Export incumbent (best feasible) + distinct alternatives.
    let epoch = *sparrow::EPOCH;
    let mut seen = std::collections::HashSet::new();
    let mut alternatives = Vec::new();
    let mut best_json: Option<ExtSPOutput> = None;

    for run in feasible.iter() {
        let ext_sol = jagua_rs::probs::spp::io::export(instance, &run.solution, epoch);
        let fp = solution_fingerprint(&ext_sol);
        if !seen.insert(fp) {
            continue; // same layout as an already-exported alternative
        }
        let output = ExtSPOutput {
            instance: ext_instance.clone(),
            solution: ext_sol,
        };
        if best_json.is_none() {
            best_json = Some(output.clone());
        }
        alternatives.push(serde_json::json!({
            "rank": alternatives.len(),
            "seed": run.seed,
            "strip_width": output.solution.strip_width,
            "density": output.solution.density,
            "solution": output.solution,
        }));
        if alternatives.len() >= config.n_alternatives {
            break;
        }
    }

    let best = best_json.expect("feasible solutions exist but none exported");
    let best_width = best.solution.strip_width;
    write_json(&best, &out_dir.join("sol_instance.json"))?;
    write_json(&serde_json::Value::Array(alternatives), &out_dir.join("alternatives.json"))?;

    println!(
        "{{\"type\":\"done\",\"best_strip_width\":{:.3},\"density\":{:.4},\"alternatives\":{},\"elapsed_sec\":{}}}",
        best_width,
        best.solution.density,
        seen.len().min(config.n_alternatives),
        started.elapsed().as_secs()
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn derive_seed_is_deterministic() {
        assert_eq!(derive_seed(42, 0), derive_seed(42, 0));
        assert_eq!(derive_seed(7, 3), derive_seed(7, 3));
    }

    #[test]
    fn derive_seed_differs_per_worker() {
        let seeds: Vec<u64> = (0..8).map(|w| derive_seed(42, w)).collect();
        let unique: std::collections::HashSet<u64> = seeds.iter().copied().collect();
        assert_eq!(seeds.len(), unique.len());
    }

    #[test]
    fn derive_seed_differs_per_master() {
        assert_ne!(derive_seed(1, 0), derive_seed(2, 0));
    }
}
