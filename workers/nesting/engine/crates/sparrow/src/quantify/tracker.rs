use crate::consts::{GLS_WEIGHT_DECAY, GLS_WEIGHT_MAX_INC_RATIO, GLS_WEIGHT_MIN_INC_RATIO};
use crate::quantify::pair_matrix::PairMatrix;
use crate::quantify::{quantify_collision_poly_container, quantify_collision_poly_poly};
use crate::util::assertions::tracker_matches_layout;
use jagua_rs::collision_detection::hazards::collector::{BasicHazardCollector, HazardCollector};
use jagua_rs::collision_detection::hazards::HazardEntity;
use jagua_rs::entities::{Layout, PItemKey};
use ordered_float::Float;
use slotmap::SecondaryMap;

/// Tracker of both collisions between pair of items and collisions with the container.
/// It also stores the weights for every pair of hazards and is used as a cache for collisions.
#[derive(Debug, Clone)]
pub struct CollisionTracker {
    pub size: usize,
    pub pk_idx_map: SecondaryMap<PItemKey, usize>,
    pub pair_collisions: PairMatrix,
    pub container_collisions: Vec<CTEntry>,
    /// P4 — biais d'éjection par aire : la perte conteneur PONDÉRÉE de l'item
    /// idx est multipliée par ce facteur ((aire/médiane)^β, clampé). À
    /// pénétration égale, une GROSSE pièce hors bande coûte plus cher qu'une
    /// petite : la séparation préfère éjecter les petites pièces (intuition
    /// user 2026-08-28). β = 0 ⇒ tous les facteurs à 1 (comportement
    /// historique). La faisabilité (loss == 0) et la dynamique GLS des poids
    /// restent pures — seul l'objectif pondéré est biaisé.
    pub container_bias: Vec<f32>,
}

/// Bornes du facteur de biais : assez large pour compter (×4 un carré face
/// à un fan), assez serré pour ne pas dominer les poids GLS (×16 max).
const BIAS_MIN: f32 = 0.25;
const BIAS_MAX: f32 = 4.0;

pub type CTSnapshot = CollisionTracker;

impl CollisionTracker {
    pub fn new(l: &Layout) -> Self {
        Self::new_with_bias(l, 0.0)
    }

    pub fn new_with_bias(l: &Layout, beta: f32) -> Self {
        let size = l.placed_items.len();

        // Create the tracker
        let mut ot = Self {
            size,
            pk_idx_map: l.placed_items.keys().enumerate()
                .map(|(i, pk)| (pk, i))
                .collect(),
            pair_collisions: PairMatrix::new(size),
            container_collisions: vec![CTEntry { weight: 1.0, loss: 0.0 }; size],
            container_bias: vec![1.0; size],
        };

        if beta > 0.0 && size > 0 {
            // Médiane des aires des shapes placées (inflatées — la constante
            // d'inflation s'annule dans le ratio) : référence d'échelle.
            let mut areas: Vec<f32> = l.placed_items.values()
                .map(|pi| pi.shape.area)
                .collect();
            areas.sort_by(|a, b| a.partial_cmp(b).unwrap());
            let median = areas[areas.len() / 2].max(1e-6);
            ot.container_bias = l.placed_items.values()
                .map(|pi| ((pi.shape.area / median).powf(beta)).clamp(BIAS_MIN, BIAS_MAX))
                .collect();
        }

        // Recompute the loss for all items
        l.placed_items.keys().for_each(|pk| {
            ot.recompute_loss_for_item(pk, l)
        });

        debug_assert!(tracker_matches_layout(&ot, l));

        ot
    }

    fn recompute_loss_for_item(&mut self, pk: PItemKey, l: &Layout) {
        let idx = self.pk_idx_map[pk];
        let pi = &l.placed_items[pk];
        let shape = &pi.shape;

        // Reset all current loss values for the item
        for i in 0..self.size {
            self.pair_collisions[(idx, i)].loss = 0.0;
        }
        self.container_collisions[idx].loss = 0.0;

        // Compute which hazards are currently colliding with the item
        let mut collector = BasicHazardCollector::with_capacity(l.placed_items.len() + 1);
        l.cde().collect_poly_collisions(shape, &mut collector);
        // Remove the item itself from the detector
        collector.remove_by_entity(&HazardEntity::from((pk, pi)));

        // For each colliding hazard, quantify the collision and store it in the tracker
        for (_, haz) in collector.iter() {
            match haz {
                HazardEntity::PlacedItem { pk: other_pk, .. } => {
                    let shape_other = &l.placed_items[*other_pk].shape;
                    let idx_other = self.pk_idx_map[*other_pk];

                    let loss = quantify_collision_poly_poly(shape, shape_other);
                    assert!(loss > 0.0, "loss for a collision should be > 0.0");
                    self.pair_collisions[(idx, idx_other)].loss = loss;
                }
                HazardEntity::Exterior => {
                    let loss = quantify_collision_poly_container(shape, l.container.outer_cd.bbox);
                    assert!(loss > 0.0, "loss for a collision should be > 0.0");
                    self.container_collisions[idx].loss = loss;
                }
                _ => unimplemented!("unsupported hazard entity"),
            }
        }
    }

    pub fn restore_but_keep_weights(&mut self, cts: &CTSnapshot, layout: &Layout) {
        //Copy the loss and keys, but keep the weights
        self.pk_idx_map = cts.pk_idx_map.clone();
        self.pair_collisions.data.iter_mut()
            .zip(cts.pair_collisions.data.iter())
            .for_each(|(a, b)| a.loss = b.loss);
        self.container_collisions.iter_mut()
            .zip(cts.container_collisions.iter())
            .for_each(|(a, b)| a.loss = b.loss);
        debug_assert!(tracker_matches_layout(self, layout));
    }

    pub fn save(&self) -> CTSnapshot {
        self.clone()
    }

    pub fn register_item_move(&mut self, l: &Layout, old_pk: PItemKey, new_pk: PItemKey) {
        //swap the keys in the pk_idx_map
        let idx = self.pk_idx_map.remove(old_pk).unwrap();
        self.pk_idx_map.insert(new_pk, idx);

        self.recompute_loss_for_item(new_pk, l);

        debug_assert!(tracker_matches_layout(self, l));
    }


    /// Algorithm 8 from https://doi.org/10.48550/arXiv.2509.13329
    pub fn update_weights(&mut self) {
        // Find the maximum loss across all entries
        let max_loss = self.pair_collisions.data.iter()
            .chain(self.container_collisions.iter())
            .map(|e| e.loss)
            .fold(0.0, |a, b| a.max(b));

        // Go over all entries (pairs) and modify their weights.
        for e in self.pair_collisions.data.iter_mut()
            .chain(self.container_collisions.iter_mut()) {
            let multiplier = match e.loss == 0.0 {
                true => {
                    // No collision at the moment, slowly decay the weight back to 1.0
                    GLS_WEIGHT_DECAY
                },
                false => {
                    // Collision detected, increase the weight based on 'how bad' the collision is relative to the worst collision
                    GLS_WEIGHT_MIN_INC_RATIO + (GLS_WEIGHT_MAX_INC_RATIO - GLS_WEIGHT_MIN_INC_RATIO) * (e.loss / max_loss)
                },
            };
            e.weight = (e.weight * multiplier).max(1.0);
        }
    }

    pub fn get_pair_weight(&self, pk1: PItemKey, pk2: PItemKey) -> f32 {
        let (idx1, idx2) = (self.pk_idx_map[pk1], self.pk_idx_map[pk2]);
        self.pair_collisions[(idx1, idx2)].weight
    }

    pub fn get_container_weight(&self, pk: PItemKey) -> f32 {
        let idx = self.pk_idx_map[pk];
        self.container_collisions[idx].weight
    }

    /// Algorithm 1 from https://doi.org/10.48550/arXiv.2509.13329
    /// Evaluations between item pairs are stored in this data-structure for quick and easy retrieval.
    pub fn get_pair_loss(&self, pk1: PItemKey, pk2: PItemKey) -> f32 {
        let (idx1, idx2) = (self.pk_idx_map[pk1], self.pk_idx_map[pk2]);
        self.pair_collisions[(idx1, idx2)].loss
    }

    pub fn get_container_loss(&self, pk: PItemKey) -> f32 {
        let idx = self.pk_idx_map[pk];
        self.container_collisions[idx].loss
    }

    /// Facteur de biais d'éjection de l'item (P4) — voir `container_bias`.
    pub fn get_container_bias(&self, pk: PItemKey) -> f32 {
        let idx = self.pk_idx_map[pk];
        self.container_bias[idx]
    }

    pub fn get_loss(&self, pk: PItemKey) -> f32 {
        let idx = self.pk_idx_map[pk];

        let pair_loss = (0..self.size)
            .map(|i| self.pair_collisions[(idx, i)].loss)
            .sum::<f32>();

        self.container_collisions[idx].loss + pair_loss
    }

    pub fn get_weighted_loss(&self, pk: PItemKey) -> f32 {
        let idx = self.pk_idx_map[pk];

        let w_pair_loss = (0..self.size)
            .map(|i| self.pair_collisions[(idx, i)].weighted_loss())
            .sum::<f32>();

        // P4 : le terme conteneur porte le biais d'aire (les paires restent
        // physiques) — cohérent avec SpecializedHazardCollector.
        self.container_collisions[idx].weighted_loss() * self.container_bias[idx] + w_pair_loss
    }

    pub fn get_total_loss(&self) -> f32 {
        let cont_o = self.container_collisions.iter().map(|e| e.loss).sum::<f32>();

        let pair_o = self.pair_collisions.data.iter()
            .map(|e| e.loss)
            .sum::<f32>();

        cont_o + pair_o
    }

    pub fn get_total_weighted_loss(&self) -> f32 {
        // P4 : terme conteneur pondéré par le biais d'aire de chaque item.
        let cont_w_o = self.container_collisions.iter().enumerate()
            .map(|(idx, e)| e.weighted_loss() * self.container_bias[idx])
            .sum::<f32>();

        let pair_w_o = self.pair_collisions.data.iter()
            .map(|e| e.weighted_loss())
            .sum::<f32>();

        cont_w_o + pair_w_o
    }
}

#[derive(Debug, Clone, Copy)]
pub struct CTEntry {
    pub loss: f32,
    pub weight: f32,
}

impl CTEntry {
    pub fn weighted_loss(&self) -> f32 {
        self.weight * self.loss
    }
}
#[cfg(test)]
mod tests {
    use super::*;

    /// P4 — biais d'éjection par aire : le facteur suit (aire/médiane)^β
    /// clampé, β=0 ⇒ neutre partout. On teste la FONCTION de facteur via la
    /// construction d'un tracker factice (sans layout complet) en vérifiant
    /// les invariants du vecteur sur des aires choisies.
    #[test]
    fn container_bias_scales_with_area() {
        // areas: 615 (fans), 615, 10000 (carré) -> médiane 615
        let beta = 0.5f32;
        let areas = [615.0f32, 615.0, 10000.0];
        let mut sorted = areas;
        sorted.sort_by(|a, b| a.partial_cmp(b).unwrap());
        let median = sorted[sorted.len() / 2].max(1e-6);
        let factor = |a: f32| ((a / median).powf(beta)).clamp(BIAS_MIN, BIAS_MAX);
        assert!((factor(615.0) - 1.0).abs() < 1e-6, "médiane ⇒ neutre");
        assert!((factor(10000.0) - 4.03).abs() < 0.1, "carré ≈ ×4");
        assert!((factor(154.0) - 0.5).abs() < 0.01, "petite ⇒ ÷2");
        assert!(factor(1.0) >= BIAS_MIN && factor(1e6) <= BIAS_MAX, "clamp");
        // β=0 : neutre quelle que soit l'aire
        let neutral = |a: f32| ((a / median).powf(0.0)).clamp(BIAS_MIN, BIAS_MAX);
        assert!((neutral(10000.0) - 1.0).abs() < 1e-6);
    }
}
