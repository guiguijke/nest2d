import { createError } from 'h3'
import { connectDB } from '../db/mongo'
import { FREE_NESTING_LIMIT } from '../features/payment/const'
import { isPromoActive } from './promo'
import { DEMO_NESTING_LIMIT } from '../../shared/constants/demo.constants'
import { ACTIVE_SUBSCRIPTION_STATUSES, getSubscription, mapSubscription } from '../features/payment/stripe'
import logger from './logger'

/**
 * Free quota is a MONTHLY allowance: 10 free nestings per calendar month
 * (UTC), reset lazily on the next consumption of a new month. The period is
 * tracked as 'YYYY-MM' on the user document (freeNestingPeriod).
 */
function currentFreePeriod() {
    return new Date().toISOString().slice(0, 7)
}

/**
 * Resets the free counter when the month rolled over. Safe to call before
 * reading freeNestingUsed; atomic, so concurrent calls can't double-reset.
 */
async function resetFreeQuotaIfNewPeriod(db, userId) {
    await db
        .collection('users')
        .updateOne(
            { id: userId, freeNestingPeriod: { $ne: currentFreePeriod() } },
            { $set: { freeNestingUsed: 0, freeNestingPeriod: currentFreePeriod() } },
        )
}

/**
 * The user's effective free monthly nesting limit. A redeemed partner promo
 * code snapshots a raised limit on the user document (users.promo, set by
 * /api/user/promo/redeem) for the duration of the campaign — once
 * promo.expiresAt is past, the quota falls back to FREE_NESTING_LIMIT.
 *
 * RULE: never read FREE_NESTING_LIMIT directly for a user-specific decision —
 * always go through this resolver (AGENTS.md, Server / quotas).
 *
 * @param {any} user user document (or projection carrying promo)
 * @returns {number}
 */
export function effectiveFreeLimit(user) {
    return isPromoActive(user?.promo) ? user.promo.freeNestingLimit : FREE_NESTING_LIMIT
}

/**
 * Returns true if the user's stored subscription currently grants access.
 * @param {any} user
 * @returns {boolean}
 */
function hasActiveSubscription(user) {
    const subscription = user?.subscription
    if (!subscription) {
        return false
    }
    if (!ACTIVE_SUBSCRIPTION_STATUSES.includes(subscription.status)) {
        return false
    }
    // No period end recorded yet (e.g. just created) — trust the status.
    if (!subscription.currentPeriodEnd) {
        return true
    }
    return new Date(subscription.currentPeriodEnd) > new Date()
}

/**
 * Re-reads the subscription from Stripe and persists it. Used as a lazy
 * fallback when the locally stored period looks expired, so the polling lag
 * doesn't wrongly block a freshly-renewed subscriber.
 * @param {import('mongodb').Db} db
 * @param {any} user
 * @returns {Promise<boolean>} whether the refreshed subscription is active
 */
async function refreshSubscription(db, user) {
    const subscriptionId = user?.subscription?.stripeSubscriptionId
    if (!subscriptionId) {
        return false
    }
    try {
        const stripeSub = await getSubscription(subscriptionId)
        const mapped = mapSubscription(stripeSub)
        await db.collection('users').updateOne({ id: user.id }, { $set: { subscription: mapped } })
        return hasActiveSubscription({ subscription: mapped })
    } catch (err) {
        logger.warn('Failed to refresh subscription from Stripe', {
            userId: user.id,
            subscriptionId,
            err,
        })
        return false
    }
}

/**
 * Read-only entitlement summary for UI (banner, paywall state).
 * @param {string} userId
 * @returns {Promise<{freeRemaining: number, subscriptionStatus: string|null, requiresPaywall: boolean}>}
 */
export async function getEntitlement(userId) {
    const db = await connectDB()
    await resetFreeQuotaIfNewPeriod(db, userId)
    const user = await db
        .collection('users')
        .findOne(
            { id: userId },
            { projection: { freeNestingUsed: 1, subscription: 1, grantedUntil: 1, promo: 1 } }
        )

    const subscriptionStatus = user?.subscription?.status || null
    const active = hasActiveSubscription(user)
    // An admin-granted free period (set from the admin panel) grants full access
    // until its expiry, exactly like an active subscription would.
    const granted = user?.grantedUntil && new Date(user.grantedUntil) > new Date()
    const freeRemaining = Math.max(0, effectiveFreeLimit(user) - (user?.freeNestingUsed || 0))

    return {
        freeRemaining,
        subscriptionStatus,
        // An active grant (admin "mois gratuit") bypasses the paywall.
        requiresPaywall: !granted && !active && freeRemaining === 0,
    }
}

/**
 * Maps the user's subscription priceId to a plan tier using the synced
 * subscription_plan documents (see 6_subscription_plan_sync.ts). Returns
 * 'standard' when the price is unknown but the subscription is active — an
 * unknown price must never silently grant premium features.
 * @param {any} user
 * @returns {Promise<string|null>} 'standard' | 'privacy' | null
 */
export async function getSubscriptionTier(user) {
    if (!hasActiveSubscription(user)) {
        return null
    }
    const db = await connectDB()
    const plan = await db
        .collection('subscription_plan')
        .findOne({ priceId: user.subscription.priceId }, { projection: { tier: 1 } })
    return plan?.tier || 'standard'
}

/**
 * Compute profiles by plan tier. NOTE (D-PRV-5, J-049): the tier code
 * `privacy` no longer gates ANY feature other than compute — the
 * zero-knowledge vault is opt-in on every plan and the legacy
 * hasPrivacyTier() resolver is removed (no code rename, D-PAY-8).
 *
 * EVERY tier gets a fully optimized result
 * (the engine computes until convergence, see plateau stop in nest-engine);
 * the plan only caps the compute THROUGHPUT (vcores = how many of the
 * QUALITY_WALKS=8 SA walks run at once) and therefore the delivery time,
 * plus the number of layout directions explorable per nesting (free: 1 —
 * the other directions cost one nesting credit each; paid: all 3,
 * unselectable for a faster result).
 *
 * wallCapSec is a worst-case wall-clock cap (plateau stop usually ends the
 * job much earlier). priority: lower = dequeued first.
 *
 * Computed SERVER-SIDE at enqueue time and persisted on the job — the
 * client can never inflate its own budget.
 *
 * TODO(calibration): vcores/wallCapSec are initial estimates — tune with
 * the perf_curve harness on the production machine (EPYC 7002, 16T budget).
 */
export const COMPUTE_TIERS = {
    free: { vcores: 1, wallCapSec: 600, maxDirections: 1, priority: 30 },
    standard: { vcores: 4, wallCapSec: 300, maxDirections: 3, priority: 20 },
    privacy: { vcores: 8, wallCapSec: 180, maxDirections: 3, priority: 10 },
}

/** Layout directions the engine can optimize towards (BPP alternatives). */
export const NEST_DIRECTIONS = ['left', 'bottom', 'balanced']

/**
 * Sheet cap per nesting job, by tier (D-PAY-9). The FREE plan is capped at
 * FREE_SHEET_CAP sheets TOTAL — the sum of `count` over every sheet format
 * defined for the job, identical or different. Paid tiers are uncapped.
 *
 * Demo nestings are EXEMPT (J-056): they live under their own dedicated
 * monthly quota (D-DEM-3) and never reach this guard (demo path in
 * nest.post.js).
 *
 * RULE: enforced SERVER-SIDE at enqueue (P3 — a client-side hint alone is
 * never a guard), BEFORE any quota is consumed, via this resolver — never
 * inline a literal cap elsewhere (AGENTS.md, Server / quotas).
 */
export const FREE_SHEET_CAP = 2

/**
 * @param {string} tier compute tier ('free'|'standard'|'privacy')
 * @returns {number} max sheets per job (Infinity = uncapped)
 */
export function sheetCapForTier(tier) {
    return tier === 'free' ? FREE_SHEET_CAP : Infinity
}

/**
 * Throws a stable 403 `sheet_cap_exceeded` when the job's total sheet count
 * exceeds the tier's cap.
 * @param {number} totalSheets sum of counts over every defined sheet format
 * @param {string} tier compute tier
 */
export function assertSheetCountWithinTier(totalSheets, tier) {
    const cap = sheetCapForTier(tier)
    if (Number(totalSheets) > cap) {
        throw createError({
            statusCode: 403,
            statusMessage: 'sheet_cap_exceeded',
            data: { reason: 'sheet_cap_exceeded', cap },
        })
    }
}

/**
 * Browser compute profile (Free local jobs): written SERVER-SIDE at
 * enqueue — the client can never inflate its own budget (P3). Stop is
 * plateau (no global improvement for patience sec); timeBudgetSec is the
 * safety-net wall. 13 s is enough for small Free jobs; a 300-part BPP
 * demo cannot reach the 200-iter plateau gate in 13 s (see D-DEM-4).
 * Mono-walk: 1 vcore, 1 direction.
 */
export const BROWSER_COMPUTE = {
    timeBudgetSec: 13,
    vcores: 1,
    maxDirections: 1,
    priority: 20,
    level: 'browser',
}

/**
 * Same-quality search for every plan (D-PAY-12). Every job runs this many
 * walks to plateau; the tier only sets how many run at once (speed).
 * 8 = Pro search. Free does them one-by-one; Unlimited 4-wide; Pro 8-wide.
 */
export const QUALITY_WALKS = 8

/**
 * J-093 — CONCURRENCE du pool navigateur par tier (vitesse), jamais la
 * taille de la recherche (QUALITY_WALKS). Jamais hardwareConcurrency —
 * même job, même nombre de walks ⇒ même résultat ; un appareil plus lent
 * est juste plus lent. Mobile plafonne la concurrence, pas le nombre de
 * walks (effectiveWalks).
 * Taille FIXE par tier, jamais hardwareConcurrency côté client — même job,
 * même tier ⇒ même résultat sur toute machine (déterminisme cross-device).
 */
export const BROWSER_WALKS = { free: 1, standard: 4, privacy: 8 }

export function browserWalksForTier(tier) {
    return BROWSER_WALKS[tier] ?? 1
}

/**
 * Where a nesting job is computed (Phase 2, flag-gated internal QA — NOT a
 * privacy feature: DXF/SVG parsing stays server-side, "local" only means the
 * SOLVE happens in the browser on server-parsed geometry).
 *
 * Written SERVER-SIDE at enqueue (P3 — a client can never declare itself
 * "local"). Flag OFF ⇒ null: nothing is written and the pipeline is
 * strictly unchanged. Rules (J-059):
 *   - demo ⇒ 'local' (QA vehicle for every account);
 *   - free ⇒ 'local';
 *   - paid ⇒ 'local' when the project opted in (projects.localCompute),
 *     otherwise 'server'.
 *
 * @param {boolean} localComputeEnabled runtime flag (string-safe read)
 * @param {boolean} isDemo shared demo project job
 * @param {string} tier compute tier ('free'|'standard'|'privacy')
 * @param {any} project project document (may carry localCompute)
 * @returns {null|'local'|'server'}
 */
export function resolveComputeLocation(localComputeEnabled, isDemo, tier, project) {
    const enabled = localComputeEnabled === true || localComputeEnabled === 'true'
    if (!enabled) return null
    if (isDemo) return 'local'
    if (tier === 'free') return 'local'
    return project?.localCompute ? 'local' : 'server'
}

/**
 * PR5 (Mode Local productisé, J-078) : où un job est calculé, côté UI.
 *   - DWG dans le job ⇒ serveur (Mode Local = DXF+SVG uniquement, acté) ;
 *   - Free ⇒ local forcé (pas de toggle ; cap 2 tôles déjà en prod) ;
 *   - Unlimited/Pro ⇒ au choix, **défaut serveur** (comportement actuel
 *     inchangé — un payant qui veut ses habitudes ne voit rien changer).
 *
 * @param {string} tier 'free'|'standard'|'privacy'
 * @param {boolean} hasDwg le job contient-il un DWG ?
 * @param {string} [userChoice] 'local'|'server' choix explicite (payants)
 * @param {boolean} [projectLocal] projet « 100 % privé » (J-090) ?
 * @returns {{mode: 'local'|'server', canToggle: boolean, reason: string}}
 */
export function resolveLocalMode(tier, hasDwg, userChoice, projectLocal = false) {
    // J-090 : un projet local est TOUJOURS calculé dans le navigateur — le
    // serveur n'a jamais la géométrie, aucun autre routage n'est possible.
    if (projectLocal) return { mode: 'local', canToggle: false, reason: 'project_local' }
    if (hasDwg) return { mode: 'server', canToggle: false, reason: 'dwg' }
    if (tier === 'free') return { mode: 'local', canToggle: false, reason: 'free' }
    return { mode: userChoice === 'local' ? 'local' : 'server', canToggle: true, reason: 'choice' }
}

/**
 * The user's compute tier: 'privacy' (Pro) > 'standard' (Unlimited —
 * subscription or admin grant) > 'free'.
 *
 * An admin grant carries an optional `grantedTier` ('standard'|'privacy',
 * absent = 'standard' — historical grants behave exactly as before): the
 * admin panel can promote a test account to Unlimited or Pro and back to
 * free at will, without Stripe (D-PAY-11). A real Stripe subscription
 * always wins over a grant.
 * @param {string} userId
 * @param {{type: string}|null} charge the charge returned by assertCanNest (null on UI paths)
 * @returns {Promise<'free'|'standard'|'privacy'>}
 */
export async function getComputeTier(userId, charge) {
    const db = await connectDB()
    const user = await db.collection('users').findOne({ id: userId }, { projection: { subscription: 1, grantedUntil: 1, grantedTier: 1 } })

    const tier = await getSubscriptionTier(user)
    if (tier === 'privacy') return 'privacy'
    if (tier === 'standard' || charge?.type === 'subscription') return 'standard'
    // Admin-granted users (free month / test tier from the admin panel) get
    // the granted tier — checked from the grant and the job's charge
    // (enqueue path).
    const granted = user?.grantedUntil && new Date(user.grantedUntil) > new Date()
    if (granted || charge?.type === 'grant') {
        return user?.grantedTier === 'privacy' ? 'privacy' : 'standard'
    }
    return 'free'
}

/**
 * Compute profile granted to a nesting job, by tier.
 *
 * @param {string} userId
 * @param {{type: string}|null} charge the charge returned by assertCanNest
 * @returns {Promise<{vcores: number, wallCapSec: number, maxDirections: number, priority: number, level: string}>}
 */
export async function getComputeProfile(userId, charge) {
    const tier = await getComputeTier(userId, charge)
    return { ...COMPUTE_TIERS[tier], level: tier }
}

/**
 * Validates a client-requested direction list against the tier's allowance.
 * Returns the sanitized list (deduped, canonical order). Throws 400/403 on
 * invalid input — the client may request FEWER directions (faster result)
 * but never more than maxDirections.
 *
 * @param {any} requested params.directions from the client (may be absent)
 * @param {number} maxDirections tier allowance
 * @returns {string[]}
 */
export function validateDirections(requested, maxDirections) {
    let list = Array.isArray(requested)
        ? requested.filter((d) => NEST_DIRECTIONS.includes(d))
        : []
    list = [...new Set(list)]
    if (list.length === 0) {
        // D-MOT-5 : 1 layout demandé = 1 sens (left). L'utilisateur coche
        // plus de sens pour comparer plus de propositions.
        list = ['left']
    }
    if (list.length > maxDirections) {
        throw createError({
            statusCode: 403,
            statusMessage: `Your plan allows ${maxDirections} layout direction(s) per nesting`,
        })
    }
    return NEST_DIRECTIONS.filter((d) => list.includes(d))
}

/**
 * Gate for nesting requests.
 *
 * Charge order: admin grant → active subscription → free monthly quota.
 * The consumed unit is recorded and returned so the caller can persist it on
 * the job — the workers refund it if the nesting fails.
 *
 * Throws a 402 with a paywall reason when nothing is available.
 *
 * @param {string} userId
 * @returns {Promise<{type: 'grant'|'subscription'|'free'}>}
 */
export async function assertCanNest(userId) {
    const db = await connectDB()
    const user = await db
        .collection('users')
        .findOne(
            { id: userId },
            {
                projection: {
                    id: 1,
                    freeNestingUsed: 1,
                    subscription: 1,
                    grantedUntil: 1,
                    emailVerified: 1,
                    provider: 1,
                    promo: 1,
                },
            }
        )

    if (!user) {
        throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
    }

    // Anti-fake: local accounts must verify their email before nesting.
    // Google accounts are verified by Google (emailVerified set at creation).
    if (user.provider === 'local' && user.emailVerified === false) {
        throw createError({ statusCode: 403, statusMessage: 'email_not_verified' })
    }

    // An admin-granted free period ("mois gratuit", set from the admin panel)
    // grants full access until its expiry, consuming no quota.
    if (user.grantedUntil && new Date(user.grantedUntil) > new Date()) {
        return { type: 'grant' }
    }

    if (hasActiveSubscription(user)) {
        return { type: 'subscription' }
    }

    // Period looks expired but we have a subscription on file — the poll may not
    // have caught a renewal yet, so verify against Stripe before denying.
    if (user.subscription?.stripeSubscriptionId && (await refreshSubscription(db, user))) {
        return { type: 'subscription' }
    }

    // Atomically consume a free nesting operation. The guard prevents two
    // concurrent requests from both spending the same remaining free slot.
    // The limit is per-user (promo codes raise it) — resolved from the doc
    // loaded above, so the atomic filter stays a plain comparison.
    await resetFreeQuotaIfNewPeriod(db, userId)
    const consumed = await db
        .collection('users')
        .findOneAndUpdate(
            { id: userId, freeNestingUsed: { $lt: effectiveFreeLimit(user) } },
            { $inc: { freeNestingUsed: 1 } },
        )

    if (consumed) {
        return { type: 'free' }
    }

    throw createError({
        statusCode: 402,
        statusMessage: 'Subscription required',
        data: { reason: 'paywall' },
    })
}

/**
 * Gate for DEMO nestings (jobs launched from the shared read-only demo
 * project). Completely separate from the regular free quota: demo nestings
 * have their own monthly allowance (demoNestingUsed / demoNestingPeriod,
 * same lazy-reset mechanism) so newcomers can always try the engine at full
 * power without spending their own free nestings — and abuse stays bounded.
 *
 * The consumed unit is returned so the caller persists it on the job — the
 * workers refund it if the nesting fails.
 *
 * @param {string} userId
 * @returns {Promise<{type: 'demo'}>}
 */
export async function assertCanNestDemo(userId) {
    const db = await connectDB()
    const user = await db
        .collection('users')
        .findOne(
            { id: userId },
            { projection: { id: 1, demoNestingUsed: 1, demoNestingPeriod: 1, emailVerified: 1, provider: 1 } }
        )

    if (!user) {
        throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
    }

    // Same anti-fake rule as regular nestings.
    if (user.provider === 'local' && user.emailVerified === false) {
        throw createError({ statusCode: 403, statusMessage: 'email_not_verified' })
    }

    await db
        .collection('users')
        .updateOne(
            { id: userId, demoNestingPeriod: { $ne: currentFreePeriod() } },
            { $set: { demoNestingUsed: 0, demoNestingPeriod: currentFreePeriod() } },
        )

    const consumed = await db
        .collection('users')
        .findOneAndUpdate(
            { id: userId, demoNestingUsed: { $lt: DEMO_NESTING_LIMIT } },
            { $inc: { demoNestingUsed: 1 } },
        )

    if (consumed) {
        return { type: 'demo' }
    }

    throw createError({
        statusCode: 402,
        statusMessage: 'Demo nesting quota reached',
        data: { reason: 'demo_quota' },
    })
}

/**
 * Read-only demo quota summary for UI (demo banner).
 * @param {string} userId
 * @returns {Promise<{demoRemaining: number}>}
 */
export async function getDemoEntitlement(userId, localComputeEnabled) {
    const local = localComputeEnabled === true || localComputeEnabled === 'true'
    // Local compute costs us no server vcores — the demo quota is an
    // anti-abuse cap on SERVER time. When the flag routes demo to the
    // browser, the allowance is unlimited.
    if (local) return { demoRemaining: null, demoUnlimited: true }
    const db = await connectDB()
    const user = await db
        .collection('users')
        .findOne({ id: userId }, { projection: { demoNestingUsed: 1, demoNestingPeriod: 1 } })
    const used = user?.demoNestingPeriod === currentFreePeriod() ? user?.demoNestingUsed || 0 : 0
    return { demoRemaining: Math.max(0, DEMO_NESTING_LIMIT - used), demoUnlimited: false }
}
