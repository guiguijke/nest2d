import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
    runPool,
    cancelPool,
    deriveSeed,
    dirBiases,
    effectiveWalks,
    resolvePoolShape,
    championIdleMs,
} from '../composables/localPool'

// ---------------------------------------------------------------------------
// Mock Worker : enregistre les instances, capture postMessage, réponses
// scriptées (jamais de vrai wasm). Les réponses sont émises en microtask —
// comme la boucle de messages réelle — pour ne jamais régler un slot avant
// que le pool ait fini de spawner.
// ---------------------------------------------------------------------------
class MockWorker {
    constructor(url, opts) {
        this.url = url
        this.opts = opts
        this.messages = []
        this.terminated = false
        this.onmessage = null
        this.onerror = null
        MockWorker.instances.push(this)
    }

    postMessage(msg) {
        this.messages.push(msg)
        const respond = MockWorker.respond
        if (respond) queueMicrotask(() => respond(this, msg))
    }

    terminate() {
        this.terminated = true
    }

    emit(data) {
        this.onmessage?.({ data })
    }

    crash(message) {
        this.onerror?.({ message })
    }
}
MockWorker.instances = []
MockWorker.respond = null

function makePayload({ walks, browserWalks, seed = '42', biases = ['left', 'bottom', 'balanced'], spp = true } = {}) {
    const instance = spp
        ? { name: 't', strip_height: 1000, items: [{ id: 0, demand: 1 }] }
        : {
              name: 't',
              bins: [{ id: 0, shape: { data: { outer: [[0, 0], [1500, 0], [1500, 1000], [0, 1000], [0, 0]] } } }],
              items: [{ id: 0, demand: 1 }],
          }
    const engineConfig = { time_budget_sec: 13, prng_seed: seed, n_alternatives: 3 }
    if (spp) engineConfig.max_strip_width = 3000
    if (biases) engineConfig.biases = biases
    if (browserWalks != null) engineConfig.browser_walks = browserWalks
    const payload = { problem: spp ? 'spp' : 'bpp', instance, engineConfig, parts: [] }
    if (walks != null) payload.walks = walks
    return payload
}

/** Sortie moteur d'un walk : l'alternative porte un marqueur `seed` unique
 * par worker pour vérifier l'ordre de concaténation des runs. */
function engineOut(w, { spp = true } = {}) {
    return {
        problem: spp ? 'spp' : 'bpp',
        sol_instance: {},
        alternatives: [{
            rank: 0,
            seed: 1000 + w,
            bias: 'left',
            evaluations: 500 + w,
            strip_width: 900,
            density: 0.5,
            solution: { layout: { placed_items: [] } },
        }],
    }
}

/** Seed exacte du run d'un walk telle que le pool la réécrit (lossless
 * BigInt) : walk w = derive_seed(master, w), run interne mono-walk =
 * derive_seed(seed_w, 0). Les seeds exportées par le moteur (> 2^53) sont
 * manglées par JSON.parse — le pool les remplace par celles-ci. */
const runSeed = (w, master = '42') => deriveSeed(deriveSeed(master, w), 0).toString()

/** Répondeur standard : solve OK pour tous, merge = echo tronqué à
 * n_alternatives (le vrai rang est le fait du moteur, pas du test). */
function respondAllOk({ mergeCalls = [], failWorkers = new Map(), spp = true } = {}) {
    return (worker, msg) => {
        const w = MockWorker.instances.indexOf(worker)
        if (msg.op === 'merge') {
            mergeCalls.push({ worker: w, msg })
            worker.emit({
                id: msg.id,
                jobSlug: msg.jobSlug,
                ok: true,
                result: JSON.stringify({
                    problem: spp ? 'spp' : 'bpp',
                    alternatives: msg.merge.runs.slice(0, msg.merge.n_alternatives ?? msg.merge.runs.length),
                }),
            })
            return
        }
        const failure = failWorkers.get(w)
        if (failure === 'crash') {
            worker.crash('boom')
            return
        }
        if (failure) {
            worker.emit({ ok: false, jobSlug: msg.jobSlug, error: failure })
            return
        }
        worker.emit({ ok: true, jobSlug: msg.jobSlug, result: engineOut(w, { spp }), memory: { pagesBefore: 10, pagesAfter: 20 } })
    }
}

beforeEach(() => {
    MockWorker.instances = []
    MockWorker.respond = null
    vi.stubGlobal('Worker', MockWorker)
})

afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
})

// ---------------------------------------------------------------------------
// derive_seed
// ---------------------------------------------------------------------------

// VECTORS DE VÉRITÉ — confirmés le 2026-08-10 par DEUX dérivations
// indépendantes (scratch rustc de l'agent JS + test derive_seed_vectors de
// l'agent Rust, spp.rs::derive_seed) : toutes les valeurs partagées matchent.
const VECTORS = [
    ['0', 0, '0'],
    ['0', 1, '7070836379803831727'],
    ['0', 7, '3207296026000306913'],
    ['1', 0, '6238072747940578789'],
    ['2', 4, '4896119209696163428'],
    ['7', 3, '7392729709960833538'],
    ['42', 0, '2835554897195333154'],
    ['42', 1, '4456085495900499605'],
    ['42', 2, '2949826092126892291'],
    ['42', 3, '5139283748462763858'],
    ['42', 4, '6349198060258255764'],
    ['42', 7, '4028864712777624925'],
    ['4122680510047324256', 0, '3846230772388269003'],
    ['4122680510047324256', 7, '6885558543060858632'],
    ['9223372036854775807', 0, '6514504133438201533'],
    ['9223372036854775807', 7, '3255033911170563879'],
]

describe('deriveSeed (miroir BigInt de spp.rs::derive_seed)', () => {
    it('matche les vecteurs de vérité Rust', () => {
        for (const [master, worker, expected] of VECTORS) {
            expect(deriveSeed(master, worker).toString(), `master=${master} worker=${worker}`).toBe(expected)
        }
    })

    it('accepte string/number/bigint et reste masqué à 63 bits (Mongo Int64)', () => {
        const max = 9223372036854775807n
        for (let w = 0; w < 16; w++) {
            const s = deriveSeed('9223372036854775807', w)
            expect(s >= 0n && s <= max).toBe(true)
        }
        expect(deriveSeed(42n, 1)).toBe(deriveSeed('42', 1))
        expect(deriveSeed(42, 1)).toBe(deriveSeed('42', 1))
    })
})

// ---------------------------------------------------------------------------
// dirBiases (miroir de EngineConfig::dir_biases)
// ---------------------------------------------------------------------------

describe('dirBiases (ordre canonique left/bottom/balanced)', () => {
    it('réordonne canoniquement et ignore les inconnues', () => {
        expect(dirBiases(['balanced', 'left'])).toEqual(['left', 'balanced'])
        expect(dirBiases(['bottom'])).toEqual(['bottom'])
        expect(dirBiases(['nope'])).toEqual(['left', 'bottom', 'balanced'])
        expect(dirBiases([])).toEqual(['left', 'bottom', 'balanced'])
        expect(dirBiases(undefined)).toEqual(['left', 'bottom', 'balanced'])
    })
})

// ---------------------------------------------------------------------------
// effectiveWalks
// ---------------------------------------------------------------------------

describe('effectiveWalks (plafond mobile / mémoire)', () => {
    const desktop = { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126' }

    it('desktop sans contrainte : taille serveur inchangée', () => {
        expect(effectiveWalks(8, desktop)).toBe(8)
        expect(effectiveWalks(1, desktop)).toBe(1)
    })

    it('mobile (userAgentData) : plafonné à 2, jamais sous 1', () => {
        const nav = { userAgentData: { mobile: true }, userAgent: desktop.userAgent }
        expect(effectiveWalks(8, nav)).toBe(2)
        expect(effectiveWalks(4, nav)).toBe(2)
        expect(effectiveWalks(1, nav)).toBe(1)
    })

    it('mobile (fallback regex UA) : plafonné à 2', () => {
        const nav = { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari/604.1' }
        expect(effectiveWalks(4, nav)).toBe(2)
    })

    it('deviceMemory <= 4 Go : plafonné à 2 ; > 4 : inchangé', () => {
        expect(effectiveWalks(4, { ...desktop, deviceMemory: 4 })).toBe(2)
        expect(effectiveWalks(4, { ...desktop, deviceMemory: 8 })).toBe(4)
    })

    it('valeurs invalides → 1 ; sans navigator → taille serveur', () => {
        expect(effectiveWalks(undefined, desktop)).toBe(1)
        expect(effectiveWalks('x', desktop)).toBe(1)
        expect(effectiveWalks(-3, desktop)).toBe(1)
        expect(effectiveWalks(4, undefined)).toBe(4)
    })
})

// ---------------------------------------------------------------------------
// runPool — mono-walk (chemin historique)
// ---------------------------------------------------------------------------

describe('resolvePoolShape — concurrence ≠ nombre de walks', () => {
    it('ne reprend jamais walks comme concurrence (démo Free = 8 walks / 1 à la fois)', () => {
        expect(resolvePoolShape({ payload: { walks: 8, concurrency: 1 } })).toEqual({
            walks: 8,
            concurrency: 1,
        })
        expect(resolvePoolShape({ payload: { walks: 8, concurrency: 4 } }).concurrency).toBe(4)
        expect(resolvePoolShape({ payload: { walks: 8 } }).concurrency).toBe(8)
        expect(resolvePoolShape({ payload: { walks: 8, concurrency: 1 } }).concurrency).toBe(1)
        expect(resolvePoolShape({ localConfig: { walks: 8, concurrency: 4 } }).concurrency).toBe(4)
    })
})

describe('runPool walks=1 (chemin actuel tel quel)', () => {
    it('1 worker, seed = master telle quelle, résultat direct sans merge', async () => {
        const mergeCalls = []
        MockWorker.respond = respondAllOk({ mergeCalls })
        const payload = makePayload({ walks: 1, seed: '42' })
        const out = await runPool('job-1', payload)

        expect(MockWorker.instances).toHaveLength(1)
        expect(MockWorker.instances[0].url).toBe('/workers/engine.worker.js')
        expect(MockWorker.instances[0].opts).toEqual({ type: 'module' })
        const msg = MockWorker.instances[0].messages[0]
        expect(msg.seed).toBe('42') // master tel quel — pas de dérivation
        expect(msg.engineConfig.n_workers).toBe(1)
        expect(msg.engineConfig.separator_workers).toBe(1)
        expect(msg.live).toBe(false)
        expect(mergeCalls).toHaveLength(0)
        expect(out.ok).toBe(true)
        expect(out.result.problem).toBe('spp')
        expect(out.result.alternatives).toHaveLength(1)
        expect(out.memory).toEqual({ pagesBefore: 10, pagesAfter: 20 })
    })

    it('défaut sans walks nulle part : 1 worker', async () => {
        MockWorker.respond = respondAllOk()
        const payload = makePayload()
        delete payload.walks
        const out = await runPool('job-1b', payload)
        expect(MockWorker.instances).toHaveLength(1)
        expect(out.ok).toBe(true)
    })
})

// ---------------------------------------------------------------------------
// runPool — multi-walks
// ---------------------------------------------------------------------------

describe('runPool walks=4 (pool + merge moteur)', () => {
    it('4 workers, seeds dérivées (vecteurs Rust), biases en singleton, merge ordonné', async () => {
        const mergeCalls = []
        MockWorker.respond = respondAllOk({ mergeCalls })
        const payload = makePayload({ walks: 4, seed: '42' })
        const out = await runPool('job-4', payload)

        expect(MockWorker.instances).toHaveLength(4)
        // Seeds = vecteurs derive_seed(master=42, w) de la table Rust.
        const seeds = MockWorker.instances.map((w) => w.messages[0].seed)
        expect(seeds).toEqual([
            '2835554897195333154',
            '4456085495900499605',
            '2949826092126892291',
            '5139283748462763858',
        ])
        // Mono-walk forcé + classe du walk en singleton (rotation canonique).
        for (let w = 0; w < 4; w++) {
            const cfg = MockWorker.instances[w].messages[0].engineConfig
            expect(cfg.n_workers).toBe(1)
            expect(cfg.separator_workers).toBe(1)
        }
        expect(MockWorker.instances.map((w) => w.messages[0].engineConfig.biases)).toEqual([
            ['left'], ['bottom'], ['balanced'], ['left'],
        ])
        // Index du walk transmis au worker (traçabilité).
        expect(MockWorker.instances.map((w) => w.messages[0].worker)).toEqual([0, 1, 2, 3])

        // Merge : appelé une fois, sur le worker 0, runs concaténés dans
        // l'ordre des workers (seed réécrite lossless = runSeed(w)),
        // n_alternatives et biases d'origine propagés.
        expect(mergeCalls).toHaveLength(1)
        expect(mergeCalls[0].worker).toBe(0)
        const merge = mergeCalls[0].msg.merge
        expect(merge.runs.map((r) => r.seed)).toEqual([0, 1, 2, 3].map((w) => runSeed(w)))
        expect(merge.n_alternatives).toBe(3)
        expect(merge.biases).toEqual(['left', 'bottom', 'balanced'])
        expect(merge.problem).toBe('spp')
        expect(merge.instance).toBe(payload.instance)
        // J-093 : prng_seed string 63 bits → placeholder 0 dans le merge
        // (le parse moteur exige u64 ; la seed ne sert qu'aux walks).
        expect(merge.engineConfig).toEqual({ ...payload.engineConfig, prng_seed: 0 })

        expect(out.ok).toBe(true)
        expect(out.result.problem).toBe('spp')
        expect(out.result.alternatives.map((a) => a.seed)).toEqual([0, 1, 2].map((w) => runSeed(w))) // echo tronqué à 3
        // Workers terminés après règlement.
        expect(MockWorker.instances.every((w) => w.terminated)).toBe(true)
    })

    it('chaque frame live est re-taguée avec l’index du worker physique', async () => {
        MockWorker.respond = (worker, msg) => {
            if (msg.op === 'merge') {
                worker.emit({ id: msg.id, ok: true, result: JSON.stringify({ alternatives: [] }) })
                return
            }
            const w = MockWorker.instances.indexOf(worker)
            if (w === 2) {
                // Le moteur interne mono-walk émet toujours worker:0.
                worker.emit({ jobSlug: msg.jobSlug, live: { type: 'layout', worker: 0, feasible: true, items: [] } })
            }
            worker.emit({ ok: true, jobSlug: msg.jobSlug, result: engineOut(w), memory: { pagesBefore: 1, pagesAfter: 2 } })
        }
        const seen = []
        const out = await runPool('job-live', makePayload({ walks: 4 }), { onLive: (evt) => seen.push(evt) })
        expect(out.ok).toBe(true)
        expect(seen).toHaveLength(1)
        expect(seen[0].worker).toBe(2)
        expect(seen[0].isSpp).toBe(true)
        expect(seen[0].sheets).toEqual([[3000, 1000]])
        // live:true propagé aux workers quand onLive est fourni.
        expect(MockWorker.instances.every((w) => w.messages[0].live === true)).toBe(true)
    })

    it('BPP sans biases : singletons canoniques synthétisés ; SPP sans biases : clé absente', async () => {
        MockWorker.respond = respondAllOk({ spp: false })
        const out = await runPool('job-bpp', makePayload({ walks: 3, biases: null, spp: false }))
        expect(out.ok).toBe(true)
        expect(MockWorker.instances.map((w) => w.messages[0].engineConfig.biases)).toEqual([
            ['left'], ['bottom'], ['balanced'],
        ])

        MockWorker.instances = []
        MockWorker.respond = respondAllOk()
        const out2 = await runPool('job-spp-nobias', makePayload({ walks: 2, biases: null }))
        expect(out2.ok).toBe(true)
        for (const w of MockWorker.instances) {
            expect('biases' in w.messages[0].engineConfig).toBe(false)
        }
    })

    it('résolution de walks : option > engineConfig.browser_walks > payload.walks', async () => {
        MockWorker.respond = respondAllOk()
        await runPool('job-w1', makePayload({ walks: 4, browserWalks: 3 }), { walks: 2 })
        expect(MockWorker.instances).toHaveLength(2)

        MockWorker.instances = []
        await runPool('job-w2', makePayload({ walks: 4, browserWalks: 3 }))
        expect(MockWorker.instances).toHaveLength(3)

        MockWorker.instances = []
        await runPool('job-w3', makePayload({ walks: 4 }))
        expect(MockWorker.instances).toHaveLength(4)
    })

    it('concurrency=1 joue N walks l’un après l’autre (même recherche, plus lent)', async () => {
        const liveAtFirst = []
        MockWorker.respond = (worker, msg) => {
            if (msg.op === 'merge') {
                queueMicrotask(() => worker.emit({
                    id: msg.id,
                    ok: true,
                    result: JSON.stringify({ alternatives: (msg.merge?.runs || []).map((r, i) => ({ ...r, rank: i })) }),
                }))
                return
            }
            liveAtFirst.push(MockWorker.instances.filter((w) => !w.terminated).length)
            queueMicrotask(() => worker.emit({ ok: true, result: engineOut(msg.worker) }))
        }
        const out = await runPool('job-seq', makePayload({ walks: 3 }), { walks: 3, concurrency: 1 })
        expect(out.ok).toBe(true)
        expect(liveAtFirst[0]).toBe(1)
        expect(MockWorker.instances).toHaveLength(3)
    })
})

// ---------------------------------------------------------------------------
// Échecs
// ---------------------------------------------------------------------------

describe('runPool — politique d’échec (le walk perdu ne vide pas le job)', () => {
    it('1 crash sur 3 : merge sur les survivants, dans l’ordre des workers', async () => {
        const mergeCalls = []
        MockWorker.respond = respondAllOk({ mergeCalls, failWorkers: new Map([[1, 'crash']]) })
        const out = await runPool('job-partial', makePayload({ walks: 3 }))
        expect(out.ok).toBe(true)
        expect(mergeCalls).toHaveLength(1)
        expect(mergeCalls[0].worker).toBe(0) // worker 0 vivant → cible du merge
        expect(mergeCalls[0].msg.merge.runs.map((r) => r.seed)).toEqual([0, 2].map((w) => runSeed(w)))
    })

    it('worker 0 en échec : le merge bascule sur le premier survivant', async () => {
        const mergeCalls = []
        MockWorker.respond = respondAllOk({ mergeCalls, failWorkers: new Map([[0, 'engine boom']]) })
        const out = await runPool('job-partial0', makePayload({ walks: 3 }))
        expect(out.ok).toBe(true)
        expect(mergeCalls[0].worker).toBe(1)
        expect(mergeCalls[0].msg.merge.runs.map((r) => r.seed)).toEqual([1, 2].map((w) => runSeed(w)))
    })

    it('échec total : ok:false avec le premier message d’erreur', async () => {
        MockWorker.respond = respondAllOk({ failWorkers: new Map([[0, 'e0'], [1, 'e1'], [2, 'e2']]) })
        const out = await runPool('job-allfail', makePayload({ walks: 3 }))
        expect(out.ok).toBe(false)
        expect(out.error).toBe('e0')
    })

    it('échec total avec un memory_cap : error memory_cap (refund appelant)', async () => {
        MockWorker.respond = respondAllOk({ failWorkers: new Map([[0, 'e0'], [1, 'memory_cap']]) })
        const out = await runPool('job-cap', makePayload({ walks: 2 }))
        expect(out.ok).toBe(false)
        expect(out.error).toBe('memory_cap')
    })

    it('memory_cap sur UN walk seulement : merge sur les survivants (pas de refund)', async () => {
        const mergeCalls = []
        MockWorker.respond = respondAllOk({ mergeCalls, failWorkers: new Map([[2, 'memory_cap']]) })
        const out = await runPool('job-cap-partial', makePayload({ walks: 3 }))
        expect(out.ok).toBe(true)
        expect(mergeCalls[0].msg.merge.runs.map((r) => r.seed)).toEqual([0, 1].map((w) => runSeed(w)))
    })

    it('merge indisponible (bundle wasm antérieur) : échec propre côté appelant', async () => {
        MockWorker.respond = (worker, msg) => {
            if (msg.op === 'merge') {
                worker.emit({ id: msg.id, ok: false, error: 'merge_alternatives_unavailable' })
                return
            }
            const w = MockWorker.instances.indexOf(worker)
            worker.emit({ ok: true, jobSlug: msg.jobSlug, result: engineOut(w) })
        }
        const out = await runPool('job-nomerge', makePayload({ walks: 2 }))
        expect(out.ok).toBe(false)
        expect(out.error).toBe('merge_alternatives_unavailable')
    })

    it('spawn impossible (Worker jette) : tous les slots échouent proprement', async () => {
        class ThrowingWorker {
            constructor() {
                throw new Error('no workers')
            }
        }
        vi.stubGlobal('Worker', ThrowingWorker)
        const out = await runPool('job-nospawn', makePayload({ walks: 2 }))
        expect(out.ok).toBe(false)
        expect(out.error).toBe('no workers')
    })
})

// ---------------------------------------------------------------------------
// Annulation
// ---------------------------------------------------------------------------

describe('championIdleMs (fenêtre d’arrêt ~ f(n))', () => {
    it('plancher 2 s sur un petit job ; +20 ms/pièce ; plafond = patience', () => {
        expect(championIdleMs(0)).toBe(2000)
        expect(championIdleMs(1)).toBe(2020)
        expect(championIdleMs(20)).toBe(2400)
        expect(championIdleMs(100)).toBe(4000)
        expect(championIdleMs(500)).toBe(12_000)
        expect(championIdleMs(500, 8000)).toBe(8000)
        expect(championIdleMs(2000, 30_000)).toBe(30_000)
    })

    it('l’écart live observé relève le plancher (fréquence réelle)', () => {
        expect(championIdleMs(20, 30_000, 8000)).toBe(16_000)
        expect(championIdleMs(500, 10_000, 8000)).toBe(10_000)
        expect(championIdleMs(20, 30_000, 100)).toBe(2400)
    })

    it('valeurs invalides → 2 s', () => {
        expect(championIdleMs(undefined)).toBe(2000)
        expect(championIdleMs(-4)).toBe(2000)
        expect(championIdleMs('x', 'nope')).toBe(2000)
    })
})

describe('runPool — arrêt champion après idle qui suit n', () => {
    it('un layout faisable complet à n=1 s’arrête ~2 s après la dernière amélioration', async () => {
        vi.useFakeTimers()
        MockWorker.respond = null
        const payload = makePayload({ walks: 1 })
        payload.instance.items = [{ id: 0, demand: 1 }]
        const promise = runPool('job-idle-small', payload, { onLive: () => {} })
        MockWorker.instances[0].emit({
            live: {
                feasible: true,
                strip_width: 400,
                density: 0.5,
                bias: 'left',
                items: [[0, 0, 0, 10, 10]],
            },
        })
        let settled = false
        promise.then(() => { settled = true })
        await vi.advanceTimersByTimeAsync(1990)
        expect(settled).toBe(false)
        await vi.advanceTimersByTimeAsync(50)
        const out = await promise
        expect(out.ok).toBe(true)
        expect(out.result.alternatives[0].strip_width).toBe(400)
        vi.useRealTimers()
    })

    it('à n=500, 2 s ne suffisent pas : la fenêtre suit le nombre de pièces', async () => {
        vi.useFakeTimers()
        MockWorker.respond = null
        const payload = makePayload({ walks: 1 })
        payload.instance.items = [{ id: 0, demand: 500 }]
        payload.engineConfig.plateau_patience_sec = 20
        const promise = runPool('job-idle-big', payload, { onLive: () => {} })
        MockWorker.instances[0].emit({
            live: {
                feasible: true,
                strip_width: 900,
                density: 0.7,
                bias: 'left',
                items: Array.from({ length: 500 }, (_, i) => [i, 0, 0, 0, 0]),
            },
        })
        let settled = false
        promise.then(() => { settled = true })
        await vi.advanceTimersByTimeAsync(2000)
        expect(settled).toBe(false)
        await vi.advanceTimersByTimeAsync(9990)
        expect(settled).toBe(false)
        await vi.advanceTimersByTimeAsync(20)
        const out = await promise
        expect(out.ok).toBe(true)
        expect(out.result.alternatives[0].strip_width).toBe(900)
        vi.useRealTimers()
    })
})

describe('runPool — settle idle champion = mono-classe seulement', () => {
    it('2 classes (left+bottom) : pas de settle idle, 2 alternatives via le merge', async () => {
        vi.useFakeTimers()
        MockWorker.respond = null // les walks « tournent » tant qu'on ne les règle pas
        const payload = makePayload({ walks: 2, biases: ['left', 'bottom'] })
        payload.instance.items = [{ id: 0, demand: 500 }]
        const promise = runPool('job-multibias', payload, { onLive: () => {} })
        expect(MockWorker.instances).toHaveLength(2)
        // Classes bien distribuées : walk 0 = left, walk 1 = bottom.
        expect(MockWorker.instances.map((w) => w.messages[0].engineConfig.biases)).toEqual([
            ['left'], ['bottom'],
        ])
        // Une frame live faisable par classe. La frame 'bottom' porte une
        // HAUTEUR (solve transposé) > largeur 'left' : liveBetter ne la
        // retient pas — avant le fix, le chrono armé par la frame 'left'
        // tuait le pool pendant que le walk 'bottom' tournait.
        const items = Array.from({ length: 500 }, (_, i) => [i, 0, 0, 0, 0])
        MockWorker.instances[0].emit({
            live: { feasible: true, strip_width: 900, density: 0.7, bias: 'left', items },
        })
        MockWorker.instances[1].emit({
            live: { feasible: true, strip_width: 1500, density: 0.7, bias: 'bottom', items },
        })
        let settled = false
        promise.then(() => { settled = true })
        // Très au-delà du chrono idle (3 s pour n=500, patience 3 s).
        await vi.advanceTimersByTimeAsync(60_000)
        expect(settled).toBe(false)

        // Complétion naturelle des deux walks, puis merge qui groupe par
        // classe : une alternative 'left' + une 'bottom'.
        MockWorker.respond = (worker, msg) => {
            if (msg.op === 'merge') {
                worker.emit({
                    id: msg.id,
                    ok: true,
                    result: JSON.stringify({ problem: 'spp', alternatives: msg.merge.runs }),
                })
            }
        }
        const alt = (w, bias) => ({
            rank: 0,
            seed: 1000 + w,
            bias,
            evaluations: 500,
            strip_width: 800 - w * 100, // rang 0 du merge bat le champion live
            density: 0.6,
            solution: { layout: { placed_items: [] } },
        })
        MockWorker.instances[0].emit({ ok: true, jobSlug: 'job-multibias', result: { alternatives: [alt(0, 'left')] } })
        MockWorker.instances[1].emit({ ok: true, jobSlug: 'job-multibias', result: { alternatives: [alt(1, 'bottom')] } })
        const out = await promise
        expect(out.ok).toBe(true)
        expect(out.result.alternatives.map((a) => a.bias)).toEqual(['left', 'bottom'])
        vi.useRealTimers()
    })

    it('1 classe sur 2 walks (non-régression) : settle idle inchangé', async () => {
        vi.useFakeTimers()
        MockWorker.respond = null
        const payload = makePayload({ walks: 2, biases: ['left'] })
        payload.instance.items = [{ id: 0, demand: 500 }]
        const promise = runPool('job-monobias', payload, { onLive: () => {} })
        expect(MockWorker.instances).toHaveLength(2)
        MockWorker.instances[0].emit({
            live: {
                feasible: true,
                strip_width: 900,
                density: 0.7,
                bias: 'left',
                items: Array.from({ length: 500 }, (_, i) => [i, 0, 0, 0, 0]),
            },
        })
        let settled = false
        promise.then(() => { settled = true })
        // n=500, patience 3 s → fenêtre plafonnée à 3 s : pas encore settle.
        await vi.advanceTimersByTimeAsync(2900)
        expect(settled).toBe(false)
        await vi.advanceTimersByTimeAsync(200)
        const out = await promise
        expect(out.ok).toBe(true)
        expect(out.result.alternatives).toHaveLength(1)
        expect(out.result.alternatives[0].strip_width).toBe(900)
        expect(MockWorker.instances.every((w) => w.terminated)).toBe(true)
        vi.useRealTimers()
    })
})

describe('cancelPool', () => {
    it('termine tous les workers et settle cancelled (sans refund local)', async () => {
        MockWorker.respond = null // aucun worker ne répond : job en vol
        const promise = runPool('job-cancel', makePayload({ walks: 4 }))
        expect(MockWorker.instances).toHaveLength(4)

        expect(cancelPool('job-cancel')).toBe(true)
        const out = await promise
        expect(out).toEqual({ ok: false, error: 'cancelled' })
        expect(MockWorker.instances.every((w) => w.terminated)).toBe(true)
        // Deuxième appel : plus de pool en vol.
        expect(cancelPool('job-cancel')).toBe(false)
    })

    it('les messages tardifs après annulation sont ignorés', async () => {
        MockWorker.respond = null
        const promise = runPool('job-cancel-late', makePayload({ walks: 2 }))
        cancelPool('job-cancel-late')
        // Un message déjà en vol ne doit pas re-settle ni lever d’erreur.
        MockWorker.instances[0].emit({ ok: true, jobSlug: 'job-cancel-late', result: engineOut(0) })
        MockWorker.instances[1].emit({ jobSlug: 'job-cancel-late', live: { type: 'layout', items: [] } })
        const out = await promise
        expect(out).toEqual({ ok: false, error: 'cancelled' })
    })

    it('slug inconnu : no-op, false', () => {
        expect(cancelPool('nope')).toBe(false)
    })
})
