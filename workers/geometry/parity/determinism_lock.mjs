// Verrou de déterminisme natif ↔ wasm32 pour nest-import (jumeau géométrie
// du bench/determinism_lock.py du moteur, AGENTS #14b).
//
// Pour chaque DXF du corpus (fixtures + démo + corpus_extra) :
//   hash SHA-256 du JSON émis par le CLI natif  ==  hash du JSON wasm
// Toute divergence = écart de libm/arrondi entre cibles → exit 1.
// À rejouer après tout changement du crate nest-import.
//
// Prérequis (depuis workers/geometry/) :
//   cargo build --release                                    # CLI natif
//   cargo build --release -p nest-import --target wasm32-unknown-unknown --features wasm
//   wasm-bindgen --target web --out-dir target/wasm-pkg \
//     target/wasm32-unknown-unknown/release/nest_import.wasm
//
// Usage (depuis la racine du repo) :
//   node workers/geometry/parity/determinism_lock.mjs

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import crypto from 'node:crypto';

const PARITY = dirname(fileURLToPath(import.meta.url));
const GEO = join(PARITY, '..');
const REPO = join(GEO, '..', '..');
const CLI = join(GEO, 'target', 'release',
  process.platform === 'win32' ? 'nest-import-cli.exe' : 'nest-import-cli');
const PKG = join(GEO, 'target', 'wasm-pkg');
const TOL = 0.01; // flattening démo (aligné parity/golden.py)

const CORPUS_DIRS = [
  join(REPO, 'workers', 'fileprocessing', 'tests', 'fixtures'),
  join(REPO, 'server', 'seed', 'demo'),
  join(PARITY, 'corpus_extra'),
];

if (!existsSync(CLI)) {
  console.error(`CLI natif manquant : ${CLI}\n→ cargo build --release (depuis workers/geometry/)`);
  process.exit(2);
}
if (!existsSync(join(PKG, 'nest_import_bg.wasm'))) {
  console.error(`pkg wasm manquant : ${PKG}\n→ voir les commandes de build en tête de ce script`);
  process.exit(2);
}

const mod = await import(pathToFileURL(join(PKG, 'nest_import.js')).href);
await mod.default({ module_or_path: readFileSync(join(PKG, 'nest_import_bg.wasm')) });

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const corpus = CORPUS_DIRS
  .filter((d) => existsSync(d))
  .flatMap((d) => readdirSync(d)
    .filter((n) => n.toLowerCase().endsWith('.dxf'))
    .map((n) => join(d, n)))
  .sort();

let divergent = 0;
for (const path of corpus) {
  // println! du CLI ajoute un '\n' final : artefact de transport, pas de géométrie.
  const nativeOut = execFileSync(CLI, [path, String(TOL)], { encoding: 'utf8', maxBuffer: 64 << 20 }).trimEnd();
  const wasmOut = mod.import_dxf(readFileSync(path), TOL);
  const hn = sha256(nativeOut);
  const hw = sha256(wasmOut);
  if (hn !== hw) {
    divergent++;
    console.log(`DIVERGENT ${path}\n  natif ${hn}\n  wasm  ${hw}`);
  }
}
console.log(`\n=== DÉTERMINISME nest-import : ${corpus.length - divergent}/${corpus.length} ` +
  `hash identiques (tolérance 0) ===`);
process.exit(divergent ? 1 : 0);
