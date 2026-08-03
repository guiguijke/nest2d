#!/usr/bin/env node
/**
 * Valide l'intégration Abby de bout en bout sans passer par Stripe :
 * crée une recette de test dans le livre des recettes, affiche la réponse,
 * puis la supprime. Sert à vérifier qu'une clé NUXT_ABBY_API_KEY (fraîche,
 * régénérée) fonctionne avant la mise en prod.
 *
 * Usage :
 *   ABBY_API_KEY=suk_xxx node scripts/test-abby-income.mjs
 *   # PowerShell : $env:ABBY_API_KEY="suk_xxx"; node scripts/test-abby-income.mjs
 *
 *   --keep   conserve la recette (pour la voir dans app.abby.fr — pense à la
 *            supprimer ensuite depuis l'app ou via DELETE /incomeBook/{id})
 */

const ABBY_BASE = 'https://api.app-abby.com'
const KEEP = process.argv.includes('--keep')

// Doit refléter server/features/accounting/abby.js — si l'un bouge, l'autre
// aussi (le script reste volontairement autonome, sans import Nuxt).
const PRODUCT_TYPE_SERVICE_BIC = 3
const PAYMENT_METHOD_STRIPE = 9

const key = process.env.ABBY_API_KEY
if (!key) {
    console.error('Erreur : ABBY_API_KEY est vide.')
    console.error('  ABBY_API_KEY=suk_xxx node scripts/test-abby-income.mjs')
    process.exit(1)
}

const headers = {
    'Authorization': `Bearer ${key}`,
    'Content-Type': 'application/json',
}

const body = {
    client: 'TEST API NESTORCUT',
    priceWithoutTax: 1919, // 19,19 € en centimes — repère visuel dans l'app
    priceTotalTax: 1919,
    vatAmount: 0,
    productType: PRODUCT_TYPE_SERVICE_BIC,
    paymentMethodUsed: { value: PAYMENT_METHOD_STRIPE },
    paidAt: new Date().toISOString().slice(0, 10),
    reference: 'TEST-API-A-SUPPRIMER',
    isTaxIncluded: false,
}

console.log(`Clé : …${key.slice(-4)}\n`)
console.log('→ Création de la recette de test (19,19 €, BIC services, Stripe)…')
const created = await fetch(`${ABBY_BASE}/incomeBook`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
}).then(async (r) => ({ status: r.status, body: await r.json() }))

if (created.status !== 201 || !created.body?._id) {
    console.error(`Échec (${created.status}) :`, JSON.stringify(created.body))
    process.exit(1)
}
console.log(`✓ Recette créée : _id=${created.body._id}`)
console.log('  Vérifie dans app.abby.fr → Livre des recettes : 19,19 €,')
console.log('  « Prestations de services artisanales ou commerciales (BIC) », Stripe.')

if (KEEP) {
    console.log('\n--keep : recette conservée. Suppression manuelle :')
    console.log(`  curl -X DELETE -H "Authorization: Bearer $ABBY_API_KEY" ${ABBY_BASE}/incomeBook/${created.body._id}`)
} else {
    const del = await fetch(`${ABBY_BASE}/incomeBook/${created.body._id}`, {
        method: 'DELETE',
        headers,
    })
    console.log(del.ok ? '✓ Recette de test supprimée.' : `⚠ Suppression échouée (${del.status}) — supprime-la depuis l'app.`)
}
