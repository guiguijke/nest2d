use crate::bpp::constructive::DirBias;
use jagua_rs::collision_detection::CDEConfig;
use serde::Deserialize;
use sparrow::config::{CompressionConfig, ExplorationConfig, SparrowConfig, DEFAULT_SPARROW_CONFIG};
use std::time::Duration;

/// Engine configuration, deserialized from the `-c config.json` file.
/// All fields optional except the ones the Python worker always sets:
/// `time_budget_sec` and `prng_seed` (deterministic by contract).
#[derive(Debug, Clone, Deserialize)]
pub struct EngineConfig {
    /// Total wall-clock budget for the optimization, in seconds.
    pub time_budget_sec: u64,
    /// Master seed: every worker derives its own stream from it.
    pub prng_seed: u64,
    /// Number of distinct alternative solutions to export.
    #[serde(default = "default_n_alternatives")]
    pub n_alternatives: usize,
    /// Parallel multi-start workers. Default: max(n_alternatives, cpus/3).
    pub n_workers: Option<usize>,
    /// SPP only: hard upper bound on the strip width (sheet length).
    /// A solution wider than this is infeasible for the job.
    pub max_strip_width: Option<f32>,
    /// Share of the budget spent exploring (rest goes to compression).
    #[serde(default = "default_explore_ratio")]
    pub explore_ratio: f32,
    /// Exact minimum distance between items and hazards (kerf/gap).
    pub min_item_separation: Option<f32>,
    /// Maximum inflation allowed when simplifying polygons.
    #[serde(default = "default_poly_simpl")]
    pub poly_simpl_tolerance: Option<f32>,
    /// None/null disables narrow-concavity closing (needed for holed items
    /// opened with a hairline channel, otherwise the channel gets sealed).
    #[serde(default = "default_concavity_cutoff")]
    pub narrow_concavity_cutoff: Option<(f32, f32)>,
    /// SPP only: run the second compaction phase on the 90°-transposed
    /// problem (minimizes used height, drives parts into holes). Default true.
    pub two_phase: Option<bool>,
    /// Share of the budget given to phase 1 (width minimization).
    pub phase1_ratio: Option<f32>,
    /// Breathing room added to the phase-2 corridor (mm): the corridor is
    /// best_width + slack so the sampler can manoeuvre around tight fits.
    pub phase2_slack_mm: Option<f32>,
    /// Apply the gravity post-pass (default true). Mainly a debug/ablation
    /// knob for benchmark comparisons.
    pub gravity: Option<bool>,
    /// Emit full layout snapshots as JSON events on stdout (live_lab
    /// visualizer). Default false — heavy payload, dev/private use only.
    pub live_events: Option<bool>,
    /// BPP warm-start sequence for the annealing, as POSITIONAL item
    /// indices (into the instance's `items` array) expanded by demand —
    /// e.g. the hole-aware interleaved sequence computed by the Python
    /// worker ([host, filler×k, host, filler×k, ...]). Non-constraining:
    /// the SA can permute away from it. Silently ignored (falling back to
    /// the decreasing-diameter default) if its length does not match the
    /// total item quantity.
    #[serde(default)]
    pub initial_sequence: Option<Vec<usize>>,
    /// BPP only: directional bias classes to explore, as strings among
    /// "left" / "bottom" / "balanced". Default (null/missing): all three.
    /// Workers are assigned round-robin over the active classes and only
    /// those classes are exported as alternatives. Ignored in SPP (sparrow
    /// has no directional evaluator).
    #[serde(default)]
    pub biases: Option<Vec<String>>,
    /// BPP only: stop a walk when its incumbent has not improved for this
    /// many seconds (wall time of the walk), after a minimum of iterations.
    /// The walk then returns early — "compute until convergence" instead of
    /// burning the full budget on easy instances. Null/missing: disabled,
    /// always run to deadline.
    #[serde(default)]
    pub plateau_patience_sec: Option<f32>,
}

fn default_n_alternatives() -> usize {
    3
}
fn default_explore_ratio() -> f32 {
    0.8
}
fn default_poly_simpl() -> Option<f32> {
    Some(0.001)
}
fn default_concavity_cutoff() -> Option<(f32, f32)> {
    Some((0.01, 0.01))
}

impl EngineConfig {
    pub fn two_phase(&self) -> bool {
        self.two_phase.unwrap_or(true)
    }
    pub fn phase1_ratio(&self) -> f32 {
        self.phase1_ratio.unwrap_or(0.6).clamp(0.1, 0.9)
    }
    pub fn phase2_slack_mm(&self) -> f32 {
        self.phase2_slack_mm.unwrap_or(1.0).max(0.0)
    }
    pub fn gravity(&self) -> bool {
        self.gravity.unwrap_or(true)
    }
    pub fn live_events(&self) -> bool {
        self.live_events.unwrap_or(false)
    }
    pub fn n_workers(&self) -> usize {
        self.n_workers.unwrap_or_else(|| {
            let inner = DEFAULT_SPARROW_CONFIG.expl_cfg.separator_config.n_workers;
            (num_cpus::get() / inner.max(1))
                .max(self.n_alternatives)
                .max(1)
        })
    }

    /// Active directional bias classes (BPP), in canonical order. Unknown
    /// strings are ignored; empty/missing means all three classes.
    pub fn dir_biases(&self) -> Vec<DirBias> {
        let active: Vec<DirBias> = self
            .biases
            .as_deref()
            .unwrap_or_default()
            .iter()
            .filter_map(|s| DirBias::from_str(s))
            .collect();
        if active.is_empty() {
            DirBias::ALL.to_vec()
        } else {
            // Canonical export order regardless of the input order.
            DirBias::ALL
                .into_iter()
                .filter(|b| active.contains(b))
                .collect()
        }
    }

    /// Plateau patience as a Duration (None = run to deadline).
    pub fn plateau_patience(&self) -> Option<Duration> {
        self.plateau_patience_sec
            .filter(|p| *p > 0.0)
            .map(Duration::from_secs_f32)
    }

    /// Builds the sparrow config for one worker run.
    pub fn sparrow_config(&self) -> SparrowConfig {
        let explore = Duration::from_secs_f32(self.time_budget_sec as f32 * self.explore_ratio);
        let compress = Duration::from_secs_f32(self.time_budget_sec as f32 * (1.0 - self.explore_ratio));
        SparrowConfig {
            rng_seed: Some(self.prng_seed as usize),
            cde_config: CDEConfig {
                quadtree_depth: 5,
                ..DEFAULT_SPARROW_CONFIG.cde_config
            },
            poly_simpl_tolerance: self.poly_simpl_tolerance,
            min_item_separation: self.min_item_separation,
            narrow_concavity_cutoff_ratio: self.narrow_concavity_cutoff,
            expl_cfg: ExplorationConfig {
                time_limit: explore,
                ..DEFAULT_SPARROW_CONFIG.expl_cfg
            },
            cmpr_cfg: CompressionConfig {
                time_limit: compress,
                ..DEFAULT_SPARROW_CONFIG.cmpr_cfg
            },
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cfg(biases: Option<Vec<String>>) -> EngineConfig {
        let json = serde_json::json!({
            "time_budget_sec": 10,
            "prng_seed": 1,
            "biases": biases,
        });
        serde_json::from_value(json).unwrap()
    }

    #[test]
    fn dir_biases_defaults_to_all() {
        assert_eq!(cfg(None).dir_biases(), DirBias::ALL.to_vec());
        assert_eq!(cfg(Some(vec![])).dir_biases(), DirBias::ALL.to_vec());
    }

    #[test]
    fn dir_biases_filters_and_orders_canonically() {
        assert_eq!(
            cfg(Some(vec!["balanced".into(), "left".into()])).dir_biases(),
            vec![DirBias::LeftFirst, DirBias::Balanced]
        );
        assert_eq!(
            cfg(Some(vec!["bottom".into()])).dir_biases(),
            vec![DirBias::BottomFirst]
        );
        // Unknown strings are ignored; all-unknown falls back to all.
        assert_eq!(
            cfg(Some(vec!["nope".into()])).dir_biases(),
            DirBias::ALL.to_vec()
        );
    }

    #[test]
    fn plateau_patience_validation() {
        let c: EngineConfig = serde_json::from_value(serde_json::json!({
            "time_budget_sec": 10,
            "prng_seed": 1,
            "plateau_patience_sec": 12.5,
        }))
        .unwrap();
        assert_eq!(c.plateau_patience(), Some(Duration::from_secs_f32(12.5)));
        let c0: EngineConfig = serde_json::from_value(serde_json::json!({
            "time_budget_sec": 10,
            "prng_seed": 1,
            "plateau_patience_sec": 0.0,
        }))
        .unwrap();
        assert_eq!(c0.plateau_patience(), None);
    }
}
