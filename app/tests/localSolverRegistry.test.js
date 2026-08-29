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
})
