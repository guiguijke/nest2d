use crate::bpp::constructive::DirBias;
use crate::config::EngineConfig;
use crate::progress::{EventSink, PlateauTerminator, ProgressListener};
use crate::{EngineOutput, map_workers};
use anyhow::{Context, Result, bail};
use jagua_rs::io::import::Importer;
use jagua_rs::probs::spp::entities::{SPInstance, SPSolution};
use jagua_rs::probs::spp::io::ext_repr::{ExtSPInstance, ExtSPSolution};
use rand::SeedableRng;
use rand::rngs::Xoshiro256PlusPlus;
use sparrow::optimizer::optimize;
use sparrow::util::io::ExtSPOutput;
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use jagua_rs::Instant;
use std::time::Duration;

/// One finished multi-start worker run.
struct WorkerRun {
    seed: u64,
    solution: SPSolution,
    evals: usize,
}

/// One finished run in directions mode, tagged with its directional class.
struct ClassRun {
    seed: u64,
    bias: crate::bpp::constructive::DirBias,
    solution: SPSolution,
    evals: usize,
}

/// Splitmix-style derivation of independent per-worker seeds from the master
/// seed. Deterministic and stable across runs/machines.
/// Masked to 63 bits: seeds round-trip through MongoDB (int64) on the
/// Python side, so they must never exceed i64::MAX.
pub fn derive_seed(master: u64, worker: usize) -> u64 {
    let mut z = master.wrapping_add((worker as u64).wrapping_mul(0x9E37_79B9_7F4A_7C15));
    z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
    z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
    (z ^ (z >> 31)) & 0x7FFF_FFFF_FFFF_FFFF
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

/// Used height of a solution (max y extent of the placed shapes) — the
/// secondary ranking criterion: at equal width, the layout consuming the
/// least sheet height wins (parts nested in holes instead of stacked).
fn used_height(solution: &SPSolution) -> f32 {
    solution
        .layout_snapshot
        .placed_items
        .values()
        .map(|pi| pi.shape.bbox.y_max)
        .fold(0.0f32, f32::max)
}

/// Single explore+compress run (one seed), with the gravity post-pass.
/// Extracted from optimize_multi; also used per-class in directions mode.
/// `plateau_patience`: stop the run early when it stops improving (the
/// listener's report stream feeds the plateau clock).
#[allow(clippy::too_many_arguments)]
fn optimize_one(
    instance: &SPInstance,
    sparrow_cfg: &sparrow::config::SparrowConfig,
    budget: Duration,
    explore_ratio: f32,
    seed: u64,
    worker: usize,
    started: Instant,
    gravity_enabled: bool,
    live: bool,
    map_back_height: Option<f32>,
    plateau_patience: Option<Duration>,
    bias_tag: Option<&'static str>,
    sink: &EventSink,
) -> (SPSolution, usize) {
    let mut cfg = *sparrow_cfg;
    cfg.expl_cfg.time_limit = budget.mul_f32(explore_ratio);
    cfg.cmpr_cfg.time_limit = budget.mul_f32(1.0 - explore_ratio);
    let rng = Xoshiro256PlusPlus::seed_from_u64(seed);
    let mut listener = ProgressListener::new(worker, started)
        .with_live(live)
        .with_map_back(map_back_height)
        .with_bias(bias_tag)
        .with_sink(sink.clone());
    let mut terminator = PlateauTerminator::new(listener.improvement_clock(), plateau_patience);
    let (solution, evals) = optimize(
        instance.clone(),
        rng,
        &mut listener,
        &mut terminator,
        &cfg.expl_cfg,
        &cfg.cmpr_cfg,
        None,
    );
    // Gravity post-pass: the search minimizes strip width only, so
    // under-constrained layouts can come out vertically scattered.
    let solution = if gravity_enabled {
        let mut prob = jagua_rs::probs::spp::entities::SPProblem::new(instance.clone());
        prob.restore(&solution);
        crate::gravity::gravity_compact(&mut prob);
        let solution = prob.save();
        // Stream the post-gravity final state so the visualizer's
        // last frame matches the exported solution exactly.
        listener.report_final(&solution, instance);
        solution
    } else {
        solution
    };
    (solution, evals)
}

/// Runs the explore+compress pipeline on `n_workers` parallel multi-starts,
/// each with its own derived seed and the full phase budget, then applies the
/// gravity post-pass to every run. Deterministic regardless of scheduling.
fn optimize_multi(
    instance: &SPInstance,
    sparrow_cfg: &sparrow::config::SparrowConfig,
    budget: Duration,
    explore_ratio: f32,
    master_seed: u64,
    seed_offset: usize,
    n_workers: usize,
    started: Instant,
    gravity_enabled: bool,
    live: bool,
    map_back_height: Option<f32>,
    plateau_patience: Option<Duration>,
    sink: &EventSink,
) -> Vec<WorkerRun> {
    map_workers(n_workers, |w| {
        let seed = derive_seed(master_seed, seed_offset + w);
        let (solution, evals) = optimize_one(
            instance,
            sparrow_cfg,
            budget,
            explore_ratio,
            seed,
            w,
            started,
            gravity_enabled,
            live,
            map_back_height,
            plateau_patience,
            None,
            sink,
        );
        WorkerRun { seed, solution, evals }
    })
}

/// Rotates an external instance -90° (x, y) -> (y, -x) and sets the strip
/// height. Allowed orientations are unchanged: rotating the problem frame
/// preserves the items' relative angles.
fn transpose_instance(ext: &ExtSPInstance, strip_height: f32) -> ExtSPInstance {
    let rotate_poly = |poly: &jagua_rs::io::ext_repr::ExtSPolygon| {
        jagua_rs::io::ext_repr::ExtSPolygon(
            poly.0.iter().map(|&(x, y)| (y, -x)).collect(),
        )
    };
    let mut out = ext.clone();
    out.strip_height = strip_height;
    for item in out.items.iter_mut() {
        if let jagua_rs::io::ext_repr::ExtShape::SimplePolygon(poly) = &item.base.shape {
            item.base.shape =
                jagua_rs::io::ext_repr::ExtShape::SimplePolygon(rotate_poly(poly));
        }
    }
    out
}

/// Maps a solution of the transposed problem back to the original frame:
/// world = R(+90°) ∘ world', which (2D rotations commute) leaves the
/// rotation unchanged and maps the translation (x, y) -> (H - y, x), H being
/// the transposed strip height.
fn map_back_solution(
    t_instance: &SPInstance,
    t_solution: &SPSolution,
    corridor: f32,
    orig_instance: &SPInstance,
) -> SPSolution {
    let epoch = *sparrow::EPOCH;
    let mut ext = jagua_rs::probs::spp::io::export(t_instance, t_solution, epoch);
    for pi in ext.layout.placed_items.iter_mut() {
        let (tx, ty) = pi.transformation.translation;
        pi.transformation.translation = (corridor - ty, tx);
    }
    ext.strip_width = corridor;
    jagua_rs::probs::spp::io::import_solution(orig_instance, &ext)
}

pub fn run_spp_mem(
    ext_instance: ExtSPInstance,
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
    let instance = jagua_rs::probs::spp::io::import_instance(&importer, &ext_instance)
        .context("importing SPP instance into jagua-rs")?;

    let n_workers = config.n_workers();
    // In deterministic work-bounded mode the wall budget must NOT leak
    // through — optimize_one re-derives phase time limits from `budget`, so
    // a wall budget here would still kill slow (e.g. wasm) runs
    // mid-trajectory and break the cross-target determinism lock.
    let det_mode = config.explore_max_conseq_failed_attempts.is_some()
        || config.compress_failure_decay.is_some();
    let budget = if det_mode {
        Duration::from_secs(24 * 3600)
    } else {
        Duration::from_secs(config.time_budget_sec)
    };
    // Two-phase (transposed height compaction) is a SHEET objective: it
    // trades up to ~slack mm of width for hole filling and a smaller used
    // height. Meaningful only when a real sheet bound exists; unconstrained
    // strip packing (benchmarks) keeps the full budget on width alone.
    let two_phase = config.two_phase() && config.max_strip_width.is_some();
    sink(&format!(
        "{{\"type\":\"start\",\"problem\":\"spp\",\"name\":\"{}\",\"items\":{},\"workers\":{},\"budget_sec\":{},\"two_phase\":{}}}",
        ext_instance.name,
        instance.total_item_qty(),
        n_workers,
        config.time_budget_sec,
        two_phase
    ));

    let max_width = config.max_strip_width;
    let (b1, b2) = if two_phase {
        (
            budget.mul_f32(config.phase1_ratio()),
            budget.mul_f32(1.0 - config.phase1_ratio()),
        )
    } else {
        (budget, Duration::ZERO)
    };

    // ================= Directions mode (tiered compute) =================
    // The client picked layout directions: each worker is assigned a class
    // round-robin and every class champions a genuinely different offcut
    // shape. Legacy jobs (no `biases` in config) keep the historical
    // two-phase flow below.
    if config.biases.is_some() {
        let biases = config.dir_biases();
        let explore = config.explore_ratio;
        let gravity_on = config.gravity();
        let live = config.live_events();
        let slack = config.phase2_slack_mm();
        let plateau = config.plateau_patience();

        let gravity_after = |instance: &SPInstance, mut mapped: SPSolution| {
            if gravity_on {
                let mut prob =
                    jagua_rs::probs::spp::entities::SPProblem::new(instance.clone());
                prob.restore(&mapped);
                crate::gravity::gravity_compact(&mut prob);
                mapped = prob.save();
            }
            mapped
        };

        let runs: Vec<ClassRun> = map_workers(n_workers, |w| {
            let bias = biases[w % biases.len()];
                let seed = derive_seed(config.prng_seed, w);
                match bias {
                    // Historical behaviour: width-min, then transposed height
                    // compaction when a sheet bound exists.
                    DirBias::LeftFirst => {
                        let (s1, s1_evals) = optimize_one(
                            &instance, &sparrow_config,
                            if two_phase { b1 } else { budget },
                            explore, seed, w, started, gravity_on, live, None, plateau,
                            Some(bias.as_str()),
sink,
                        );
                        if !two_phase {
                            return Some(ClassRun { seed, bias, solution: s1, evals: s1_evals });
                        }
                        // Corridor capped at the sheet width even when phase 1
                        // overshot it: phase 2 then FORCES width = mw (a
                        // degraded-but-feasible left) instead of losing the
                        // whole class — with one worker per class, a single
                        // missed phase 1 must not empty the class.
                        let corridor = match max_width {
                            Some(mw) => (s1.strip_width() + slack).min(mw),
                            None => s1.strip_width() + slack,
                        };
                        let t_ext = transpose_instance(&ext_instance, corridor);
                        let t_instance =
                            jagua_rs::probs::spp::io::import_instance(&importer, &t_ext).ok()?;
                        let (s2, s2_evals) = optimize_one(
                            &t_instance, &sparrow_config, b2, explore,
                            seed ^ 0x5EED_5EED, w, started, gravity_on, live,
                            Some(corridor), plateau,
                            Some(bias.as_str()),
                            sink,
                        );
                        if s2.strip_width() > ext_instance.strip_height + 1e-4 {
                            // Phase 2 overshot the sheet height: fall back to
                            // the phase-1 width-min layout when IT fits —
                            // the legacy flow keeps phase-1 results in this
                            // exact case too.
                            if max_width.is_some_and(|mw| s1.strip_width() > mw + 1e-4) {
                                return None;
                            }
                            return Some(ClassRun { seed, bias, solution: s1, evals: s1_evals + s2_evals });
                        }
                        let mapped = map_back_solution(&t_instance, &s2, corridor, &instance);
                        Some(ClassRun { seed, bias, solution: gravity_after(&instance, mapped), evals: s1_evals + s2_evals })
                    }
                    // Minimize USED HEIGHT: phase 1 on the 90°-transposed
                    // strip (transposed width == original height usage),
                    // then phase 2 back in the original frame with a tight
                    // HEIGHT corridor — minimizing the width inside that
                    // corridor forces parts into holes and pockets, exactly
                    // like the transposed compaction does for the left class.
                    DirBias::BottomFirst => {
                        let Some(mw) = max_width else {
                            // No sheet bound: directions are meaningless here.
                            let (s, evals) = optimize_one(
                                &instance, &sparrow_config, budget, explore,
                                seed, w, started, gravity_on, live, None, plateau,
                                Some(bias.as_str()),
sink,
                            );
                            return Some(ClassRun { seed, bias, solution: s, evals });
                        };
                        let t_ext = transpose_instance(&ext_instance, mw);
                        let t_instance =
                            jagua_rs::probs::spp::io::import_instance(&importer, &t_ext).ok()?;
                        let (s1, s1_evals) = optimize_one(
                            &t_instance, &sparrow_config,
                            if two_phase { b1 } else { budget },
                            explore, seed, w, started, gravity_on, live,
                            Some(mw), plateau,
                            Some(bias.as_str()),
                            sink,
                        );
                        if s1.strip_width() > ext_instance.strip_height + 1e-4 {
                            return None; // taller than the sheet: unusable
                        }
                        if !two_phase {
                            let mapped = map_back_solution(&t_instance, &s1, mw, &instance);
                            return Some(ClassRun { seed, bias, solution: gravity_after(&instance, mapped), evals: s1_evals });
                        }
                        // Phase 2: original frame, strip height = best height
                        // + slack. The width minimizer can no longer stack
                        // past the corridor, so it packs parts into holes.
                        let height_corridor =
                            (s1.strip_width() + slack).min(ext_instance.strip_height);
                        let mut ext2 = ext_instance.clone();
                        ext2.strip_height = height_corridor;
                        let inst2 =
                            jagua_rs::probs::spp::io::import_instance(&importer, &ext2).ok()?;
                        let (s2, s2_evals) = optimize_one(
                            &inst2, &sparrow_config, b2, explore,
                            seed ^ 0x5EED_5EED, w, started, gravity_on, live,
                            None, plateau,
                            Some(bias.as_str()),
sink,
                        );
                        if s2.strip_width() > mw + 1e-4 {
                            // Width overshot the sheet: keep the phase-1
                            // transposed result (mapped back) instead.
                            let mapped = map_back_solution(&t_instance, &s1, mw, &instance);
                            return Some(ClassRun { seed, bias, solution: gravity_after(&instance, mapped), evals: s1_evals + s2_evals });
                        }
                        Some(ClassRun { seed, bias, solution: s2, evals: s1_evals + s2_evals })
                    }
                    // Corner blob: width-min first (like left), then the
                    // transposed compaction with a corridor of 2x that
                    // minimal width instead of the tight one — hosts stay
                    // grouped (hole filling is preserved, like left) but the
                    // layout spreads into a compact corner rectangle about
                    // two columns wide, with an L-shaped offcut. Distinct
                    // from both the left column and the bottom row.
                    DirBias::Balanced => {
                        let Some(mw) = max_width else {
                            // No sheet bound: directions are meaningless here.
                            let (s, evals) = optimize_one(
                                &instance, &sparrow_config, budget, explore,
                                seed, w, started, gravity_on, live, None, plateau,
                                Some(bias.as_str()),
sink,
                            );
                            return Some(ClassRun { seed, bias, solution: s, evals });
                        };
                        let (s1, s1_evals) = optimize_one(
                            &instance, &sparrow_config,
                            if two_phase { b1 } else { budget },
                            explore, seed, w, started, gravity_on, live, None, plateau,
                            Some(bias.as_str()),
sink,
                        );
                        if !two_phase {
                            return Some(ClassRun { seed, bias, solution: s1, evals: s1_evals });
                        }
                        let corridor = (s1.strip_width() * 2.0).min(mw);
                        let t_ext = transpose_instance(&ext_instance, corridor);
                        let t_instance =
                            jagua_rs::probs::spp::io::import_instance(&importer, &t_ext).ok()?;
                        let (s2, s2_evals) = optimize_one(
                            &t_instance, &sparrow_config, b2, explore,
                            seed ^ 0x5EED_5EED, w, started, gravity_on, live,
                            Some(corridor), plateau,
                            Some(bias.as_str()),
                            sink,
                        );
                        if s2.strip_width() > ext_instance.strip_height + 1e-4 {
                            // Corridor overshot the sheet height: fall back to
                            // the phase-1 layout (legacy resilience).
                            return Some(ClassRun { seed, bias, solution: s1, evals: s1_evals + s2_evals });
                        }
                        let mapped = map_back_solution(&t_instance, &s2, corridor, &instance);
                        Some(ClassRun {
                            seed,
                            bias,
                            solution: gravity_after(&instance, mapped),
                            evals: s1_evals + s2_evals,
                        })
                    }
                }
            })
            .into_iter()
            .flatten()
            .collect();

        if runs.is_empty() {
            sink(&format!(
                "{{\"type\":\"error\",\"reason\":\"infeasible\",\"elapsed_sec\":{}}}",
                started.elapsed().as_secs()
            ));
            bail!("no feasible solution in directions mode");
        }

        // Alternatives grouped by class (canonical left/bottom/balanced
        // order), then remaining runs by quality as fallback.
        let quality = |r: &ClassRun| {
            (
                ordered_float(strip(r)),
                ordered_float(used_height(&r.solution)),
                r.seed,
            )
        };
        fn strip(r: &ClassRun) -> f32 {
            r.solution.strip_width()
        }
        fn ordered_float(v: f32) -> u64 {
            (v * 1e4).round() as u64
        }
        let mut ordered: Vec<&ClassRun> = DirBias::ALL
            .into_iter()
            .filter(|b| biases.contains(b))
            .filter_map(|b| runs.iter().filter(|r| r.bias == b).min_by_key(|r| quality(r)))
            .collect();
        let mut rest: Vec<&ClassRun> = runs.iter().collect();
        rest.sort_by_key(|r| quality(r));
        ordered.extend(rest);

        let epoch = *sparrow::EPOCH;
        let mut seen = std::collections::HashSet::new();
        let mut alternatives = Vec::new();
        let mut best_json: Option<ExtSPOutput> = None;
        for run in ordered {
            let ext_sol = jagua_rs::probs::spp::io::export(&instance, &run.solution, epoch);
            let fp = solution_fingerprint(&ext_sol);
            if !seen.insert(fp) {
                continue;
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
                "bias": run.bias.as_str(),
                "evaluations": run.evals,
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
        let best_density = best.solution.density;
        let n_exported = alternatives.len();
        sink(&format!(
            "{{\"type\":\"done\",\"best_strip_width\":{:.3},\"density\":{:.4},\"alternatives\":{},\"elapsed_sec\":{}}}",
            best_width,
            best_density,
            n_exported,
            started.elapsed().as_secs()
        ));
        return Ok(EngineOutput {
            sol_instance: serde_json::to_value(&best)?,
            alternatives,
        });
    }


    // ---------------- Phase 1: minimize used width ----------------
    let runs1 = optimize_multi(
        &instance,
        &sparrow_config,
        b1,
        config.explore_ratio,
        config.prng_seed,
        0,
        n_workers,
        started,
        config.gravity(),
        config.live_events(),
        None,
        config.plateau_patience(),
        sink,
    );
    let feasible1: Vec<&WorkerRun> = runs1
        .iter()
        .filter(|r| max_width.is_none_or(|mw| r.solution.strip_width() <= mw + 1e-4))
        .collect();
    if feasible1.is_empty() {
        let best = runs1
            .iter()
            .map(|r| r.solution.strip_width())
            .fold(f32::INFINITY, f32::min);
        sink(&format!(
            "{{\"type\":\"error\",\"reason\":\"infeasible\",\"best_strip_width\":{:.3},\"max_strip_width\":{},\"elapsed_sec\":{}}}",
            best,
            max_width.unwrap_or(f32::NAN),
            started.elapsed().as_secs()
        ));
        bail!(
            "no feasible solution: narrowest strip {:.3} exceeds limit {}",
            best,
            max_width.unwrap_or(f32::NAN)
        );
    }
    let best_width = feasible1
        .iter()
        .map(|r| r.solution.strip_width())
        .fold(f32::INFINITY, f32::min);

    // ------------- Phase 2: minimize used height (transposed) -------------
    // Minimizing the strip width alone is indifferent to hole usage: parts
    // stacked in the used column score the same as parts nested in cutouts.
    // Re-running the optimizer on the 90°-transposed problem with a corridor
    // of width ~W* forces the issue: stacking is impossible, so minimizing
    // the (transposed) length drives parts into holes and shrinks the used
    // height — the real business objective (clean, maximal offcut).
    let mut final_runs: Vec<WorkerRun> = Vec::new();
    if two_phase {
        let corridor = match max_width {
            Some(mw) => (best_width + config.phase2_slack_mm()).min(mw),
            None => best_width + config.phase2_slack_mm(),
        };
        let t_ext = transpose_instance(&ext_instance, corridor);
        match jagua_rs::probs::spp::io::import_instance(&importer, &t_ext) {
            Ok(t_instance) => {
                // The phase-1 layout mapped back always fits, so the length
                // limit is the full strip height.
                let t_config = EngineConfig {
                    max_strip_width: Some(ext_instance.strip_height),
                    ..config.clone()
                };
                let _ = &t_config; // documented intent; feasibility filter below uses it
                let runs2 = optimize_multi(
                    &t_instance,
                    &sparrow_config,
                    b2,
                    config.explore_ratio,
                    config.prng_seed,
                    10_000,
                    n_workers,
                    started,
                    config.gravity(),
                    config.live_events(),
                    Some(corridor),
                    config.plateau_patience(),
                    sink,
                );
                let max_length = ext_instance.strip_height;
                for run in runs2 {
                    if run.solution.strip_width() > max_length + 1e-4 {
                        continue; // longer than the sheet is tall: unusable
                    }
                    let mut mapped = map_back_solution(
                        &t_instance,
                        &run.solution,
                        corridor,
                        &instance,
                    );
                    if config.gravity() {
                        let mut prob =
                            jagua_rs::probs::spp::entities::SPProblem::new(instance.clone());
                        prob.restore(&mapped);
                        crate::gravity::gravity_compact(&mut prob);
                        mapped = prob.save();
                    }
                    final_runs.push(WorkerRun {
                        seed: run.seed,
                        solution: mapped,
                        evals: run.evals,
                    });
                }
                if final_runs.is_empty() {
                    log::warn!("[SPP] phase 2 produced nothing usable, keeping phase 1 results");
                }
            }
            Err(e) => {
                log::warn!("[SPP] transposed instance failed to import ({e:#}), keeping phase 1 results");
            }
        }
    }
    if final_runs.is_empty() {
        final_runs = feasible1.into_iter().map(|r| WorkerRun {
            seed: r.seed,
            solution: r.solution.clone(),
            evals: r.evals,
        }).collect();
    }

    // Rank: narrowest strip first, then least used height, stable seed tie-break.
    final_runs.sort_by(|a, b| {
        a.solution
            .strip_width()
            .total_cmp(&b.solution.strip_width())
            .then(used_height(&a.solution).total_cmp(&used_height(&b.solution)))
            .then(a.seed.cmp(&b.seed))
    });

    // Export incumbent (best feasible) + distinct alternatives.
    let epoch = *sparrow::EPOCH;
    let mut seen = std::collections::HashSet::new();
    let mut alternatives = Vec::new();
    let mut best_json: Option<ExtSPOutput> = None;

    for run in final_runs.iter() {
        let ext_sol = jagua_rs::probs::spp::io::export(&instance, &run.solution, epoch);
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
            "evaluations": run.evals,
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
    let best_density = best.solution.density;
    let n_exported = alternatives.len();

    sink(&format!(
        "{{\"type\":\"done\",\"best_strip_width\":{:.3},\"density\":{:.4},\"alternatives\":{},\"elapsed_sec\":{}}}",
        best_width,
        best_density,
        n_exported,
        started.elapsed().as_secs()
    ));
    Ok(EngineOutput {
        sol_instance: serde_json::to_value(&best)?,
        alternatives,
    })
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
    fn derive_seed_fits_signed_63_bits() {
        for master in [0u64, 1, 42, u64::MAX / 2, u64::MAX] {
            for w in 0..8 {
                assert!(derive_seed(master, w) <= i64::MAX as u64);
            }
        }
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
