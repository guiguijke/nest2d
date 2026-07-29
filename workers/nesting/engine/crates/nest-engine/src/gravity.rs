//! Deterministic "gravity" post-pass for SPP solutions.
//!
//! The separation/compaction loop minimizes the strip WIDTH only — the
//! vertical axis is not part of the objective, so under-constrained layouts
//! (few items in a large strip) can come out vertically scattered, which
//! reads as "broken" to users even though the offcut is optimal.
//!
//! This pass pulls every item down as far as collision-free, then left,
//! using exact collision detection against the layout CDE. It can never
//! create an overlap (every accepted position is validated) and can never
//! increase the used width — it frequently shrinks it further, so the strip
//! width is tightened to the actual used extent at the end.

use jagua_rs::collision_detection::hazards::filter::NoFilter;
use jagua_rs::entities::{Instance, PItemKey};
use jagua_rs::geometry::geo_traits::TransformableFrom;
use jagua_rs::geometry::{DTransformation, Transformation};
use jagua_rs::probs::spp::entities::{SPPlacement, SPProblem};

/// Bisection steps per axis per item: 16 steps pin the contact position to
/// ~1/65536 of the travel — visually exact, cheap.
const BISECTION_STEPS: usize = 16;

/// Pulls every item down (then left) as far as collision-free, and tightens
/// the strip width to the used extent. Deterministic: items are processed in
/// a fixed geometric order and every probe is exact.
pub fn gravity_compact(prob: &mut SPProblem) {
    pull_axis(prob, Axis::Down);
    pull_axis(prob, Axis::Left);

    // Tighten the strip to the actual used width (gravity can only have
    // shrunk it). fit_strip also rebuilds the container CDE and accounts
    // for the min_item_separation offset — keeps the density/offcut honest.
    prob.fit_strip();
}

enum Axis {
    Down,
    Left,
}

fn pull_axis(prob: &mut SPProblem, axis: Axis) {
    // Fixed processing order: bottom-most (resp. left-most) items first, so
    // items above/beside them can settle onto them. Ties broken by item id
    // for full determinism.
    let mut order: Vec<(PItemKey, f32, usize)> = prob
        .layout
        .placed_items
        .iter()
        .map(|(pk, pi)| {
            let coord = match axis {
                Axis::Down => pi.shape.bbox.y_min,
                Axis::Left => pi.shape.bbox.x_min,
            };
            (pk, coord, pi.item_id)
        })
        .collect();
    order.sort_by(|(_, c_a, id_a), (_, c_b, id_b)| {
        c_a.total_cmp(c_b).then(id_a.cmp(id_b))
    });

    for (pk, _, _) in order {
        let old_placement = match prob.layout.placed_items.get(pk) {
            Some(pi) => SPPlacement {
                item_id: pi.item_id,
                d_transf: pi.d_transf,
            },
            None => continue,
        };
        let item_id = old_placement.item_id;
        let item = prob.instance.item(item_id).clone();
        let start_dt = old_placement.d_transf;

        // Remove first: the item must not collide with itself during probes.
        prob.remove_item(pk);

        let mut buffer = {
            let mut buffer = (*item.shape_cd).clone();
            buffer.surrogate = None; // faster transforms; exact check uses the polygon
            buffer
        };

        let is_valid = |prob: &SPProblem,
                        buffer: &mut jagua_rs::geometry::primitives::SPolygon,
                        dt: DTransformation| {
            let transf: Transformation = dt.compose();
            buffer.transform_from(&item.shape_cd, &transf);
            !prob.layout.cde().detect_poly_collision(buffer, &NoFilter)
        };

        let (start_comp, other_comp) = match axis {
            Axis::Down => (start_dt.translation().1, start_dt.translation().0),
            Axis::Left => (start_dt.translation().0, start_dt.translation().1),
        };

        // Bisect along the axis toward 0. Only VALID midpoints are ever
        // accepted, so the result is collision-free even when feasibility
        // along the axis is not monotonic (we just stop early).
        let mut lo = 0.0f32;
        let mut hi = start_comp; // known valid
        let mut best = start_comp;
        for _ in 0..BISECTION_STEPS {
            let mid = (lo + hi) / 2.0;
            let dt = match axis {
                Axis::Down => DTransformation::new(start_dt.rotation(), (other_comp, mid)),
                Axis::Left => DTransformation::new(start_dt.rotation(), (mid, other_comp)),
            };
            if is_valid(prob, &mut buffer, dt) {
                best = mid;
                hi = mid;
            } else {
                lo = mid;
            }
        }

        let new_dt = match axis {
            Axis::Down => DTransformation::new(start_dt.rotation(), (other_comp, best)),
            Axis::Left => DTransformation::new(start_dt.rotation(), (best, other_comp)),
        };
        prob.place_item(SPPlacement {
            item_id,
            d_transf: new_dt,
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use jagua_rs::io::import::Importer;
    use jagua_rs::probs::spp::io::ext_repr::ExtSPInstance;
    use jagua_rs::probs::spp::io::import_instance;

    fn strip_instance() -> jagua_rs::probs::spp::entities::SPInstance {
        let json = serde_json::json!({
            "name": "gravity-test",
            "strip_height": 560.0,
            "items": [{
                "id": 0,
                "demand": 2,
                "allowed_orientations": [0.0],
                "shape": {"type": "simple_polygon", "data": [[0,0],[100,0],[100,100],[0,100],[0,0]]}
            }]
        });
        let ext: ExtSPInstance = serde_json::from_value(json).unwrap();
        let importer = Importer::new(
            sparrow::config::DEFAULT_SPARROW_CONFIG.cde_config,
            Some(0.001),
            None,
            Some((0.01, 0.01)),
        );
        import_instance(&importer, &ext).unwrap()
    }

    #[test]
    fn gravity_pulls_items_to_origin_without_overlap() {
        let instance = strip_instance();
        let mut prob = SPProblem::new(instance);
        // The base strip starts at area/height: widen it first so the
        // scattered placements below are feasible.
        prob.change_strip_width(600.0);
        // Two squares scattered high and right.
        // Strictly inside: exact contact with an edge counts as a collision
        // in jagua, so the gravity pass stops a tiny epsilon away from edges.
        prob.place_item(SPPlacement {
            item_id: 0,
            d_transf: DTransformation::new(0.0, (50.5, 300.5)),
        });
        prob.place_item(SPPlacement {
            item_id: 0,
            d_transf: DTransformation::new(0.0, (200.5, 450.5)),
        });
        assert!(prob.layout.is_feasible());

        gravity_compact(&mut prob);

        let mut boxes: Vec<_> = prob
            .layout
            .placed_items
            .values()
            .map(|pi| pi.shape.bbox)
            .collect();
        boxes.sort_by(|a, b| a.x_min.total_cmp(&b.x_min));
        for (i, b) in boxes.iter().enumerate() {
            eprintln!("box {i}: x[{:.3},{:.3}] y[{:.3},{:.3}]", b.x_min, b.x_max, b.y_min, b.y_max);
        }

        // Clustered at the origin (modulo the contact epsilon): first square
        // at ~(0,0), second right beside it.
        assert!(boxes[0].x_min < 0.5 && boxes[0].y_min < 0.5);
        assert!(boxes[1].x_min < 100.5);
        assert!(boxes[1].y_min < 100.5);
        // No overlap.
        for (i, a) in boxes.iter().enumerate() {
            for b in &boxes[i + 1..] {
                let ox = (a.x_max.min(b.x_max) - a.x_min.max(b.x_min)).max(0.0);
                let oy = (a.y_max.min(b.y_max) - a.y_min.max(b.y_min)).max(0.0);
                assert!(ox * oy < 1e-3, "overlap after gravity");
            }
        }
        // Strip tightened to the used width.
        assert!(prob.strip_width() <= 200.5);
        assert!(prob.layout.is_feasible());
    }
}
