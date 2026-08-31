/**
 * Bind a results-list item to the project page currently on screen.
 * SSE reconnects on navigation (UserResults lives in the layout) so the
 * list can still hold the PREVIOUS project's jobs for a tick — never pick
 * an item whose projectSlug is missing or belongs to someone else.
 */
export function belongsToProject(item, projectSlug) {
    if (!item || !projectSlug) return false
    if (!item.projectSlug) return false
    return item.projectSlug === projectSlug
}

export function pickAwaitingLocal(list, projectSlug) {
    return (list || []).find(
        (r) => r.status === 'awaiting_local' && belongsToProject(r, projectSlug),
    ) || null
}

export function pickLiveJob(list, projectSlug) {
    return (list || []).find(
        (r) => r.liveLayout && belongsToProject(r, projectSlug),
    ) || null
}

export function pickRunningJob(list, projectSlug) {
    return (list || []).find(
        (r) => r.isInProgress && belongsToProject(r, projectSlug),
    ) || null
}

// ---------------------------------------------------------------------------
// Champion live — UNE définition partagée (registre + LiveNestingView).
// R-6 (audit 2026-08-31 §R-6) : la couche registre filtrait les frames avec
// une égalité stricte sur strip_width, court-circuitant en amont la fenêtre
// de corridor phase 2 et le critère remnant du plateau BPP — la vue ne
// voyait plus que des frames « déjà meilleures » et figeait (« 1 maj et
// c'est tout », régression du fix B.4). Toute évolution du critère se fait
// ICI, les deux consommateurs suivent.
// ---------------------------------------------------------------------------

// sparrow has NO hard sheet bound: a collision-free ("feasible") solution
// can still be wider than the sheet. Only layouts that actually fit count
// as presentable — otherwise the champion locks on over-width garbage.
export function frameFitsSheet(s) {
    if (!s?.feasible) return false
    const w = s.sheets?.[0]?.[0]
    if (w != null && s.strip_width != null) return s.strip_width <= w + 0.5
    return true
}

// Fenêtre d'égalité SPP : les frames phase 2 vivent à largeur ≈ champion
// phase 1 + slack moteur (corridor = phase1 + 1 mm) — dans cette fenêtre le
// départage se fait sur la hauteur utilisée (critère secondaire du merge),
// sinon toute la compression de hauteur de la phase 2 est invisible.
export const SPP_TIE_WINDOW_MM = 1.0

// Strict quality order: fits-the-sheet first, then narrowest strip / fewest
// bins, then least used height, then densest. Ties keep the incumbent
// (stability), sauf égalité PARFAITE en BPP où la frame fraîche gagne
// (rotation entre incumbents des walks à ~1 Hz — sans ça la vue fige sur le
// premier layout pendant tout le plateau du recuit).
export function frameIsBetter(a, b) {
    if (!a) return false
    if (!b) return true
    const fa = frameFitsSheet(a), fb = frameFitsSheet(b)
    if (fa !== fb) return fa
    const aw = a.strip_width ?? Infinity, bw = b.strip_width ?? Infinity
    if (aw !== bw) {
        const tie = a.isSpp && b.isSpp && Math.abs(aw - bw) <= SPP_TIE_WINDOW_MM
        if (!tie) return aw < bw
        const tha = a.used_height ?? Infinity, thb = b.used_height ?? Infinity
        if (tha !== thb) return tha < thb
        // fenêtre + hauteurs égales : l'incumbent reste (stabilité)
        return false
    }
    const ab = a.bins ?? Infinity, bb = b.bins ?? Infinity
    if (ab !== bb) return ab < bb
    // BPP : à nombre de tôles égal, le « remnant » (marge résiduelle du
    // recuit) est LE critère qui progresse pendant le plateau.
    const ar = a.remnant ?? Infinity, br = b.remnant ?? Infinity
    if (ar !== br) return ar < br
    const ah = a.used_height ?? Infinity, bh = b.used_height ?? Infinity
    if (ah !== bh) return ah < bh
    if ((a.density || 0) > (b.density || 0) + 1e-9) return true
    if ((b.density || 0) > (a.density || 0) + 1e-9) return false
    // Same packing quality: prefer the hole-filled frame so the live
    // view matches the result modal (fillers in cutouts).
    if ((a.holesFilled || 0) !== (b.holesFilled || 0)) {
        return (a.holesFilled || 0) > (b.holesFilled || 0)
    }
    if ((a.items?.length || 0) !== (b.items?.length || 0)) {
        return (a.items?.length || 0) > (b.items?.length || 0)
    }
    // Égalité parfaite : BPP accepte la frame fraîche ; SPP garde
    // l'incumbent (stabilité du corridor phase 2).
    return a.isSpp === false && b.isSpp === false
}
