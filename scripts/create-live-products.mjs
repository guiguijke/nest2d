#!/usr/bin/env node
/**
 * Crée (ou met à jour) les fiches d'abonnement NestorCut sur le compte Stripe
 * LIVE : un produit « Standard » et un produit « Confidentialité+ », chacun
 * avec un prix mensuel par défaut en EUR + option USD.
 *
 * Le serveur synchronise ensuite ces produits au boot
 * (server/plugins/6_subscription_plan_sync.ts) — aucun changement de code
 * nécessaire après création.
 *
 * Usage :
 *   # Git Bash / Linux / macOS :
 *   STRIPE_SECRET_KEY=sk_live_xxx node scripts/create-live-products.mjs
 *   # PowerShell :
 *   $env:STRIPE_SECRET_KEY="sk_live_xxx"; node scripts/create-live-products.mjs
 *
 * Sécurité :
 *   - la clé ne vient QUE de la variable d'environnement, jamais d'un fichier ;
 *   - une clé sk_test_ fait échouer le script (sauf --allow-test, pour valider
 *     le script lui-même en mode test) ;
 *   - la clé n'est jamais affichée (4 derniers caractères seulement).
 *
 * Idempotent : relancer le script ne duplique rien. Si le prix par défaut
 * existant ne correspond plus aux montants ci-dessous, un NOUVEAU prix est
 * créé et passé en défaut (les prix Stripe sont immuables) ; l'ancien prix
 * est désactivé — les abonnés existants restent sur leur prix d'origine.
 *
 * TVA : aucune tax_behavior / automatic_tax n'est configuré — l'entreprise
 * est en franchise en base (TVA non applicable, art. 293 B du CGI). Si ça
 * change un jour, configurer Stripe Tax AVANT de toucher aux prix.
 */

const STRIPE_BASE = 'https://api.stripe.com/v1'

const ALLOW_TEST = process.argv.includes('--allow-test')

/**
 * Catalogue des abonnements. Montants en centimes.
 * metadata.type=subscription + metadata.tier sont lus par le plan sync.
 */
const PLANS = [
    {
        key: 'standard',
        product: {
            name: 'NestorCut Standard',
            description:
                'Nesting illimité : multi-tôles, pièces hétérogènes, 3 layouts alternatifs, 4 vCores de calcul.',
            metadata: { type: 'subscription', tier: 'standard' },
        },
        price: {
            currency: 'eur',
            unit_amount: 1900,
            recurring: { interval: 'month' },
            currency_options: { usd: { unit_amount: 1900 } },
        },
    },
    {
        key: 'privacy',
        product: {
            name: 'NestorCut Confidentialité+',
            description:
                'Tout Standard, plus le coffre zéro-connaissance (fichiers chiffrés côté client) et 8 vCores prioritaires.',
            metadata: { type: 'subscription', tier: 'privacy' },
        },
        price: {
            currency: 'eur',
            unit_amount: 3900,
            recurring: { interval: 'month' },
            currency_options: { usd: { unit_amount: 3900 } },
        },
    },
]

function requireKey() {
    const key = process.env.STRIPE_SECRET_KEY
    if (!key) {
        console.error('Erreur : STRIPE_SECRET_KEY est vide. Exemple :')
        console.error('  STRIPE_SECRET_KEY=sk_live_xxx node scripts/create-live-products.mjs')
        process.exit(1)
    }
    if (key.startsWith('sk_test_') && !ALLOW_TEST) {
        console.error('Erreur : clé de TEST détectée (sk_test_...).')
        console.error('Ce script cible le compte LIVE. Passe --allow-test pour un essai en mode test.')
        process.exit(1)
    }
    if (!key.startsWith('sk_live_') && !ALLOW_TEST) {
        console.error(`Erreur : préfixe de clé inattendu (${key.slice(0, 7)}...). Une clé sk_live_ est attendue.`)
        process.exit(1)
    }
    return key
}

async function stripe(method, path, params, key) {
    const init = { method, headers: { Authorization: `Bearer ${key}` } }
    if (params) {
        init.headers['Content-Type'] = 'application/x-www-form-urlencoded'
        init.body = params
    }
    const response = await fetch(`${STRIPE_BASE}${path}`, init)
    const body = await response.json()
    if (!response.ok) {
        const message = body?.error?.message || response.statusText
        throw new Error(`Stripe ${method} ${path} → ${response.status}: ${message}`)
    }
    return body
}

/** Sérialise un objet imbriqué en application/x-www-form-urlencoded (style Stripe). */
function encodeParams(obj, prefix, out = new URLSearchParams()) {
    for (const [k, v] of Object.entries(obj)) {
        const name = prefix ? `${prefix}[${k}]` : k
        if (v != null && typeof v === 'object') {
            encodeParams(v, name, out)
        } else if (v != null) {
            out.append(name, String(v))
        }
    }
    return out
}

/** Le prix par défaut du produit correspond-il exactement à la spec voulue ? */
function priceMatches(price, spec) {
    return (
        price &&
        typeof price === 'object' &&
        price.active &&
        price.recurring?.interval === spec.recurring.interval &&
        price.currency === spec.currency &&
        price.unit_amount === spec.unit_amount &&
        price.currency_options?.usd?.unit_amount === spec.price_usd
    )
}

async function ensurePlan(plan, key) {
    // 1. Retrouver un produit existant portant ce tier.
    const list = await stripe(
        'GET',
        `/products?active=true&limit=100&expand[]=data.default_price`,
        null,
        key,
    )
    let product = list.data.find(
        (p) => p.metadata?.type === 'subscription' && p.metadata?.tier === plan.key,
    )

    // 2. Créer ou corriger le produit.
    if (!product) {
        product = await stripe('POST', '/products', encodeParams(plan.product), key)
        console.log(`✓ Produit créé : ${plan.product.name} (${product.id})`)
    } else {
        const drift =
            product.name !== plan.product.name ||
            product.description !== plan.product.description
        if (drift) {
            await stripe(
                'POST',
                `/products/${product.id}`,
                encodeParams({ name: plan.product.name, description: plan.product.description }),
                key,
            )
            console.log(`✓ Produit mis à jour : ${product.id}`)
        } else {
            console.log(`= Produit déjà présent : ${plan.product.name} (${product.id})`)
        }
    }

    // 3. Vérifier le prix par défaut ; en créer un nouveau s'il dévie.
    const spec = {
        ...plan.price,
        price_usd: plan.price.currency_options.usd.unit_amount,
    }
    let defaultPrice = typeof product.default_price === 'object' ? product.default_price : null
    if (product.default_price && !defaultPrice) {
        defaultPrice = await stripe(
            'GET',
            `/prices/${product.default_price}?expand[]=currency_options`,
            null,
            key,
        )
    }
    if (defaultPrice && !defaultPrice.currency_options) {
        defaultPrice = await stripe('GET', `/prices/${defaultPrice.id}?expand[]=currency_options`, null, key)
    }

    if (priceMatches(defaultPrice, spec)) {
        console.log(`= Prix déjà conforme : ${defaultPrice.id} (${plan.price.unit_amount / 100} ${plan.price.currency.toUpperCase()}/mois + USD)`)
        return { productId: product.id, priceId: defaultPrice.id }
    }

    const oldPriceId = defaultPrice?.id
    const newPrice = await stripe(
        'POST',
        '/prices',
        encodeParams({ product: product.id, ...plan.price }),
        key,
    )
    await stripe('POST', `/products/${product.id}`, encodeParams({ default_price: newPrice.id }), key)
    if (oldPriceId && oldPriceId !== newPrice.id) {
        await stripe('POST', `/prices/${oldPriceId}`, encodeParams({ active: false }), key)
        console.log(`✓ Ancien prix ${oldPriceId} désactivé (remplacé)`)
    }
    console.log(
        `✓ Prix créé et passé en défaut : ${newPrice.id} — ` +
            `${plan.price.unit_amount / 100} EUR/mois, ${plan.price.currency_options.usd.unit_amount / 100} USD/mois`,
    )
    return { productId: product.id, priceId: newPrice.id }
}

async function main() {
    const key = requireKey()
    console.log(`Clé : …${key.slice(-4)} ${key.startsWith('sk_test_') ? '(TEST !)' : '(live)'}\n`)

    const results = {}
    for (const plan of PLANS) {
        console.log(`── ${plan.product.name} ──`)
        results[plan.key] = await ensurePlan(plan, key)
        console.log()
    }

    console.log('Terminé. Récapitulatif :')
    for (const [tier, ids] of Object.entries(results)) {
        console.log(`  ${tier.padEnd(9)} product=${ids.productId}  price=${ids.priceId}`)
    }
    console.log(`
Prochaines étapes :
  1. Vérifier dans le Dashboard (mode live) que les 2 produits et leurs prix sont corrects.
  2. Créer l'endpoint webhook live (voir docs/stripe-go-live.md) et coller son
     whsec_... dans NUXT_STRIPE_WEBHOOK_SECRET.
  3. Mettre la clé live dans NUXT_STRIPE_SECRET_KEY (.env du serveur), puis
     redémarrer l'app : les logs doivent afficher
     "[subscription-plan-sync] Synced standard plan price_..." et
     "[subscription-plan-sync] Synced privacy plan price_...".`)
}

main().catch((err) => {
    console.error(`Échec : ${err.message}`)
    process.exit(1)
})
