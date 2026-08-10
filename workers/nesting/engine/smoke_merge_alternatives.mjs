// Smoke test de l'export wasm `merge_alternatives` (J-093 — pool de Web
// Workers navigateur).
//
//   node workers/nesting/engine/smoke_merge_alternatives.mjs
//
// 1. Fixture partagée fixtures/merge_spp_input.json — les MÊMES assertions
//    que le test d'intégration Rust crates/nest-engine/tests/merge_smoke.rs
//    (verrou cross-target natif/wasm de la fusion).
// 2. Cas minimal : 2 runs SPP fabriqués à la main.
// 3. Flux pool réel : deux walks mono-thread (run_nesting wasm, seeds
//    distinctes) sur la fixture b_demo, fusionnés via merge_alternatives —
//    le champion doit matcher le min par cmp_key (coût SA) des runs.
import { readFileSync } from 'node:fs';
import init, { run_nesting, merge_alternatives } from '../../../public/engine/nest_wasm.js';

const root = new URL('.', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8');
const wasmBytes = readFileSync(new URL('../../../public/engine/nest_wasm_bg.wasm', root));
await init(wasmBytes);

let failures = 0;
const check = (cond, label) => {
  if (!cond) { failures++; console.error(`FAIL ${label}`); }
  else { console.log(`ok   ${label}`); }
};

// ---------- 1. Fixture partagée (miroir du test Rust merge_smoke.rs) ----------
{
  const input = read('fixtures/merge_spp_input.json');
  const out = JSON.parse(merge_alternatives(input));
  check(out.problem === 'spp', 'fixture: problem spp');
  const alts = out.alternatives;
  check(alts.length === 2, `fixture: 2 alternatives (balanced dédupé), got ${alts.length}`);
  check(alts[0].rank === 0 && alts[0].seed === 111 && alts[0].bias === 'left',
    'fixture: rank 0 = champion left (seed 111, string acceptée)');
  check(alts[0].evaluations === 1000 && alts[0].used_height === 40 && alts[0].strip_width === 80,
    'fixture: compteurs/used_height/strip_width du champion left');
  check(alts[1].rank === 1 && alts[1].seed === 222 && alts[1].bias === 'bottom',
    'fixture: rank 1 = champion bottom (seed 222, number accepté)');
  check(out.sol_instance.name === 'merge-fixture' && out.sol_instance.strip_height === 100 &&
    out.sol_instance.solution.strip_width === 80, 'fixture: sol_instance = best aplati');
  const out2 = merge_alternatives(input);
  check(out2 === merge_alternatives(input),
    'fixture: déterministe (deux appels, même chaîne brute)');
}

// ---------- 2. Minimal : 2 runs SPP faits main ----------
{
  const mk = (seed, w, tx) => ({
    seed, bias: 'left', evaluations: seed, used_height: 10,
    solution: { strip_width: w, density: 0.5, run_time_sec: 0,
      layout: { container_id: 0, density: 0.5, placed_items: [
        { item_id: 0, transformation: { rotation: 0, translation: [tx, 0] } } ] } },
  });
  const out = JSON.parse(merge_alternatives(JSON.stringify({
    problem: 'spp',
    instance: { name: 'mini', strip_height: 50, items: [] },
    runs: [mk(5, 90, 1), mk(3, 80, 2)],
    biases: ['left'],
    n_alternatives: 3,
  })));
  check(out.alternatives.length === 2, 'mini: 2 alternatives');
  check(out.alternatives[0].seed === 3, 'mini: meilleure largeur en rank 0');
  check(out.sol_instance.solution.strip_width === 80, 'mini: best = strip 80');
}

// ---------- 3. Flux pool : 2 walks mono-thread wasm fusionnés ----------
{
  const instance = read('../bench/fixtures/b_demo/instance.json');
  const config = read('../bench/fixtures/b_demo/config_det.json');
  const seedA = 4122680510047324256n; // seed de la fixture
  const seedB = 123456789n;

  const walk = (seed) => JSON.parse(run_nesting(instance, config, seed)).alternatives[0];
  const a = walk(seedA);
  const b = walk(seedB);
  check(a.cost_detail && typeof a.cost_detail.remnant === 'number',
    'pool: le walk exporte cost_detail (pass-through)');
  check(a.bias === 'left' && a.iterations === 25, 'pool: champs du walk présents');

  const runs = [a, b].map((alt) => ({
    seed: String(alt.seed),
    bias: alt.bias,
    iterations: alt.iterations,
    cost_detail: alt.cost_detail,
    solution: alt.solution,
  }));
  const merged = JSON.parse(merge_alternatives(JSON.stringify({
    problem: 'bpp', instance: JSON.parse(instance),
    engineConfig: JSON.parse(config),
    runs, biases: ['left'], n_alternatives: 3,
  })));

  // Champion attendu = min par cmp_key (unplaced, bin_cost, -remnant,
  // -falkenauer, seed) sur les deux runs.
  const cmp = (x, y) =>
    (x.cost_detail.unplaced - y.cost_detail.unplaced) ||
    (x.cost_detail.bin_cost - y.cost_detail.bin_cost) ||
    (y.cost_detail.remnant - x.cost_detail.remnant) ||
    (y.cost_detail.falkenauer - x.cost_detail.falkenauer) ||
    (x.seed < y.seed ? -1 : x.seed > y.seed ? 1 : 0);
  const expectedFirst = cmp(a, b) <= 0 ? a : b;
  check(merged.problem === 'bpp', 'pool: problem bpp');
  check(merged.alternatives.length >= 1 && merged.alternatives.length <= 2,
    `pool: 1..2 alternatives (dédup possible), got ${merged.alternatives.length}`);
  check(merged.alternatives[0].seed === expectedFirst.seed,
    'pool: rank 0 = min cmp_key des walks');
  check(merged.sol_instance.solution.cost === merged.alternatives[0].cost,
    'pool: sol_instance cohérente avec le best');
  merged.alternatives.forEach((alt, i) => {
    if (alt.rank !== i) { failures++; console.error(`FAIL pool: rank ${alt.rank} != ${i}`); }
  });
  console.log(`     (walks: seed ${a.seed} cost ${a.cost} / seed ${b.seed} cost ${b.cost} -> merged ${merged.alternatives.length} alt)`);
}

if (failures > 0) { console.error(`\n${failures} FAIL`); process.exit(1); }
console.log('\nmerge_alternatives smoke OK');
