/* Chrono du post-pass JS (séquence localBridge exacte) sur le rejeu user. */
import { describe, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { normalizeLayouts, applyHoleFill, expandMeta } from 'C:/Users/guiguijke/OneDrive/Projects/Nestorcut_Suite/Nestorcut/app/composables/localBridge'
import { fillResidualBands, pairViolates } from 'C:/Users/guiguijke/OneDrive/Projects/Nestorcut_Suite/Nestorcut/app/composables/residualClient'
import { ringDist, smallLattice } from 'C:/Users/guiguijke/OneDrive/Projects/Nestorcut_Suite/Nestorcut/app/composables/structureClient'

const BENCH = 'C:/Users/guiguijke/OneDrive/Projects/Nestorcut_Suite/Nestorcut/workers/nesting/bench'
const payload = JSON.parse(readFileSync(`${BENCH}/out_user_payload.json`, 'utf8'))
const pre = JSON.parse(readFileSync(`${BENCH}/out_user_layouts_pre.json`, 'utf8'))

const T = {}
const timed = (name, fn) => { const t0 = performance.now(); const r = fn(); T[name] = performance.now() - t0; console.log(`  ${name}: ${T[name].toFixed(0)} ms`); return r }

describe('perf post-pass JS', () => {
    it('chrono', () => {
        for (let rep = 0; rep < 2; rep++) {
            console.log(`=== run ${rep}`)
            const t0 = performance.now()
            const space = Number(payload.engineConfig?.min_item_separation) || 0.1
            const parts = payload.parts
            const layouts = timed('normalizeLayouts+clone', () => normalizeLayouts({ layouts: JSON.parse(JSON.stringify(pre.layouts)) }))
            const meta = payload.meta
            if (meta && Array.isArray(meta.idMap)) {
                for (const layout of layouts) for (const pi of layout.placed_items || []) { const m = meta.idMap[pi.item_id]; if (m != null) pi.item_id = m }
            }
            if (meta && !meta.packs) timed('expandMeta', () => expandMeta(parts, meta.host, meta.fill, meta.slots, layouts, meta.ringRotations))
            timed('applyHoleFill#1', () => applyHoleFill(parts, layouts, space))
            const stats = {}
            timed('fillResidualBands(' + (rep ? 'grid' : 'compact') + ')', () => fillResidualBands(parts, layouts, space, payload, stats, rep ? 'grid' : 'compact'))
            timed('applyHoleFill#2', () => applyHoleFill(parts, layouts, space))
            console.log('  counts', layouts.map((l) => l.placed_items.length), 'stats', JSON.stringify(stats).slice(0, 300))
            console.log(`TOTAL ${(performance.now() - t0).toFixed(0)} ms`)
        }
        // micro-bench ringDist / pairViolates : fan (19 sommets) vs host (5), fan vs fan
        const fan = payload.parts.find((p) => (p.coords || []).length > 10)
        const host = payload.parts.find((p) => (p.coords || []).length <= 10) || fan
        const ringA = fan.coords.map(([x, y]) => [x + 100, y + 100])
        const ringB = fan.coords.map(([x, y]) => [x + 130, y + 100])
        const ringH = host.coords.map(([x, y]) => [x + 300, y + 300])
        let t = performance.now(); let acc = 0
        for (let i = 0; i < 20000; i++) acc += ringDist(ringA, ringB)
        console.log(`ringDist fan-fan (${ringA.length}x${ringB.length}): ${((performance.now() - t) / 20000 * 1e3).toFixed(2)} us/appel`)
        t = performance.now()
        for (let i = 0; i < 20000; i++) acc += ringDist(ringA, ringH)
        console.log(`ringDist fan-host (${ringA.length}x${ringH.length}): ${((performance.now() - t) / 20000 * 1e3).toFixed(2)} us/appel`)
        t = performance.now()
        for (let i = 0; i < 20000; i++) acc += pairViolates(ringA, ringB, 0.1) ? 1 : 0
        console.log(`pairViolates fan-fan: ${((performance.now() - t) / 20000 * 1e3).toFixed(2)} us/appel (acc ${acc > 0})`)
        // smallLattice sur une bande 900x100 avec 300 fans
        t = performance.now()
        const lat = smallLattice({ id: fan.id, coords: fan.coords, rotations: fan.rotations || [0, 90, 180, 270] }, 0.1, [0.1, 900, 999.9, 999.9], { want: 300, axis: 'x' })
        console.log(`smallLattice bande 1000x100 want 300: ${(performance.now() - t).toFixed(0)} ms -> ${lat ? lat.length : 0} poses`)
    }, 120000)
})
