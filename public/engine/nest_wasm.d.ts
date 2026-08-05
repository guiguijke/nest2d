/* tslint:disable */
/* eslint-disable */

/**
 * run_nesting(instance_json, params_json, seed) -> result_json
 *
 * - `instance_json`: jagua-rs external instance (SPP: name/items/strip_height;
 *   BPP: name/items/bins).
 * - `params_json`: EngineConfig fields (time_budget_sec, n_workers, biases, …).
 *   `prng_seed` may be omitted/zero — the `seed` argument wins.
 * - `seed`: master PRNG seed (explicit determinism contract).
 *
 * Returns `{ "problem": "spp"|"bpp", "sol_instance": …, "alternatives": […] }`.
 */
export function run_nesting(instance_json: string, params_json: string, seed: bigint): string;

/**
 * Current wasm linear-memory size, in 64 KiB pages (exact, unlike
 * performance.memory which excludes wasm memory) — the UI guardrail.
 */
export function wasm_memory_pages(): number;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly run_nesting: (a: number, b: number, c: number, d: number, e: bigint) => [number, number, number, number];
    readonly wasm_memory_pages: () => number;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __externref_table_alloc: () => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __externref_table_dealloc: (a: number) => void;
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
