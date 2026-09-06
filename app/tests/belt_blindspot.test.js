import { describe, it, expect } from 'vitest'
import { exactOverlapArea } from '../composables/residualClient'

const sq = { id: 1, coords: [[0, 0], [10, 0], [10, 10], [0, 10]], holes: [] }
const parts = new Map([['1', sq]])
const pose = (x, y) => ({ item_id: 1, transformation: { rotation: 0, translation: [x, y] } })
const key = (si, pi) => `${si}|${pi.item_id}|${(0).toFixed(6)}|${pi.transformation.translation[0].toFixed(6)}|${pi.transformation.translation[1].toFixed(6)}`

describe('AD5 belt blind spot', () => {
    it('new piece (higher index) overlapping an old piece (lower index) is counted', () => {
        const old = pose(0, 0)
        const fresh = pose(5, 5) // overlaps old by 25 mm²
        const layouts = [{ placed_items: [old, fresh] }]
        const full = exactOverlapArea(layouts, parts)
        const watched = new Set([key(0, fresh)])
        const diff = exactOverlapArea(layouts, parts, watched)
        console.log('full =', full, 'differential(watched=new only) =', diff)
        expect(full).toBe(1)
        expect(diff).toBe(1)
    })
    it('new piece with LOWER index than its old neighbour is counted too', () => {
        const fresh = pose(5, 5)
        const old = pose(0, 0)
        const layouts = [{ placed_items: [fresh, old] }]
        const watched = new Set([key(0, fresh)])
        expect(exactOverlapArea(layouts, parts, watched)).toBe(1)
    })
})
