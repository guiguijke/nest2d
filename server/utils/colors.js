import { createHash } from 'node:crypto'

/**
 * Per-part display colors — screen rendering only, never written into the
 * production result DXF. The palette MUST stay in sync with
 * workers/common/worker_common/colors.py: colors are assigned at import by
 * the file-processing worker, and documents imported before this feature get
 * this deterministic fallback so every surface (live view, result SVG, parts
 * list) shows the same color for the same part.
 */
export const PART_PALETTE = [
    '#2563EB', '#DC2626', '#059669', '#D97706', '#7C3AED', '#DB2777',
    '#0D9488', '#EA580C', '#4F46E5', '#65A30D', '#0891B2', '#BE185D',
    '#16A34A', '#9333EA', '#0284C7', '#C026D3', '#CA8A04', '#E11D48',
    '#0F766E', '#9F1239', '#3F6212', '#1D4ED8', '#B45309', '#6D28D9',
]

// Fill is the part color at low opacity; the stroke carries the full color.
export const FILL_OPACITY_LAYOUT = 0.35

/**
 * Deterministic fallback for parts imported before colors existed.
 * MUST match color_for_part in workers/common/worker_common/colors.py
 * (sha1 of 'slug:index', first byte modulo palette length).
 */
export function colorForPart(slug, index) {
    const digest = createHash('sha1').update(`${slug}:${index}`).digest()
    return PART_PALETTE[digest[0] % PART_PALETTE.length]
}

/** Persisted color if present, deterministic fallback otherwise. */
export function resolvePartColor(part, slug, index) {
    return part?.color || colorForPart(slug, index)
}
