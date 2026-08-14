/**
 * J-093 — Pool de Web Workers moteur pour le solve navigateur multi-walks.
 *
 * Le serveur impose N (« walks ») par tier (Free 1 / Unlimited 4 / Pro 8) —
 * JAMAIS navigator.hardwareConcurrency : même job + même taille de pool ⇒
 * même résultat ; un appareil plus lent est juste plus lent, pas différent.
 * Chaque walk tourne dans SON worker neuf (1 instance wasm par worker,
 * ~36 Mo, aucun SharedArrayBuffer — workers terminables à l'annulation) ;
 * la fusion des alternatives est déléguée au moteur wasm lui-même (export
 * `merge_alternatives`, op 'merge' du worker) — AUCUNE logique de rang
 * n'est réimplémentée en JS.
 *
 * Contrats (figés avec l'agent Rust) :
 * - `deriveSeed(master, w)` = miroir BigInt EXACT de spp.rs::derive_seed.
 * - walks === 1 → UN worker, seed = master tel quel, résultat direct sans
 *   appel merge (comportement de l'ancien runInWorker mono-walk).
 * - Échec partiel (crash / error / memory_cap d'un ou plusieurs walks) : le
 *   walk perdu ne vide pas le job — si ≥ 1 worker a réussi, le merge porte
 *   sur les survivants ; si TOUS échouent → { ok:false } avec error
 *   'memory_cap' si l'un des échecs est un memory_cap (le refund côté
 *   appelant se keyedessus), sinon le premier message d'erreur.
 * - Annulation : `cancelPool(jobSlug)` termine tous les workers du job et
 *   settle { ok:false, error:'cancelled' }. L'appelant ne refunde PAS sur
 *   'cancelled' : le serveur a déjà finalisé le job + refundé le quota via
 *   POST /api/results/:slug/cancel, qui précède toujours cancelPool côté UI
 *   (voir UserResultItem.vue — « JAMAIS de local-fail ensuite »).
 *
 * Biais directionnels (preuve : workers/nesting/engine) : en mono-walk
 * (n_workers = 1, imposé à chaque worker du pool), le moteur exécute le
 * seul walk w = 0 et prend donc TOUJOURS dir_biases()[0] — spp.rs:327
 * `biases[w % biases.len()]` et bpp/mod.rs:103 idem. Le pool doit donc
 * imposer la classe du walk w via un singleton `biases: [classe]` :
 * - biases explicites dans engineConfig → singleton [dirBiases(biases)[w]]
 *   (miroir canonique de EngineConfig::dir_biases, ordre left/bottom/
 *   balanced, inconnues ignorées, vide → ALL) ;
 * - BPP sans biases → le moteur défaut à ALL en interne (bpp/mod.rs:100) :
 *   on synthétise le singleton [ALL[w % 3]] (strictement équivalent) ;
 * - SPP sans biases → flow legacy (spp.rs:305 exige biases.is_some()) :
 *   biases reste ABSENT, chaque walk ne diffère que par sa seed — comme le
 *   multi-start in-engine optimize_multi.
 */

// ---------------------------------------------------------------------------
// derive_seed — miroir BigInt EXACT de spp.rs (splitmix64-style, wrapping
// 64 bits, masqué à 63 bits pour le round-trip Mongo Int64). La seed master
// arrive en STRING (BSON Int64 sérialisé, piège #16).
// ---------------------------------------------------------------------------
const MASK64 = (1n << 64n) - 1n
const GOLDEN = 0x9e3779b97f4a7c15n
const MIX1 = 0xbf58476d1ce4e5b9n
const MIX2 = 0x94d049bb133111ebn
const MASK63 = 0x7fffffffffffffffn

/**
 * @param {string|number|bigint} master graine maîtresse (63 bits, string)
 * @param {number} worker index du walk (0..n-1)
 * @returns {bigint} graine dérivée, ≤ i64::MAX
 */
export function deriveSeed(master, worker) {
    let z = (BigInt(master) + BigInt(worker) * GOLDEN) & MASK64
    z = ((z ^ (z >> 30n)) * MIX1) & MASK64
    z = ((z ^ (z >> 27n)) * MIX2) & MASK64
    return (z ^ (z >> 31n)) & MASK63
}

// ---------------------------------------------------------------------------
// Biais directionnels — ordre canonique du moteur (DirBias::ALL,
// constructive.rs:84). Miroir de EngineConfig::dir_biases (config.rs:137) :
// inconnues ignorées, liste vide/absente → les trois classes.
// ---------------------------------------------------------------------------
const DIR_BIAS_ORDER = ['left', 'bottom', 'balanced']

/** @param {string[]|undefined|null} biases @returns {string[]} classes canoniques actives */
export function dirBiases(biases) {
    const active = (Array.isArray(biases) ? biases : []).filter((b) => DIR_BIAS_ORDER.includes(b))
    if (!active.length) return DIR_BIAS_ORDER.slice()
    return DIR_BIAS_ORDER.filter((b) => active.includes(b))
}

// ---------------------------------------------------------------------------
// Taille effective du pool.
// ---------------------------------------------------------------------------
const MOBILE_UA = /Mobi|Android|iPhone|iPad|iPod/i

/**
 * Mobile ou peu de RAM → pool plafonné à 2 walks. Détection simple et
 * documentée : `navigator.userAgentData.mobile` quand il existe, sinon
 * fallback regex UA ; `navigator.deviceMemory ≤ 4` (Go, Chrome-only)
 * plafonne aussi. J-093 : le déterminisme se relit à taille de pool égale —
 * même job + même pool effectif ⇒ même résultat ; un appareil contraint
 * joue simplement un pool plus petit, la taille reste une donnée serveur.
 * @param {number|string} walks taille serveur
 * @param {object} [nav] navigator (injectable pour les tests)
 */
export function effectiveWalks(walks, nav = globalThis.navigator) {
    const n = Math.max(1, Math.trunc(Number(walks) || 0) || 1)
    const mobile = nav?.userAgentData?.mobile === true || MOBILE_UA.test(nav?.userAgent || '')
    const lowMem = typeof nav?.deviceMemory === 'number' && nav.deviceMemory <= 4
    return mobile || lowMem ? Math.min(n, 2) : n
}

// ---------------------------------------------------------------------------
// Pool.
// ---------------------------------------------------------------------------

/** Pools en vol, par jobSlug — requis par cancelPool. */
const pools = new Map()

/** Miroir de localCompute.liveSheets (gardé en sync) : cadre des frames
 * live — SPP = bande unique, BPP = bboxes des bins. */
function liveSheets(payload) {
    const instance = payload?.instance || {}
    if (Array.isArray(instance.bins) && instance.bins.length) {
        return instance.bins.map((b) => {
            let w = 0
            let h = 0
            for (const [x, y] of b?.shape?.data?.outer || []) {
                w = Math.max(w, x)
                h = Math.max(h, y)
            }
            return [w, h]
        })
    }
    return [[
        Number(payload?.engineConfig?.max_strip_width) || 0,
        Number(instance.strip_height) || 0,
    ]]
}

/** Config moteur d'UN walk : mono-walk forcé (#14c) + classe directionnelle
 * du walk w en singleton (voir l'en-tête — le mono-walk interne prend
 * toujours biases[0]). */
function workerEngineConfig(payload, w, isSpp) {
    const base = payload?.engineConfig || {}
    const cfg = { ...base, n_workers: 1, separator_workers: 1 }
    if (Array.isArray(base.biases) && base.biases.length) {
        const active = dirBiases(base.biases)
        cfg.biases = [active[w % active.length]]
    } else if (!isSpp) {
        cfg.biases = [DIR_BIAS_ORDER[w % DIR_BIAS_ORDER.length]]
    }
    return cfg
}

/** Mémoire agrégée du pool : le pic d'un worker (pages wasm 64 Ko). */
function poolMemory(pool) {
    let best = null
    for (const slot of pool.slots) {
        const m = slot.outcome?.memory
        if (m && (m.pagesAfter ?? 0) > (best?.pagesAfter ?? 0)) best = m
    }
    return best || undefined
}

/**
 * Lance le solve sur un pool de `walks` workers moteur.
 * @param {string} jobSlug
 * @param {object} payload localPayload actuel ({ problem, instance, meta,
 *   engineConfig, parts, outputUnit, addOutShape }) — inchangé.
 * @param {object} [opts]
 * @param {(evt: object) => void} [opts.onLive] frames live (re-taguées
 *   `worker` = index du worker physique, + sheets/isSpp comme runInWorker).
 * @param {number} [opts.walks] taille du pool — sinon
 *   `payload.engineConfig.browser_walks ?? payload.walks ?? 1`.
 * @returns {Promise<{ ok: boolean, result?: object, error?: string, memory?: object }>}
 *   result = { problem, alternatives, ... } (forme attendue par
 *   runLocalJobPrivate ; en multi-walks, alternatives = sortie du merge
 *   moteur, jamais un rang JS).
 */
export function runPool(jobSlug, payload, { onLive, walks, concurrency } = {}) {
    const requested = walks ?? payload?.engineConfig?.browser_walks ?? payload?.walks ?? 1
    const n = Math.max(1, Math.trunc(Number(requested) || 1))
    const rawConc = concurrency
        ?? payload?.engineConfig?.browser_concurrency
        ?? payload?.concurrency
        ?? n
    // Mobile / low-RAM: cap how many run at once, NEVER how many we search
    // (D-PAY-12 — same quality, just slower).
    const conc = Math.min(n, effectiveWalks(rawConc))
    const masterSeed = String(payload?.engineConfig?.prng_seed ?? '0')
    const isSpp = !Array.isArray(payload?.instance?.bins)

    return new Promise((resolve) => {
        const pool = {
            slots: [],
            settled: false,
            nextWalk: 0,
            conc,
            onLive: onLive || null,
            sheets: liveSheets(payload),
            isSpp,
            settle(outcome) {
                if (pool.settled) return
                pool.settled = true
                for (const slot of pool.slots) {
                    try {
                        slot.worker?.terminate()
                    } catch {
                        // déjà mort — sans conséquence
                    }
                }
                pools.delete(jobSlug)
                resolve(outcome)
            },
        }
        pools.set(jobSlug, pool)

        for (let w = 0; w < n; w++) {
            pool.slots.push({ w, worker: null, outcome: null, mergeId: null, evals: 0, evalsBanked: 0 })
        }
        pumpQueue(jobSlug, pool, payload, masterSeed)
        // Tous les spawns ont pu échouer synchronement.
        checkAllSettled(jobSlug, pool, payload)
    })
}

function pumpQueue(jobSlug, pool, payload, masterSeed) {
    if (pool.settled) return
    const n = pool.slots.length
    const running = pool.slots.filter((s) => s.worker && !s.outcome).length
    let room = pool.conc - running
    while (room > 0 && pool.nextWalk < n) {
        const w = pool.nextWalk++
        startWalk(jobSlug, pool, payload, masterSeed, w)
        room -= 1
    }
}

function startWalk(jobSlug, pool, payload, masterSeed, w) {
    const slot = pool.slots[w]
    const n = pool.slots.length
    try {
        slot.worker = new Worker('/workers/engine.worker.js', { type: 'module' })
    } catch (err) {
        slot.outcome = { ok: false, error: String(err?.message || err) }
        return
    }
    slot.worker.onmessage = (event) => onWorkerMessage(jobSlug, pool, slot, event, payload, masterSeed)
    slot.worker.onerror = (event) => {
        failSlot(jobSlug, pool, slot, payload, event?.message || 'worker error', masterSeed)
    }
    slot.worker.postMessage({
        jobSlug,
        instance: payload.instance,
        engineConfig: workerEngineConfig(payload, w, pool.isSpp),
        seed: n === 1 ? masterSeed : deriveSeed(masterSeed, w).toString(),
        live: Boolean(pool.onLive),
        worker: w,
    })
}

/**
 * Termine tous les workers du job et settle { ok:false, error:'cancelled' }.
 * Appelé APRÈS POST /api/results/:slug/cancel (le serveur finalise et
 * refunde) — l'appelant ne doit JAMAIS poster local-fail sur 'cancelled'.
 * @returns {boolean} true si un pool en vol a été annulé.
 */
export function cancelPool(jobSlug) {
    const pool = pools.get(jobSlug)
    if (!pool || pool.settled) return false
    pool.settle({ ok: false, error: 'cancelled' })
    return true
}

// ---------------------------------------------------------------------------
// Internes.
// ---------------------------------------------------------------------------

function onWorkerMessage(jobSlug, pool, slot, event, payload, masterSeed) {
    if (pool.settled) return
    const data = event.data || {}
    // Frame live intermédiaire : re-taguée avec l'index du worker PHYSIQUE
    // (le moteur interne mono-walk émet toujours worker:0) — le champion
    // lock de LiveNestingView gère N workers comme le flux SSE serveur.
    if (data.live) {
        pool.onLive?.({ ...data.live, worker: slot.w, sheets: pool.sheets, isSpp: pool.isSpp })
        return
    }
    // Compteur live de combinaisons (SPP 'evals', BPP 'heartbeat.iterations'
    // — normalisé en amont par engine.worker.js). Le compteur d'une
    // instance wasm repart à zéro à chaque nouvelle phase du solve : on
    // banque le dernier total dès qu'un walk recule (miroir du pipeline
    // Python, piège #10), puis on somme tous les walks du pool.
    if (data.evals) {
        const n = Number(data.evals.n) || 0
        if (n < slot.evals) slot.evalsBanked += slot.evals
        slot.evals = n
        const total = pool.slots.reduce((acc, s) => acc + s.evals + s.evalsBanked, 0)
        pool.onLive?.({ type: 'evals', evals: total, walks: pool.conc })
        return
    }
    // Réponse à l'op 'merge' (opération adressée par id, protocole worker).
    if (data.id && data.id === slot.mergeId) {
        if (!data.ok) {
            // Échec propre côté appelant — notamment
            // 'merge_alternatives_unavailable' si le bundle wasm publié est
            // antérieur à J-093. Le quota est refundé par l'appelant.
            pool.settle({ ok: false, error: data.error || 'merge_failed', memory: poolMemory(pool) })
            return
        }
        let merged
        try {
            merged = JSON.parse(data.result)
            // J-093 : JSON.parse mangle les seeds 63 bits (> 2^53) — on les
            // réécrit depuis la string brute du merge (ordre des
            // alternatives ; seeds émises en nombre ou en string selon le
            // chemin moteur — les deux formes sont reprises).
            const rawSeeds = [...data.result.matchAll(/"seed"\s*:\s*"?(\d+)"?/g)].map((m) => m[1])
            if (Array.isArray(merged?.alternatives)) {
                merged.alternatives.forEach((alt, i) => {
                    if (rawSeeds[i] != null) alt.seed = rawSeeds[i]
                })
            }
        } catch {
            pool.settle({ ok: false, error: 'merge_parse', memory: poolMemory(pool) })
            return
        }
        pool.settle({
            ok: true,
            result: {
                ...merged,
                problem: merged.problem ?? payload?.problem ?? slot.outcome?.result?.problem,
                alternatives: Array.isArray(merged.alternatives) ? merged.alternatives : [],
            },
            memory: poolMemory(pool),
        })
        return
    }
    // Règlement du solve de ce walk : { ok, result|error, memory }.
    slot.outcome = data
    if (!data.ok) {
        try {
            slot.worker?.terminate()
        } catch {
            // déjà mort
        }
    }
    pumpQueue(jobSlug, pool, payload, masterSeed ?? String(payload?.engineConfig?.prng_seed ?? '0'))
    checkAllSettled(jobSlug, pool, payload)
}

function failSlot(jobSlug, pool, slot, payload, message, masterSeed) {
    if (pool.settled) return
    if (!slot.outcome) slot.outcome = { ok: false, error: String(message || 'worker error') }
    try {
        slot.worker?.terminate()
    } catch {
        // déjà mort
    }
    pumpQueue(jobSlug, pool, payload, masterSeed ?? String(payload?.engineConfig?.prng_seed ?? '0'))
    checkAllSettled(jobSlug, pool, payload)
}

function checkAllSettled(jobSlug, pool, payload) {
    if (pool.settled) return
    if (pool.slots.some((s) => !s.outcome)) return
    const n = pool.slots.length

    // Mono-walk : résultat direct, jamais de merge (chemin historique).
    if (n === 1) {
        const out = pool.slots[0].outcome
        pool.settle(out.ok
            ? { ok: true, result: out.result, memory: out.memory }
            : { ok: false, error: out.error || 'engine error', memory: out.memory })
        return
    }

    const survivors = pool.slots.filter((s) => s.outcome.ok)
    if (!survivors.length) {
        // Tous les walks ont échoué : memory_cap l'emporte (le refund côté
        // appelant se keyedessus), sinon premier message d'erreur.
        const anyCap = pool.slots.some((s) => s.outcome.error === 'memory_cap')
        const first = pool.slots.find((s) => s.outcome.error)?.outcome.error
        pool.settle({ ok: false, error: anyCap ? 'memory_cap' : String(first || 'pool_failed'), memory: poolMemory(pool) })
        return
    }

    // Échec partiel : le walk perdu ne vide pas le job — le merge porte sur
    // les survivants. runs = concaténation des alternatives par index de
    // worker (ordre stable), chaque alternative porte déjà seed / bias /
    // evaluations|iterations / solution (export moteur).
    const masterSeed = String(payload?.engineConfig?.prng_seed ?? '0')
    const runs = []
    for (const slot of pool.slots) {
        if (!slot.outcome.ok) continue
        // J-093 : le seed 63 bits d'une alternative est MANGLÉ par le
        // JSON.parse du worker (> 2^53) — on le réécrit depuis la dérivation
        // BigInt exacte : le walk w tourne avec seed_w = derive_seed(master,
        // w), son run interne mono-walk avec derive_seed(seed_w, 0). Sans ça
        // les tie-breaks du merge et le replay dérivent silencieusement.
        const walkSeed = pool.slots.length === 1 ? BigInt(masterSeed) : deriveSeed(masterSeed, slot.w)
        const runSeed = deriveSeed(walkSeed, 0).toString()
        for (const alt of slot.outcome.result?.alternatives || []) {
            runs.push({ ...alt, seed: runSeed })
        }
    }
    // Le merge s'exécute sur le worker 0 quand il a réussi (contrat), sinon
    // sur le premier survivant — un worker crashé est terminé, inutilisable.
    const target = survivors[0]
    const mergeId = `merge:${jobSlug}`
    target.mergeId = mergeId
    target.worker.postMessage({
        id: mergeId,
        jobSlug,
        op: 'merge',
        merge: {
            problem: payload?.problem ?? target.outcome.result?.problem,
            instance: payload?.instance,
            // J-093 : prng_seed arrive en STRING (63 bits, piège #16) mais le
            // parse EngineConfig du merge exige un u64 — et le passer en
            // number le mangle. Le merge ne cherche pas (la seed ne sert
            // qu'aux walks, déjà joués) : placeholder 0 documenté.
            engineConfig: { ...payload?.engineConfig, prng_seed: 0 },
            runs,
            biases: payload?.engineConfig?.biases || [],
            n_alternatives: payload?.engineConfig?.n_alternatives,
        },
    })
}
