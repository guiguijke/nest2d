//! Simulated annealing over the item placement sequence (with late-incumbent
//! guarantee): the order in which the greedy constructor places items is the
//! search space, sequence permutations are the moves. Objective is
//! lexicographic: (1) every item placed, (2) fewest bin cost, (3) biggest
//! reusable remnant per sheet, (4) most uneven fill (Falkenauer).

use super::constructive::{DirBias, construct};
use jagua_rs::entities::Instance;
use jagua_rs::entities::LayoutSnapshot;
use jagua_rs::probs::bpp::entities::{BPInstance, BPSolution};
use rand::{Rng, RngExt};
use std::time::{Duration, Instant};

/// Scalarized cost for SA acceptance. Lexicographic comparisons use `cmp_key`.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Cost {
    pub unplaced: usize,
    pub bin_cost: u64,
    /// Mean remnant score over used bins, as a fraction of one bin's area
    /// in [0, 1]: biggest free rectangle or L-shape per sheet. Higher = a
    /// cleaner, more reusable offcut.
    pub remnant: f64,
    /// Falkenauer fitness in (0, 1]: higher = more uneven fill = better.
    pub falkenauer: f64,
}

impl Cost {
    pub fn scalar(&self) -> f64 {
        // bin_cost dominates (10 per sheet); remnant worth ~3 per full sheet
        // of clean offcut; falkenauer a nudge (0.5).
        self.unplaced as f64 * 1000.0 + self.bin_cost as f64 * 10.0
            - self.remnant * 3.0
            - self.falkenauer * 0.5
    }
    /// Lexicographic ordering: unplaced, then bin cost, then remnant, then fill.
    pub fn cmp_key(&self) -> (usize, u64, i64, i64) {
        (
            self.unplaced,
            self.bin_cost,
            // negate: higher remnant / falkenauer is better
            (-self.remnant * 1e9) as i64,
            (-self.falkenauer * 1e9) as i64,
        )
    }
}

/// Remnant score of one layout: the largest free rectangle OR L-shape around
/// the used bounding box (right/top/bottom/left bands, and the two L
/// combinations of adjacent bands). Expressed as a fraction of the bin area.
///
/// A band is free BY CONSTRUCTION of the used bbox, and each L is the union
/// of two adjacent bands (a full-side band plus the continuation over the
/// used region on the adjacent side) — the shape a shop can actually reuse
/// for L-shaped parts.
fn layout_remnant(ls: &LayoutSnapshot) -> f64 {
    let bbox = ls.container.outer_cd.bbox;
    let (w, h) = (bbox.width() as f64, bbox.height() as f64);
    if w <= 0.0 || h <= 0.0 {
        return 0.0;
    }
    let mut min_x = f32::INFINITY;
    let mut min_y = f32::INFINITY;
    let mut max_x = f32::NEG_INFINITY;
    let mut max_y = f32::NEG_INFINITY;
    for pi in ls.placed_items.values() {
        let b = &pi.shape.bbox;
        min_x = min_x.min(b.x_min);
        min_y = min_y.min(b.y_min);
        max_x = max_x.max(b.x_max);
        max_y = max_y.max(b.y_max);
    }
    if !min_x.is_finite() {
        return 1.0; // empty layout: fully reusable
    }
    let (min_x, min_y) = (min_x as f64, min_y as f64);
    let (max_x, max_y) = (max_x as f64, max_y as f64);

    let right = (w - max_x) * h;
    let top = w * (h - max_y);
    let left = min_x * h;
    let bottom = w * min_y;
    // L-shapes: full band + adjacent band over the used region (no overlap).
    let l_right_top = (w - max_x) * h + max_x * (h - max_y);
    let l_top_right = w * (h - max_y) + (w - max_x) * max_y;
    let l_left_bottom = min_x * h + (w - min_x) * min_y;
    let l_bottom_left = w * min_y + min_x * (h - min_y);

    let best = right
        .max(top)
        .max(left)
        .max(bottom)
        .max(l_right_top)
        .max(l_top_right)
        .max(l_left_bottom)
        .max(l_bottom_left);
    (best / (w * h)).clamp(0.0, 1.0)
}

pub fn cost_of(solution: &BPSolution, instance: &BPInstance, unplaced: usize) -> Cost {
    let n_layouts = solution.layout_snapshots.len().max(1) as f64;
    let falkenauer = solution
        .layout_snapshots
        .values()
        .map(|ls| {
            let fill = ls.placed_item_area(instance) / ls.container.area();
            (fill * fill) as f64
        })
        .sum::<f64>()
        / n_layouts;
    let remnant = solution
        .layout_snapshots
        .values()
        .map(layout_remnant)
        .sum::<f64>()
        / n_layouts;
    Cost {
        unplaced,
        bin_cost: solution.cost(instance),
        remnant,
        falkenauer,
    }
}

/// Initial sequence: items expanded by demand, largest diameter first
/// (classic decreasing-size heuristic, strong starting point for SA).
pub fn initial_sequence(instance: &BPInstance) -> Vec<usize> {
    let mut ids: Vec<usize> = (0..instance.items.len()).collect();
    ids.sort_by(|&a, &b| {
        instance
            .item(b)
            .shape_cd
            .diameter
            .total_cmp(&instance.item(a).shape_cd.diameter)
    });
    let mut seq = Vec::with_capacity(instance.total_item_qty());
    for id in ids {
        for _ in 0..instance.item_qty(id) {
            seq.push(id);
        }
    }
    seq
}

pub struct SaReport {
    pub best_solution: BPSolution,
    pub best_cost: Cost,
    pub iterations: usize,
}

/// Runs the annealing until `deadline`. `on_improvement` is called every time
/// the incumbent improves (for live progress); `on_heartbeat` at ~1 Hz.
/// `bias` steers the constructive's directional tie-break (per-worker, so
/// exported alternatives are structurally distinct).
pub fn anneal(
    instance: &BPInstance,
    n_samples: usize,
    deadline: Duration,
    bias: DirBias,
    rng: &mut impl Rng,
    mut on_improvement: impl FnMut(&Cost, &BPSolution),
    mut on_heartbeat: impl FnMut(usize, &Cost),
) -> SaReport {
    let started = Instant::now();
    let end = started + deadline;

    let mut seq = initial_sequence(instance);

    // Evaluate the initial sequence.
    let initial = construct(instance, &seq, n_samples, bias, rng);
    let mut current_cost = cost_of(&initial.solution, instance, initial.unplaced);

    // Incumbent: the actual best solution ever seen (stored, never rebuilt —
    // constructive placement is stochastic, re-running it could regress).
    let mut best_solution = initial.solution.clone();
    let mut best_cost = current_cost;
    on_improvement(&best_cost, &best_solution);

    // Temperature schedule: geometric from T0 to T_END over the time budget.
    // Δcost is in "bin-equivalents" (10 per bin), so T0 ~ a few bins.
    const T0: f64 = 5.0;
    const T_END: f64 = 0.01;

    let n = seq.len();
    let mut iterations = 0usize;
    let mut last_heartbeat = Instant::now();

    while Instant::now() < end {
        iterations += 1;

        // Pick and apply a move.
        let mov = match rng.random_range(0..4) {
            // swap two positions
            0 | 1 => {
                let a = rng.random_range(0..n);
                let b = rng.random_range(0..n);
                seq.swap(a, b);
                Move::Swap(a, b)
            }
            // move one element to another position
            2 => {
                let from = rng.random_range(0..n);
                let to = rng.random_range(0..n);
                let v = seq.remove(from);
                seq.insert(to, v);
                Move::Insert(from, to)
            }
            // reverse a segment
            _ => {
                let a = rng.random_range(0..n);
                let b = rng.random_range(0..n);
                let (lo, hi) = (a.min(b), a.max(b));
                seq[lo..=hi].reverse();
                Move::Reverse(lo, hi)
            }
        };

        let candidate = construct(instance, &seq, n_samples, bias, rng);
        let candidate_cost = cost_of(&candidate.solution, instance, candidate.unplaced);

        let elapsed_frac = (started.elapsed().as_secs_f64() / deadline.as_secs_f64()).min(1.0);
        let temperature = T0 * (T_END / T0).powf(elapsed_frac);
        let delta = candidate_cost.scalar() - current_cost.scalar();
        let accept = delta <= 0.0 || rng.random::<f64>() < (-delta / temperature).exp();

        if accept {
            current_cost = candidate_cost;
            if candidate_cost.cmp_key() < best_cost.cmp_key() {
                best_cost = candidate_cost;
                best_solution = candidate.solution.clone();
                on_improvement(&best_cost, &best_solution);
            }
        } else {
            mov.revert(&mut seq);
        }

        if last_heartbeat.elapsed().as_secs() >= 1 {
            last_heartbeat = Instant::now();
            on_heartbeat(iterations, &best_cost);
        }
    }

    // Incumbent guarantee: the exported solution is the best one ever
    // encountered during the walk, not the last state.
    SaReport {
        best_solution,
        best_cost,
        iterations,
    }
}

enum Move {
    Swap(usize, usize),
    Insert(usize, usize),
    Reverse(usize, usize),
}

impl Move {
    fn revert(self, seq: &mut Vec<usize>) {
        match self {
            Move::Swap(a, b) => seq.swap(a, b),
            Move::Insert(from, to) => {
                // inverse of remove(from) + insert(to)
                let v = seq.remove(to);
                seq.insert(from, v);
            }
            Move::Reverse(lo, hi) => seq[lo..=hi].reverse(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cost_is_lexicographic() {
        let a = Cost { unplaced: 0, bin_cost: 3, remnant: 0.2, falkenauer: 0.5 };
        let b = Cost { unplaced: 1, bin_cost: 1, remnant: 0.9, falkenauer: 0.9 };
        // feasibility dominates everything
        assert!(a.cmp_key() < b.cmp_key());
        let c = Cost { unplaced: 0, bin_cost: 2, remnant: 0.1, falkenauer: 0.1 };
        // fewer bins beats better remnant and fill
        assert!(c.cmp_key() < a.cmp_key());
        let d = Cost { unplaced: 0, bin_cost: 2, remnant: 0.6, falkenauer: 0.1 };
        // at equal bins, bigger remnant wins
        assert!(d.cmp_key() < c.cmp_key());
        let e = Cost { unplaced: 0, bin_cost: 2, remnant: 0.6, falkenauer: 0.9 };
        // at equal remnant, more uneven fill wins
        assert!(e.cmp_key() < d.cmp_key());
    }
}
