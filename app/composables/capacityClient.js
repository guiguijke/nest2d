/**
 * Pré-contrôle de capacité avec espacement — miroir EXACT de
 * workers/nesting/core/capacity.py (plan 2026-09-05 §1.2a), parité
 * chiffrée 1e-9 verrouillée par tests. Voir le docstring Python pour
 * le contexte (job infaisable à 4 mm livré « done » avec bande hors
 * tôle : le test d'aire NUE ignorait le gonflement Minkowski).
 */
import { simplifyRing } from './localPayloadBuilder'

export const REFUSE_RATIO = 0.88
export const REFERENCE_PACKING = 0.85
const EPS = 1e-9

function ringArea(coords) {
    let a = 0
    const n = coords.length
    for (let i = 0; i < n; i++) {
        const [x1, y1] = coords[i]
        const [x2, y2] = coords[(i + 1) % n]
        a += x1 * y2 - x2 * y1
    }
    return Math.abs(a) / 2
}

function ringPerimeter(coords) {
    let p = 0
    const n = coords.length
    for (let i = 0; i < n; i++) {
        const [x1, y1] = coords[i]
        const [x2, y2] = coords[(i + 1) % n]
        p += Math.hypot(x2 - x1, y2 - y1)
    }
    return p
}

export function inflatedArea(part, space) {
    const coords = (part && part.coords) || []
    if (coords.length < 3) return 0
    const s = Math.max(0, Number(space) || 0)
    return ringArea(coords) + ringPerimeter(coords) * s / 2
        + Math.PI * s * s / 4
}

export function sheetUsableArea(width, height, space) {
    const s = Math.max(0, Number(space) || 0)
    return Math.max(0, (Number(width) - s) * (Number(height) - s))
}

function bboxGridCapacity(part, width, height, space) {
    const coords = (part && part.coords) || []
    if (coords.length < 3) return 0
    let minx = Infinity, maxx = -Infinity, miny = Infinity, maxy = -Infinity
    for (const [x, y] of coords) {
        if (x < minx) minx = x
        if (x > maxx) maxx = x
        if (y < miny) miny = y
        if (y > maxy) maxy = y
    }
    const w = maxx - minx
    const h = maxy - miny
    const s = Math.max(0, Number(space) || 0)
    if (w + s <= 0 || h + s <= 0) return 0
    const cols = Math.floor((Number(width) + s) / (w + s))
    const rows = Math.floor((Number(height) + s) / (h + s))
    return Math.max(0, cols) * Math.max(0, rows)
}

// Miroit _constructive_fit : une instance qui tient par construction en
// grilles (bbox + space) est faisable — dérogation du garde #49 (le
// ratio statistique ne refuse jamais un carré 8×8 exact dans sa tôle).
function constructiveFit(parts, sheets, space) {
    if (!parts?.length || !sheets?.length) return false
    let sheetsNeeded = 0
    for (const p of parts) {
        const count = Math.trunc(Number(p?.count) || 0)
        if (count <= 0) continue
        let bestCap = 0
        for (const sh of sheets) {
            bestCap = Math.max(bestCap, bboxGridCapacity(p, sh?.width, sh?.height, space))
        }
        if (bestCap <= 0) return false
        sheetsNeeded += Math.ceil(count / bestCap)
    }
    const stock = sheets.reduce(
        (n, sh) => n + (Math.trunc(Number(sh?.count) || 1)), 0)
    return sheetsNeeded <= stock
}

export function capacityReport(parts, sheets, space) {
    const s = Math.max(0, Number(space) || 0)
    let totalInflated = 0
    const counts = []
    for (const p of parts || []) {
        const c = Math.trunc(Number(p?.count) || 0)
        totalInflated += inflatedArea(p, s) * c
        counts.push(c)
    }
    let totalUsable = 0
    let stock = 0
    for (const sh of sheets || []) {
        const n = Math.trunc(Number(sh?.count) || 1)
        totalUsable += sheetUsableArea(sh?.width, sh?.height, s) * n
        stock += n
    }
    if (totalInflated <= 0 || totalUsable <= 0) return null
    const ratio = totalInflated / totalUsable

    const sheetsNeeded = Math.max(1, Math.ceil(ratio * stock / REFERENCE_PACKING))

    let maxParts
    if (ratio > REFERENCE_PACKING) {
        const scale = (totalUsable * REFERENCE_PACKING) / totalInflated
        maxParts = {}
        counts.forEach((c, i) => { maxParts[i] = Math.floor(c * scale) })
    } else {
        maxParts = {}
        counts.forEach((c, i) => { maxParts[i] = c })
    }

    const rAt = (sp) => {
        let num = 0
        for (const p of parts || []) {
            num += inflatedArea(p, sp) * (Math.trunc(Number(p?.count) || 0))
        }
        let den = 0
        for (const sh of sheets || []) {
            den += sheetUsableArea(sh?.width, sh?.height, sp)
                * (Math.trunc(Number(sh?.count) || 1))
        }
        return den > 0 ? num / den : Infinity
    }

    let maxSpacing = 0
    let lo = 0
    let hi = Math.max(0, s)
    if (rAt(0) <= REFERENCE_PACKING) {
        while (hi < 1000 && rAt(hi) <= REFERENCE_PACKING) {
            hi = hi > 0 ? hi * 2 : 1
        }
        for (let k = 0; k < 40; k++) {
            const mid = (lo + hi) / 2
            if (rAt(mid) <= REFERENCE_PACKING) lo = mid
            else hi = mid
        }
        maxSpacing = Math.round(lo * 100) / 100
    }

    const constructive = constructiveFit(parts, sheets, s)
    return {
        ratio: Math.round(ratio * 10000) / 10000,
        totalInflatedMm2: Math.round(totalInflated * 10) / 10,
        totalUsableMm2: Math.round(totalUsable * 10) / 10,
        sheetsNeeded,
        maxPartsAtSpacing: maxParts,
        maxSpacingForFitMm: maxSpacing,
        refused: ratio > REFUSE_RATIO && !constructive,
    }
}
