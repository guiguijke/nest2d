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
    /// Deterministic per-worker assignment: covers all three classes as soon
    /// as n_workers >= 3 (always the case: n_workers >= n_alternatives).
    pub fn from_worker(w: usize) -> Self {
        match w % 3 {
            0 => DirBias::LeftFirst,
            1 => DirBias::BottomFirst,
            _ => DirBias::Balanced,
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
        let steer = 1.0 + DIR_ALPHA * self.bias.extent_ratio(&merged, self.bin_w, self.bin_h);
        SampleEval::Clear {
            loss: growth * GROWTH_WEIGHT * steer + bottom_left,
        }
    }

    fn n_evals(&self) -> usize {
        self.n_evals
    }
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

        // Search ALL open layouts, keep the placement with the lowest loss
        // (most bottom-left). No layout is skipped on a sampling miss, so a
        // new bin only opens when the item truly fits nowhere.
        let mut best: Option<(f32, BPPlacement)> = None;
        for layout_id in open_layouts {
            let BPLayoutType::Open(lkey) = layout_id else {
                unreachable!()
            };
            let layout = &problem.layouts[lkey];
            if let Some((d_transf, loss)) = search_layout(layout, item, bias, rng) {
                if best.as_ref().is_none_or(|(best_loss, _)| loss < *best_loss) {
                    best = Some((loss, BPPlacement {
                        layout_id,
                        item_id,
                        d_transf,
                    }));
                }
            }
        }

        // No open layout admitted the item: open a fresh bin (in id order).
        if best.is_none() {
            for (bin_id, qty) in problem.bin_stock_qtys.iter().enumerate() {
                if *qty == 0 {
                    continue;
                }
                let layout = Layout::new(problem.instance.container(bin_id).clone());
                if let Some((d_transf, loss)) = search_layout(&layout, item, bias, rng) {
                    best = Some((loss, BPPlacement {
                        layout_id: BPLayoutType::Closed { bin_id },
                        item_id,
                        d_transf,
                    }));
                    break;
                }
            }
        }

        match best {
            Some((_, placement)) => {
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
    fn anneal_keeps_incumbent_feasible() {
        let instance = tiny_instance();
        let mut rng = Xoshiro256PlusPlus::seed_from_u64(2);
        let report = sa::anneal(
            &instance,
            200,
            Duration::from_secs(2),
            DirBias::LeftFirst,
            &mut rng,
            |_, _| {},
            |_, _| {},
        );
        assert_eq!(report.best_cost.unplaced, 0);
        assert_eq!(report.best_cost.bin_cost, 1);
        assert!(report.iterations > 0);
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

        // Count sectors nested in holes: centroid within the r=35 hole of a
        // square (hole centre = square translation, geometry is centred).
        let mut nested = 0usize;
        let mut total_sectors = 0usize;
        for ls in result.solution.layout_snapshots.values() {
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
}

