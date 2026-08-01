//! BPP mode (multi-sheet bin packing): parallel multi-start simulated
//! annealing over item sequences, evaluated by the greedy constructive.
//! Replaces the lbf subprocess + Python racing + hole-relocation post-passes.

pub mod constructive;
pub mod sa;

use crate::config::EngineConfig;
use crate::spp::derive_seed;
use anyhow::{Context, Result, bail};
use constructive::DirBias;
use jagua_rs::io::import::Importer;
use jagua_rs::probs::bpp::io::ext_repr::{ExtBPInstance, ExtBPSolution};
use rand::SeedableRng;
use rand::rngs::Xoshiro256PlusPlus;
use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use sparrow::util::io::write_json;
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::io::Write;
use std::path::Path;
use std::time::{Duration, Instant};

/// Samples evaluated per item during constructive placement.
/// Hundreds of samples suffice for a good first-fit; SA drives the quality.
const N_SAMPLES_PER_ITEM: usize = 300;

#[derive(Serialize, Deserialize, Clone)]
pub struct ExtBPOutput {
    #[serde(flatten)]
    pub instance: ExtBPInstance,
    pub solution: ExtBPSolution,
}

struct WorkerRun {
    seed: u64,
    bias: DirBias,
    cost: sa::Cost,
    solution: jagua_rs::probs::bpp::entities::BPSolution,
    iterations: usize,
}

fn solution_fingerprint(solution: &ExtBPSolution) -> u64 {
    let mut hasher = DefaultHasher::new();
    for layout in &solution.layouts {
        layout.container_id.hash(&mut hasher);
        let mut items: Vec<(u64, i64, i64, i64)> = layout
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
    }
    hasher.finish()
}

pub fn run_bpp(instance_path: &Path, out_dir: &Path, config: &EngineConfig) -> Result<()> {
    let started = Instant::now();
    let input_str = std::fs::read_to_string(instance_path)
        .with_context(|| format!("reading BPP instance {}", instance_path.display()))?;
    let ext_instance: ExtBPInstance =
        serde_json::from_str(&input_str).context("parsing BPP instance")?;

    let sparrow_config = config.sparrow_config();
    let importer = Importer::new(
        sparrow_config.cde_config,
        sparrow_config.poly_simpl_tolerance,
        sparrow_config.min_item_separation,
        sparrow_config.narrow_concavity_cutoff_ratio,
    );
    let instance = jagua_rs::probs::bpp::io::import_instance(&importer, &ext_instance)
        .context("importing BPP instance into jagua-rs")?;

    let n_workers = config.n_workers();
    println!(
        "{{\"type\":\"start\",\"problem\":\"bpp\",\"name\":\"{}\",\"items\":{},\"workers\":{},\"budget_sec\":{}}}",
        ext_instance.name,
        instance.total_item_qty(),
        n_workers,
        config.time_budget_sec
    );
    let _ = std::io::stdout().flush();

    let instance = &instance;
    let deadline = Duration::from_secs(config.time_budget_sec);

    // Parallel multi-start: one SA walk per worker, each with a derived seed.
    // Deterministic per worker; ranking below is deterministic too.
    let live = config.live_events();
    let warm_start = config.initial_sequence.clone();
    let biases = config.dir_biases();
    let plateau_patience = config.plateau_patience();
    let mut runs: Vec<WorkerRun> = (0..n_workers)
        .into_par_iter()
        .map(|w| {
            let seed = derive_seed(config.prng_seed, w);
            let bias = biases[w % biases.len()];
            let mut rng = Xoshiro256PlusPlus::seed_from_u64(seed);
            let report = sa::anneal(
                instance,
                N_SAMPLES_PER_ITEM,
                deadline,
                bias,
                warm_start.clone(),
                plateau_patience,
                &mut rng,
                |cost, solution| {
                    println!(
                        "{{\"type\":\"progress\",\"worker\":{},\"stage\":\"bpp-search\",\"feasible\":{},\"bins\":{},\"unplaced\":{},\"elapsed_sec\":{}}}",
                        w,
                        cost.unplaced == 0,
                        cost.bin_cost,
                        cost.unplaced,
                        started.elapsed().as_secs()
                    );
                    if live {
                        // Full layout snapshot of the new incumbent for the
                        // visualizer: [[item_id, bin, rotation_deg, x, y]].
                        let mut items = String::new();
                        items.push('[');
                        let mut first = true;
                        for (bin, ls) in solution.layout_snapshots.values().enumerate() {
                            for pi in ls.placed_items.values() {
                                if !first {
                                    items.push(',');
                                }
                                first = false;
                                let dt = pi.d_transf;
                                let t = dt.translation();
                                items.push_str(&format!(
                                    "[{},{},{:.2},{:.3},{:.3}]",
                                    pi.item_id,
                                    bin,
                                    dt.rotation().to_degrees(),
                                    t.0,
                                    t.1
                                ));
                            }
                        }
                        items.push(']');
                        println!(
                            "{{\"type\":\"layout\",\"worker\":{},\"stage\":\"bpp-search\",\"feasible\":{},\"bins\":{},\"unplaced\":{},\"remnant\":{:.4},\"elapsed_ms\":{},\"items\":{}}}",
                            w,
                            cost.unplaced == 0,
                            cost.bin_cost,
                            cost.unplaced,
                            cost.remnant,
                            started.elapsed().as_millis(),
                            items
                        );
                    }
                    let _ = std::io::stdout().flush();
                },
                |iterations, cost| {
                    println!(
                        "{{\"type\":\"heartbeat\",\"worker\":{},\"stage\":\"bpp-search\",\"iterations\":{},\"bins\":{},\"unplaced\":{},\"elapsed_sec\":{}}}",
                        w,
                        iterations,
                        cost.bin_cost,
                        cost.unplaced,
                        started.elapsed().as_secs()
                    );
                    let _ = std::io::stdout().flush();
                },
            );
            WorkerRun {
                seed,
                bias,
                cost: report.best_cost,
                solution: report.best_solution,
                iterations: report.iterations,
            }
        })
        .collect();

    // Rank: lexicographic cost, stable tie-break on seed.
    runs.sort_by(|a, b| a.cost.cmp_key().cmp(&b.cost.cmp_key()).then(a.seed.cmp(&b.seed)));

    let feasible: Vec<&WorkerRun> = runs.iter().filter(|r| r.cost.unplaced == 0).collect();
    if feasible.is_empty() {
        let best_unplaced = runs.first().map(|r| r.cost.unplaced).unwrap_or(0);
        println!(
            "{{\"type\":\"error\",\"reason\":\"infeasible\",\"unplaced\":{},\"elapsed_sec\":{}}}",
            best_unplaced,
            started.elapsed().as_secs()
        );
        bail!("no feasible solution: {best_unplaced} items could not be placed");
    }

    // Alternatives are grouped by directional bias class so the exported
    // options are structurally distinct: best run of each ACTIVE class,
    // classes in fixed order (left / bottom / balanced — the contract asked
    // by users), then the remaining runs by cost as fallback when a class
    // has no feasible run or more alternatives are requested than there are
    // active classes.
    let mut ordered: Vec<&WorkerRun> = DirBias::ALL
        .into_iter()
        .filter(|b| biases.contains(b))
        .filter_map(|b| {
            feasible
                .iter()
                .copied()
                .filter(|r| r.bias == b)
                .min_by(|a, b| a.cost.cmp_key().cmp(&b.cost.cmp_key()).then(a.seed.cmp(&b.seed)))
        })
        .collect();
    ordered.extend(feasible.iter().copied());

    // Export incumbent + distinct alternatives.
    let epoch = *sparrow::EPOCH;
    let mut seen = std::collections::HashSet::new();
    let mut alternatives = Vec::new();
    let mut best_json: Option<ExtBPOutput> = None;

    for run in ordered {
        let ext_sol = jagua_rs::probs::bpp::io::export(instance, &run.solution, epoch);
        let fp = solution_fingerprint(&ext_sol);
        if !seen.insert(fp) {
            continue;
        }
        let output = ExtBPOutput {
            instance: ext_instance.clone(),
            solution: ext_sol,
        };
        if best_json.is_none() {
            best_json = Some(output.clone());
        }
        alternatives.push(serde_json::json!({
            "rank": alternatives.len(),
            "seed": run.seed,
            "bias": run.bias.as_str(),
            "cost": output.solution.cost,
            "density": output.solution.density,
            "layout_count": output.solution.layouts.len(),
            "iterations": run.iterations,
            "solution": output.solution,
        }));
        if alternatives.len() >= config.n_alternatives {
            break;
        }
    }

    let best = best_json.expect("feasible solutions exist but none exported");
    let best_cost = best.solution.cost;
    let best_density = best.solution.density;
    let n_exported = alternatives.len();
    write_json(&best, &out_dir.join("sol_instance.json"))?;
    write_json(&serde_json::Value::Array(alternatives), &out_dir.join("alternatives.json"))?;

    println!(
        "{{\"type\":\"done\",\"cost\":{},\"density\":{:.4},\"alternatives\":{},\"elapsed_sec\":{}}}",
        best_cost,
        best_density,
        n_exported,
        started.elapsed().as_secs()
    );
    Ok(())
}
