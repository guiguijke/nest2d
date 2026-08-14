import { describe, expect, it } from 'vitest'
import {
    axisLabelPos,
    displayDirectionArrow,
    engineToDisplay,
    isSheetPortrait,
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
