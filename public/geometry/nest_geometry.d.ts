/* tslint:disable */
/* eslint-disable */

/**
 * compute_report(json {items, containers, space}) -> rapport JSON.
 */
export function compute_report(json: string): string;

/**
 * export_dxf(dxf_bytes_source, json {transforms, space, add_out_shape,
 * bin_width, bin_height, output_unit}) -> DXF texte (une source).
 */
export function export_dxf(source: Uint8Array, json: string): string;

/**
 * export_svg_sheet(json spec) -> SVG coloré de la tôle.
 */
export function export_svg_sheet(json: string): string;

/**
 * import_file(bytes, tol) -> JSON ImportResult (détection par signature).
 */
export function import_file(bytes: Uint8Array, tol: number): string;

/**
 * import_svg(bytes, tol) -> JSON ImportResult.
 */
export function import_svg(bytes: Uint8Array, tol: number): string;

/**
 * open_holes(json {outer, holes, space_mm}) -> JSON {ring, channels_opened}.
 */
export function open_holes(json: string): string;

/**
 * Pages mémoire wasm courantes (garde-fou du worker géométrie) — même
 * sémantique que nest_wasm::wasm_memory_pages (memory_size, exact).
 */
export function wasm_memory_pages(): number;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly compute_report: (a: number, b: number) => [number, number, number, number];
    readonly export_dxf: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly export_svg_sheet: (a: number, b: number) => [number, number, number, number];
    readonly import_file: (a: number, b: number, c: number) => [number, number, number, number];
    readonly import_svg: (a: number, b: number, c: number) => [number, number, number, number];
    readonly open_holes: (a: number, b: number) => [number, number, number, number];
    readonly wasm_memory_pages: () => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
