/**
 * Unit conversion helpers — the ONLY place the app converts units.
 *
 * The canonical internal unit is ALWAYS millimeters: geometry in Mongo,
 * job params sent to the API, worker constants. Inches exist purely at the
 * UI boundary:
 *   - display: mm -> preferred unit (fmtLength / fmtArea)
 *   - input:   preferred unit -> mm before anything is sent to the API
 *              (displayToMm in files.js / strip.js requestBody)
 *
 * Never convert inside the pipeline or the engine (AGENTS.md rule).
 */

export const MM_PER_INCH = 25.4
export const SQMM_PER_SQIN = MM_PER_INCH * MM_PER_INCH // 645.16
export const SQIN_PER_SQFT = 144

export const UNITS = ['mm', 'inch']
export const DEFAULT_UNIT = 'mm'

/**
 * Standard sheet presets — a US user picks 48×96 from a list, never types
 * sheet dimensions by hand. Metric gets the standard metric plate sizes.
 * (Stock research 2026-08-04: 48×120 is a very common US stock size.)
 */
export const SHEET_PRESETS = {
    mm: [
        { width: 1000, height: 2000 },
        { width: 1250, height: 2500 },
        { width: 1500, height: 3000 },
    ],
    inch: [
        { width: 48, height: 96 }, // 4×8 ft
        { width: 48, height: 120 }, // 4×10 ft
        { width: 60, height: 120 }, // 5×10 ft
        { width: 72, height: 144 }, // 6×12 ft
    ],
}

/**
 * Regional equivalents between metric and US standard sheets, used on a
 * unit switch: a sheet EXACTLY matching a preset of the from-unit snaps to
 * the equivalent standard of the target region — never a numeric
 * conversion (a US shop thinks "4×8 ft", never 39.37×78.74).
 *
 * Source: stock research 2026-08-04 (Wexler HR sheet stock, EU plate
 * standards). Only two CLEAN pairs exist — 4×8 ft ↔ 1250×2500 and
 * 5×10 ft ↔ 1500×3000; the metric and US series do not overlap beyond
 * that, so the other entries map to the closest standard of the target
 * region (48×96 covers 1000×2000 in both dimensions).
 * Keys are canonical (small×large); the user's orientation is preserved.
 */
const SHEET_EQUIVALENTS = {
    mm: {
        '1000x2000': { width: '48', height: '96' },
        '1250x2500': { width: '48', height: '96' },
        '1500x3000': { width: '60', height: '120' },
    },
    inch: {
        '48x96': { width: '1250', height: '2500' },
        '48x120': { width: '1250', height: '2500' },
        '60x120': { width: '1500', height: '3000' },
        '72x144': { width: '1500', height: '3000' },
    },
}

/**
 * Regional equivalent of a sheet given in `fromUnit` display values, when
 * it exactly matches a known preset of that unit. Returns display strings
 * for `toUnit`, preserving the sheet's orientation (landscape stays
 * landscape), or null when the size is custom (caller falls back to a
 * plain numeric conversion).
 */
export function equivalentSheetPreset(width, height, fromUnit, toUnit) {
    if (fromUnit === toUnit) return null
    const w = Number(String(width).replace(',', '.'))
    const h = Number(String(height).replace(',', '.'))
    if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return null
    const key = `${Math.min(w, h)}x${Math.max(w, h)}`
    const hit = (SHEET_EQUIVALENTS[fromUnit] || {})[key]
    if (!hit) return null
    return w <= h ? { ...hit } : { width: hit.height, height: hit.width }
}

// Defaults applied when params are pristine and the user switches unit.
export const DEFAULT_SHEET = {
    mm: { width: '1000', height: '2000' },
    inch: { width: '48', height: '96' },
}
export const DEFAULT_SPACE = {
    mm: '0.1',
    inch: '0.004',
}

export function isValidUnit(unit) {
    return UNITS.includes(unit)
}

export function unitLabel(unit) {
    return unit === 'inch' ? '"' : 'mm'
}

export function mmToDisplay(mm, unit) {
    const v = Number(mm)
    if (!Number.isFinite(v)) return v
    return unit === 'inch' ? v / MM_PER_INCH : v
}

export function displayToMm(value, unit) {
    const v = Number(value)
    if (!Number.isFinite(v)) return v
    return unit === 'inch' ? v * MM_PER_INCH : v
}

// "48.500" -> "48.5", "1000.0" -> "1000", "0.004" -> "0.004"
function trimFixed(v, decimals) {
    return v.toFixed(decimals).replace(/\.?0+$/, '')
}

/**
 * Length VALUE for display, without the unit suffix (for "{w} × {h} {unit}"
 * strings). mm: 0.1 resolution; inch: 0.001" resolution (0.0254 mm — far
 * below any real kerf, so display rounding has no business impact).
 * Pass `decimals` to override (e.g. 2 for sub-mm spacing gaps).
 */
export function fmtLengthValue(mm, unit, decimals) {
    const v = mmToDisplay(mm, unit)
    if (!Number.isFinite(v)) return '—'
    const d = decimals ?? (unit === 'inch' ? 3 : 1)
    return trimFixed(v, d)
}

/**
 * Length for display (includes the unit suffix).
 */
export function fmtLength(mm, unit) {
    const s = fmtLengthValue(mm, unit)
    if (s === '—') return s
    return unit === 'inch' ? `${s}"` : `${s} mm`
}

/**
 * Area for display (includes the unit suffix).
 * mm: localized mm², switching to m² above 1 000 000 mm² (quoting-scale
 * numbers stay readable). inch: in² plus ft² in parentheses — square
 * footage is the estimator number for material purchasing (used/free per
 * sheet).
 */
export function fmtArea(mm2, unit) {
    const v = Number(mm2)
    if (!Number.isFinite(v)) return '—'
    if (unit === 'inch') {
        const in2 = v / SQMM_PER_SQIN
        const ft2 = in2 / SQIN_PER_SQFT
        return `${Math.round(in2).toLocaleString()} in² (${ft2.toFixed(2)} ft²)`
    }
    if (Math.abs(v) >= 1e6) return `${(v / 1e6).toFixed(2)} m²`
    return `${Math.round(v).toLocaleString()} mm²`
}

/**
 * Converts a raw input string ('48', '0.004', '12,5') between units,
 * keeping it a string suitable for an <input>. Non-numeric input is
 * returned untouched so the user's partial typing is never mangled.
 */
export function convertInputValue(str, fromUnit, toUnit) {
    if (fromUnit === toUnit) return str
    const v = Number(String(str).replace(',', '.'))
    if (!Number.isFinite(v)) return str
    const mm = fromUnit === 'inch' ? v * MM_PER_INCH : v
    const out = toUnit === 'inch' ? mm / MM_PER_INCH : mm
    return trimFixed(out, toUnit === 'inch' ? 3 : 1)
}
