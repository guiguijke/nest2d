/* tslint:disable */
/* eslint-disable */

/**
 * merge_alternatives(json) -> result_json (J-093 — pool de Web Workers).
 *
 * Fusionne des runs mono-walk DÉJÀ EXPORTÉS (un champion par worker du pool
 * navigateur) en alternatives, avec la sémantique EXACTE du multi-start
 * serveur : champions par classe directionnelle active (ordre canonique
 * left/bottom/balanced), repli qualité, dédup fingerprint, cap
 * n_alternatives, ranks ré-assignés. Entrée JSON :
 *
 * ```json
 * {
 *   "problem": "spp" | "bpp",
 *   "instance": { "...instance externe (comme run_nesting)..." },
 *   "engineConfig": { "...config moteur complète ou partielle..." },
 *   "runs": [ { "seed": 12345, "bias": "left", "evaluations": 12,
 *               "iterations": 34, "used_height": 40.0,
 *               "cost_detail": {"unplaced":0,"bin_cost":2,"remnant":0.4,"falkenauer":0.8},
 *               "solution": { "...solution externe du walk..." } } ],
 *   "biases": ["left"],
 *   "n_alternatives": 3
 * }
 * ```
 *
 * `seed` accepte number ou string (BigInt). Pour la parité exacte serveur,
 * reprendre par pass-through les champs additifs exportés par chaque walk
 * (`used_height` SPP, `cost_detail` BPP) — replis documentés sinon (voir
 * nest_engine::merge). Retour : la forme exacte de run_nesting
 * `{ "problem", "sol_instance", "alternatives" }`.
 */
export function merge_alternatives(json: string): string;

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
 * run_nesting_live(instance_json, params_json, seed, on_event) — idem
 * run_nesting mais chaque événement moteur (progress/layout/evals, déjà
 * throttlés côté Rust à ~2 Hz) est transmis SYNCHRONE à `on_event(line)`
 * (J-084, vue live navigateur). Force `live_events` : sans snapshots le
 * streaming n'a aucun intérêt. Le solve reste bloquant et déterministe —
 * la callback n'influence jamais la recherche.
 */
export function run_nesting_live(instance_json: string, params_json: string, seed: bigint, on_event: Function): string;

/**
 * Current wasm linear-memory size, in 64 KiB pages (exact, unlike
 * performance.memory which excludes wasm memory) — the UI guardrail.
 */
export function wasm_memory_pages(): number;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly merge_alternatives: (a: number, b: number) => [number, number, number, number];
    readonly run_nesting: (a: number, b: number, c: number, d: number, e: bigint) => [number, number, number, number];
    readonly run_nesting_live: (a: number, b: number, c: number, d: number, e: bigint, f: any) => [number, number, number, number];
    readonly wasm_memory_pages: () => number;
    readonly __wbindgen_exn_store: (a: number) => void;
    readonly __externref_table_alloc: () => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
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
