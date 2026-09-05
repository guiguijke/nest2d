/**
 * AA1 (vérif L1 2026-09-05) — UNE définition de la qualité, mesurée.
 *
 * La « densité » stockée n'avait pas le même sens selon l'option (Grille =
 * matière / Σ tôles ; moteur = matière / emprise) : les 900 mêmes pièces
 * sur les 2 mêmes tôles affichaient 55,4 % contre 62,3 % et l'option 1
 * paraissait la moins bonne. Ces helpers lisent la densité MESURÉE du
 * rapport vérifié (totals.densityPct = Σ aires pièces / Σ aires tôles,
 * déjà en %), identique pour toutes les options, et décident de la
 * JUSTIFICATION du rang 0 d'après la vérité des chutes.
 */

/** Densité mesurée (%, déjà arrondie à 0,1) — repli sur alt.density
 * UNIQUEMENT si l'alternative n'a pas de rapport (jobs antérieurs). */
export function altDensityPctOf(alt) {
    if (!alt) return null
    if (alt.report) return alt.report.totals?.densityPct ?? null
    return alt.density != null ? alt.density * 100 : null
}

/** Pourquoi l'option 1 est proposée en premier : 'offcut' si sa chute est
 * bien la plus grande (à `toleranceMm2` près), sinon 'grid' (rangées
 * régulières, découpes prévisibles) — jamais un mensonge. */
export function whyFirstKind(alts, { toleranceMm2 = 1 } = {}) {
    if (!Array.isArray(alts) || alts.length < 2) return null
    const area = (a) => a?.offcut?.area ?? a?.offcut?.areaMm2 ?? 0
    const best = area(alts[0])
    const otherMax = Math.max(...alts.slice(1).map(area))
    return best >= otherMax - toleranceMm2 ? 'offcut' : 'grid'
}
