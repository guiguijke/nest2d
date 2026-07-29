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
    pub fn n_workers(&self) -> usize {
        self.n_workers.unwrap_or_else(|| {
            let inner = DEFAULT_SPARROW_CONFIG.expl_cfg.separator_config.n_workers;
            (num_cpus::get() / inner.max(1))
                .max(self.n_alternatives)
                .max(1)
        })
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
