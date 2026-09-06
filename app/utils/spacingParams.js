/**
 * Kerf explicite (B.4 / masterplan 3.10) — logique pure, testée.
 *
 * L'espacement entre pièces se règle par ses deux causes : le kerf
 * (largeur de coupe de l'outil) et la sécurité (marge gardée autour de
 * chaque pièce). L'espacement EFFECTIF — la clé `space` comprise par
 * l'API et les deux moteurs — vaut toujours :
 *
 *     space = kerf + 2 × sécurité
 *
 * Les deux réglages vivent en unité d'affichage (chaînes saisies).
 */

/**
 * Round to 4 decimals — keeps `space = kerf + 2 × safety` free of float
 * noise (0.15 × 2 -> 0.3, not 0.30000000000000004) while preserving every
 * spacing a user can actually type.
 */
export function round4Str(v) {
    const n = Number(v)
    if (!Number.isFinite(n)) return '0'
    return String(Math.round(n * 10000) / 10000)
}

/** Param string ("1,5") -> number (1.5), invalid/absent -> 0. */
export function paramNumber(v) {
    return Number(String(v ?? '0').replace(',', '.')) || 0
}

/** Effective spacing (display unit) from the two explicit settings. */
export function spacingFromKerfSafety(kerf, safety) {
    return round4Str(paramNumber(kerf) + 2 * paramNumber(safety))
}

/**
 * Migration (B.4) : un params écrit AVANT le chantier ne porte que
 * `space`. On dérive kerf = 0 et sécurité = space / 2 — l'espacement
 * effectif transmis au moteur est IDENTIQUE au dizaine-millième près,
 * donc un projet ancien rouvert rejoue le même résultat.
 */
export function withKerfDefaults(params) {
    if (params.kerf != null && params.safety != null) return params
    return { ...params, kerf: '0', safety: round4Str(paramNumber(params.space) / 2) }
}

/**
 * Levier « réduire l'espacement à X mm » : réduit la SÉCURITÉ, jamais le
 * kerf (il décrit l'outil physique). Retourne le patch {safety} (en
 * millimètres) qui amène l'effectif exactement à `targetMm`, ou null si
 * la cible ne permet même pas le kerf courant.
 */
export function safetyPatchForTargetMm(kerfMm, targetMm) {
    if (!(targetMm > kerfMm)) return null
    return { safetyMm: (targetMm - kerfMm) / 2 }
}
