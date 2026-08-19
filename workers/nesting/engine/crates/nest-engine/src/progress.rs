use jagua_rs::entities::Instance;
use jagua_rs::probs::spp::entities::{SPInstance, SPSolution};
use sparrow::util::listener::{ReportType, SolutionListener};
use sparrow::util::terminator::Terminator;
use std::io::Write;
use std::sync::{Arc, Mutex};
use jagua_rs::Instant;
use std::time::{Duration};

/// Puits des événements moteur (progress/layout/evals). Le CLI natif écrit
/// sur stdout (le worker Python parse ces lignes) ; le wrapper wasm transmet
/// à une callback JS (vue live navigateur, J-084). PUREMENT observationnel :
/// un sink ne doit JAMAIS influencer la recherche (déterminisme, AGENTS #14b).
/// Send+Sync : les runs multi-start natifs partagent le sink sous rayon.
pub type EventSink = Arc<dyn Fn(&str) + Send + Sync>;

/// Sink par défaut : stdout + flush, comportement historique du CLI.
pub fn stdout_sink() -> EventSink {
    Arc::new(|line: &str| {
        println!("{line}");
        let _ = std::io::stdout().flush();
    })
}

/// Wall-clock timeout + plateau patience for sparrow runs: kills the run
/// when the incumbent has not improved for `patience`. The improvement clock
/// is shared with the ProgressListener, which bumps it on GENUINE global
/// improvements only: a new best width (ExplFeas) or a successful
/// compression (CmprFeas). Working states (ExplImproving / ExplInfeas while
/// separating at an over-shrunk width) deliberately do NOT reset the clock —
/// that grinding is exactly what the plateau stop is meant to cut.
pub struct PlateauTerminator {
    timeout: Option<Instant>,
    last_improvement: Arc<Mutex<Instant>>,
    patience: Option<Duration>,
}

impl PlateauTerminator {
    pub fn new(last_improvement: Arc<Mutex<Instant>>, patience: Option<Duration>) -> Self {
        Self {
            timeout: None,
            last_improvement,
            patience,
        }
    }
}

impl Terminator for PlateauTerminator {
    fn kill(&self) -> bool {
        if self.timeout.is_some_and(|t| Instant::now() > t) {
            return true;
        }
        if let Some(patience) = self.patience {
            return self
                .last_improvement
                .lock()
                .map(|t| t.elapsed() >= patience)
                .unwrap_or(false);
        }
        false
    }

    fn new_timeout(&mut self, timeout: Duration) {
        self.timeout = Some(Instant::now() + timeout);
    }

    fn timeout_at(&self) -> Option<Instant> {
        self.timeout
    }
}

/// SolutionListener emitting throttled JSON progress lines on stdout.
/// The Python worker parses these to update the job's live progress in Mongo;
/// stdout must carry NOTHING else (logs go to stderr, no logger installed).
///
/// With `live_events` enabled (live_lab visualizer), it also emits full
/// placement snapshots of every reported solution — including the infeasible
/// intermediate states, which is what lets you watch the algorithm think.
pub struct ProgressListener {
    worker: usize,
    started: Instant,
    last_emit: Instant,
    last_stage: &'static str,
    live: bool,
    last_layout_emit: Instant,
    /// Phase-2 runs on the 90°-transposed problem: when set (corridor
    /// height), layout events are mapped back to the original frame so the
    /// visualizer always shows the real sheet.
    map_back_height: Option<f32>,
    /// Improvement clock shared with the PlateauTerminator: bumped on every
    /// progress report (the run is demonstrably not converged).
    last_improvement: Arc<Mutex<Instant>>,
    /// Separate 1 Hz slot for the live evals counter (so it never starves
    /// the scalar progress events of their own slot).
    last_evals_emit: Instant,
    /// Directional class of this run (directions mode), tagged on every
    /// event so the frontend can show one track per strategy.
    bias: Option<&'static str>,
    /// Destination of the emitted JSON lines (stdout natif, callback JS wasm).
    sink: EventSink,
}

fn stage_of(report: &ReportType) -> &'static str {
    match report {
        ReportType::ExplFeas | ReportType::ExplInfeas | ReportType::ExplImproving => "explore",
        ReportType::CmprFeas => "compress",
        ReportType::Final => "final",
    }
}

impl ProgressListener {
    pub fn new(worker: usize, started: Instant) -> Self {
        // web-time's browser clock starts at page load — `now() - 2s`
        // underflows and panics on wasm32. Saturate instead (the "-2s" only
        // pre-arms the emit throttles so the first report goes through).
        let now = Instant::now();
        let armed = now
            .checked_sub(std::time::Duration::from_secs(2))
            .unwrap_or(now);
        Self {
            worker,
            started,
            last_emit: armed,
            last_stage: "",
            live: false,
            last_layout_emit: armed,
            map_back_height: None,
            last_improvement: Arc::new(Mutex::new(Instant::now())),
            last_evals_emit: armed,
            bias: None,
            sink: stdout_sink(),
        }
    }

    /// The improvement clock to hand to the PlateauTerminator of this run.
    pub fn improvement_clock(&self) -> Arc<Mutex<Instant>> {
        Arc::clone(&self.last_improvement)
    }

    pub fn with_live(mut self, live: bool) -> Self {
        self.live = live;
        self
    }

    pub fn with_map_back(mut self, height: Option<f32>) -> Self {
        self.map_back_height = height;
        self
    }

    pub fn with_bias(mut self, bias: Option<&'static str>) -> Self {
        self.bias = bias;
        self
    }

    pub fn with_sink(mut self, sink: EventSink) -> Self {
        self.sink = sink;
        self
    }

    fn bias_json(&self) -> String {
        match self.bias {
            Some(b) => format!(",\"bias\":\"{b}\""),
            None => String::new(),
        }
    }

    /// Emits a layout snapshot outside the listener flow — used for the
    /// post-gravity final state, so the last streamed frame matches the
    /// exported solution exactly.
    pub fn report_final(&mut self, solution: &SPSolution, instance: &SPInstance) {
        if self.live {
            self.emit_layout("final", true, solution, instance);
        }
    }

    fn emit(&mut self, stage: &'static str, feasible: bool, strip_width: f32) {
        (self.sink)(&format!(
            "{{\"type\":\"progress\",\"worker\":{},\"stage\":\"{}\",\"feasible\":{},\"strip_width\":{:.3},\"elapsed_sec\":{}{}}}",
            self.worker,
            stage,
            feasible,
            strip_width,
            self.started.elapsed().as_secs(),
            self.bias_json()
        ));
    }

    /// Full layout snapshot for the visualizer: every placed item with its
    /// rotation (degrees) and translation. Coordinates are in the EXTERNAL
    /// (source) frame: `int_to_ext_transformation` composes the centering
    /// pre-transform, EXACTLY like the final export (`export_layout_snapshot`)
    /// — sans ça, les pièces non centrées à l'origine (Piece_Fillx4,
    /// centroïde +17,66 mm) sont décalées de R(θ)·(−centroïde) dans toute
    /// solution reconstruite depuis une frame live (panne prod 100+800 :
    /// fillers excédentaires en amas chevauchant hors tôle, mode local).
    fn emit_layout(&mut self, stage: &'static str, feasible: bool, solution: &SPSolution, instance: &SPInstance) {
        let mut items = String::with_capacity(solution.layout_snapshot.placed_items.len() * 24);
        items.push('[');
        for (i, pi) in solution.layout_snapshot.placed_items.values().enumerate() {
            if i > 0 {
                items.push(',');
            }
            let ext_dt = jagua_rs::io::export::int_to_ext_transformation(
                &pi.d_transf,
                &instance.item(pi.item_id).shape_orig.pre_transform,
            );
            let t = ext_dt.translation();
            let (tx, ty) = match self.map_back_height {
                // Transposed frame -> original: (x, y) -> (H - y, x),
                // rotation unchanged (2D rotations commute) — même formule
                // que map_back_solution, appliquée sur la transform EXTERNE.
                Some(h) => (h - t.1, t.0),
                None => t,
            };
            items.push_str(&format!(
                "[{},{:.2},{:.3},{:.3}]",
                pi.item_id,
                ext_dt.rotation().to_degrees(),
                tx,
                ty
            ));
        }
        items.push(']');
        let strip_width = solution.strip_width();
        let density = solution.density(instance);
        (self.sink)(&format!(
            "{{\"type\":\"layout\",\"worker\":{},\"stage\":\"{}\",\"feasible\":{},\"strip_width\":{:.3},\"density\":{:.4},\"elapsed_ms\":{},\"items\":{}{}}}",
            self.worker,
            stage,
            feasible,
            strip_width,
            density,
            self.started.elapsed().as_millis(),
            items,
            self.bias_json()
        ));
    }
}

impl SolutionListener for ProgressListener {
    fn report_evals(&mut self, evals: usize) {
        // Live combinations counter: throttled to 1 Hz per worker, the
        // Python side sums the latest value of every worker.
        if self.last_evals_emit.elapsed().as_millis() >= 1000 {
            self.last_evals_emit = Instant::now();
            (self.sink)(&format!(
                "{{\"type\":\"evals\",\"worker\":{},\"evals\":{},\"elapsed_sec\":{}{}}}",
                self.worker,
                evals,
                self.started.elapsed().as_secs(),
                self.bias_json()
            ));
        }
    }

    fn report(&mut self, report: ReportType, solution: &SPSolution, instance: &SPInstance) {
        let stage = stage_of(&report);
        let feasible = matches!(report, ReportType::ExplFeas | ReportType::CmprFeas | ReportType::Final);

        // Genuine global improvements only: new best width (ExplFeas) or
        // successful compression (CmprFeas). Working states (ExplImproving /
        // ExplInfeas) do NOT reset the plateau clock — grinding at an
        // over-shrunk width is what the plateau stop is meant to cut.
        if matches!(report, ReportType::ExplFeas | ReportType::CmprFeas) {
            if let Ok(mut t) = self.last_improvement.lock() {
                *t = Instant::now();
            }
        }

        // Throttle scalar progress to 1 Hz per worker: report types
        // flip-flop between rounds of a phase. Final always passes.
        if report == ReportType::Final || self.last_emit.elapsed().as_secs() >= 1 {
            self.last_emit = Instant::now();
            self.last_stage = stage;
            self.emit(stage, feasible, solution.strip_width());
        }

        // Layout snapshots for the visualizer: 2 Hz per worker max, but
        // phase transitions and the final solution always go through.
        if self.live {
            let is_transition = stage != self.last_stage;
            if report == ReportType::Final
                || is_transition
                || self.last_layout_emit.elapsed().as_millis() >= 500
            {
                self.last_layout_emit = Instant::now();
                self.emit_layout(stage, feasible, solution, instance);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use jagua_rs::geometry::DTransformation;
    use jagua_rs::io::import::Importer;
    use jagua_rs::probs::spp::entities::{SPPlacement, SPProblem};
    use jagua_rs::probs::spp::io::ext_repr::ExtSPInstance;
    use jagua_rs::probs::spp::io::import_instance;

    /// Instance avec une pièce ASYMÉTRIQUE (L 40×30, centroïde d'aire ≠
    /// origine — le cas Piece_Fillx4 : centroïde à +17,66 mm).
    fn asym_ext_instance() -> ExtSPInstance {
        let json = serde_json::json!({
            "name": "asym-live-test",
            "strip_height": 300.0,
            "items": [{
                "id": 0,
                "demand": 3,
                "allowed_orientations": [0.0, 90.0, 180.0, 270.0],
                "shape": {"type": "simple_polygon", "data": [
                    [0,0],[40,0],[40,10],[12,10],[12,30],[0,30],[0,0]]}
            }]
        });
        serde_json::from_value(json).unwrap()
    }

    fn asym_instance() -> SPInstance {
        let importer = Importer::new(
            sparrow::config::DEFAULT_SPARROW_CONFIG.cde_config,
            Some(0.001),
            Some(2.0),
            Some((0.01, 0.01)),
        );
        import_instance(&importer, &asym_ext_instance()).unwrap()
    }

    /// Capture la frame live émise pour `sol` et retourne les (rot°, tx, ty)
    /// parsés, triés par item. `map_back` = hauteur corridor phase 2.
    fn capture_frame(
        sol: &SPSolution,
        instance: &SPInstance,
        map_back: Option<f32>,
    ) -> Vec<(f32, f32, f32)> {
        let captured = Arc::new(Mutex::new(String::new()));
        let c2 = Arc::clone(&captured);
        let sink: EventSink = Arc::new(move |line: &str| {
            c2.lock().unwrap().push_str(line);
        });
        let mut listener = ProgressListener::new(0, Instant::now())
            .with_live(true)
            .with_map_back(map_back)
            .with_sink(sink);
        listener.emit_layout("final", true, sol, instance);
        let line = captured.lock().unwrap().clone();
        let v: serde_json::Value = serde_json::from_str(&line).unwrap();
        let mut out: Vec<(f32, f32, f32)> = v["items"]
            .as_array()
            .unwrap()
            .iter()
            .map(|it| {
                (
                    it[1].as_f64().unwrap() as f32,
                    it[2].as_f64().unwrap() as f32,
                    it[3].as_f64().unwrap() as f32,
                )
            })
            .collect();
        out.sort_by(|a, b| a.partial_cmp(b).unwrap());
        out
    }

    /// Transforms externes de référence (export final), triées pareil.
    fn export_transforms(sol: &SPSolution, instance: &SPInstance) -> Vec<(f32, f32, f32)> {
        let ext = jagua_rs::io::export::export_layout_snapshot(&sol.layout_snapshot, instance);
        let mut out: Vec<(f32, f32, f32)> = ext
            .placed_items
            .iter()
            .map(|pi| {
                (
                    pi.transformation.rotation,
                    pi.transformation.translation.0,
                    pi.transformation.translation.1,
                )
            })
            .collect();
        out.sort_by(|a, b| a.partial_cmp(b).unwrap());
        out
    }

    fn assert_frames_match(frame: &[(f32, f32, f32)], reference: &[(f32, f32, f32)]) {
        assert_eq!(frame.len(), reference.len());
        // La frame imprime rot à 0,01° et les translations à 0,001 mm :
        // tolérance = demi-ultime de l'arrondi d'impression.
        for (f, e) in frame.iter().zip(reference.iter()) {
            assert!(
                (f.0 - e.0).abs() <= 0.006 && (f.1 - e.1).abs() <= 6e-4 && (f.2 - e.2).abs() <= 6e-4,
                "frame {f:?} != export {e:?}"
            );
        }
    }

    /// Verrou (panne prod 100+800, mode local) : la frame live d'une pièce
    /// ASYMÉTRIQUE doit coïncider avec l'export final — rotation ET
    /// translation. Avant le fix, la frame portait la transform INTERNE
    /// jagua (ancrage centroïde) : décalage R(θ)·(−centroïde).
    #[test]
    fn live_frame_matches_final_export_asymmetric() {
        let instance = asym_instance();
        let mut prob = SPProblem::new(instance.clone());
        prob.change_strip_width(250.0);
        prob.place_item(SPPlacement {
            item_id: 0,
            d_transf: DTransformation::new(90.0f32.to_radians(), (60.0, 70.0)),
        });
        prob.place_item(SPPlacement {
            item_id: 0,
            d_transf: DTransformation::new(0.0, (20.0, 30.0)),
        });
        prob.place_item(SPPlacement {
            item_id: 0,
            d_transf: DTransformation::new(180.0f32.to_radians(), (150.0, 120.0)),
        });
        let sol = prob.save();

        let frame = capture_frame(&sol, &instance, None);
        let reference = export_transforms(&sol, &instance);
        assert_frames_match(&frame, &reference);
    }

    /// Phase 2 transposée : la frame live (map_back_height = corridor) doit
    /// coïncider avec la solution remappée par `map_back_solution` + export
    /// final — la formule (x,y)->(H−y,x), rotation inchangée, s'applique à
    /// la transform EXTERNE (vérifié contre le code de transposition :
    /// world = R(+90°) ∘ world' laisse θ inchangé même pour une pièce
    /// asymétrique).
    #[test]
    fn live_frame_map_back_matches_phase2_export() {
        let instance = asym_instance();
        let corridor = 150.0f32;
        let t_ext = crate::spp::transpose_instance(&asym_ext_instance(), corridor);
        let importer = Importer::new(
            sparrow::config::DEFAULT_SPARROW_CONFIG.cde_config,
            Some(0.001),
            Some(2.0),
            Some((0.01, 0.01)),
        );
        let t_instance = import_instance(&importer, &t_ext).unwrap();
        let mut t_prob = SPProblem::new(t_instance.clone());
        t_prob.change_strip_width(120.0);
        t_prob.place_item(SPPlacement {
            item_id: 0,
            d_transf: DTransformation::new(90.0f32.to_radians(), (60.0, 70.0)),
        });
        t_prob.place_item(SPPlacement {
            item_id: 0,
            d_transf: DTransformation::new(270.0f32.to_radians(), (40.0, 180.0)),
        });
        let t_sol = t_prob.save();

        let frame = capture_frame(&t_sol, &t_instance, Some(corridor));
        let mapped = crate::spp::map_back_solution(&t_instance, &t_sol, corridor, &instance);
        let reference = export_transforms(&mapped, &instance);
        assert_frames_match(&frame, &reference);
    }
}
