use jagua_rs::probs::spp::entities::{SPInstance, SPSolution};
use sparrow::util::listener::{ReportType, SolutionListener};
use std::io::Write;
use std::time::Instant;

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
        Self {
            worker,
            started,
            last_emit: Instant::now() - std::time::Duration::from_secs(2),
            last_stage: "",
            live: false,
            last_layout_emit: Instant::now() - std::time::Duration::from_secs(2),
            map_back_height: None,
        }
    }

    pub fn with_live(mut self, live: bool) -> Self {
        self.live = live;
        self
    }

    pub fn with_map_back(mut self, height: Option<f32>) -> Self {
        self.map_back_height = height;
        self
    }

    fn emit(&mut self, stage: &'static str, feasible: bool, strip_width: f32) {
        println!(
            "{{\"type\":\"progress\",\"worker\":{},\"stage\":\"{}\",\"feasible\":{},\"strip_width\":{:.3},\"elapsed_sec\":{}}}",
            self.worker,
            stage,
            feasible,
            strip_width,
            self.started.elapsed().as_secs()
        );
        let _ = std::io::stdout().flush();
    }

    /// Full layout snapshot for the visualizer: every placed item with its
    /// rotation (degrees) and translation. Coordinates are in the solver
    /// frame (jagua composes its centering pre-transform into them).
    fn emit_layout(&mut self, stage: &'static str, feasible: bool, solution: &SPSolution, instance: &SPInstance) {
        let mut items = String::with_capacity(solution.layout_snapshot.placed_items.len() * 24);
        items.push('[');
        for (i, pi) in solution.layout_snapshot.placed_items.values().enumerate() {
            if i > 0 {
                items.push(',');
            }
            let dt = pi.d_transf;
            let t = dt.translation();
            let (tx, ty) = match self.map_back_height {
                // Transposed frame -> original: (x, y) -> (H - y, x),
                // rotation unchanged (2D rotations commute).
                Some(h) => (h - t.1, t.0),
                None => t,
            };
            items.push_str(&format!(
                "[{},{:.2},{:.3},{:.3}]",
                pi.item_id,
                dt.rotation().to_degrees(),
                tx,
                ty
            ));
        }
        items.push(']');
        let strip_width = solution.strip_width();
        let density = solution.density(instance);
        println!(
            "{{\"type\":\"layout\",\"worker\":{},\"stage\":\"{}\",\"feasible\":{},\"strip_width\":{:.3},\"density\":{:.4},\"elapsed_ms\":{},\"items\":{}}}",
            self.worker,
            stage,
            feasible,
            strip_width,
            density,
            self.started.elapsed().as_millis(),
            items
        );
        let _ = std::io::stdout().flush();
    }
}

impl SolutionListener for ProgressListener {
    fn report(&mut self, report: ReportType, solution: &SPSolution, instance: &SPInstance) {
        let stage = stage_of(&report);
        let feasible = matches!(report, ReportType::ExplFeas | ReportType::CmprFeas | ReportType::Final);

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
