//! Greedy constructive placement for BPP: places items in a given sequence
//! order using sparrow's sampling machinery (uniform search + coordinate
//! descent refinement) with a left-bottom-fill evaluator. This is the
//! evaluation function of the simulated annealing loop (sa.rs) — it replaces
//! both the lbf CLI subprocess and the Python racing tournament.

use jagua_rs::collision_detection::hazards::filter::NoFilter;
use jagua_rs::entities::{Instance, Layout};
use jagua_rs::geometry::DTransformation;
use jagua_rs::geometry::geo_traits::TransformableFrom;
use jagua_rs::geometry::primitives::{Rect, SPolygon};
use jagua_rs::probs::bpp::entities::{
    BPInstance, BPLayoutType, BPPlacement, BPProblem, BPSolution,
};
use rand::Rng;
use sparrow::eval::sample_eval::{SampleEval, SampleEvaluator};
use sparrow::sample::search::{SampleConfig, search_placement};

/// Sampling budget per item per candidate layout. The coordinate descents
/// are what pull placements tight against their neighbours (uniform sampling
/// alone leaves gaps that cost whole sheets at 100+ items). The focussed
/// samples concentrate around a "host" item (see search_layout) — that is
/// what finds the exact slots inside partially filled holes.
const SAMPLE_CFG: SampleConfig = SampleConfig {
    n_container_samples: 300,
    n_focussed_samples: 100,
    n_coord_descents: 3,
};

pub struct ConstructiveResult {
    pub solution: BPSolution,
    /// Items that fit in no bin (infeasible when > 0).
    pub unplaced: usize,
}

fn merge_rect(a: &Rect, b: &Rect) -> Rect {
    Rect {
        x_min: a.x_min.min(b.x_min),
        y_min: a.y_min.min(b.y_min),
        x_max: a.x_max.max(b.x_max),
        y_max: a.y_max.max(b.y_max),
    }
}

fn rect_area(r: &Rect) -> f32 {
    (r.x_max - r.x_min).max(0.0) * (r.y_max - r.y_min).max(0.0)
}

/// Bottom-left weight inside a placement loss (same shape as sparrow's LBF).
const BL_X: f32 = 10.0;
/// Tolérance « growth nul » (mm²) pour la décision par tôle (C1) : bruit
/// flottant des bboxes f32.
const GROWTH0_EPS: f32 = 1e-3;
/// Marginal bbox growth (mm^2) dominates the loss: a placement inside a hole
/// or pocket grows the used bbox by 0 and always beats an edge placement.
/// This is what fills cutouts instead of sprinkling parts along the edges.
const GROWTH_WEIGHT: f32 = 10.0;
/// Strength of the directional steering: the growth cost is inflated by up
/// to (1 + DIR_ALPHA) when the placement extends the used bbox to the far
/// side of the sheet in the discouraged direction. Dimensionless, so it
/// scales with any sheet size; multiplicative on growth, so in-bbox
/// placements (growth = 0, holes included) are never penalized.
/// Empirical ceiling: at 2.0 the LeftFirst constructive loses a sheet on the
/// dense 160-piece case (columns too narrow to pack efficiently); 1.5 keeps
/// every bias feasible there while still visibly steering sparse layouts.
const DIR_ALPHA: f32 = 1.5;

/// Directional bias assigned per SA worker so the exported alternatives are
/// structurally distinct layouts rather than near-identical converged copies
/// of the same corner-packed solution. Steers by inflating the growth cost
/// proportionally to how far the placement pushes the used bbox in the
/// discouraged direction — a placement inside the current bbox (holes and
/// pockets included) has zero growth and always beats any bbox-extending
/// placement, so hole filling is never traded for bias.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum DirBias {
    /// Historical behaviour: discourage x extent — packs along the left edge.
    LeftFirst,
    /// Discourage y extent — packs along the bottom edge.
    BottomFirst,
    /// Discourage both equally — compact corner blob (mix of both).
    Balanced,
}

impl DirBias {
    /// All classes, in the canonical export order (left, bottom, balanced).
    pub const ALL: [DirBias; 3] = [
        DirBias::LeftFirst,
        DirBias::BottomFirst,
        DirBias::Balanced,
    ];

    pub fn from_str(s: &str) -> Option<Self> {
        match s {
            "left" => Some(DirBias::LeftFirst),
            "bottom" => Some(DirBias::BottomFirst),
            "balanced" => Some(DirBias::Balanced),
            _ => None,
        }
    }

    pub fn as_str(&self) -> &'static str {
        match self {
            DirBias::LeftFirst => "left",
            DirBias::BottomFirst => "bottom",
            DirBias::Balanced => "balanced",
        }
    }

    /// Discouraged-extent ratio of the merged used-bbox, in [0, 1].
    fn extent_ratio(&self, merged: &Rect, bin_w: f32, bin_h: f32) -> f32 {
        let xr = if bin_w > 0.0 { merged.x_max / bin_w } else { 0.0 };
        let yr = if bin_h > 0.0 { merged.y_max / bin_h } else { 0.0 };
        match self {
            DirBias::LeftFirst => xr,
            DirBias::BottomFirst => yr,
            DirBias::Balanced => (xr + yr) * 0.5,
        }
        .clamp(0.0, 1.0)
    }

    /// C2 (audit 2026-09-03) : steer sur le Δ d'EXTENT — la version
    /// absolue (`merged.x_max / bin_w`) pénalisait la tôle pleine (x_max
    /// 900) jusqu'à 1,8× plus que la tôle fraîche (x_max 80) : sous
    /// `left`, toute petite pièce migrait vers la dernière tôle. Le steer
    /// marginal ne pénalise que la POUSSEE du front, pas son niveau.
    fn marginal_extent(&self, merged: &Rect, used: &Rect, bin_w: f32, bin_h: f32) -> f32 {
        let dx = if bin_w > 0.0 { (merged.x_max - used.x_max) / bin_w } else { 0.0 };
        let dy = if bin_h > 0.0 { (merged.y_max - used.y_max) / bin_h } else { 0.0 };
        match self {
            DirBias::LeftFirst => dx,
            DirBias::BottomFirst => dy,
            DirBias::Balanced => dx.max(dy),
        }
        .clamp(0.0, 1.0)
    }
}

/// Placement evaluator that primarily minimizes the MARGINAL GROWTH of the
/// layout's used bbox (hole/pocket filling), with bottom-left as tie-break.
/// Directly aligned with the SA's remnant objective: what does not grow the
/// bbox does not shrink the offcut.
pub struct HoleFillEvaluator<'a> {
    layout: &'a Layout,
    item: &'a jagua_rs::entities::Item,
    shape_buff: SPolygon,
    used_bbox: Rect,
    used_area: f32,
    bias: DirBias,
    bin_w: f32,
    bin_h: f32,
    n_evals: usize,
}

impl<'a> HoleFillEvaluator<'a> {
    pub fn new(layout: &'a Layout, item: &'a jagua_rs::entities::Item, bias: DirBias) -> Self {
        let used_bbox = layout
            .placed_items
            .values()
            .map(|pi| pi.shape.bbox)
            .reduce(|acc, b| merge_rect(&acc, &b))
            // Empty layout: degenerate bbox at the origin, so the first
            // placement is pushed to the bottom-left corner.
            .unwrap_or(Rect {
                x_min: 0.0,
                y_min: 0.0,
                x_max: 0.0,
                y_max: 0.0,
            });
        let used_area = rect_area(&used_bbox);
        let bin_bbox = layout.container.outer_cd.bbox;
        Self {
            layout,
            item,
            shape_buff: item.shape_cd.as_ref().clone(),
            used_bbox,
            used_area,
            bias,
            bin_w: bin_bbox.width(),
            bin_h: bin_bbox.height(),
            n_evals: 0,
        }
    }
}

impl<'a> SampleEvaluator for HoleFillEvaluator<'a> {
    fn evaluate_sample(&mut self, dt: DTransformation, _upper_bound: Option<SampleEval>) -> SampleEval {
        self.n_evals += 1;
        let cde = self.layout.cde();
        let transf = dt.into();
        if cde.detect_surrogate_collision(self.item.shape_cd.surrogate(), &transf, &NoFilter) {
            return SampleEval::Invalid;
        }
        self.shape_buff.transform_from(&self.item.shape_cd, &transf);
        if cde.detect_poly_collision(&self.shape_buff, &NoFilter) {
            return SampleEval::Invalid;
        }
        let b = self.shape_buff.bbox;
        let merged = merge_rect(&self.used_bbox, &b);
        let growth = (rect_area(&merged) - self.used_area).max(0.0);
        let corner = b.corners()[0];
        let poi = self.shape_buff.poi.center;
        let bottom_left = BL_X * (poi.0 + corner.0) + (poi.1 + corner.1);
        // C2 : steer MARGINAL — ne pénalise que la poussée du front dans
        // la direction découragée, pas le niveau déjà atteint.
        let steer = 1.0
            + DIR_ALPHA
                * self
                    .bias
                    .marginal_extent(&merged, &self.used_bbox, self.bin_w, self.bin_h);
        SampleEval::Clear {
            loss: growth * GROWTH_WEIGHT * steer + bottom_left,
        }
    }

    fn n_evals(&self) -> usize {
        self.n_evals
    }
}

/// Croissance marginale de l'AABB utilisé pour une pose donnée (mm²) —
/// sert à la décision PAR TÔLE (C1) : growth nul = pose dans un
/// trou/poche interne, elle n'étend pas le front.
fn marginal_growth(layout: &Layout, item: &jagua_rs::entities::Item, dt: &DTransformation) -> f32 {
    let used = layout
        .placed_items
        .values()
        .map(|pi| pi.shape.bbox)
        .reduce(|acc, b| merge_rect(&acc, &b))
        .unwrap_or(Rect {
            x_min: 0.0,
            y_min: 0.0,
            x_max: 0.0,
            y_max: 0.0,
        });
    let mut buff = item.shape_cd.as_ref().clone();
    let transf: jagua_rs::geometry::Transformation = (*dt).into();
    buff.transform_from(&item.shape_cd, &transf);
    (rect_area(&merge_rect(&used, &buff.bbox)) - rect_area(&used)).max(0.0)
}

/// Picks a "host" reference item in the layout for focussed sampling: the
/// largest placed item able to contain `item` (its bbox spans the item's).
/// Sampling around a holed host concentrates candidates on its cutouts,
/// which uniform container sampling misses once holes get crowded.
fn pick_host<'a>(
    layout: &'a Layout,
    item: &jagua_rs::entities::Item,
) -> Option<jagua_rs::entities::PItemKey> {
    let item_area = item.shape_cd.area;
    layout
        .placed_items
        .iter()
        .filter(|(_, pi)| pi.shape.area > item_area * 1.5)
        .max_by(|(_, a), (_, b)| a.shape.area.total_cmp(&b.shape.area))
        .map(|(pk, _)| pk)
}

/// Searches one layout for a feasible placement of `item`, returning the
/// transformation and its loss.
fn search_layout(
    layout: &Layout,
    item: &jagua_rs::entities::Item,
    bias: DirBias,
    rng: &mut impl Rng,
) -> Option<(DTransformation, f32)> {
    let evaluator = HoleFillEvaluator::new(layout, item, bias);
    let host = pick_host(layout, item);
    let (best, _) = search_placement(layout, item, host, evaluator, SAMPLE_CFG, rng);
    best.and_then(|(dt, eval)| match eval {
        SampleEval::Clear { loss } => Some((dt, loss)),
        _ => None,
    })
}

/// Places every item of `sequence` (item ids, expanded by demand) with a
/// best-fit strategy: every open layout is searched and the lowest-loss
/// placement wins; a fresh bin is opened only when no open layout admits
/// the item. First-fit opens new bins on mere sampling failures — at 100+
/// items that visibly costs sheets.
///
/// Native hole-filling comes for free: the CDE hazards are the placed
/// shapes, so sampling reaches every empty pocket (including channel-opened
/// cutouts of holed items).
pub fn construct(
    instance: &BPInstance,
    sequence: &[usize],
    n_samples: usize,
    bias: DirBias,
    rng: &mut impl Rng,
) -> ConstructiveResult {
    let _ = n_samples; // superseded by SAMPLE_CFG, kept for API compatibility
    let mut problem = BPProblem::new(instance.clone());
    let mut unplaced = 0;

    for &item_id in sequence {
        let item = instance.item(item_id);

        let open_layouts: Vec<BPLayoutType> =
            problem.layouts.keys().map(BPLayoutType::Open).collect();

        // C1 (audit 2026-09-03, cause racine de la migration des petites
        // pièces vers la dernière tôle) : le best-fit inter-tôles
        // comparait des pertes ABSOLUES (growth mm² + bottom_left en
        // coordonnées absolues) — une poche à x=800 de la tôle 1 perdait
        // contre n'importe quel point à x<80 de la tôle 2. Décision
        // lexicographique PAR TÔLE, dans l'ordre d'ouverture :
        //   (1) première tôle offrant une pose à growth == 0 (trou/poche) ;
        //   (2) sinon première tôle qui admet l'item (first-fit) ;
        // la perte (growth × steer + bottom_left) ne départage plus que
        // les poses D'UNE MÊME tôle (search_layout l'a déjà minimisée).
        let mut growth0: Option<BPPlacement> = None;
        let mut first_fit: Option<BPPlacement> = None;
        for layout_id in open_layouts {
            let BPLayoutType::Open(lkey) = layout_id else {
                unreachable!()
            };
            let layout = &problem.layouts[lkey];
            if let Some((d_transf, _loss)) = search_layout(layout, item, bias, rng) {
                let placement = BPPlacement {
                    layout_id,
                    item_id,
                    d_transf,
                };
                if first_fit.is_none() {
                    first_fit = Some(placement);
                }
                if marginal_growth(layout, item, &d_transf) <= GROWTH0_EPS {
                    growth0 = Some(placement);
                    break; // première tôle à growth nul : décision prise
                }
            }
        }
        let mut best = growth0.or(first_fit);

        // No open layout admitted the item: open a fresh bin (in id order).
        if best.is_none() {
            for (bin_id, qty) in problem.bin_stock_qtys.iter().enumerate() {
                if *qty == 0 {
                    continue;
                }
                let layout = Layout::new(problem.instance.container(bin_id).clone());
                if let Some((d_transf, _loss)) = search_layout(&layout, item, bias, rng) {
                    best = Some(BPPlacement {
                        layout_id: BPLayoutType::Closed { bin_id },
                        item_id,
                        d_transf,
                    });
                    break;
                }
            }
        }

        match best {
            Some(placement) => {
                problem.place_item(placement);
            }
            None => unplaced += 1,
        }
    }

    ConstructiveResult {
        solution: problem.save(),
        unplaced,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::bpp::sa;
    use jagua_rs::io::import::Importer;
    use jagua_rs::probs::bpp::io::ext_repr::ExtBPInstance;
    use jagua_rs::probs::bpp::io::import_instance;
    use rand::SeedableRng;
    use rand::rngs::Xoshiro256PlusPlus;
    use std::time::Duration;

    /// 10 rectangles 100x80 into 400x560 sheets: 6 fit per sheet row-block,
    /// everything must be placed on a single sheet.
    fn tiny_instance() -> BPInstance {
        let json = serde_json::json!({
            "name": "tiny",
            "items": [{
                "id": 0,
                "demand": 10,
                "allowed_orientations": [0.0, 90.0],
                "shape": {"type": "simple_polygon", "data": [[0,0],[100,0],[100,80],[0,80],[0,0]]}
            }],
            "bins": [{
                "id": 0,
                "cost": 1,
                "stock": 5,
                "shape": {"type": "polygon", "data": {"outer": [[0,0],[400,0],[400,560],[0,560],[0,0]]}}
            }]
        });
        let ext: ExtBPInstance = serde_json::from_value(json).unwrap();
        let importer = Importer::new(
            sparrow::config::DEFAULT_SPARROW_CONFIG.cde_config,
            Some(0.001),
            None,
            Some((0.01, 0.01)),
        );
        import_instance(&importer, &ext).unwrap()
    }

    #[test]
    fn constructive_places_everything() {
        let instance = tiny_instance();
        let mut rng = Xoshiro256PlusPlus::seed_from_u64(1);
        let seq = sa::initial_sequence(&instance);
        let result = construct(&instance, &seq, 200, DirBias::LeftFirst, &mut rng);
        assert_eq!(result.unplaced, 0, "all 10 rectangles must fit");
        assert_eq!(result.solution.layout_snapshots.len(), 1, "one sheet suffices");
    }

    #[test]
    fn diag_bias_bboxes() {
        let instance = tiny_instance();
        let seq = sa::initial_sequence(&instance);
        for bias in [DirBias::LeftFirst, DirBias::BottomFirst, DirBias::Balanced] {
            for seed in [11u64, 12, 13] {
                let mut rng = Xoshiro256PlusPlus::seed_from_u64(seed);
                let result = construct(&instance, &seq, 200, bias, &mut rng);
                let ls = result.solution.layout_snapshots.values().next().unwrap();
                let mut r: Option<Rect> = None;
                for pi in ls.placed_items.values() {
                    r = Some(match r {
                        None => pi.shape.bbox,
                        Some(acc) => merge_rect(&acc, &pi.shape.bbox),
                    });
                }
                let r = r.unwrap();
                eprintln!(
                    "{bias:?} seed {seed}: bbox {:.1}x{:.1} (w x h)",
                    r.x_max - r.x_min,
                    r.y_max - r.y_min
                );
            }
        }
    }

    /// The directional extent penalty steers the packing shape: 10 rectangles
    /// 100x80 in a 400x560 sheet pack strictly no wider and no flatter under
    /// LeftFirst than under BottomFirst, on every seed — and at least one
    /// seed shows the fully steered tall-columns shape. (Steering is relative,
    /// not absolute: on geometries where rows are area-optimal the growth
    /// term keeps both classes compact, LeftFirst is just relatively
    /// narrower/taller.)
    #[test]
    fn bias_steers_packing_direction() {
        let instance = tiny_instance();
        let seq = sa::initial_sequence(&instance);

        let used_bbox = |bias: DirBias, seed: u64| {
            let mut rng = Xoshiro256PlusPlus::seed_from_u64(seed);
            let result = construct(&instance, &seq, 200, bias, &mut rng);
            assert_eq!(result.unplaced, 0);
            let ls = result.solution.layout_snapshots.values().next().unwrap();
            let mut r: Option<Rect> = None;
            for pi in ls.placed_items.values() {
                r = Some(match r {
                    None => pi.shape.bbox,
                    Some(acc) => merge_rect(&acc, &pi.shape.bbox),
                });
            }
            r.unwrap()
        };

        let mut strongly_steered = false;
        for seed in [11, 12, 13] {
            let left = used_bbox(DirBias::LeftFirst, seed);
            let bottom = used_bbox(DirBias::BottomFirst, seed);
            let left_w = left.x_max - left.x_min;
            let left_h = left.y_max - left.y_min;
            let bottom_w = bottom.x_max - bottom.x_min;
            let bottom_h = bottom.y_max - bottom.y_min;
            assert!(
                left_w <= bottom_w + 1.0 && left_h >= bottom_h - 1.0,
                "LeftFirst ({left_w:.0}x{left_h:.0}) should be narrower/taller \
                 than BottomFirst ({bottom_w:.0}x{bottom_h:.0}) (seed {seed})"
            );
            strongly_steered |= left_h > left_w;
        }
        assert!(
            strongly_steered,
            "at least one seed should show the fully steered left-column shape"
        );
    }

    #[test]
    fn warm_start_used_only_when_complete() {
        let instance = tiny_instance();
        let default = sa::initial_sequence(&instance);
        // Complete warm-start: used as-is (here: reversed default).
        let mut warm = default.clone();
        warm.reverse();
        assert_eq!(sa::pick_initial_sequence(&instance, Some(warm.clone())), warm);
        // Wrong length: silent fallback to the default.
        assert_eq!(
            sa::pick_initial_sequence(&instance, Some(vec![0, 0])),
            default
        );
        assert_eq!(sa::pick_initial_sequence(&instance, None), default);
    }

    #[test]
    fn anneal_keeps_incumbent_feasible() {
        let instance = tiny_instance();
        let mut rng = Xoshiro256PlusPlus::seed_from_u64(2);
        let report = sa::anneal(
            &instance,
            200,
            Duration::from_secs(2),
            DirBias::LeftFirst,
            None,
            None,
            None,
            &mut rng,
            |_, _| {},
            |_, _, _| {},
        );
        assert_eq!(report.best_cost.unplaced, 0);
        assert_eq!(report.best_cost.bin_cost, 1);
        assert!(report.iterations > 0);
    }

    /// With a plateau patience, a converged walk stops long before its
    /// deadline: the tiny instance reaches its optimum (1 bin) almost
    /// immediately, so a 0.5s patience must cut a 30s budget short.
    #[test]
    fn plateau_stops_converged_walk_early() {
        let instance = tiny_instance();
        let mut rng = Xoshiro256PlusPlus::seed_from_u64(4);
        let started = std::time::Instant::now();
        let report = sa::anneal(
            &instance,
            200,
            Duration::from_secs(30),
            DirBias::LeftFirst,
            None,
            Some(Duration::from_millis(500)),
            None,
            &mut rng,
            |_, _| {},
            |_, _, _| {},
        );
        let elapsed = started.elapsed();
        assert_eq!(report.best_cost.unplaced, 0);
        assert_eq!(report.best_cost.bin_cost, 1);
        assert!(
            elapsed < Duration::from_secs(10),
            "plateau should stop the walk well before the 30s deadline ({elapsed:?})"
        );
    }
}

#[cfg(test)]
mod scale_tests {
    use super::*;
    use crate::bpp::sa;
    use jagua_rs::io::import::Importer;
    use jagua_rs::probs::bpp::io::ext_repr::ExtBPInstance;
    use jagua_rs::probs::bpp::io::import_instance;
    use rand::SeedableRng;
    use rand::rngs::Xoshiro256PlusPlus;
    use std::time::Duration;

    /// Sectors nested in holes: centroid within the r=35 hole of a square
    /// (hole centre = square translation, geometry is centred).
    /// Returns (nested, total_sectors).
    fn nested_sectors(solution: &BPSolution) -> (usize, usize) {
        let mut nested = 0usize;
        let mut total_sectors = 0usize;
        for ls in solution.layout_snapshots.values() {
            let mut square_centres = Vec::new();
            for pi in ls.placed_items.values() {
                if pi.item_id == 0 {
                    square_centres.push(pi.d_transf.translation());
                }
            }
            for pi in ls.placed_items.values() {
                if pi.item_id != 1 {
                    continue;
                }
                total_sectors += 1;
                let c = pi.shape.poi.center;
                if square_centres.iter().any(|&(sx, sy)| {
                    let dx = c.0 - sx;
                    let dy = c.1 - sy;
                    dx * dx + dy * dy < 35.0 * 35.0
                }) {
                    nested += 1;
                }
            }
        }
        (nested, total_sectors)
    }

    /// 30 channel-opened holed squares + 130 sectors, 400x560 sheets, 1.5mm
    /// separation — the 160-piece production case. Geometry mirrors the real
    /// fixtures (square [-50,50]^2 with r=35 hole, quarter-sector r=28).
    fn sector_points() -> Vec<(f32, f32)> {
        // quarter annulus-ish sector: arc of r=28 from (28,0) to (0,28)
        let mut pts = vec![(2.83, 2.83)];
        for i in 0..=8 {
            let a = std::f32::consts::FRAC_PI_2 * (i as f32 / 8.0);
            pts.push((28.0 * a.cos(), 28.0 * a.sin()));
        }
        pts.push((2.83, 2.83));
        pts
    }

    /// The real Piece_Trou geometry (100x100 square, r=35 hole) after the
    /// pipeline's channel conversion at space=1.5mm — generated by
    /// core/holed_polygons.py::open_holes_with_channels.
    fn channel_opened_square() -> Vec<[f32; 2]> {
        vec![[-50.000,-50.000], [-50.000,50.000], [50.000,50.000], [50.000,0.800], [34.981,0.800], [34.960,1.665], [34.842,3.327], [34.644,4.981], [34.367,6.624], [34.013,8.252], [33.582,9.861], [33.075,11.447], [32.493,13.008], [31.837,14.540], [31.109,16.038], [30.311,17.500], [29.444,18.922], [28.510,20.302], [27.512,21.636], [26.451,22.920], [25.331,24.153], [24.153,25.331], [22.920,26.451], [21.636,27.512], [20.302,28.510], [18.922,29.444], [17.500,30.311], [16.038,31.109], [14.540,31.837], [13.008,32.493], [11.447,33.075], [9.861,33.582], [8.252,34.013], [6.624,34.367], [4.981,34.644], [3.327,34.842], [1.665,34.960], [0.000,35.000], [-1.665,34.960], [-3.327,34.842], [-4.981,34.644], [-6.624,34.367], [-8.252,34.013], [-9.861,33.582], [-11.447,33.075], [-13.008,32.493], [-14.540,31.837], [-16.038,31.109], [-17.500,30.311], [-18.922,29.444], [-20.302,28.510], [-21.636,27.512], [-22.920,26.451], [-24.153,25.331], [-25.331,24.153], [-26.451,22.920], [-27.512,21.636], [-28.510,20.302], [-29.444,18.922], [-30.311,17.500], [-31.109,16.038], [-31.837,14.540], [-32.493,13.008], [-33.075,11.447], [-33.582,9.861], [-34.013,8.252], [-34.367,6.624], [-34.644,4.981], [-34.842,3.327], [-34.960,1.665], [-35.000,0.000], [-34.960,-1.665], [-34.842,-3.327], [-34.644,-4.981], [-34.367,-6.624], [-34.013,-8.252], [-33.582,-9.861], [-33.075,-11.447], [-32.493,-13.008], [-31.837,-14.540], [-31.109,-16.038], [-30.311,-17.500], [-29.444,-18.922], [-28.510,-20.302], [-27.512,-21.636], [-26.451,-22.920], [-25.331,-24.153], [-24.153,-25.331], [-22.920,-26.451], [-21.636,-27.512], [-20.302,-28.510], [-18.922,-29.444], [-17.500,-30.311], [-16.038,-31.109], [-14.540,-31.837], [-13.008,-32.493], [-11.447,-33.075], [-9.861,-33.582], [-8.252,-34.013], [-6.624,-34.367], [-4.981,-34.644], [-3.327,-34.842], [-1.665,-34.960], [-0.000,-35.000], [1.665,-34.960], [3.327,-34.842], [4.981,-34.644], [6.624,-34.367], [8.252,-34.013], [9.861,-33.582], [11.447,-33.075], [13.008,-32.493], [14.540,-31.837], [16.038,-31.109], [17.500,-30.311], [18.922,-29.444], [20.302,-28.510], [21.636,-27.512], [22.920,-26.451], [24.153,-25.331], [25.331,-24.153], [26.451,-22.920], [27.512,-21.636], [28.510,-20.302], [29.444,-18.922], [30.311,-17.500], [31.109,-16.038], [31.837,-14.540], [32.493,-13.008], [33.075,-11.447], [33.582,-9.861], [34.013,-8.252], [34.367,-6.624], [34.644,-4.981], [34.842,-3.327], [34.960,-1.665], [34.981,-0.800], [50.000,-0.800], [50.000,-50.000], [-50.000,-50.000]]
    }

    fn instance_160() -> BPInstance {
        let square: Vec<[f32; 2]> = channel_opened_square();
        let sector: Vec<[f32; 2]> = sector_points().iter().map(|p| [p.0, p.1]).collect();
        let json = serde_json::json!({
            "name": "160",
            "items": [
                {"id": 0, "demand": 30, "allowed_orientations": [0.0, 90.0, 180.0, 270.0],
                 "shape": {"type": "simple_polygon", "data": square}},
                {"id": 1, "demand": 130, "allowed_orientations": [0.0, 90.0, 180.0, 270.0],
                 "shape": {"type": "simple_polygon", "data": sector}}
            ],
            "bins": [{"id": 0, "cost": 1, "stock": 100,
                      "shape": {"type": "polygon", "data": {"outer": [[0,0],[400,0],[400,560],[0,560],[0,0]]}}}]
        });
        let ext: ExtBPInstance = serde_json::from_value(json).unwrap();
        let importer = Importer::new(
            sparrow::config::DEFAULT_SPARROW_CONFIG.cde_config,
            Some(0.001),
            Some(1.5),
            None,
        );
        import_instance(&importer, &ext).unwrap()
    }

    #[test]
    fn diag_construct_160() {
        let instance = instance_160();
        let mut rng = Xoshiro256PlusPlus::seed_from_u64(3);
        let seq = sa::initial_sequence(&instance);
        let result = construct(&instance, &seq, 300, DirBias::LeftFirst, &mut rng);
        eprintln!("unplaced: {}", result.unplaced);
        for (k, ls) in result.solution.layout_snapshots.iter() {
            let n_squares = ls.placed_items.values().filter(|pi| pi.item_id == 0).count();
            let n_sectors = ls.placed_items.values().filter(|pi| pi.item_id == 1).count();
            eprintln!("layout {:?}: {} squares, {} sectors, density {:.3}",
                k, n_squares, n_sectors, ls.density(&instance));
        }
        eprintln!("total bins: {}", result.solution.layout_snapshots.len());
        assert_eq!(result.unplaced, 0);

        // The 160-piece production target: 2 sheets (area bound), with the
        // sectors filling the squares' holes (4 slots each).
        assert_eq!(
            result.solution.layout_snapshots.len(),
            2,
            "expected 2 sheets for the 160-piece case"
        );

        // Count sectors nested in holes (4 slots per square).
        let (nested, total_sectors) = nested_sectors(&result.solution);
        eprintln!("sectors nested in holes: {nested}/{total_sectors}");
        assert!(
            nested * 2 >= total_sectors,
            "holes underfilled: {nested}/{total_sectors} sectors nested"
        );
    }

    /// The three directional biases must all stay feasible on the 160-piece
    /// case (hole filling is never traded for bias) and produce genuinely
    /// different layouts — this is what makes the exported alternatives
    /// structurally distinct.
    #[test]
    fn biases_all_feasible_and_distinct_160() {
        let instance = instance_160();
        let seq = sa::initial_sequence(&instance);

        let mut layouts_sig = Vec::new();
        for bias in [DirBias::LeftFirst, DirBias::BottomFirst, DirBias::Balanced] {
            let mut rng = Xoshiro256PlusPlus::seed_from_u64(7);
            let result = construct(&instance, &seq, 300, bias, &mut rng);
            assert_eq!(result.unplaced, 0, "{bias:?} must place all 160 items");
            assert_eq!(
                result.solution.layout_snapshots.len(),
                2,
                "{bias:?} must stay on 2 sheets"
            );
            // Signature: sorted (item, rounded x, rounded y) of every placement.
            let mut sig: Vec<(usize, i64, i64)> = result
                .solution
                .layout_snapshots
                .values()
                .flat_map(|ls| {
                    ls.placed_items.values().map(|pi| {
                        let t = pi.d_transf.translation();
                        (
                            pi.item_id,
                            (t.0 * 10.0).round() as i64,
                            (t.1 * 10.0).round() as i64,
                        )
                    })
                })
                .collect();
            sig.sort_unstable();
            layouts_sig.push((bias, sig));
            for (k, ls) in result.solution.layout_snapshots.iter() {
                let mut r: Option<Rect> = None;
                for pi in ls.placed_items.values() {
                    r = Some(match r {
                        None => pi.shape.bbox,
                        Some(acc) => merge_rect(&acc, &pi.shape.bbox),
                    });
                }
                let r = r.unwrap();
                eprintln!(
                    "{bias:?} layout {:?}: used {:.0}x{:.0}",
                    k,
                    r.x_max - r.x_min,
                    r.y_max - r.y_min
                );
            }
        }

        for (i, (ba, sig_a)) in layouts_sig.iter().enumerate() {
            for (bb, sig_b) in layouts_sig.iter().skip(i + 1) {
                assert_ne!(sig_a, sig_b, "{ba:?} and {bb:?} produced identical layouts");
            }
        }
    }

    /// A/B measurement for the hole-aware warm-start (see
    /// doc/plan-warmstart-agregats-directions.md, keep criterion: >= +10%
    /// nested sectors or better lexicographic cost at equal nesting).
    /// Same seed, same bias, same wall-clock budget — with and without the
    /// interleaved sequence Python builds ([host, filler x4] x 30 + tail).
    /// Sweeps bias x budget because the effect may depend on how much time
    /// the SA has to move away from the initial sequence.
    ///
    /// VERDICT (2026-08, seed 21): NEGATIVE on every configuration — the
    /// interleaved warm-start loses a sheet (3 vs 2) and fills fewer holes
    /// (78-82 vs 91-93 nested). Fillers placed right after their host that
    /// miss the hole land against it and break the hosts' tight packing;
    /// the default hosts-first order protects that packing. Kept as an
    /// on-demand harness (run: `cargo test --release warm_start_160_ab --
    /// --ignored --nocapture`) in case a future warm-start variant
    /// (e.g. hole-reliable fillers only) wants the same measurement.
    #[test]
    #[ignore = "A/B measurement harness, ~100s; negative verdict documented above"]
    fn warm_start_160_ab() {
        let instance = instance_160();
        // Mirrors core.nesting_input_builder.build_initial_sequence output
        // for this instance: every host followed by its 4 hole fillers.
        let mut warm = Vec::with_capacity(160);
        for _ in 0..30 {
            warm.push(0);
            warm.extend([1, 1, 1, 1]);
        }
        warm.extend([1; 10]);
        assert_eq!(warm.len(), instance.total_item_qty());

        for bias in [DirBias::LeftFirst, DirBias::Balanced] {
            for budget_s in [6u64, 20] {
                let run = |initial: Option<Vec<usize>>, seed: u64| {
                    let mut rng = Xoshiro256PlusPlus::seed_from_u64(seed);
                    sa::anneal(
                        &instance,
                        300,
                        Duration::from_secs(budget_s),
                        bias,
                        initial,
                        None,
                        None,
                        &mut rng,
                        |_, _| {},
                        |_, _, _| {},
                    )
                };
                let baseline = run(None, 21);
                let warmed = run(Some(warm.clone()), 21);
                let (nested_base, total) = nested_sectors(&baseline.best_solution);
                let (nested_warm, _) = nested_sectors(&warmed.best_solution);
                eprintln!(
                    "A/B 160 {bias:?} {budget_s}s: baseline bins={} nested={}/{} remnant={:.3} \
                     | warmstart bins={} nested={}/{} remnant={:.3}",
                    baseline.best_cost.bin_cost, nested_base, total, baseline.best_cost.remnant,
                    warmed.best_cost.bin_cost, nested_warm, total, warmed.best_cost.remnant,
                );
                assert_eq!(baseline.best_cost.unplaced, 0, "baseline infeasible ({bias:?} {budget_s}s)");
                assert_eq!(warmed.best_cost.unplaced, 0, "warm-start infeasible ({bias:?} {budget_s}s)");
            }
        }
    }

    /// Instance « cas user » miniature : 81 carrés 100×100 + petits
    /// rectangles 40×28 (fans), 2 tôles 1000×1000.
    fn bands_instance(n_fans: usize) -> BPInstance {
        let json = serde_json::json!({
            "name": "bands",
            "items": [
                {"id": 0, "demand": 81,
                 "allowed_orientations": [0.0, 90.0],
                 "shape": {"type": "simple_polygon", "data": [[0,0],[100,0],[100,100],[0,100],[0,0]]}},
                {"id": 1, "demand": n_fans,
                 "allowed_orientations": [0.0, 90.0, 180.0, 270.0],
                 "shape": {"type": "simple_polygon", "data": [[0,0],[40,0],[40,28],[0,28],[0,0]]}}
            ],
            "bins": [{
                "id": 0, "cost": 1, "stock": 2,
                "shape": {"type": "polygon", "data": {"outer": [[0,0],[1000,0],[1000,1000],[0,1000],[0,0]]}}
            }]
        });
        let ext: ExtBPInstance = serde_json::from_value(json).unwrap();
        let importer = Importer::new(
            sparrow::config::DEFAULT_SPARROW_CONFIG.cde_config,
            Some(0.001),
            None,
            Some((0.01, 0.01)),
        );
        import_instance(&importer, &ext).unwrap()
    }

    /// T2 (plan 2026-09-03 §2.1, C1) : le best-fit inter-tôles sur pertes
    /// ABSOLUES faisait migrer les petites pièces vers la dernière tôle
    /// (rejeu payload user : tôle 1 = 81 hôtes + 8 fans SEULEMENT). La
    /// décision par tôle (growth==0 puis first-fit) doit remplir les
    /// bandes de la tôle 1 AVANT d'étendre la tôle 2.
    #[test]
    fn constructive_fills_first_sheet_bands_before_growing_second() {
        let instance = bands_instance(400);
        let mut rng = Xoshiro256PlusPlus::seed_from_u64(7);
        let seq = sa::initial_sequence(&instance);
        let result = construct(&instance, &seq, 200, DirBias::LeftFirst, &mut rng);
        assert_eq!(result.unplaced, 0);
        assert_eq!(result.solution.layout_snapshots.len(), 2);
        // Tôle 1 (premier layout ouvert) : 81 carrés + ≥ 150 fans.
        let first = result
            .solution
            .layout_snapshots
            .iter()
            .min_by_key(|(k, _ls)| *k)
            .unwrap()
            .1;
        let squares = first
            .placed_items
            .values()
            .filter(|pi| pi.item_id == 0)
            .count();
        let fans = first
            .placed_items
            .values()
            .filter(|pi| pi.item_id == 1)
            .count();
        // 150 au banc réel (audit_bpp_replay) ; le synthétique sans trous
        // a un peu moins de bande : ≥ 100 prouve C1 (l'ancien best-fit
        // inter-tôles n'en mettait que ~8).
        eprintln!("T2: tôle 1 = {squares} carrés + {fans} fans");
        assert!(squares >= 75, "la quasi-totalité des carrés sur la tôle 1 — eu {squares}");
        assert!(
            fans >= 100,
            "C1 : la tôle 1 doit recevoir ses fans de bande (≥ 100) — eu {fans}"
        );
    }

    /// T3 : le steer est MARGINAL (C2) — deux poussées d'extent identiques
    /// donnent le même ratio quel que soit le niveau ABSOLU du front
    /// (l'ancien ratio absolu pénalisait 1,8× la tôle pleine sous `left`).
    #[test]
    fn dir_bias_steer_is_per_sheet() {
        let used_full = Rect { x_min: 0.0, y_min: 0.0, x_max: 900.0, y_max: 900.0 };
        let used_fresh = Rect { x_min: 0.0, y_min: 0.0, x_max: 80.0, y_max: 80.0 };
        let push_x = Rect { x_min: 0.0, y_min: 0.0, x_max: 910.0, y_max: 900.0 };
        let push_fresh = Rect { x_min: 0.0, y_min: 0.0, x_max: 90.0, y_max: 80.0 };
        // Même poussée (+10 mm / 1000) : même steer, niveaux différents.
        let a = DirBias::LeftFirst.marginal_extent(&push_x, &used_full, 1000.0, 1000.0);
        let b = DirBias::LeftFirst.marginal_extent(&push_fresh, &used_fresh, 1000.0, 1000.0);
        assert!((a - b).abs() < 1e-6, "steer marginal : {a} vs {b}");
        // Aucune poussée en x (LeftFirst) → steer nul, même si y pousse.
        let y_push = Rect { x_min: 0.0, y_min: 0.0, x_max: 900.0, y_max: 950.0 };
        assert_eq!(
            DirBias::LeftFirst.marginal_extent(&y_push, &used_full, 1000.0, 1000.0),
            0.0
        );
    }
}
