import {
    connectDB,
    getAvatarBucket,
    getBucket,
} from '~~/server/db/mongo'
import { clearVaultSessions } from '~~/server/utils/vault'
import {
    cancelSubscriptionImmediately,
    deleteCustomer,
} from '~~/server/features/payment/stripe'
import { unsubscribeFromNewsletter } from '~~/server/features/listmonk/unsubscribe'
import { sendAccountDeletedEmail } from '~~/server/features/notification/sendEmail'
import logger from '~~/server/utils/logger'

/**
 * Full account deletion (GDPR right to erasure), self-serve from the profile
 * page. Immediate and irreversible.
 *
 * Covers every trace of the user across the system:
 *  - Stripe: active/trialing subscription canceled IMMEDIATELY (the account
 *    disappears, so the usual cancel-at-period-end grace is meaningless),
 *    then the customer is deleted so late webhooks hit nothing.
 *  - listmonk: newsletter subscriber removed (when the user opted in).
 *  - Running jobs: pending jobs are marked cancelled, processing jobs get
 *    cancelRequested (the bin-nesting worker polls it every ~2 s and stops
 *    cleanly; the strip worker ignores it — harmless). Compute-pool leases
 *    are keyed by job id and reaped automatically after 60 s without
 *    heartbeat, so there is nothing to release here.
 *  - GridFS: every file across the 7 content buckets (metadata.ownerId) plus
 *    the avatar (linked by filename, no ownerId metadata). Crypto-shredding
 *    works for vault-encrypted files — no DEK needed to delete ciphertext.
 *  - Mongo collections: owner-scoped (projects, files, jobs) and user-scoped
 *    (tokens with NO TTL index, vault sessions, checkouts, support messages,
 *    tracking, http logs).
 *  - adminActions: anonymized (targetUserId nulled) rather than deleted, so
 *    the admin audit trail keeps its shape without personal data.
 *  - users: the document itself, deleted LAST (every step above needs it).
 *
 * External calls (Stripe, listmonk, email) are best-effort: their failure
 * must never block the erasure. A tiny race remains with in-flight workers
 * (a job deleted mid-write can leave an ownerless GridFS file) — accepted
 * and bounded to a few seconds; orphan files carry no personal reference.
 *
 * @param {object} event H3 event (runtime config access for listmonk)
 * @param {object} user the full user document (must include id, email,
 *   provider, subscription, stripeCustomerId, newsletterOptIn)
 * @returns {Promise<object>} deletion summary (counts, for logs)
 */
export async function deleteUserAccount(event, user) {
    const userId = user.id
    const db = await connectDB()
    const summary = { userId }

    // 1. Stripe — cancel the subscription right away, then drop the customer.
    if (user.subscription?.stripeSubscriptionId) {
        try {
            await cancelSubscriptionImmediately(user.subscription.stripeSubscriptionId)
            summary.stripeSubscriptionCanceled = true
        } catch (err) {
            logger.warn(`Account deletion: Stripe subscription cancel failed for ${userId}:`, err?.data || err?.message || err)
        }
    }
    if (user.stripeCustomerId) {
        try {
            await deleteCustomer(user.stripeCustomerId)
            summary.stripeCustomerDeleted = true
        } catch (err) {
            logger.warn(`Account deletion: Stripe customer delete failed for ${userId}:`, err?.data || err?.message || err)
        }
    }

    // 2. listmonk — remove the newsletter subscriber (opt-in users only).
    if (user.newsletterOptIn && user.email) {
        summary.newsletterUnsubscribed = await unsubscribeFromNewsletter(event, { email: user.email })
    }

    // 3. Stop active jobs before wiping. pending → cancelled (never picked
    //    up), processing → cancelRequested (polled by the bin worker).
    const now = new Date()
    for (const name of ['nesting_jobs', 'strip_nesting_job_queue']) {
        const col = db.collection(name)
        await col.updateMany(
            { ownerId: userId, status: 'pending' },
            { $set: { status: 'cancelled', information: 'Account deleted.', update_ts: now } }
        )
        await col.updateMany(
            { ownerId: userId, status: 'processing' },
            { $set: { cancelRequested: true, update_ts: now } }
        )
    }

    // 4. GridFS — content buckets by owner metadata, avatar by filename.
    let gridFsDeleted = 0
    for (const bucketName of [
        'userDxf',
        'validDxf',
        'userDxfFilesSvg',
        'stripUserDxf',
        'nestDxf',
        'nestSvg',
        'stripNestDxf',
    ]) {
        const bucket = await getBucket(bucketName)
        const files = await bucket.find({ 'metadata.ownerId': userId }).toArray()
        await Promise.all(files.map((f) => bucket.delete(f._id)))
        gridFsDeleted += files.length
    }
    const avatarBucket = await getAvatarBucket()
    const avatars = await avatarBucket.find({ filename: `avatar-${userId}.jpg` }).toArray()
    await Promise.all(avatars.map((f) => avatarBucket.delete(f._id)))
    summary.gridFsFilesDeleted = gridFsDeleted + avatars.length

    // 5. Mongo collections — owner-scoped, then userId-scoped.
    for (const name of [
        'user_dxf_files',
        'strip_user_dxf_files',
        'projects',
        'strip_projects',
        'nesting_jobs',
        'strip_nesting_job_queue',
    ]) {
        await db.collection(name).deleteMany({ ownerId: userId })
    }
    for (const name of [
        'passwordResets',
        'emailVerifications',
        'subscription_checkouts',
        'supportMessages',
        'tracking',
        'http',
    ]) {
        await db.collection(name).deleteMany({ userId })
    }
    await clearVaultSessions(userId)

    // 6. Admin audit trail — keep the actions, drop the personal reference.
    await db.collection('adminActions').updateMany(
        { targetUserId: userId },
        { $set: { targetUserId: null, targetUserDeleted: true } }
    )

    // 7. The user document itself, last.
    await db.collection('users').deleteOne({ id: userId })

    // 8. Confirmation email — best-effort, after everything (address already
    //    captured, so the deleted document is not needed).
    if (user.email) {
        try {
            await sendAccountDeletedEmail(user.email)
        } catch (err) {
            logger.warn(`Account deletion: confirmation email failed for ${userId}:`, err?.message || err)
        }
    }

    logger.info(`Account deleted: ${userId}`, summary)
    return summary
}
