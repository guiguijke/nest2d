/**
 * Date de réinitialisation du quota mensuel de nestings gratuits.
 *
 * Le quota est compté par période UTC côté serveur
 * (server/utils/entitlement.js : currentPeriod = ISO slice(0, 7)) — la
 * réinitialisation a donc lieu le 1er du mois suivant à 00:00:00 UTC.
 * Ce module est le seul endroit côté app qui calcule et formate cette date.
 */

/**
 * 1er du mois suivant à 00:00:00.000 UTC.
 * Date.UTC normalise les mois hors bornes : décembre (mois 11) + 1 bascule
 * proprement sur janvier de l'année suivante.
 */
export function nextQuotaReset(now = new Date()) {
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))
}

/**
 * Libellé localisé « date + heure » du prochain reset, dans le fuseau de
 * l'utilisateur — le reset à 00:00 UTC n'est pas minuit local, le nom de
 * fuseau court lève l'ambiguïté (ex. « 1 sept., 02:00 UTC+2 »).
 * locale : code app ('fr' | 'en', cf. useLocale) — Intl attend 'fr-FR'.
 */
export function formatQuotaReset(now, locale) {
    const intlLocale = locale === 'fr' ? 'fr-FR' : 'en'
    return new Intl.DateTimeFormat(intlLocale, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        timeZoneName: 'short',
    }).format(nextQuotaReset(now))
}
