/**
 * Display-only sheet orientation. Engine coords stay y-up, origin at the
 * sheet's bottom-left, X = width, Y = length. The screen always shows the
 * long side horizontal (landscape) so 16:9 monitors are used; a portrait
 * sheet (H > W) is rotated 90° CW. Optimization directions refer to the
 * ENGINE axes (left = –X, bottom = –Y), never the screen edges — the
 * origin + arrows make that mapping explicit.
 */

export function isSheetPortrait(width, height) {
    return Number(height) > Number(width) + 1e-6
}

export function sheetDisplaySize(width, height) {
    const W = Number(width) || 1
    const H = Number(height) || 1
    return isSheetPortrait(W, H) ? { viewW: H, viewH: W } : { viewW: W, viewH: H }
}

/** SVG transform applied to the un-rotated W×H sheet group (y-down SVG). */
export function sheetLandscapeTransform(width, height) {
    const W = Number(width) || 1
    const H = Number(height) || 1
    if (!isSheetPortrait(W, H)) return ''
    return `translate(${H} 0) rotate(90)`
}

/** Engine (y-up) → display SVG (y-down, landscape). */
export function engineToDisplay(ex, ey, width, height) {
    const W = Number(width) || 1
    const H = Number(height) || 1
    if (isSheetPortrait(W, H)) return [ey, ex]
    return [ex, H - ey]
}

/**
 * Origin + axis tips in DISPLAY coordinates.
 * Landscape (W≥H): origin bottom-left, +X right, +Y up.
 * Portrait rotated: origin top-left, +X down, +Y right (length along the screen).
 * The triad is inset a few viewBox units so the origin mark and labels
 * are not clipped by the SVG edge — directions stay exact.
 */
export function sheetAxesDisplay(width, height) {
    const W = Number(width) || 1
    const H = Number(height) || 1
    const { viewW, viewH } = sheetDisplaySize(W, H)
    const short = Math.min(viewW, viewH)
    const len = Math.min(Math.max(short * 0.18, Math.max(viewW, viewH) * 0.055), short * 0.28)
    const inset = Math.max(short * 0.014, 10)
    if (isSheetPortrait(W, H)) {
        return {
            origin: { x: inset, y: inset },
            xTo: { x: inset, y: inset + len },
            yTo: { x: inset + len, y: inset },
            len,
            viewW,
            viewH,
        }
    }
    return {
        origin: { x: inset, y: H - inset },
        xTo: { x: inset + len, y: H - inset },
        yTo: { x: inset, y: H - inset - len },
        len,
        viewW,
        viewH,
    }
}

/** Label just past the arrow tip, pushed toward the sheet interior. */
export function axisLabelPos(from, to, viewW, viewH, font) {
    const dx = to.x - from.x
    const dy = to.y - from.y
    const L = Math.hypot(dx, dy) || 1
    const ux = dx / L
    const uy = dy / L
    const mx = (from.x + to.x) / 2
    const my = (from.y + to.y) / 2
    let nx = -uy
    let ny = ux
    if ((viewW / 2 - mx) * nx + (viewH / 2 - my) * ny < 0) {
        nx = -nx
        ny = -ny
    }
    const pad = font * 0.65
    const x = Math.min(viewW - pad, Math.max(pad, to.x + ux * font * 0.55 + nx * font * 0.7))
    const y = Math.min(viewH - pad, Math.max(pad, to.y + uy * font * 0.55 + ny * font * 0.7))
    return { x, y }
}

/**
 * Screen arrow for an engine direction after landscape display.
 * left = –X, bottom = –Y — never the current screen edges.
 */
export function displayDirectionArrow(dir, width, height) {
    const portrait = isSheetPortrait(width, height)
    if (dir === 'left') return portrait ? '↑' : '←'
    if (dir === 'bottom') return portrait ? '←' : '↓'
    if (dir === 'balanced') return portrait ? '↖' : '↙'
    return ''
}
