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
use rand::rngs::Xoshiro256PlusPlus;
use jagua_rs::Instant;
use std::time::Duration;

/// Scalarized cost for SA acceptance. Lexicographic comparisons use `cmp_key`.
/// Serialize/Deserialize : transport du coût complet dans les alternatives
/// exportées (`cost_detail`, J-093 — parité exacte du merge wasm).
#[derive(Debug, Clone, Copy, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct Cost {
    pub unplaced: usize,
    pub bin_cost: u64,
    /// C4 (audit 2026-09-03) : remnant score MAXIMAL des tôles utilisées,
    /// fraction de l'aire d'une tôle en [0, 1] : plus grand rectangle ou L
    /// libre. Plus grand = chute plus propre ET CONCENTRÉE — la moyenne
    /// d'antan était neutre à la concentration (une chute propre répartie
    /// en bandes inguérables valait une chute pleine tôle).
    pub remnant: f64,
    /// C4 : Σ fill² sur les tôles (Falkenauer) — plus grand = remplissage
    /// plus inégal = mieux.
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
    let _ = n_layouts;
    // C4 : Σ fill² (somme, pas moyenne) et remnant MAX (pas moyenne).
    let falkenauer = solution
        .layout_snapshots
        .values()
        .map(|ls| {
            let fill = ls.placed_item_area(instance) / ls.container.area();
            (fill * fill) as f64
        })
        .sum::<f64>();
    let remnant = solution
        .layout_snapshots
        .values()
        .map(layout_remnant)
        .fold(0.0_f64, f64::max);
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

/// Picks the SA starting sequence: the warm-start if it is complete (one
/// entry per demanded item), otherwise the decreasing-diameter default.
pub(crate) fn pick_initial_sequence(
    instance: &BPInstance,
    warm: Option<Vec<usize>>,
) -> Vec<usize> {
    warm.filter(|s| s.len() == instance.total_item_qty())
        .unwrap_or_else(|| initial_sequence(instance))
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
/// `initial_seq` is an optional warm-start sequence (positional item ids,
/// expanded by demand); used only if its length matches the total item
/// quantity, otherwise the decreasing-diameter default kicks in.
/// `plateau_patience`: stop early when the incumbent has not improved for
/// this long (after MIN_ITERS_BEFORE_PLATEAU iterations) — "compute until
/// convergence" instead of burning the full budget on easy instances.
/// `max_iterations` (cross-target determinism harness): when set, the loop
/// runs a fixed number of iterations and the temperature schedule is driven
/// by the iteration fraction instead of wall clock — the walk becomes
/// reproducible bit-for-bit across native and wasm builds.
pub fn anneal(
    instance: &BPInstance,
    n_samples: usize,
    deadline: Duration,
    bias: DirBias,
    initial_seq: Option<Vec<usize>>,
    plateau_patience: Option<Duration>,
    max_iterations: Option<usize>,
    rng: &mut impl Rng,
    mut on_improvement: impl FnMut(&Cost, &BPSolution),
    mut on_heartbeat: impl FnMut(usize, &Cost, &BPSolution),
) -> SaReport {
    let started = Instant::now();
    let end = started + deadline;

    let mut seq = pick_initial_sequence(instance, initial_seq);

    // C3 (audit 2026-09-03) : rng d'évaluation DÉRIVÉ de (graine du walk,
    // hash de la séquence) — le constructif stochastique re-évaluait la
    // MÊME séquence avec un autre tirage à chaque visite (multi-start
    // bruité) : le SA comparait du bruit, pas des séquences. Désormais une
    // séquence donnée produit toujours la même évaluation dans le walk.
    let base_seed = rng.next_u64();
    let eval_rng = |seq: &[usize]| -> Xoshiro256PlusPlus {
        rand::SeedableRng::seed_from_u64(seq_hash(seq) ^ base_seed)
    };

    // Evaluate the initial sequence.
    let initial = construct(instance, &seq, n_samples, bias, &mut eval_rng(&seq));
    let mut current_cost = cost_of(&initial.solution, instance, initial.unplaced);

    // Incumbent: the actual best solution ever seen (stored, never rebuilt —
    // constructive placement is stochastic, re-running it could regress).
    let mut best_solution = initial.solution.clone();
    let mut best_cost = current_cost;
    on_improvement(&best_cost, &best_solution);
    let mut last_improvement = Instant::now();

    // Temperature schedule: geometric from T0 to T_END over the time budget.
    // Δcost is in "bin-equivalents" (10 per bin), so T0 ~ a few bins.
    const T0: f64 = 5.0;
    const T_END: f64 = 0.01;
    // C7 (audit 2026-09-03) : plateau calibré en TEMPS — l'ancien plancher
    // MIN_ITERS_BEFORE_PLATEAU = 200 × ~210 ms/it = 42 s incompressibles sur
    // le corpus user, non calibré à n. Minimum de recherche avant arrêt :
    // max(3 s, 20 × durée moyenne d'itération), borné à mi-budget.
    const PLATEAU_MIN_SEARCH_SEC: f64 = 3.0;
    const PLATEAU_MIN_ITERS_FACTOR: f64 = 20.0;

    let n = seq.len();
    let mut iterations = 0usize;
    let mut last_heartbeat = Instant::now();

    loop {
        // Termination: fixed iteration count (deterministic mode) or deadline.
        match max_iterations {
            Some(mi) if iterations >= mi => break,
            None if Instant::now() >= end => break,
            _ => {}
        }
        iterations += 1;

        // Plateau stop: no incumbent improvement for `patience`.
        if let Some(patience) = plateau_patience {
            let avg_iter = started.elapsed().as_secs_f64() / (iterations.max(1) as f64);
            let min_search = PLATEAU_MIN_SEARCH_SEC
                .max(PLATEAU_MIN_ITERS_FACTOR * avg_iter)
                .min(deadline.as_secs_f64() * 0.5);
            if started.elapsed().as_secs_f64() >= min_search
                && last_improvement.elapsed() >= patience
            {
                break;
            }
        }

        // Pick and apply a move (C3 : type-aware — aucun move entre ids
        // identiques, ~73 % des moves du corpus user étaient des no-ops).
        let Some(mov) = apply_move(&mut seq, rng) else {
            continue; // séquence à classe unique : rien à explorer
        };

        let candidate = construct(instance, &seq, n_samples, bias, &mut eval_rng(&seq));
        let candidate_cost = cost_of(&candidate.solution, instance, candidate.unplaced);

        let elapsed_frac = match max_iterations {
            Some(mi) => (iterations as f64 / mi as f64).min(1.0),
            None => (started.elapsed().as_secs_f64() / deadline.as_secs_f64()).min(1.0),
        };
        // libm pow/exp — identical on every target (platform libms diverge
        // by ulps and break cross-target replay determinism, AGENTS.md).
        let temperature = T0 * libm::pow(T_END / T0, elapsed_frac);
        let delta = candidate_cost.scalar() - current_cost.scalar();
        let accept = delta <= 0.0 || rng.random::<f64>() < libm::exp(-delta / temperature);

        if accept {
            current_cost = candidate_cost;
            if candidate_cost.cmp_key() < best_cost.cmp_key() {
                best_cost = candidate_cost;
                best_solution = candidate.solution.clone();
                last_improvement = Instant::now();
                on_improvement(&best_cost, &best_solution);
            }
        } else {
            mov.revert(&mut seq);
        }

        if last_heartbeat.elapsed().as_secs() >= 1 {
            last_heartbeat = Instant::now();
            on_heartbeat(iterations, &best_cost, &best_solution);
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

/// Hash FNV-1a de la séquence (positions prises en compte).
fn seq_hash(seq: &[usize]) -> u64 {
    let mut h: u64 = 0xcbf29ce484222325;
    for (i, &v) in seq.iter().enumerate() {
        h ^= (v as u64).wrapping_mul(0x100000001b3);
        h ^= (i as u64).wrapping_mul(0x9E3779B97F4A7C15);
        h = h.rotate_left(13).wrapping_mul(0xff51afd7ed558ccd);
    }
    h
}

/// C3 : un move qui n'échange que des ids IDENTIQUES est un no-op (le
/// constructif place les items d'une classe de façon interchangeable) —
/// sur le corpus user, ~73 % des moves étaient perdus. Chaque move
/// ré-échantillonne sa cible jusqu'à tomber sur un id différent ; None
/// si la séquence n'a qu'une classe (rien à explorer).
fn apply_move(seq: &mut Vec<usize>, rng: &mut impl Rng) -> Option<Move> {
    let n = seq.len();
    if n < 2 {
        return None;
    }
    fn redraw_until_diff(
        seq: &[usize],
        n: usize,
        rng: &mut impl Rng,
        a: usize,
    ) -> Option<usize> {
        for _ in 0..n.max(4) {
            let b = rng.random_range(0..n);
            if seq[b] != seq[a] {
                return Some(b);
            }
        }
        // dernier recours : scan déterministe d'un id différent
        (0..n).find(|&b| seq[b] != seq[a])
    }
    match rng.random_range(0..4) {
        // swap two positions of DIFFERENT ids
        0 | 1 => {
            let a = rng.random_range(0..n);
            let b = redraw_until_diff(&seq, n, rng, a)?;
            seq.swap(a, b);
            Some(Move::Swap(a, b))
        }
        // move one element to a position of a different id (moving inside
        // a run of identical values is a no-op)
        2 => {
            let from = rng.random_range(0..n);
            let to = redraw_until_diff(&seq, n, rng, from)?;
            let v = seq.remove(from);
            let to = to.min(seq.len()); // le remove décale les indices
            seq.insert(to, v);
            Some(Move::Insert(from, to))
        }
        // reverse a segment whose endpoints differ (a constant segment
        // reverses to itself)
        _ => {
            let a = rng.random_range(0..n);
            let b = redraw_until_diff(&seq, n, rng, a)?;
            let (lo, hi) = (a.min(b), a.max(b));
            seq[lo..=hi].reverse();
            Some(Move::Reverse(lo, hi))
        }
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

    /// T4 (plan §2.3, C3) : sur une séquence à forte multiplicité (le
    /// corpus user : 999 fans + 100 trous), chaque move doit CHANGER la
    /// séquence — l'ancien tirage uniforme produisait ~73 % de no-ops
    /// (swap/insert/reverse entre items interchangeables).
    #[test]
    fn sa_moves_change_sequence() {
        use rand::SeedableRng;
        use rand::rngs::Xoshiro256PlusPlus;
        let mut seq: Vec<usize> = Vec::new();
        for _ in 0..999 {
            seq.push(1);
        }
        for _ in 0..100 {
            seq.push(0);
        }
        let mut rng = Xoshiro256PlusPlus::seed_from_u64(42);
        let mut changed = 0usize;
        let mut applied = 0usize;
        for _ in 0..2000 {
            let before = seq.clone();
            if apply_move(&mut seq, &mut rng).is_some() {
                applied += 1;
                if seq != before {
                    changed += 1;
                }
            }
        }
        assert!(applied > 1500, "des moves doivent s'appliquer ({applied})");
        let ratio = changed as f64 / applied as f64;
        assert!(
            ratio >= 0.95,
            "≥ 95 % des moves doivent changer la séquence — {ratio:.3}"
        );
    }

    /// C3 : le rng d'évaluation dérivé de (base, hash(seq)) rend le
    /// constructif DÉTERMINISTE par séquence — deux évaluations de la
    /// même séquence donnent la même solution.
    #[test]
    fn construct_is_deterministic_per_sequence() {
        use crate::bpp::constructive::{construct, DirBias};
        use jagua_rs::io::import::Importer;
        use jagua_rs::probs::bpp::io::ext_repr::ExtBPInstance;
        use jagua_rs::probs::bpp::io::import_instance;
        use rand::SeedableRng;
        use rand::rngs::Xoshiro256PlusPlus;
        let json = serde_json::json!({
            "name": "det",
            "items": [
                {"id": 0, "demand": 6,
                 "allowed_orientations": [0.0, 90.0],
                 "shape": {"type": "simple_polygon", "data": [[0,0],[50,0],[50,50],[0,50],[0,0]]}},
                {"id": 1, "demand": 20,
                 "allowed_orientations": [0.0, 90.0, 180.0, 270.0],
                 "shape": {"type": "simple_polygon", "data": [[0,0],[20,0],[20,14],[0,14],[0,0]]}}
            ],
            "bins": [{
                "id": 0, "cost": 1, "stock": 2,
                "shape": {"type": "polygon", "data": {"outer": [[0,0],[300,0],[300,300],[0,300],[0,0]]}}
            }]
        });
        let ext: ExtBPInstance = serde_json::from_value(json).unwrap();
        let importer = Importer::new(
            sparrow::config::DEFAULT_SPARROW_CONFIG.cde_config,
            Some(0.001),
            None,
            Some((0.01, 0.01)),
        );
        let instance = import_instance(&importer, &ext).unwrap();
        let seq: Vec<usize> = std::iter::repeat(0).take(6)
            .chain(std::iter::repeat(1).take(20)).collect();
        let base = 0xdeadbeefu64;
        let mut r1 = Xoshiro256PlusPlus::seed_from_u64(seq_hash(&seq) ^ base);
        let mut r2 = Xoshiro256PlusPlus::seed_from_u64(seq_hash(&seq) ^ base);
        let a = construct(&instance, &seq, 200, DirBias::LeftFirst, &mut r1);
        let b = construct(&instance, &seq, 200, DirBias::LeftFirst, &mut r2);
        let poses = |r: &crate::bpp::constructive::ConstructiveResult| -> Vec<(String, usize, f32, f32, f32)> {
            let mut out = Vec::new();
            for (k, ls) in r.solution.layout_snapshots.iter() {
                for pi in ls.placed_items.values() {
                    out.push((
                        format!("{k:?}"),
                        pi.item_id,
                        pi.d_transf.rotation.into_inner(),
                        pi.d_transf.translation.0.into_inner(),
                        pi.d_transf.translation.1.into_inner(),
                    ));
                }
            }
            out.sort_by(|x, y| x.partial_cmp(y).unwrap());
            out
        };
        assert_eq!(poses(&a), poses(&b), "même séquence = même solution (rng dérivé du hash)");
    }

    /// T5 (plan §2.3, C4) : à coût de tôles égal, une chute CONCENTRÉE
    /// (remnant max) bat une chute diluée — l'ancienne moyenne égalisait
    /// les deux (neutre à la concentration).
    #[test]
    fn cost_prefers_concentrated_remnant() {
        let concentrated = Cost {
            unplaced: 0,
            bin_cost: 2,
            remnant: 0.6,
            falkenauer: 0.5,
        };
        let diluted = Cost {
            unplaced: 0,
            bin_cost: 2,
            remnant: 0.3,
            falkenauer: 0.5,
        };
        assert!(concentrated.cmp_key() < diluted.cmp_key());
    }

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
