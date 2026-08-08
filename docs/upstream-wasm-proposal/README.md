# Proposition cfg upstream — jagua-rs / sparrow (JeroenGar)

**Statut : PRÉPARÉE, NON SOUMISE** (décision patron requise avant toute
soumission). Branche dédiée `feat/upstream-wasm-cfg-proposal`, rien d'autre.

## Contexte

Nest2D compile sa chaîne moteur (jagua-rs 0.7.2 + sparrow + nest-engine)
vers `wasm32-unknown-unknown` pour exécuter le nesting dans le navigateur
(Phase 2, verdict GO — `spike/VERDICT.md`). Deux adaptations ont été
nécessaires dans les dépendances — elles sont **génériques** et pourraient
vivre upstream au lieu d'un vendoring.

## 1. jagua-rs : import mono-thread wasm32 + libm (déterminisme cross-target)

`jagua-rs-wasm-determinism.patch` (diff vs crates.io 0.7.2) :

- **mono-thread** : `par_iter()` → `iter()` sous `cfg(target_arch = "wasm32")`
  dans `probs/{spp,bpp,mspp}/io/import.rs` (rayon panique au spawn sur
  wasm32-unknown-unknown — natif inchangé).
- **déterminisme** : `atan2`/`sin_cos` → `libm::atan2f`/`libm::sincosf`
  (4 sites, `geometry/transformation.rs`). Les libms plateforme (msvcrt /
  glibc / Rust libm sur wasm32) divergent par ulps et cassent la
  reproductibilité cross-device d'une recherche chaotique (mesuré :
  7,9 M vs 4,9 M évals à seed égal — bit-exact après libm).

Forme upstream possible (à discuter avec l'auteur) : feature `wasm` (ou
`deterministic-math`) plutôt que libm systématique — libm pur Rust coûte
~10-15 % d'itérations vs libm système sur les appels trigo.

## 2. sparrow : pool rayon désactivé en mono-walk + chemin séquentiel partagé

`sparrow-wasm-mono-walk.patch` (diff vs notre vendoring actuel) :

- `Separator::new` : pool `None` si `cfg!(target_arch = "wasm32") ||
  config.n_workers <= 1` (un pool à 1 worker n'apporte que du jitter).
- `move_items_multi` : chemin séquentiel `iter_mut()` quand le pool est
  `None` (le fallback actuel tombe sur le pool global rayon → panic wasm).
- `explore.rs` : `rand_distr::Normal` → Box-Muller via libm (les queues de
  ziggurat appellent ln/exp plateforme — même problème de déterminisme).

## 3. Ce qui N'EST PAS proposé

- `nest-engine` (spécifique Nest2D : CLI, orchestration, `map_workers`,
  champs de config déterministes) — reste chez nous.
- La crate `nest-wasm` (wrapper wasm-bindgen) — reste chez nous.

## 4. Référence

- `workers/nesting/bench/determinism_lock.py` — verrou SHA-256 natif/wasm
  (tolérance 0) démontrant la reproductibilité après patches.
- `workers/nesting/bench/BASELINE-libm.md` — métriques avant/après
  (densités en hausse, badges verts, variance hole-fill qualifiée).
