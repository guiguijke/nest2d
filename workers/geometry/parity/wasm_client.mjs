// Côté "navigateur" du diff client/serveur (PR4) : charge le bundle WASM
// géométrie servi depuis public/geometry/ et produit les mêmes artefacts
// que le chemin serveur, pour comparaison par exports_check / diff.
//
// Usage : node parity/wasm_client.mjs <mode>  (lit un JSON spec sur stdin)
//   modes : import | colored | report | dxf_sheet
import { readFileSync } from 'node:fs'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { join, dirname } from 'node:path'

const PARITY = dirname(fileURLToPath(import.meta.url))
const GEO = join(PARITY, '..', '..', '..', 'public', 'geometry')
const mod = await import(pathToFileURL(join(GEO, 'nest_geometry.js')).href)
await mod.default({ module_or_path: readFileSync(join(GEO, 'nest_geometry_bg.wasm')) })

const mode = process.argv[2]
const spec = JSON.parse(readFileSync(0, 'utf8'))

if (mode === 'import') {
  const bytes = new Uint8Array(readFileSync(spec.path))
  process.stdout.write(mod.import_file(bytes, spec.tol ?? 0.01))
} else if (mode === 'colored') {
  process.stdout.write(mod.export_svg_sheet(JSON.stringify(spec)))
} else if (mode === 'report') {
  process.stdout.write(mod.compute_report(JSON.stringify(spec)))
} else if (mode === 'dxf_sheet') {
  // J-082 : tôle combinée multi-sources (jumeau navigateur de build_part).
  // spec : { sources: {slug: cheminFichier}, transforms, bin_width, … }
  const slugs = Object.keys(spec.sources)
  const sources = slugs.map((s) => new Uint8Array(readFileSync(spec.sources[s])))
  const { sources: _paths, ...jsonSpec } = spec
  process.stdout.write(mod.export_dxf_sheet(slugs, sources, JSON.stringify(jsonSpec)))
} else {
  console.error('mode inconnu ' + mode)
  process.exit(2)
}
