/**
 * Z1 (vérif 2026-09-05) : modèle du bandeau « refus capacité » de la page
 * projet — les trois leviers chiffrés du pré-contrôle (tôles nécessaires,
 * pièces max à cet espacement, espacement max qui tient) et les actions
 * correctives dérivées des réglages courants. Pur et testé ; la page
 * ([slug].vue) ne fait que le rendu.
 *
 * `unfit` vient soit du 422 de l'API (files.js nestUnfit), soit du refus
 * navigateur (localSolverRegistry → localPayloadBuilder), soit d'une
 * solution partielle (reason 'partial').
 */

/**
 * @param {object|null} unfit {reason, ratio?, sheetsNeeded?,
 *   maxPartsAtSpacing?, maxSpacingForFitMm?, unplaced?}
 * @param {object} ctx {sheets: [{width, height, count}], spaceMm: number|null}
 * @returns {object|null} null quand il n'y a rien à afficher.
 */
export function capacityPanelModel(unfit, { sheets = [], spaceMm = null } = {}) {
    if (!unfit || !unfit.reason) return null
    const num = (v) => (v != null && Number.isFinite(Number(v)) ? Number(v) : null)
    const sheetsNeeded = num(unfit.sheetsNeeded)
    const maxParts = num(unfit.maxPartsAtSpacing)
    const maxSpacingMm = num(unfit.maxSpacingForFitMm)
    if (sheetsNeeded == null && maxParts == null && maxSpacingMm == null
        && num(unfit.unplaced) == null) {
        return null
    }
    // « Ajouter une tôle » : count+1 sur le premier format actif — les
    // leviers disent « ≈ N tôles », un clic ajoute une tôle, l'utilisateur
    // itère visuellement (même action que le bandeau unfit du modal).
    const firstIdx = sheets.findIndex((s) => (Number(s?.count) || 0) > 0)
    const nextSheets = firstIdx >= 0
        ? sheets.map((s, i) => (i === firstIdx
            ? { ...s, count: String((Number(s.count) || 0) + 1) }
            : s))
        : null
    // « Réduire l'espacement » : utile seulement si le levier existe ET
    // abaisse réellement l'espacement courant (un maxSpacing ≥ space
    // n'est pas une action).
    const canReduceSpacing = maxSpacingMm != null
        && spaceMm != null && maxSpacingMm < spaceMm
    return {
        reason: unfit.reason,
        unplaced: num(unfit.unplaced),
        levers: { sheetsNeeded, maxParts, maxSpacingMm },
        nextSheets,
        reduceSpacingToMm: canReduceSpacing ? maxSpacingMm : null,
    }
}
