// Verrou de déterminisme natif ↔ wasm32 (jumeau géométrie du
// bench/determinism_lock.py du moteur, AGENTS #14b).
//
// 1) nest-import : pour chaque fichier du corpus (DXF + SVG, détection par
//    signature), hash SHA-256 du JSON du CLI natif == hash du JSON wasm.
// 2) nest-preprocess : pour chaque part à trous du corpus, open_holes natif
//    (nest-channels-cli) == open_holes wasm, comparaison profonde des
//    anneaux (JSON sérialisé identique).
//
// Toute divergence = écart de libm/arrondi entre cibles → exit 1.
// À rejouer après tout changement des crates.
//
// Prérequis (depuis workers/geometry/) :
//   cargo build --release                                    # CLI natifs
//   cargo build --release -p nest-import -p nest-preprocess \
//     --target wasm32-unknown-unknown --features wasm,svg
//   wasm-bindgen --target web --out-dir target/wasm-pkg \
//     target/wasm32-unknown-unknown/release/nest_import.wasm
//   wasm-bindgen --target web --out-dir target/wasm-pkg-pp \
//     target/wasm32-unknown-unknown/release/nest_preprocess.wasm
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
const CHAN_CLI = join(GEO, 'target', 'release',
  process.platform === 'win32' ? 'nest-channels-cli.exe' : 'nest-channels-cli');
const PKG = join(GEO, 'target', 'wasm-pkg');
const PKG_PP = join(GEO, 'target', 'wasm-pkg-pp');
const TOL = 0.01; // flattening démo (aligné parity/golden.py)
const SPACE = 2.0; // espacement job démo (J-036)

const CORPUS_DIRS = [
  join(REPO, 'workers', 'fileprocessing', 'tests', 'fixtures'),
  join(REPO, 'server', 'seed', 'demo'),
  join(PARITY, 'corpus_extra'),
  join(PARITY, 'corpus_svg'),
];

if (!existsSync(CLI) || !existsSync(CHAN_CLI)) {
  console.error('CLI natif manquant → cargo build --release (depuis workers/geometry/)');
  process.exit(2);
}
if (!existsSync(join(PKG, 'nest_import_bg.wasm'))) {
  console.error(`pkg wasm manquant : ${PKG}\n→ voir les commandes de build en tête de ce script`);
  process.exit(2);
}

const mod = await import(pathToFileURL(join(PKG, 'nest_import.js')).href);
await mod.default({ module_or_path: readFileSync(join(PKG, 'nest_import_bg.wasm')) });
let pmod = null;
if (existsSync(join(PKG_PP, 'nest_preprocess_bg.wasm'))) {
  pmod = await import(pathToFileURL(join(PKG_PP, 'nest_preprocess.js')).href);
  await pmod.default({ module_or_path: readFileSync(join(PKG_PP, 'nest_preprocess_bg.wasm')) });
}

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const corpus = CORPUS_DIRS
  .filter((d) => existsSync(d))
  .flatMap((d) => readdirSync(d)
    .filter((n) => ['.dxf', '.svg'].includes(n.toLowerCase().slice(n.lastIndexOf('.'))))
    .map((n) => join(d, n)))
  .sort();

let divergent = 0;
let channelCases = 0;
let channelDivergent = 0;
for (const path of corpus) {
  // println! du CLI ajoute un '\n' final : artefact de transport, pas de géométrie.
  let nativeOut;
  try {
    nativeOut = execFileSync(CLI, [path, String(TOL)], { encoding: 'utf8', maxBuffer: 64 << 20 }).trimEnd();
  } catch (e) {
    // Error-parity : le natif a échoué proprement — le wasm doit échouer aussi.
    let wasmErr = null;
    try {
      mod.import_file(readFileSync(path), TOL);
    } catch (we) {
      wasmErr = we;
    }
    if (wasmErr === null) {
      divergent++;
      console.log(`DIVERGENT (error) ${path}: natif KO, wasm OK`);
    }
    continue;
  }
  const wasmOut = mod.import_file(readFileSync(path), TOL);
  const hn = sha256(nativeOut);
  const hw = sha256(wasmOut);
  if (hn !== hw) {
    divergent++;
    console.log(`DIVERGENT ${path}\n  natif ${hn}\n  wasm  ${hw}`);
    continue;
  }
  // nest-preprocess : open_holes natif vs wasm sur les parts à trous.
  if (!pmod) continue;
  const inputsJson = execFileSync(CHAN_CLI, [path, String(SPACE), 'inputs'],
    { encoding: 'utf8', maxBuffer: 64 << 20 }).trimEnd();
  const inputs = JSON.parse(inputsJson);
  if (!inputs.length) continue;
  const nativeRings = JSON.parse(
    execFileSync(CHAN_CLI, [path, String(SPACE), 'difference'],
      { encoding: 'utf8', maxBuffer: 64 << 20 }).trimEnd()).rings;
  inputs.forEach((input, i) => {
    channelCases++;
    const wasmRes = JSON.parse(pmod.open_holes(JSON.stringify(input)));
    if (JSON.stringify(wasmRes.ring) !== JSON.stringify(nativeRings[i])) {
      channelDivergent++;
      console.log(`DIVERGENT open_holes ${path}#${i}`);
    }
  });
}
console.log(`\n=== DÉTERMINISME nest-import : ${corpus.length - divergent}/${corpus.length} ` +
  `hash identiques (tolérance 0) ===`);
if (pmod) {
  console.log(`=== DÉTERMINISME nest-preprocess : ${channelCases - channelDivergent}/${channelCases} ` +
    `open_holes identiques (tolérance 0) ===`);
}
process.exit(divergent + channelDivergent ? 1 : 0);
