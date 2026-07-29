use jagua_rs::probs::spp::entities::{SPInstance, SPSolution};
use sparrow::util::listener::{ReportType, SolutionListener};
use std::time::Instant;

/// SolutionListener emitting throttled JSON progress lines on stdout.
/// The Python worker parses these to update the job's live progress in Mongo;
/// stdout must carry NOTHING else (logs go to stderr, no logger installed).
pub struct ProgressListener {
    worker: usize,
    started: Instant,
    last_emit: Instant,
    last_stage: &'static str,
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
        }
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
        use std::io::Write;
        let _ = std::io::stdout().flush();
    }
}

impl SolutionListener for ProgressListener {
    fn report(&mut self, report: ReportType, solution: &SPSolution, _instance: &SPInstance) {
        let stage = stage_of(&report);
        let feasible = matches!(report, ReportType::ExplFeas | ReportType::CmprFeas | ReportType::Final);
        // Throttle to 1 Hz per worker: report types flip-flop between rounds
        // of a phase, so stage changes alone are not a reliable trigger.
        // The Final report always passes.
        if report == ReportType::Final || self.last_emit.elapsed().as_secs() >= 1 {
            self.last_emit = Instant::now();
            self.last_stage = stage;
            self.emit(stage, feasible, solution.strip_width());
        }
    }
}
