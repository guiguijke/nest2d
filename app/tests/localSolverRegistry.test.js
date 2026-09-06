import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Le registre est un singleton module-level : réimport forcé par test pour
// isoler l'état (vi.resetModules + import dynamique).
async function freshRegistry(run, cancel) {
    vi.resetModules()
    const mod = await import('../composables/localSolverRegistry')
    mod.configureSolver({
        run: run || (async () => ({ ok: true })),
        cancel: cancel || (async () => {}),
    })
    return mod
}

const job = (slug, itemMap = []) => ({ slug, itemMap })

describe('localSolverRegistry — navigation isolée, file tier, idempotence', () => {
    beforeEach(() => { vi.resetModules() })
    afterEach(() => { vi.restoreAllMocks() })

    it('ensureJob est idempotent : re-navigation/refresh ne relance PAS', async () => {
        let runs = 0
        const mod = await freshRegistry(async () => { runs += 1; await new Promise(r => setTimeout(r, 20)); return { ok: true } })
        mod.ensureJob(job('j1'), { projectSlug: 'p1', maxConcurrent: 1 })
        mod.ensureJob(job('j1'), { projectSlug: 'p1', maxConcurrent: 1 })
        mod.ensureJob(job('j1'), { projectSlug: 'p1', maxConcurrent: 1 })
        await new Promise(r => setTimeout(r, 60))
        expect(runs).toBe(1)
    })

    it('cap 1 : le 2e projet attend en file, démarre à la fin du 1er', async () => {
        const started = []
        let release
        const gate = new Promise(r => { release = r })
        const mod = await freshRegistry(async (slug) => {
            started.push(slug)
            if (slug === 'j1') await gate
            return { ok: true }
        })
        mod.ensureJob(job('j1'), { projectSlug: 'p1', maxConcurrent: 1 })
        mod.ensureJob(job('j2'), { projectSlug: 'p2', maxConcurrent: 1 })
        await new Promise(r => setTimeout(r, 10))
        expect(started).toEqual(['j1']) // j2 en file
        expect(mod.progressFor('p2').phase).toBe('queued')
        release()
        await new Promise(r => setTimeout(r, 20))
        expect(started).toEqual(['j1', 'j2']) // démarre après
    })

    it('cap 3 (Pro) : deux projets tournent en parallèle', async () => {
        const started = []
        let release
        const gate = new Promise(r => { release = r })
        const mod = await freshRegistry(async (slug) => { started.push(slug); await gate; return { ok: true } })
        mod.ensureJob(job('j1'), { projectSlug: 'p1', maxConcurrent: 3 })
        mod.ensureJob(job('j2'), { projectSlug: 'p2', maxConcurrent: 3 })
        await new Promise(r => setTimeout(r, 10))
        expect(started.sort()).toEqual(['j1', 'j2'])
        release()
        await new Promise(r => setTimeout(r, 20))
    })

    it('cancelJob retire le job de la file et marque cancelled', async () => {
        let release
        const gate = new Promise(r => { release = r })
        const cancelled = []
        const mod = await freshRegistry(
            async () => { await gate; return { ok: true } },
            async (slug) => { cancelled.push(slug) },
        )
        mod.ensureJob(job('j1'), { projectSlug: 'p1', maxConcurrent: 1 })
        mod.ensureJob(job('j2'), { projectSlug: 'p2', maxConcurrent: 1 })
        await mod.cancelJob('j2')
        expect(cancelled).toEqual(['j2'])
        release()
        await new Promise(r => setTimeout(r, 20))
        expect(mod.progressFor('p2').phase).toBe('cancelled')
    })

    it('la progression vit dans le registre (frame, zone) — survit à la page', async () => {
        const mod = await freshRegistry(async (slug, { onLive }) => {
            onLive({ type: 'evals', evals: 42 })
            onLive({ type: 'zone', zone: 'B', attempt: 2, attempts: 3 })
            onLive({ feasible: true, items: [], walks: 4 })
            return { ok: true, liveLayout: { stage: 'final' }, itemMap: [] }
        })
        mod.ensureJob(job('j1', [{ id: 0 }]), { projectSlug: 'p1', maxConcurrent: 1 })
        await new Promise(r => setTimeout(r, 20))
        const p = mod.progressFor('p1')
        expect(p.phase).toBe('done')
        expect(p.evals).toBe(42)
        expect(p.zone.zone).toBe('B')
        expect(p.walks).toBe(4)
        expect(p.itemMap).toEqual([{ id: 0 }])
        expect(p.result.liveLayout.stage).toBe('final')
    })

    it('onLive garde la meilleure frame, pas la dernière (pire −X)', async () => {
        const mod = await freshRegistry(async (_slug, { onLive }) => {
            onLive({ feasible: true, strip_width: 700, density: 0.8, items: [1] })
            onLive({ feasible: true, strip_width: 900, density: 0.5, items: [1] })
            return { ok: true }
        })
        mod.ensureJob(job('j1'), { projectSlug: 'pA', maxConcurrent: 1 })
        await new Promise((r) => setTimeout(r, 30))
        expect(mod.progressFor('pA').frame.strip_width).toBe(700)
    })

    it('re-subscribe depuis un autre projet ne vole pas le projectSlug', async () => {
        let release
        const gate = new Promise((r) => { release = r })
        const mod = await freshRegistry(async () => { await gate; return { ok: true } })
        mod.ensureJob(job('j1'), { projectSlug: 'pA', maxConcurrent: 1 })
        await new Promise((r) => setTimeout(r, 10))
        expect(mod.progressFor('pA').phase).toBe('running')
        expect(mod.hasActiveJob('pA')).toBe(true)
        expect(mod.hasActiveJob('pB')).toBe(false)
        mod.ensureJob(job('j1'), { projectSlug: 'pB', maxConcurrent: 1 })
        expect(mod.progressFor('pA').phase).toBe('running')
        expect(mod.progressFor('pB')).toBe(null)
        expect(mod.hasActiveJob('pA')).toBe(true)
        expect(mod.hasActiveJob('pB')).toBe(false)
        expect(mod.activeJobs().map((j) => j.projectSlug)).toEqual(['pA'])
        release()
        await new Promise((r) => setTimeout(r, 20))
    })

    it('un job annulé en file ne démarre jamais', async () => {
        const started = []
        let release
        const gate = new Promise(r => { release = r })
        const mod = await freshRegistry(async (slug) => { started.push(slug); if (slug === 'j1') await gate; return { ok: true } })
        mod.ensureJob(job('j1'), { projectSlug: 'p1', maxConcurrent: 1 })
        mod.ensureJob(job('j2'), { projectSlug: 'p2', maxConcurrent: 1 })
        await mod.cancelJob('j2')
        release()
        await new Promise(r => setTimeout(r, 20))
        expect(started).toEqual(['j1'])
    })

    it('re-file d\'un job en ERREUR : phase remise à queued, un seul run en plus (verrou R-5)', async () => {
        let runs = 0
        const mod = await freshRegistry(async () => {
            runs += 1
            return runs === 1 ? { ok: false, error: 'payload_timeout' } : { ok: true }
        })
        mod.ensureJob(job('j1'), { projectSlug: 'p1', maxConcurrent: 1 })
        await new Promise(r => setTimeout(r, 20))
        expect(mod.progressFor('p1').phase).toBe('error')
        // Double re-file (re-navigation pendant qu'un autre job tient le
        // slot) : l'entrée doit repasser queued UNE fois — pas deux entrées
        // en file → pas de double run du même slug.
        mod.ensureJob(job('j1'), { projectSlug: 'p1', maxConcurrent: 1 })
        mod.ensureJob(job('j1'), { projectSlug: 'p1', maxConcurrent: 1 })
        await new Promise(r => setTimeout(r, 30))
        expect(runs).toBe(2)
        expect(mod.progressFor('p1').phase).toBe('done')
    })

    it('champion registre : fenêtre phase 2 SPP (+1 mm, hauteur plus basse) remplace (verrou R-6)', async () => {
        const frames = [
            { feasible: true, isSpp: true, sheets: [[3000, 1000]], strip_width: 700, used_height: 1900, items: [1] },
            { feasible: true, isSpp: true, sheets: [[3000, 1000]], strip_width: 701, used_height: 1500, items: [1] },
        ]
        const mod = await freshRegistry(async (_slug, { onLive }) => {
            frames.forEach((f) => onLive(f))
            return { ok: true }
        })
        mod.ensureJob(job('j1'), { projectSlug: 'pA', maxConcurrent: 1 })
        await new Promise((r) => setTimeout(r, 30))
        // L'ancien comparateur (égalité stricte sur strip_width) rejetait la
        // frame phase 2 et la vue live restait figée sur le layout phase 1.
        expect(mod.progressFor('pA').frame.used_height).toBe(1500)
    })

    it('champion registre : BPP à l\'égalité parfaite, la frame fraîche remplace (verrou R-6)', async () => {
        const mk = (i) => ({ feasible: true, isSpp: false, bins: 2, remnant: 400, items: [i] })
        const seen = []
        const mod = await freshRegistry(async (_slug, { onLive }) => {
            onLive(mk(1)); onLive(mk(2)); seen.push('sent')
            return { ok: true }
        })
        mod.ensureJob(job('j1'), { projectSlug: 'pA', maxConcurrent: 1 })
        await new Promise((r) => setTimeout(r, 30))
        expect(mod.progressFor('pA').frame.items).toEqual([2])
    })

    // C31 (lot 3) : la frame stage 'final' (alternative rang 0 post-pass)
    // est LA conclusion — elle remplace le champion même si une frame
    // moteur brute semble mieux classée (bins moindre ici).
    it('champion registre : stage final remplace toujours (verrou C31)', async () => {
        const champ = { feasible: true, isSpp: false, bins: 1, remnant: 900, items: [1] }
        const final = { stage: 'final', feasible: true, isSpp: false, bins: 2, remnant: null, items: [1, 2] }
        const mod = await freshRegistry(async (_slug, { onLive }) => {
            onLive(champ)
            onLive(final)
            return { ok: true }
        })
        mod.ensureJob(job('j1'), { projectSlug: 'pA', maxConcurrent: 1 })
        await new Promise((r) => setTimeout(r, 30))
        expect(mod.progressFor('pA').frame.stage).toBe('final')
        expect(mod.progressFor('pA').frame.items).toEqual([1, 2])
    })
})
