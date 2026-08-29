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
use jagua_rs::entities::Instance as _;
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

/// Snapshot complet de l'incumbent pour la vue live :
/// [[item_id, bin, rotation_deg, x, y]].
///
/// Piège 14g : jagua centre chaque pièce au centroïde à l'import
/// (`pre_transform`) — une frame émise depuis `d_transf` seul est en repère
/// INTERNE et décale toute pièce non centrée à l'origine. La frame doit être
/// sérialisée dans la convention EXTERNE (source), comme `emit_layout` SPP
/// (progress.rs) et l'export final (`export_layout_snapshot`).
fn layout_event(
    w: usize,
    cost: &sa::Cost,
    solution: &jagua_rs::probs::bpp::entities::BPSolution,
    instance: &jagua_rs::probs::bpp::entities::BPInstance,
    started: &Instant,
    bias: DirBias,
) -> String {
    let mut items = String::new();
    items.push('[');
    let mut first = true;
    for (bin, ls) in solution.layout_snapshots.values().enumerate() {
        for pi in ls.placed_items.values() {
            if !first {
                items.push(',');
            }
            first = false;
            let ext_dt = jagua_rs::io::export::int_to_ext_transformation(
                &pi.d_transf,
                &instance.item(pi.item_id).shape_orig.pre_transform,
            );
            let t = ext_dt.translation();
            items.push_str(&format!(
                "[{},{},{:.2},{:.3},{:.3}]",
                pi.item_id,
                bin,
                ext_dt.rotation().to_degrees(),
                t.0,
                t.1
            ));
        }
    }
    items.push(']');
    format!(
        "{{\"type\":\"layout\",\"worker\":{},\"stage\":\"bpp-search\",\"feasible\":{},\"bins\":{},\"unplaced\":{},\"remnant\":{:.4},\"elapsed_ms\":{},\"items\":{},\"bias\":\"{}\"}}",
        w,
        cost.unplaced == 0,
        cost.bin_cost,
        cost.unplaced,
        cost.remnant,
        started.elapsed().as_millis(),
        items,
        bias.as_str()
    )
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
                        sink(&layout_event(w, cost, solution, instance, &started, bias));
                    }
                },
                |iterations, cost, solution| {
                    sink(&format!(
                        "{{\"type\":\"heartbeat\",\"worker\":{},\"stage\":\"bpp-search\",\"iterations\":{},\"bins\":{},\"unplaced\":{},\"elapsed_sec\":{}}}",
                        w,
                        iterations,
                        cost.bin_cost,
                        cost.unplaced,
                        started.elapsed().as_secs()
                    ));
                    // Vue live BPP (bug 2026-08-29 : « 1 maj et c'est tout ») :
                    // les ameliorations deviennent rares apres la descente
                    // initiale — le heartbeat (1 Hz) embarque le snapshot de
                    // l'incumbent pour que la vue vive comme en SPP.
                    if live {
                        sink(&layout_event(w, cost, solution, instance, &started, bias));
                    }
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

#[cfg(test)]
mod live_frame_tests {
    //! Verrou (piège 14g/46) : une frame live BPP doit porter la transform
    //! EXTERNE (int_to_ext composé) — pas le `d_transf` interne jagua, qui
    //! ancre les pièces au centroïde et les décale à l'écran. Miroir BPP de
    //! progress.rs::live_frame_matches_final_export_asymmetric.

    use super::*;

    /// Triangle volontairement NON centré : centroïde ≈ (110, 10) — un
    /// `d_transf` nu serait décalé d'autant, l'export composé non.
    fn off_center_bp_instance() -> ExtBPInstance {
        ExtBPInstance {
            name: "bpp-live-lock".to_owned(),
            items: vec![jagua_rs::probs::bpp::io::ext_repr::ExtItem {
                base: jagua_rs::io::ext_repr::ExtItem {
                    id: 0,
                    allowed_orientations: None,
                    shape: jagua_rs::io::ext_repr::ExtShape::SimplePolygon(
                        jagua_rs::io::ext_repr::ExtSPolygon(vec![
                            (100.0, 0.0),
                            (130.0, 0.0),
                            (100.0, 30.0),
                            (100.0, 0.0),
                        ]),
                    ),
                    min_quality: None,
                },
                demand: 3,
            }],
            bins: vec![jagua_rs::probs::bpp::io::ext_repr::ExtBin {
                base: jagua_rs::io::ext_repr::ExtContainer {
                    id: 0,
                    shape: jagua_rs::io::ext_repr::ExtShape::SimplePolygon(
                        jagua_rs::io::ext_repr::ExtSPolygon(vec![
                            (0.0, 0.0),
                            (300.0, 0.0),
                            (300.0, 300.0),
                            (0.0, 300.0),
                            (0.0, 0.0),
                        ]),
                    ),
                    zones: vec![],
                },
                cost: 1,
                stock: 1,
            }],
        }
    }

    /// La DERNIÈRE frame layout (incumbent final) doit coïncider avec les
    /// placements exportés de la meilleure alternative — rotation degrés à
    /// 0,01° et translation à 0,001 mm (arrondis d'impression de la frame).
    #[test]
    fn bpp_live_frame_matches_final_export_off_center() {
        let layouts: std::sync::Arc<std::sync::Mutex<Vec<String>>> = Default::default();
        let sink_capture = layouts.clone();
        let sink: EventSink = std::sync::Arc::new(move |s: &str| {
            if s.contains("\"type\":\"layout\"") {
                sink_capture.lock().unwrap().push(s.to_string());
            }
        });
        let config: EngineConfig = serde_json::from_value(serde_json::json!({
            "time_budget_sec": 1,
            "prng_seed": 42,
            "n_workers": 1,
            "live_events": true,
            "biases": ["left"],
        }))
        .unwrap();

        let out = run_bpp_mem(off_center_bp_instance(), &config, &sink)
            .expect("small instance must solve");

        let guard = layouts.lock().unwrap();
        assert!(!guard.is_empty(), "no layout frame captured (live_events?)");
        let last: serde_json::Value =
            serde_json::from_str(guard.last().unwrap()).unwrap();
        let mut frame: Vec<(f32, f32, f32)> = last["items"]
            .as_array()
            .expect("frame items array")
            .iter()
            .map(|it| {
                (
                    it[2].as_f64().unwrap() as f32,
                    it[3].as_f64().unwrap() as f32,
                    it[4].as_f64().unwrap() as f32,
                )
            })
            .collect();
        frame.sort_by(|a, b| a.partial_cmp(b).unwrap());
        drop(guard);

        // Export : la transformation sérialisée porte la rotation en
        // DEGRÉS (le worker Python fait math.radians(...) à la lecture) —
        // pas de conversion ici.
        let sol = &out.alternatives[0]["solution"];
        let mut exported: Vec<(f32, f32, f32)> = sol["layouts"]
            .as_array()
            .expect("export layouts")
            .iter()
            .flat_map(|l| l["placed_items"].as_array().unwrap().iter())
            .map(|pi| {
                let t = &pi["transformation"];
                (
                    t["rotation"].as_f64().unwrap() as f32,
                    t["translation"][0].as_f64().unwrap() as f32,
                    t["translation"][1].as_f64().unwrap() as f32,
                )
            })
            .collect();
        exported.sort_by(|a, b| a.partial_cmp(b).unwrap());

        assert_eq!(frame.len(), exported.len(), "frame vs export item count");
        for (f, e) in frame.iter().zip(exported.iter()) {
            assert!(
                (f.0 - e.0).abs() <= 0.006 && (f.1 - e.1).abs() <= 6e-4 && (f.2 - e.2).abs() <= 6e-4,
                "frame {f:?} != export {e:?} — d_transf nu (repère interne) au lieu de int_to_ext ?"
            );
        }
    }
}
