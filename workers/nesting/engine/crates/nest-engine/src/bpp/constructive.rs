//! Greedy constructive placement for BPP: places items in a given sequence
//! order using sparrow's sampling machinery (uniform search + coordinate
//! descent refinement) with a left-bottom-fill evaluator. This is the
//! evaluation function of the simulated annealing loop (sa.rs) — it replaces
//! both the lbf CLI subprocess and the Python racing tournament.

use jagua_rs::entities::{Instance, Layout};
use jagua_rs::geometry::DTransformation;
use jagua_rs::probs::bpp::entities::{
    BPInstance, BPLayoutType, BPPlacement, BPProblem, BPSolution,
};
use rand::Rng;
use sparrow::eval::lbf_evaluator::LBFEvaluator;
use sparrow::eval::sample_eval::SampleEval;
use sparrow::sample::search::{SampleConfig, search_placement};

/// Sampling budget per item per candidate layout. The coordinate descents
/// are what pull placements tight against their neighbours (uniform sampling
/// alone leaves gaps that cost whole sheets at 100+ items).
const SAMPLE_CFG: SampleConfig = SampleConfig {
    n_container_samples: 300,
    n_focussed_samples: 0,
    n_coord_descents: 2,
};

pub struct ConstructiveResult {
    pub solution: BPSolution,
    /// Items that fit in no bin (infeasible when > 0).
    pub unplaced: usize,
}

/// Searches one layout for a feasible placement of `item`, returning the
/// transformation and its bottom-left loss.
fn search_layout(
    layout: &Layout,
    item: &jagua_rs::entities::Item,
    rng: &mut impl Rng,
) -> Option<(DTransformation, f32)> {
    let evaluator = LBFEvaluator::new(layout, item);
    let (best, _) = search_placement(layout, item, None, evaluator, SAMPLE_CFG, rng);
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
            if let Some((d_transf, loss)) = search_layout(layout, item, rng) {
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
                if let Some((d_transf, loss)) = search_layout(&layout, item, rng) {
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

    fn instance_160() -> BPInstance {
        let square: Vec<[f32; 2]> = vec![[-50.0,-50.0],[50.0,-50.0],[50.0,50.0],[-50.0,50.0],[-50.0,-50.0]];
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
        let result = construct(&instance, &seq, 300, &mut rng);
        eprintln!("unplaced: {}", result.unplaced);
        for (k, ls) in result.solution.layout_snapshots.iter() {
            let n_squares = ls.placed_items.values().filter(|pi| pi.item_id == 0).count();
            let n_sectors = ls.placed_items.values().filter(|pi| pi.item_id == 1).count();
            eprintln!("layout {:?}: {} squares, {} sectors, density {:.3}",
                k, n_squares, n_sectors, ls.density(&instance));
        }
        eprintln!("total bins: {}", result.solution.layout_snapshots.len());
        assert_eq!(result.unplaced, 0);
        // Anti-regression guard for the 160-piece production case: the
        // constructive must pack the main sheets tight (~15 squares + ~60
        // sectors each = >75% density). A loose constructive (first-fit or
        // plain uniform sampling) lands at ~59% and costs a whole sheet.
        let mut densities: Vec<f32> = result
            .solution
            .layout_snapshots
            .values()
            .map(|ls| ls.density(&instance))
            .collect();
        densities.sort_by(|a, b| b.total_cmp(a));
        assert!(
            densities[0] > 0.75,
            "main sheet density regressed: {:.3}",
            densities[0]
        );
    }
}
