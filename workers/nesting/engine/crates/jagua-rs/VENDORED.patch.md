# Vendored patches on jagua-rs 0.7.2 (upstream: MPL-2.0, Jeroen Gardeyn)

1. `src/probs/spp/io/import.rs`, `src/probs/bpp/io/import.rs`,
   `src/probs/mspp/io/import.rs` :
   `par_iter()` → `iter()` sous `cfg(target_arch = "wasm32")`.
   Raison : rayon spawne des threads OS — panique sur wasm32-unknown-unknown
   (pool global). Natif inchangé.

2. `src/geometry/transformation.rs` : `atan2` → `libm::atan2f`,
   `sin_cos` → `libm::sincosf` (3 sites). Raison : les libms plateforme
   (msvcrt / glibc / Rust libm sur wasm32) divergent par ulps et cassent la
   reproductibilité cross-device (AGENTS.md moteur — libm). Dép libm ajoutée.

Upstream inchangé sinon. Licence : MPL-2.0 (voir LICENSE).
