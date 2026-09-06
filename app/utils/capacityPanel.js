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
 * @param {object} ctx {sheets: [{width, height, count}], spaceMm: number|null,
 *   kerfMm?: number|null}
 * @returns {object|null} null quand il n'y a rien à afficher.
 */
export function capacityPanelModel(unfit, { sheets = [], spaceMm = null, kerfMm = null } = {}) {
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
    // « Réduire l'espacement » (C04) : utile seulement si le levier existe
    // ET abaisse réellement l'espacement courant (un maxSpacing ≥ space
    // n'est pas une action) ET qu'il reste quelque chose à gagner —
    // sous 0,5 mm d'espacement courant le levier est MASQUÉ (la marge
    // restante est illusoire), et avec le kerf explicite la cible doit
    // dépasser le kerf (on ne réduit jamais la largeur de coupe de
    // l'outil).
    const SPACING_FLOOR_MM = 0.5
    const spacingAtFloor = spaceMm != null && spaceMm <= SPACING_FLOOR_MM
    const kerf = num(kerfMm)
    const leverWouldHelp = maxSpacingMm != null && spaceMm != null && maxSpacingMm < spaceMm
    const kerfBlocks = leverWouldHelp && kerf != null && maxSpacingMm <= kerf
    const canReduceSpacing = leverWouldHelp && !spacingAtFloor && !kerfBlocks
    return {
        reason: unfit.reason,
        unplaced: num(unfit.unplaced),
        levers: { sheetsNeeded, maxParts, maxSpacingMm },
        nextSheets,
        reduceSpacingToMm: canReduceSpacing ? maxSpacingMm : null,
        // C04 : espacement courant déjà au plancher (≤ 0,5 mm) ou kerf
        // bloquant — la page affiche « même sans espacement, ça ne tient
        // pas » au lieu d'un bouton inutile.
        noSpacingGain: spacingAtFloor || kerfBlocks,
    }
}
