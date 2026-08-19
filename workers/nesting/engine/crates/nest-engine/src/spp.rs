use crate::bpp::constructive::DirBias;
use crate::config::EngineConfig;
use crate::merge::{SpMergeMode, SpRun, merge_sp_runs};
use crate::progress::{EventSink, PlateauTerminator, ProgressListener};
use crate::{EngineOutput, map_workers};
use anyhow::{Context, Result, bail};
use jagua_rs::io::import::Importer;
use jagua_rs::probs::spp::entities::{SPInstance, SPSolution};
use jagua_rs::probs::spp::io::ext_repr::ExtSPInstance;
use rand::SeedableRng;
use rand::rngs::Xoshiro256PlusPlus;
use sparrow::optimizer::optimize;
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

/// Used height of a solution (max y extent of the placed shapes) — the
/// secondary ranking criterion: at equal width, the layout consuming the
/// least sheet height wins (parts nested in holes instead of stacked).
/// Pub : réutilisée par le repli `used_height` du merge wasm (merge.rs).
pub fn used_height(solution: &SPSolution) -> f32 {
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
    column_fill: bool,
    max_strip_width: Option<f32>,
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
        // J-086 : gravité orientée par classe directionnelle (left/bottom/
        // balanced) pour laisser une grosse chute rectangulaire cohérente.
        crate::gravity::gravity_for_bias(&mut prob, bias_tag, instance.base_strip.fixed_height);
        // J-092 : post-pass de remplissage (notch-fill/restack left,
        // rééquilibrage balanced). Uniquement sur la frame FINALE : les runs
        // transposés (map_back_height Some) reçoivent le post-pass après
        // mapping, via gravity_after.
        if column_fill && map_back_height.is_none() {
            crate::column_fill::post_pass_for_bias(&mut prob, bias_tag, max_strip_width);
        }
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
    column_fill: bool,
    max_strip_width: Option<f32>,
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
            column_fill,
            max_strip_width,
        );
        WorkerRun { seed, solution, evals }
    })
}

/// Rotates an external instance -90° (x, y) -> (y, -x) and sets the strip
/// height. Allowed orientations are unchanged: rotating the problem frame
/// preserves the items' relative angles.
pub(crate) fn transpose_instance(ext: &ExtSPInstance, strip_height: f32) -> ExtSPInstance {
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
pub(crate) fn map_back_solution(
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

fn ring_area(pts: &[(f32, f32)]) -> f32 {
    let mut s = 0.0;
    for i in 0..pts.len().saturating_sub(1) {
        s += pts[i].0 * pts[i + 1].1 - pts[i + 1].0 * pts[i].1;
    }
    (s / 2.0).abs()
}

/// J-088 (balanced) : largeur cible de la région utilisée pour que la chute
/// droite (W−uw) ≈ chute haut (H−uh), avec uh ≈ A/uw. Résout
/// uw² + (H−W)·uw − A = 0, majorée ~15 % (spacing/pertes).
fn balanced_width(area: f32, sheet_h: f32, sheet_w: f32) -> f32 {
    let a = area * 1.15;
    let dh = sheet_h - sheet_w;
    let disc = (dh * dh + 4.0 * a).max(0.0);
    (-dh + disc.sqrt()) / 2.0
}

pub fn run_spp_mem(
    ext_instance: ExtSPInstance,
    config: &EngineConfig,
    sink: &EventSink,
) -> Result<EngineOutput> {
    let started = Instant::now();

    // Aire totale des pièces (× demande) — corridor équilibré (J-088).
    let total_part_area: f32 = ext_instance
        .items
        .iter()
        .map(|it| {
            let a = match &it.base.shape {
                jagua_rs::io::ext_repr::ExtShape::SimplePolygon(p) => ring_area(&p.0),
                _ => 0.0,
            };
            a * it.demand as f32
        })
        .sum();

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
        let column_fill_on = config.column_fill();
        let live = config.live_events();
        let slack = config.phase2_slack_mm();
        let plateau = config.plateau_patience();

        let gravity_after =
            |instance: &SPInstance, mut mapped: SPSolution, bias: Option<&'static str>| {
                if gravity_on {
                    let mut prob =
                        jagua_rs::probs::spp::entities::SPProblem::new(instance.clone());
                    prob.restore(&mapped);
                    // J-086 : gravité orientée par classe (balanced équilibré).
                    crate::gravity::gravity_for_bias(&mut prob, bias, instance.base_strip.fixed_height);
                    // J-092 : post-pass de remplissage sur la frame finale.
                    if column_fill_on {
                        crate::column_fill::post_pass_for_bias(&mut prob, bias, max_width);
                    }
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
                            column_fill_on,
                            max_width,
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
                            column_fill_on,
                            max_width,
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
                        Some(ClassRun { seed, bias, solution: gravity_after(&instance, mapped, Some(bias.as_str())), evals: s1_evals + s2_evals })
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
                            column_fill_on,
                            max_width,
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
                            column_fill_on,
                            max_width,
                        );
                        if s1.strip_width() > ext_instance.strip_height + 1e-4 {
                            return None; // taller than the sheet: unusable
                        }
                        if !two_phase {
                            let mapped = map_back_solution(&t_instance, &s1, mw, &instance);
                            return Some(ClassRun { seed, bias, solution: gravity_after(&instance, mapped, Some(bias.as_str())), evals: s1_evals });
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
                            column_fill_on,
                            max_width,
                        );
                        if s2.strip_width() > mw + 1e-4 {
                            // Width overshot the sheet: keep the phase-1
                            // transposed result (mapped back) instead.
                            let mapped = map_back_solution(&t_instance, &s1, mw, &instance);
                            return Some(ClassRun { seed, bias, solution: gravity_after(&instance, mapped, Some(bias.as_str())), evals: s1_evals + s2_evals });
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
                            column_fill_on,
                            max_width,
                            );
                            return Some(ClassRun { seed, bias, solution: s, evals });
                        };
                        let (s1, s1_evals) = optimize_one(
                            &instance, &sparrow_config,
                            if two_phase { b1 } else { budget },
                            explore, seed, w, started, gravity_on, live, None, plateau,
                            Some(bias.as_str()),
sink,
                            column_fill_on,
                            max_width,
                        );
                        if !two_phase {
                            return Some(ClassRun { seed, bias, solution: s1, evals: s1_evals });
                        }
                        // J-086 (balanced) : corridor choisi pour que la chute
                        // droite ≈ chute haut. On résout uw² + (H-W)·uw - A = 0
                        // (uh = A/uw), ce qui donne une région utilisée plus
                        // haute que large sur une tôle portrait → bras égaux.
                        // J-088 : corridor = largeur cible équilibrée (chute
                        // droite ≈ chute haut), bornée sur [min_width, mw].
                        // J-092 suite : si la phase 1 a dépassé la tôle
                        // (piège #6 — une solution feasible peut dépasser
                        // max_strip_width), le plancher du clamp serait >
                        // mw (panic f32::clamp) : on cape à mw, comme left.
                        let corridor = if s1.strip_width() > mw {
                            mw
                        } else {
                            balanced_width(
                                total_part_area,
                                ext_instance.strip_height,
                                mw,
                            )
                            .clamp(s1.strip_width(), mw)
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
                            column_fill_on,
                            max_width,
                        );
                        if s2.strip_width() > ext_instance.strip_height + 1e-4 {
                            // J-092 suite : retry borné au lieu du fallback
                            // dur (spec J-092 ③ — bisection du corridor) :
                            // UNE re-tentative avec corridor élargi (milieu
                            // entre corridor et tôle) si le budget restant le
                            // permet, puis meilleur faisable. Un corridor plus
                            // large relaxe la contrainte de largeur : la
                            // compaction peut descendre sous la hauteur tôle.
                            let corridor2 = (corridor + mw) / 2.0;
                            let remaining = budget.saturating_sub(started.elapsed());
                            // Le retry consomme le budget RESTANT (borné : le
                            // job ne dépasse jamais son enveloppe totale).
                            let retry_budget = remaining;
                            if corridor2 > corridor + 1.0
                                && (det_mode
                                    || retry_budget >= Duration::from_millis(500))
                            {
                                sink(&format!(
                                    "{{\"type\":\"retry\",\"worker\":{w},\"bias\":\"balanced\",\"corridor\":{corridor2:.3},\"budget_sec\":{:.3}}}",
                                    retry_budget.as_secs_f32()
                                ));
                                let t_ext2 = transpose_instance(&ext_instance, corridor2);
                                if let Ok(t_instance2) =
                                    jagua_rs::probs::spp::io::import_instance(&importer, &t_ext2)
                                {
                                    let (s3, s3_evals) = optimize_one(
                                        &t_instance2, &sparrow_config, retry_budget,
                                        explore, seed ^ 0x5EED_5EED, w, started,
                                        gravity_on, live, Some(corridor2), plateau,
                                        Some(bias.as_str()),
                                        sink,
                                        column_fill_on,
                                        max_width,
                                    );
                                    if s3.strip_width() <= ext_instance.strip_height + 1e-4 {
                                        let mapped = map_back_solution(
                                            &t_instance2, &s3, corridor2, &instance,
                                        );
                                        return Some(ClassRun {
                                            seed,
                                            bias,
                                            solution: gravity_after(
                                                &instance,
                                                mapped,
                                                Some(bias.as_str()),
                                            ),
                                            evals: s1_evals + s2_evals + s3_evals,
                                        });
                                    }
                                }
                            }
                            // Fallback : la phase 1, seulement si ELLE tient
                            // dans la tôle (piège #6) — sinon la classe est
                            // perdue (None), comme left.
                            if s1.strip_width() > mw + 1e-4 {
                                return None;
                            }
                            return Some(ClassRun { seed, bias, solution: s1, evals: s1_evals + s2_evals });
                        }
                        let mapped = map_back_solution(&t_instance, &s2, corridor, &instance);
                        Some(ClassRun {
                            seed,
                            bias,
                            solution: gravity_after(&instance, mapped, Some(bias.as_str())),
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
        // order), then remaining runs by quality as fallback — la fusion est
        // partagée avec l'entrée wasm `merge_alternatives` (J-093).
        let epoch = *sparrow::EPOCH;
        let exported: Vec<SpRun> = runs
            .iter()
            .map(|r| SpRun {
                seed: r.seed,
                bias: Some(r.bias),
                evals: r.evals,
                used_height: used_height(&r.solution),
                solution: jagua_rs::probs::spp::io::export(&instance, &r.solution, epoch),
            })
            .collect();
        let merged = merge_sp_runs(
            &ext_instance,
            &exported,
            SpMergeMode::Directions(&biases),
            max_width,
            config.n_alternatives,
        )
        .expect("feasible solutions exist but none exported");

        sink(&format!(
            "{{\"type\":\"done\",\"best_strip_width\":{:.3},\"density\":{:.4},\"alternatives\":{},\"elapsed_sec\":{}}}",
            merged.best_strip_width,
            merged.best_density,
            merged.output.alternatives.len(),
            started.elapsed().as_secs()
        ));
        return Ok(merged.output);
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
        config.column_fill(),
        max_width,
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
                    config.column_fill(),
                    max_width,
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
                        // J-092 : post-pass « left » (la gravité legacy est la
                        // gravité gauche par défaut, J-088).
                        if config.column_fill() {
                            crate::column_fill::post_pass_for_bias(&mut prob, None, max_width);
                        }
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

    // Rank: narrowest strip first, then least used height, stable seed
    // tie-break — fusion partagée avec l'entrée wasm `merge_alternatives`
    // (J-093), mode Flat (flux legacy sans classes).
    let epoch = *sparrow::EPOCH;
    let exported: Vec<SpRun> = final_runs
        .iter()
        .map(|r| SpRun {
            seed: r.seed,
            bias: None,
            evals: r.evals,
            used_height: used_height(&r.solution),
            solution: jagua_rs::probs::spp::io::export(&instance, &r.solution, epoch),
        })
        .collect();
    let merged = merge_sp_runs(
        &ext_instance,
        &exported,
        SpMergeMode::Flat,
        max_width,
        config.n_alternatives,
    )
    .expect("feasible solutions exist but none exported");

    sink(&format!(
        "{{\"type\":\"done\",\"best_strip_width\":{:.3},\"density\":{:.4},\"alternatives\":{},\"elapsed_sec\":{}}}",
        merged.best_strip_width,
        merged.best_density,
        merged.output.alternatives.len(),
        started.elapsed().as_secs()
    ));
    Ok(merged.output)
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

    /// Vecteurs en dur pour le miroir BigInt côté JS (J-093 — le pool de Web
    /// Workers dérive seed_w = derive_seed(master, w) exactement comme le
    /// multi-start serveur). Valeurs vérifiées par deux implémentations
    /// indépendantes (Rust + Python).
    #[test]
    fn derive_seed_vectors() {
        let vectors: &[(u64, usize, u64)] = &[
            (0, 0, 0),
            (1, 0, 6238072747940578789),
            (42, 0, 2835554897195333154),
            (42, 1, 4456085495900499605),
            (42, 2, 2949826092126892291),
            (42, 3, 5139283748462763858),
            (i64::MAX as u64, 7, 3255033911170563879), // 2^63 - 1
            (9223372036854775806, 1, 3158053848750491582), // 2^63 - 2
        ];
        for &(master, worker, expected) in vectors {
            assert_eq!(
                derive_seed(master, worker),
                expected,
                "derive_seed({master}, {worker})"
            );
            // Stabilité : deux appels, même valeur (et ≤ i64::MAX).
            assert_eq!(derive_seed(master, worker), derive_seed(master, worker));
            assert!(expected <= i64::MAX as u64);
        }
    }
}
