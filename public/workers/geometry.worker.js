/**
 * PR4 (flag-gated QA): runs the geometry WASM bundle OFF the main thread.
 * Une seule instantiation, réutilisée (même pattern que engine.worker.js).
 * Protocol (JSON): in {id, op, ...args} -> out {id, ok, result|error}.
 * ops: import_file (bytes as Array — DXF ou SVG, détection par signature) ;
 * open_holes / export_svg_sheet / compute_report (json string) ;
 * export_dxf_sheet (slugs + sources:Array[] + json).
 * J-090 : + canonical_dxf (bytes as Array -> bytes canoniques mm, renvoyés
 * en Array) et pinwheel_capacity (json string) — l'import 100 % client.
 */
import init, {
    import_file, open_holes, export_svg_sheet, compute_report,
    export_dxf_sheet,
    canonical_dxf, pinwheel_capacity,
} from '/geometry/nest_geometry.js'

let ready = null

self.onmessage = async (event) => {
    const { id, op, ...args } = event.data || {}
    try {
        ready = ready || init()
        await ready
        let result
        switch (op) {
            case 'import_file':
                result = import_file(new Uint8Array(args.bytes), args.tol ?? 0.01)
                break
            case 'open_holes':
                result = open_holes(args.json)
                break
            case 'export_svg_sheet':
                result = export_svg_sheet(args.json)
                break
            case 'compute_report':
                result = compute_report(args.json)
                break
            case 'export_dxf_sheet':
                // slugs: string[] ; sources: bytes[][] (une entrée par slug)
                result = export_dxf_sheet(
                    args.slugs,
                    (args.sources || []).map((b) => new Uint8Array(b)),
                    args.json,
                )
                break
            case 'canonical_dxf':
                // Bytes source (DXF/SVG) -> bytes DXF canoniques mm (renvoyés
                // en Array simple : le structured clone d'Uint8Array passe,
                // mais l'Array uniformise avec les autres ops bytes).
                result = Array.from(canonical_dxf(new Uint8Array(args.bytes), args.tol ?? 0.01))
                break
            case 'pinwheel_capacity':
                result = pinwheel_capacity(args.json)
                break
            default:
                throw new Error(`unknown op ${op}`)
        }
        self.postMessage({ id, ok: true, result })
    } catch (err) {
        self.postMessage({ id, ok: false, error: String(err && err.message ? err.message : err) })
    }
}
