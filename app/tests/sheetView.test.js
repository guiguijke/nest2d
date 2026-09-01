import { describe, expect, it } from 'vitest'
import {
    axisLabelPos,
    displayDirectionArrow,
    engineToDisplay,
    isSheetPortrait,
    livePaneLayout,
    sheetAxesDisplay,
    sheetDisplaySize,
    sheetLandscapeTransform,
} from '../utils/sheetView'

describe('sheetView landscape display', () => {
    it('landscape stock (W≥H) keeps engine axes: origin BL, +X right, +Y up', () => {
        expect(isSheetPortrait(3000, 1500)).toBe(false)
        expect(sheetDisplaySize(3000, 1500)).toEqual({ viewW: 3000, viewH: 1500 })
        expect(sheetLandscapeTransform(3000, 1500)).toBe('')
        expect(engineToDisplay(0, 0, 3000, 1500)).toEqual([0, 1500])
        expect(engineToDisplay(3000, 0, 3000, 1500)).toEqual([3000, 1500])
        expect(engineToDisplay(0, 1500, 3000, 1500)).toEqual([0, 0])
        const ax = sheetAxesDisplay(3000, 1500)
        expect(ax.origin.x).toBeGreaterThan(0)
        expect(ax.origin.y).toBeLessThan(1500)
        expect(ax.origin.y).toBeGreaterThan(1400)
        expect(ax.xTo.x).toBeGreaterThan(ax.origin.x)
        expect(ax.yTo.y).toBeLessThan(ax.origin.y)
    })

    it('portrait stock (1500×3000) displays landscape: +Y along the long screen axis', () => {
        expect(isSheetPortrait(1500, 3000)).toBe(true)
        expect(sheetDisplaySize(1500, 3000)).toEqual({ viewW: 3000, viewH: 1500 })
        expect(sheetLandscapeTransform(1500, 3000)).toBe('translate(3000 0) rotate(90)')
        // Engine origin → display top-left; +X down; +Y right.
        expect(engineToDisplay(0, 0, 1500, 3000)).toEqual([0, 0])
        expect(engineToDisplay(1500, 0, 1500, 3000)).toEqual([0, 1500])
        expect(engineToDisplay(0, 3000, 1500, 3000)).toEqual([3000, 0])
        const ax = sheetAxesDisplay(1500, 3000)
        expect(ax.origin.x).toBeGreaterThan(0)
        expect(ax.origin.y).toBeGreaterThan(0)
        expect(ax.origin.x).toBeLessThan(80)
        expect(ax.xTo.y).toBeGreaterThan(ax.origin.y)
        expect(ax.yTo.x).toBeGreaterThan(ax.origin.x)
    })

    it('direction arrows follow the displayed axes, not the screen edges', () => {
        expect(displayDirectionArrow('left', 3000, 1500)).toBe('←')
        expect(displayDirectionArrow('bottom', 3000, 1500)).toBe('↓')
        expect(displayDirectionArrow('balanced', 3000, 1500)).toBe('↙')
        // 1500×3000 shown landscape: +X down, +Y right → –X up, –Y left.
        expect(displayDirectionArrow('left', 1500, 3000)).toBe('↑')
        expect(displayDirectionArrow('bottom', 1500, 3000)).toBe('←')
        expect(displayDirectionArrow('balanced', 1500, 3000)).toBe('↖')
    })

    it('axis labels stay inside the displayed sheet', () => {
        const ax = sheetAxesDisplay(1500, 3000)
        const x = axisLabelPos(ax.origin, ax.xTo, ax.viewW, ax.viewH, 40)
        const y = axisLabelPos(ax.origin, ax.yTo, ax.viewW, ax.viewH, 40)
        for (const p of [x, y]) {
            expect(p.x).toBeGreaterThan(0)
            expect(p.y).toBeGreaterThan(0)
            expect(p.x).toBeLessThan(ax.viewW)
            expect(p.y).toBeLessThan(ax.viewH)
        }
    })
})

describe('livePaneLayout — vue live BPP, une tôle par panneau', () => {
    // Constat 2026-09-01 : le rendu live ignorait l'index de tôle des
    // items BPP et superposait toutes les tôles sur un seul contour.
    it('SPP / bins absents : un seul panneau ancré à l\'origine (rendu inchangé)', () => {
        const pl = livePaneLayout([[1000, 2000]], [])
        expect(pl.panes).toHaveLength(1)
        expect(pl.panes[0]).toMatchObject({ bin: 0, dx: 0, w: 1000, h: 2000 })
        // 1000×2000 portrait → affichage paysage 2000 de large.
        expect(pl.panes[0].viewW).toBe(2000)
        expect(pl.panes[0].landscape).toBe('translate(2000 0) rotate(90)')
        expect(pl.totalW).toBe(2000)
        expect(pl.truncated).toBe(0)
    })

    it('deux tôles : panneaux côte à côte, décalés de viewW + gap', () => {
        const pl = livePaneLayout([[1000, 1000]], [0, 1])
        expect(pl.panes.map((p) => p.bin)).toEqual([0, 1])
        expect(pl.panes[0].dx).toBe(0)
        expect(pl.gap).toBeCloseTo(1000 * 0.05, 6)
        expect(pl.panes[1].dx).toBeCloseTo(1000 + 1000 * 0.05, 6)
        expect(pl.totalW).toBeCloseTo(pl.panes[1].dx + 1000, 6)
    })

    it('formats mixtes : chaque bin prend SES dims (repli entrée 0 si absente)', () => {
        const pl = livePaneLayout([[1000, 1000], [1500, 3000]], [0, 1])
        expect(pl.panes[0]).toMatchObject({ w: 1000, h: 1000, viewW: 1000 })
        expect(pl.panes[1]).toMatchObject({ w: 1500, h: 3000, viewW: 3000 })
        // Frames locales sans per-bin : repli sur l'entrée 0 pour le bin 3.
        const fallback = livePaneLayout([[1000, 1000]], [3])
        expect(fallback.panes[0]).toMatchObject({ bin: 3, w: 1000, h: 1000 })
    })

    it('plafond : au-delà de max, tôles tronquées comptées, pas de panneaux', () => {
        const pl = livePaneLayout([[1000, 1000]], [0, 1, 2, 3, 4, 5, 6, 7], 6)
        expect(pl.panes).toHaveLength(6)
        expect(pl.panes.map((p) => p.bin)).toEqual([0, 1, 2, 3, 4, 5])
        expect(pl.truncated).toBe(2)
    })

    it('bins non contigus triés (0 et 3 → deux panneaux ordonnés)', () => {
        const pl = livePaneLayout([[1000, 1000]], [3, 0])
        expect(pl.panes.map((p) => p.bin)).toEqual([0, 3])
        expect(pl.panes[1].dx).toBeGreaterThan(pl.panes[0].dx)
    })
})
