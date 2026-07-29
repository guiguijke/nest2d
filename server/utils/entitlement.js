import { createError } from "h3";
import { connectDB } from "~~/server/db/mongo";
import { FREE_NESTING_LIMIT, CREDIT_COST_PER_NESTING } from "~~/server/features/payment/const";
import {
  ACTIVE_SUBSCRIPTION_STATUSES,
  getSubscription,
  mapSubscription,
} from "~~/server/features/payment/stripe";
import logger from "./logger";

/**
 * Free quota is a MONTHLY allowance: 10 free nestings per calendar month
 * (UTC), reset lazily on the next consumption of a new month. The period is
 * tracked as 'YYYY-MM' on the user document (freeNestingPeriod).
 */
function currentFreePeriod() {
  return new Date().toISOString().slice(0, 7);
}

/**
 * Resets the free counter when the month rolled over. Safe to call before
 * reading freeNestingUsed; atomic, so concurrent calls can't double-reset.
 */
async function resetFreeQuotaIfNewPeriod(db, userId) {
  await db.collection("users").updateOne(
    { id: userId, freeNestingPeriod: { $ne: currentFreePeriod() } },
    { $set: { freeNestingUsed: 0, freeNestingPeriod: currentFreePeriod() } }
  );
}

/**
 * Returns true if the user's stored subscription currently grants access.
 * @param {any} user
 * @returns {boolean}
 */
function hasActiveSubscription(user) {
  const subscription = user?.subscription;
  if (!subscription) {
    return false;
  }
  if (!ACTIVE_SUBSCRIPTION_STATUSES.includes(subscription.status)) {
    return false;
  }
  // No period end recorded yet (e.g. just created) — trust the status.
  if (!subscription.currentPeriodEnd) {
    return true;
  }
  return new Date(subscription.currentPeriodEnd) > new Date();
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
  const subscriptionId = user?.subscription?.stripeSubscriptionId;
  if (!subscriptionId) {
    return false;
  }
  try {
    const stripeSub = await getSubscription(subscriptionId);
    const mapped = mapSubscription(stripeSub);
    await db
      .collection("users")
      .updateOne({ id: user.id }, { $set: { subscription: mapped } });
    return hasActiveSubscription({ subscription: mapped });
  } catch (err) {
    logger.warn("Failed to refresh subscription from Stripe", {
      userId: user.id,
      subscriptionId,
      err,
    });
    return false;
  }
}

/**
 * Read-only entitlement summary for UI (banner, paywall state).
 * @param {string} userId
 * @returns {Promise<{freeRemaining: number, creditsRemaining: number, subscriptionStatus: string|null, requiresPaywall: boolean}>}
 */
export async function getEntitlement(userId) {
  const db = await connectDB();
  await resetFreeQuotaIfNewPeriod(db, userId);
  const user = await db
    .collection("users")
    .findOne(
      { id: userId },
      { projection: { freeNestingUsed: 1, subscription: 1, isAdmin: 1, balance: 1 } }
    );

  const subscriptionStatus = user?.subscription?.status || null;
  const active = hasActiveSubscription(user);
  const freeRemaining = Math.max(
    0,
    FREE_NESTING_LIMIT - (user?.freeNestingUsed || 0)
  );
  const creditsRemaining = Math.floor((user?.balance || 0) / CREDIT_COST_PER_NESTING);

  return {
    freeRemaining,
    creditsRemaining,
    subscriptionStatus,
    // Admins are never paywalled — they get unlimited nesting.
    requiresPaywall:
      !user?.isAdmin && !active && freeRemaining === 0 && creditsRemaining === 0,
  };
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
    return null;
  }
  const db = await connectDB();
  const plan = await db
    .collection("subscription_plan")
    .findOne({ priceId: user.subscription.priceId }, { projection: { tier: 1 } });
  return plan?.tier || "standard";
}

/**
 * Whether the user may enable the zero-knowledge vault ("Confidentialité+"
 * tier). Admins always qualify (dogfooding + support).
 * @param {string} userId
 * @returns {Promise<boolean>}
 */
export async function hasPrivacyTier(userId) {
  const db = await connectDB();
  const user = await db
    .collection("users")
    .findOne({ id: userId }, { projection: { isAdmin: 1, subscription: 1 } });
  if (user?.isAdmin) {
    return true;
  }
  return (await getSubscriptionTier(user)) === "privacy";
}

/**
 * Selectable compute levels. Users can trade quality for speed within what
 * their tier allows (see getMaxComputeLevel); the level is validated
 * SERVER-SIDE at enqueue time — the client can never inflate its budget.
 *
 * Budgets are wall-clock seconds consumed by the nest-engine (separation/
 * compaction optimizer): quality scales with time and the engine always
 * returns its incumbent, so more time can never produce a worse layout.
 */
export const COMPUTE_LEVELS = {
  simple: { timeBudgetSec: 15, nAlternatives: 1 },
  normal: { timeBudgetSec: 45, nAlternatives: 3 },
  advanced: { timeBudgetSec: 180, nAlternatives: 3 },
};

const LEVEL_ORDER = ["simple", "normal", "advanced"];

function clampLevel(requested, max) {
  const reqIdx = LEVEL_ORDER.indexOf(requested);
  const maxIdx = LEVEL_ORDER.indexOf(max);
  if (reqIdx === -1) return max;
  return LEVEL_ORDER[Math.min(reqIdx, maxIdx)];
}

/**
 * Highest compute level a user may select, given their tier.
 */
export async function getMaxComputeLevel(userId, charge) {
  const db = await connectDB();
  const user = await db
    .collection("users")
    .findOne({ id: userId }, { projection: { isAdmin: 1, subscription: 1 } });

  if (user?.isAdmin) return "advanced";
  const tier = await getSubscriptionTier(user);
  if (tier === "privacy") return "advanced";
  if (charge?.type === "subscription" || charge?.type === "credits") return "normal";
  return "simple";
}

/**
 * Compute budget granted to a nesting job, by tier. Computed SERVER-SIDE at
 * enqueue time and persisted on the job — the client can never inflate its
 * own budget. priority: lower = dequeued first.
 *
 * @param {string} userId
 * @param {{type: string}|null} charge the charge returned by assertCanNest
 * @param {string} [requestedLevel] optional compute level selected in the UI
 * @returns {Promise<{timeBudgetSec: number, nAlternatives: number, priority: number, level: string}>}
 */
export async function getComputeProfile(userId, charge, requestedLevel) {
  const db = await connectDB();
  const user = await db
    .collection("users")
    .findOne({ id: userId }, { projection: { isAdmin: 1, subscription: 1 } });

  let maxLevel = "simple";
  let priority = 30;
  if (user?.isAdmin) {
    maxLevel = "advanced";
    priority = 0;
  } else {
    const tier = await getSubscriptionTier(user);
    if (tier === "privacy") {
      maxLevel = "advanced";
      priority = 10;
    } else if (charge?.type === "subscription" || charge?.type === "credits") {
      maxLevel = "normal";
      priority = 20;
    }
  }

  const level = clampLevel(requestedLevel, maxLevel);
  return { ...COMPUTE_LEVELS[level], priority, level };
}

/**
 * Gate for nesting requests of feature-flagged users.
 *
 * Charge order: admin (free) → active subscription → free quota → paid
 * credits. The consumed unit is recorded and returned so the caller can
 * persist it on the job — the workers refund it if the nesting fails.
 *
 * Throws a 402 with a paywall reason when nothing is available.
 *
 * Callers must only invoke this for users with isStripFeatureEnable on; legacy
 * (flag-off) users keep their balance-based flow.
 *
 * @param {string} userId
 * @returns {Promise<{type: 'admin'|'subscription'|'free'|'credits', amount?: number}>}
 */
export async function assertCanNest(userId) {
  const db = await connectDB();
  const user = await db
    .collection("users")
    .findOne(
      { id: userId },
      { projection: { id: 1, freeNestingUsed: 1, subscription: 1, isAdmin: 1, balance: 1 } }
    );

  if (!user) {
    throw createError({ statusCode: 401, statusMessage: "Unauthorized" });
  }

  // Admins have unlimited nesting — no quota is consumed.
  if (user.isAdmin) {
    return { type: "admin" };
  }

  if (hasActiveSubscription(user)) {
    return { type: "subscription" };
  }

  // Period looks expired but we have a subscription on file — the poll may not
  // have caught a renewal yet, so verify against Stripe before denying.
  if (
    user.subscription?.stripeSubscriptionId &&
    (await refreshSubscription(db, user))
  ) {
    return { type: "subscription" };
  }

  // Atomically consume a free nesting operation. The guard prevents two
  // concurrent requests from both spending the same remaining free slot.
  await resetFreeQuotaIfNewPeriod(db, userId);
  const consumed = await db.collection("users").findOneAndUpdate(
    { id: userId, freeNestingUsed: { $lt: FREE_NESTING_LIMIT } },
    { $inc: { freeNestingUsed: 1 } }
  );

  if (consumed) {
    return { type: "free" };
  }

  // Free quota exhausted — fall back to paid credits, consumed atomically.
  const charged = await db.collection("users").findOneAndUpdate(
    { id: userId, balance: { $gte: CREDIT_COST_PER_NESTING } },
    { $inc: { balance: -CREDIT_COST_PER_NESTING } }
  );

  if (charged) {
    return { type: "credits", amount: CREDIT_COST_PER_NESTING };
  }

  throw createError({
    statusCode: 402,
    statusMessage: "Subscription required",
    data: { reason: "paywall" },
  });
}
