//! BPP mode (multi-sheet bin packing): parallel multi-start simulated
//! annealing over item sequences, evaluated by the greedy constructive.
//! Replaces the lbf subprocess + Python racing + hole-relocation post-passes.

pub mod constructive;
pub mod sa;

use crate::config::EngineConfig;
use crate::merge::{BpMergeError, BpRun, merge_bp_runs};
use crate::progress::EventSink;
use crate::spp::derive_seed;
use crate::{EngineOutput, map_workers};
use anyhow::{Context, Result, bail};
use constructive::DirBias;
use jagua_rs::io::import::Importer;
use jagua_rs::probs::bpp::io::ext_repr::{ExtBPInstance, ExtBPSolution};
use rand::SeedableRng;
use rand::rngs::Xoshiro256PlusPlus;
use serde::{Deserialize, Serialize};
use jagua_rs::Instant;
use std::time::Duration;

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

pub fn run_bpp_mem(
    ext_instance: ExtBPInstance,
    config: &EngineConfig,
    sink: &EventSink,
) -> Result<EngineOutput> {
    let started = Instant::now();

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
    sink(&format!(
        "{{\"type\":\"start\",\"problem\":\"bpp\",\"name\":\"{}\",\"items\":{},\"workers\":{},\"budget_sec\":{}}}",
        ext_instance.name,
        instance.total_item_qty(),
        n_workers,
        config.time_budget_sec
    ));

    let instance = &instance;
    let deadline = Duration::from_secs(config.time_budget_sec);

    // Parallel multi-start: one SA walk per worker, each with a derived seed.
    // Deterministic per worker; ranking below is deterministic too.
    let live = config.live_events();
    let warm_start = config.initial_sequence.clone();
    let biases = config.dir_biases();
    let plateau_patience = config.plateau_patience();
    let sa_max_iterations = config.sa_max_iterations;
    let runs: Vec<WorkerRun> = map_workers(n_workers, |w| {
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
            sa_max_iterations,
            &mut rng,
                |cost, solution| {
                    sink(&format!(
                        "{{\"type\":\"progress\",\"worker\":{},\"stage\":\"bpp-search\",\"feasible\":{},\"bins\":{},\"unplaced\":{},\"elapsed_sec\":{},\"bias\":\"{}\"}}",
                        w,
                        cost.unplaced == 0,
                        cost.bin_cost,
                        cost.unplaced,
                        started.elapsed().as_secs(),
                        bias.as_str()
                    ));
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
                        sink(&format!(
                            "{{\"type\":\"layout\",\"worker\":{},\"stage\":\"bpp-search\",\"feasible\":{},\"bins\":{},\"unplaced\":{},\"remnant\":{:.4},\"elapsed_ms\":{},\"items\":{},\"bias\":\"{}\"}}",
                            w,
                            cost.unplaced == 0,
                            cost.bin_cost,
                            cost.unplaced,
                            cost.remnant,
                            started.elapsed().as_millis(),
                            items,
                            bias.as_str()
                        ));
                    }
                },
                |iterations, cost| {
                    sink(&format!(
                        "{{\"type\":\"heartbeat\",\"worker\":{},\"stage\":\"bpp-search\",\"iterations\":{},\"bins\":{},\"unplaced\":{},\"elapsed_sec\":{}}}",
                        w,
                        iterations,
                        cost.bin_cost,
                        cost.unplaced,
                        started.elapsed().as_secs()
                    ));
                },
            );
            WorkerRun {
                seed,
                bias,
                cost: report.best_cost,
                solution: report.best_solution,
                iterations: report.iterations,
            }
        });

    // Rank: lexicographic cost, stable tie-break on seed. Alternatives are
    // grouped by directional bias class so the exported options are
    // structurally distinct: best run of each ACTIVE class, classes in fixed
    // order (left / bottom / balanced — the contract asked by users), then
    // the remaining runs by cost as fallback when a class has no feasible run
    // or more alternatives are requested than there are active classes.
    // La fusion est partagée avec l'entrée wasm `merge_alternatives` (J-093).
    let epoch = *sparrow::EPOCH;
    let exported: Vec<BpRun> = runs
        .iter()
        .map(|r| BpRun {
            seed: r.seed,
            bias: r.bias,
            cost: r.cost,
            iterations: r.iterations,
            solution: jagua_rs::probs::bpp::io::export(instance, &r.solution, epoch),
        })
        .collect();
    match merge_bp_runs(&ext_instance, &exported, &biases, config.n_alternatives) {
        Ok(merged) => {
            sink(&format!(
                "{{\"type\":\"done\",\"cost\":{},\"density\":{:.4},\"alternatives\":{},\"elapsed_sec\":{}}}",
                merged.best_cost,
                merged.best_density,
                merged.output.alternatives.len(),
                started.elapsed().as_secs()
            ));
            Ok(merged.output)
        }
        Err(BpMergeError::Infeasible { best_unplaced }) => {
            sink(&format!(
                "{{\"type\":\"error\",\"reason\":\"infeasible\",\"unplaced\":{},\"elapsed_sec\":{}}}",
                best_unplaced,
                started.elapsed().as_secs()
            ));
            bail!("no feasible solution: {best_unplaced} items could not be placed")
        }
    }
}
