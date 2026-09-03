use crate::sample::search::SampleConfig;
use jagua_rs::io::svg::{SvgDrawOptions, SvgLayoutTheme};

pub const GLS_WEIGHT_MAX_INC_RATIO: f32 = 2.0;
pub const GLS_WEIGHT_MIN_INC_RATIO: f32 = 1.2;
pub const GLS_WEIGHT_DECAY: f32 = 0.95;
pub const OVERLAP_PROXY_EPSILON_DIAM_RATIO: f32 = 0.01;


/// Coordinate descent step multiplier on success
pub const CD_STEP_SUCCESS: f32 = 1.1;

/// Coordinate descent step multiplier on failure
pub const CD_STEP_FAIL: f32 = 0.5;

/// Ratio of the item's min dimension to be used as initial and limit step size for the first refinement
pub const PRE_REFINE_CD_TL_RATIOS: (f32, f32) = (0.25, 0.02);

/// Step sizes for rotation in the first refinement
pub const PRE_REFINE_CD_R_STEPS: (f32, f32) = (f32::to_radians(5.0), f32::to_radians(1.0));

/// Ratio of the item's min dimension to be used as initial and limit step size for the second (final) refinement
pub const SND_REFINE_CD_TL_RATIOS: (f32, f32) = (0.01, 0.001);

/// C6 (audit 2026-09-03) : borne ABSOLUE du pas final de descente. Le pas
/// ratio seul (0,001 × min_dim) vaut 0,1 mm pour un hôte de 100 mm : les
/// colonnes dérivent de +0,1/colonne (50,1 / 150,2 / 250,4…), y_max
/// atteint 904,76 et la 9e rangée ne tient plus — 80 hôtes au lieu de 81
/// sur une tôle 1000 (une cellule de grille perdue, visible en navigateur).
pub const SND_REFINE_ABS_LIMIT_MM: f32 = 0.01;

/// Step sizes for rotation in the second (final) refinement
pub const SND_REFINE_CD_R_STEPS: (f32, f32) = (f32::to_radians(0.5), f32::to_radians(0.05));

/// If two samples are closer than this ratio of the item's min dimension, they are considered duplicates
pub const UNIQUE_SAMPLE_THRESHOLD: f32 = 0.05;

pub const DEFAULT_EXPLORE_TIME_RATIO: f32 = 0.8;
pub const DEFAULT_COMPRESS_TIME_RATIO: f32 = 0.2;

pub const DEFAULT_MAX_CONSEQ_FAILS_EXPL: usize = 10;

pub const DEFAULT_FAIL_DECAY_RATIO_CMPR: f32 = 0.9;

pub const LOG_LEVEL_FILTER_RELEASE: log::LevelFilter = log::LevelFilter::Info;

pub const LOG_LEVEL_FILTER_DEBUG: log::LevelFilter = log::LevelFilter::Debug;

pub const DRAW_OPTIONS: SvgDrawOptions = SvgDrawOptions {
    theme: SvgLayoutTheme::GRAY,
    quadtree: false,
    surrogate: false,
    highlight_collisions: true,
    draw_cd_shapes: false,
    highlight_cd_shapes: true,
};

pub const LBF_SAMPLE_CONFIG: SampleConfig = SampleConfig {
    n_container_samples: 1000,
    n_focussed_samples: 0,
    n_coord_descents: 3,
};