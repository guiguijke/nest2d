//! nest-preprocess — canaux capillaires (ouverture des trous) pour le moteur.
//! SQUELETTE WIP (PR2 Phase 2) — implémentation en cours, ne pas utiliser.

/// Largeur de canal survivant à l'inflation min_item_separation (jumeau de
/// holed_polygons.channel_width_for_space).
pub fn channel_width_for_space(space: f64) -> f64 {
    let space = if space.is_nan() { 0.0 } else { space };
    (0.01f64).max(space + 0.1).min(2.5)
}

/// Les canaux survivent-ils à l'inflation ? (holed_polygons.channels_usable)
pub fn channels_usable(space: f64) -> bool {
    channel_width_for_space(space) > space
}
