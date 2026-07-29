//! Greedy constructive placement for BPP: places items in a given sequence
//! order using sampling-based bottom-left-fill search. This is the evaluation
//! function of the simulated annealing loop (sa.rs) — it replaces both the
//! lbf CLI subprocess and the Python racing tournament.

use jagua_rs::collision_detection::CDEngine;
use jagua_rs::collision_detection::hazards::filter::NoFilter;
use jagua_rs::entities::Instance;
use jagua_rs::geometry::geo_enums::RotationRange;
use jagua_rs::geometry::geo_traits::TransformableFrom;
use jagua_rs::geometry::{DTransformation, Transformation};
use jagua_rs::probs::bpp::entities::{
    BPInstance, BPLayoutType, BPPlacement, BPProblem, BPSolution,
};
use rand::{Rng, RngExt};

/// Weight of the horizontal extent in the placement loss: packing left matters
/// more than packing low (same idea as the classic LBF loss).
const X_MULTIPLIER: f32 = 10.0;

pub struct ConstructiveResult {
    pub solution: BPSolution,
    /// Items that fit in no bin (infeasible when > 0).
    pub unplaced: usize,
}

/// Samples a rotation allowed for the item.
fn sample_rotation(item: &jagua_rs::entities::Item, rng: &mut impl Rng) -> f32 {
    match &item.allowed_rotation {
        RotationRange::None => 0.0,
        RotationRange::Continuous => rng.random_range(0.0..std::f32::consts::TAU),
        RotationRange::Discrete(angles) => {
            angles[rng.random_range(0..angles.len())]
        }
    }
}

/// Loss of a candidate placement: weighted (x_max, y_max) of the placed bbox.
fn placement_loss(x_max: f32, y_max: f32) -> f32 {
    x_max * X_MULTIPLIER + y_max
}

/// Searches one container (via its CDE) for a feasible, low-loss placement of
/// `item`. Uniform sampling over the container bbox, surrogate pre-filter,
/// exact polygon validation. Returns the best transformation found.
pub fn search_placement(
    cde: &CDEngine,
    item: &jagua_rs::entities::Item,
    n_samples: usize,
    rng: &mut impl Rng,
) -> Option<DTransformation> {
    let surrogate = item.shape_cd.surrogate();
    // Working copy without surrogate: cheaper to transform repeatedly.
    let mut buffer = {
        let mut buffer = (*item.shape_cd).clone();
        buffer.surrogate = None;
        buffer
    };

    let container_bbox = cde.bbox();
    let mut best: Option<(DTransformation, f32)> = None;
    // Once a placement exists, candidates that cannot beat its loss are
    // skipped before the expensive exact check.
    let mut x_bound = container_bbox.x_max;

    for _ in 0..n_samples {
        let rotation = sample_rotation(item, rng);

        // Rotate around the origin to learn the rotated bbox, then sample a
        // translation that keeps the bbox inside the container.
        let rot_transf = Transformation::from_rotation(rotation);
        buffer.transform_from(&item.shape_cd, &rot_transf);
        let rb = buffer.bbox;

        let x_span = container_bbox.x_max - container_bbox.x_min - (rb.x_max - rb.x_min);
        let y_span = container_bbox.y_max - container_bbox.y_min - (rb.y_max - rb.y_min);
        if x_span < 0.0 || y_span < 0.0 {
            continue; // item does not fit in this orientation
        }
        let tx = container_bbox.x_min - rb.x_min + rng.random_range(0.0..x_span.max(0.0));
        let ty = container_bbox.y_min - rb.y_min + rng.random_range(0.0..y_span.max(0.0));

        let d_transf = DTransformation::new(rotation, (tx, ty));
        let transf = d_transf.compose();

        if cde.detect_surrogate_collision(surrogate, &transf, &NoFilter) {
            continue;
        }
        buffer.transform_from(&item.shape_cd, &transf);
        let loss = placement_loss(buffer.bbox.x_max, buffer.bbox.y_max);

        let worth_testing = match &best {
            Some((_, best_loss)) => loss < *best_loss,
            None => buffer.bbox.x_max <= x_bound,
        };
        if !worth_testing {
            continue;
        }
        if !cde.detect_poly_collision(&buffer, &NoFilter) {
            best = Some((d_transf, loss));
            // Tighten: nothing right of (best_loss - y) / X_MULTIPLIER can win.
            x_bound = loss / X_MULTIPLIER;
        }
    }
    best.map(|(dt, _)| dt)
}

/// Places every item of `sequence` (item ids, expanded by demand) with a
/// first-fit strategy: open layouts in creation order, then fresh bins with
/// remaining stock. Native hole-filling comes for free: the CDE hazards are
/// the placed shapes, so sampling reaches every empty pocket (including
/// channel-opened cutouts of holed items).
pub fn construct(
    instance: &BPInstance,
    sequence: &[usize],
    n_samples: usize,
    rng: &mut impl Rng,
) -> ConstructiveResult {
    let mut problem = BPProblem::new(instance.clone());
    let mut unplaced = 0;

    'item: for &item_id in sequence {
        let item = instance.item(item_id);

        let open_layouts: Vec<BPLayoutType> =
            problem.layouts.keys().map(BPLayoutType::Open).collect();
        let bins_with_stock: Vec<BPLayoutType> = problem
            .bin_stock_qtys
            .iter()
            .enumerate()
            .filter(|(_, qty)| **qty > 0)
            .map(|(bin_id, _)| BPLayoutType::Closed { bin_id })
            .collect();

        for layout_id in open_layouts.into_iter().chain(bins_with_stock) {
            let cde = match layout_id {
                BPLayoutType::Open(lkey) => problem.layouts[lkey].cde(),
                BPLayoutType::Closed { bin_id } => {
                    problem.instance.container(bin_id).base_cde.as_ref()
                }
            };
            if let Some(d_transf) = search_placement(cde, item, n_samples, rng) {
                problem.place_item(BPPlacement {
                    layout_id,
                    item_id,
                    d_transf,
                });
                continue 'item;
            }
        }
        unplaced += 1;
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
        let result = construct(&instance, &seq, 200, &mut rng);
        assert_eq!(result.unplaced, 0, "all 10 rectangles must fit");
        assert_eq!(result.solution.layout_snapshots.len(), 1, "one sheet suffices");
    }

    #[test]
    fn anneal_keeps_incumbent_feasible() {
        let instance = tiny_instance();
        let mut rng = Xoshiro256PlusPlus::seed_from_u64(2);
        let report = sa::anneal(
            &instance,
            200,
            Duration::from_secs(2),
            &mut rng,
            |_| {},
            |_, _| {},
        );
        assert_eq!(report.best_cost.unplaced, 0);
        assert_eq!(report.best_cost.bin_cost, 1);
        assert!(report.iterations > 0);
    }
}
