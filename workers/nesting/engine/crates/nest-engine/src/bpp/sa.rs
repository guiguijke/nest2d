//! Simulated annealing over the item placement sequence (with late-incumbent
//! guarantee): the order in which the greedy constructor places items is the
//! search space, sequence permutations are the moves. Objective is
//! lexicographic: (1) every item placed, (2) fewest bin cost, (3) most uneven
//! fill (Falkenauer) — full bins and one light bin leave a reusable offcut.

use super::constructive::construct;
use jagua_rs::entities::Instance;
use jagua_rs::probs::bpp::entities::{BPInstance, BPSolution};
use rand::{Rng, RngExt};
use std::time::{Duration, Instant};

/// Scalarized cost for SA acceptance. Lexicographic comparisons use `cmp_key`.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Cost {
    pub unplaced: usize,
    pub bin_cost: u64,
    /// Falkenauer fitness in (0, 1]: higher = more uneven fill = better.
    pub falkenauer: f64,
}

impl Cost {
    pub fn scalar(&self) -> f64 {
        self.unplaced as f64 * 1000.0 + self.bin_cost as f64 * 10.0 - self.falkenauer
    }
    /// Lexicographic ordering: unplaced, then bin cost, then fill evenness.
    pub fn cmp_key(&self) -> (usize, u64, i64) {
        (
            self.unplaced,
            self.bin_cost,
            // negate: higher falkenauer is better
            (-self.falkenauer * 1e9) as i64,
        )
    }
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
    Cost {
        unplaced,
        bin_cost: solution.cost(instance),
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
pub fn anneal(
    instance: &BPInstance,
    n_samples: usize,
    deadline: Duration,
    rng: &mut impl Rng,
    mut on_improvement: impl FnMut(&Cost),
    mut on_heartbeat: impl FnMut(usize, &Cost),
) -> SaReport {
    let started = Instant::now();
    let end = started + deadline;

    let mut seq = initial_sequence(instance);

    // Evaluate the initial sequence.
    let initial = construct(instance, &seq, n_samples, rng);
    let mut current_cost = cost_of(&initial.solution, instance, initial.unplaced);

    // Incumbent: the actual best solution ever seen (stored, never rebuilt —
    // constructive placement is stochastic, re-running it could regress).
    let mut best_solution = initial.solution.clone();
    let mut best_cost = current_cost;
    on_improvement(&best_cost);

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

        let candidate = construct(instance, &seq, n_samples, rng);
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
                on_improvement(&best_cost);
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
        let a = Cost { unplaced: 0, bin_cost: 3, falkenauer: 0.5 };
        let b = Cost { unplaced: 1, bin_cost: 1, falkenauer: 0.9 };
        // feasibility dominates everything
        assert!(a.cmp_key() < b.cmp_key());
        let c = Cost { unplaced: 0, bin_cost: 2, falkenauer: 0.1 };
        // fewer bins beats better fill
        assert!(c.cmp_key() < a.cmp_key());
        let d = Cost { unplaced: 0, bin_cost: 2, falkenauer: 0.9 };
        // at equal bins, more uneven fill wins
        assert!(d.cmp_key() < c.cmp_key());
    }
}
