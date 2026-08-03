/**
 * Abby (app.abby.fr) — client API minimal pour le livre des recettes.
 *
 * Pourquoi le livre des recettes et pas les factures : Stripe reste le seul
 * système de facturation (factures PDF conformes, pied 293 B). Chaque
 * encaissement est poussé ici en recette (catégorie BIC services), ce qui
 * préremplit les déclarations URSSAF — c'est le registre légal du
 * micro-entrepreneur. Pas de double numérotation de factures.
 *
 * Constaté par exploration de l'API (2026-08) — non documenté officiellement :
 *   - montants en CENTIMES (comme tout l'écosystème Abby) ;
 *   - productType 3 = prestations de services artisanales/commerciales (BIC) ;
 *   - paymentMethodUsed 9 = Stripe (8 = « autre ») ;
 *   - pas de GET /incomeBook : la dédup est trackée côté Mongo
 *     (collection accounting_entries), jamais par re-lecture Abby.
 *
 * La clé (NUXT_ABBY_API_KEY, préfixe suk_) se révoque/régénère dans
 * app.abby.fr → paramètres → intégrations.
 */

const ABBY_BASE = 'https://api.app-abby.com'

// Enumérations numériques de l'API incomeBook (valeurs vérifiées contre le
// frontend app.abby.fr).
export const ABBY_PRODUCT_TYPE_SERVICE_BIC = 3
export const ABBY_PAYMENT_METHOD_STRIPE = 9

function abbyKey() {
    // useRuntimeConfig DOIT être appelé dans la fonction : au niveau module,
    // pas de contexte Nuxt et la clé serait undefined.
    return useRuntimeConfig().abbyApiKey
}

/**
 * Crée une recette dans le livre des recettes Abby.
 * @param {{
 *   client: string,
 *   amountCents: number,
 *   paidAt: Date,
 *   reference: string,
 * }} entry montant en centimes EUR, référence = n° de facture Stripe
 * @returns {Promise<string|null>} l'id Abby de la recette, ou null si la
 *   clé API n'est pas configurée (intégration désactivée, pas une erreur)
 */
export async function createIncomeEntry({ client, amountCents, paidAt, reference }) {
    const key = abbyKey()
    if (!key) {
        return null
    }

    const response = await $fetch(`${ABBY_BASE}/incomeBook`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${key}`,
            'Content-Type': 'application/json',
        },
        body: {
            client,
            // Franchise en base : HT = TTC, TVA 0.
            priceWithoutTax: amountCents,
            priceTotalTax: amountCents,
            vatAmount: 0,
            productType: ABBY_PRODUCT_TYPE_SERVICE_BIC,
            paymentMethodUsed: { value: ABBY_PAYMENT_METHOD_STRIPE },
            paidAt: paidAt.toISOString().slice(0, 10),
            reference,
            isTaxIncluded: false,
        },
    })
    return response?._id || null
}

/**
 * Supprime une recette (ex. après un remboursement complet).
 * @param {string} incomeId id Abby (_id renvoyé à la création)
 */
export async function deleteIncomeEntry(incomeId) {
    const key = abbyKey()
    if (!key || !incomeId) {
        return
    }
    await $fetch(`${ABBY_BASE}/incomeBook/${incomeId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${key}` },
    })
}
