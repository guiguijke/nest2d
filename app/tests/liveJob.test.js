import { describe, expect, it } from 'vitest'
import {
    belongsToProject,
    pickAwaitingLocal,
    pickLiveJob,
    pickRunningJob,
    frameFitsSheet,
    frameIsBetter,
} from '../utils/liveJob'

const aLive = { slug: 'jA', projectSlug: 'pA', status: 'awaiting_local', isInProgress: true, liveLayout: { stage: 'x' } }
const bIdle = { slug: 'jB', projectSlug: 'pB', status: 'done', isInProgress: false, liveLayout: null }
const untagged = { slug: 'jOld', status: 'awaiting_local', isInProgress: true, liveLayout: { stage: 'y' } }

describe('liveJob — isolation by projectSlug', () => {
    it('refuses untagged items (stale SSE list during A→B navigation)', () => {
        expect(belongsToProject(untagged, 'pA')).toBe(false)
        expect(belongsToProject(untagged, 'pB')).toBe(false)
        expect(belongsToProject(aLive, 'pA')).toBe(true)
        expect(belongsToProject(aLive, 'pB')).toBe(false)
    })

    it('page B does not pick project A live / awaiting / running', () => {
        const list = [aLive, bIdle, untagged]
        expect(pickAwaitingLocal(list, 'pB')).toBe(null)
        expect(pickLiveJob(list, 'pB')).toBe(null)
        expect(pickRunningJob(list, 'pB')).toBe(null)
        expect(pickAwaitingLocal(list, 'pA')).toBe(aLive)
        expect(pickLiveJob(list, 'pA')).toBe(aLive)
        expect(pickRunningJob(list, 'pA')).toBe(aLive)
    })
})

// ---------------------------------------------------------------------------
// Champion live partagé (R-6 audit 2026-08-31) — le filtre du registre de
// solves et le champion-lock de LiveNestingView consomment LA MÊME
// définition. L'ancien filtre registre comparait strip_width en égalité
// stricte : la fenêtre de corridor phase 2 et le remnant BPP étaient
// invisibles en amont de la vue.
// ---------------------------------------------------------------------------

const spp = (over = {}) => ({
    feasible: true, isSpp: true, sheets: [[3000, 1000]],
    strip_width: 900, used_height: 1900, density: 0.5, items: [[0, 0, 0, 1, 1]],
    ...over,
})
const bpp = (over = {}) => ({
    feasible: true, isSpp: false, bins: 3, remnant: 500,
    used_height: 900, density: 0.5, items: [[0, 0, 0, 1, 1]],
    ...over,
})

describe('frameFitsSheet — présentabilité (bande qui tient dans la tôle)', () => {
    it('hors-tôle = non présentable, même faisable moteur', () => {
        expect(frameFitsSheet(spp({ strip_width: 3100 }))).toBe(false)
        expect(frameFitsSheet(spp({ strip_width: 3000.4 }))).toBe(true)
        expect(frameFitsSheet(spp({ feasible: false }))).toBe(false)
        expect(frameFitsSheet({ feasible: true })).toBe(true) // pas de sheets → tolérant
    })
})

describe('frameIsBetter — ordre de qualité du champion', () => {
    it('SPP fenêtre phase 2 : champion + 1 mm avec hauteur plus basse détrône (verrou R-6)', () => {
        expect(frameIsBetter(spp({ strip_width: 901, used_height: 1500 }), spp())).toBe(true)
    })

    it('SPP fenêtre : hauteurs égales → l\'incumbent reste (stabilité)', () => {
        expect(frameIsBetter(spp({ strip_width: 901 }), spp())).toBe(false)
    })

    it('SPP hors fenêtre (champion + 50 mm) : jamais détrôné', () => {
        expect(frameIsBetter(spp({ strip_width: 950, used_height: 800 }), spp())).toBe(false)
    })

    it('plus étroit gagne hors fenêtre, SPP comme BPP', () => {
        expect(frameIsBetter(spp({ strip_width: 800 }), spp())).toBe(true)
        expect(frameIsBetter(bpp({ bins: 2 }), bpp())).toBe(true)
    })

    it('BPP : à tôles égales le remnant fait le progrès du plateau (verrou R-6)', () => {
        expect(frameIsBetter(bpp({ remnant: 400 }), bpp())).toBe(true)
        expect(frameIsBetter(bpp({ remnant: 600 }), bpp())).toBe(false)
    })

    it('égalité parfaite : BPP accepte la frame fraîche, SPP garde l\'incumbent', () => {
        expect(frameIsBetter(bpp(), bpp())).toBe(true)
        expect(frameIsBetter(spp(), spp())).toBe(false)
    })

    it('hors-tôle jamais champion contre une frame qui tient', () => {
        expect(frameIsBetter(spp({ strip_width: 3100 }), spp())).toBe(false)
        expect(frameIsBetter(spp(), spp({ strip_width: 3100 }))).toBe(true)
    })
})
