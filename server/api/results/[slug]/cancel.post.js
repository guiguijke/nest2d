import { defineEventHandler } from 'h3'
import { connectDB } from '~~/server/db/mongo'

/**
 * Cancel a nesting job owned by the caller.
 * - pending: cancelled immediately (the worker only claims pending jobs).
 * - processing: the cancelRequested flag is set; the worker's engine driver
 *   polls it (about every 2s), kills the engine and finalizes the job as
 *   cancelled (charge refunded).
 */
export default defineEventHandler(async (event) => {
    const userId = event.context?.auth?.userId
    if (!userId) {
        throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
    }

    const slug = getRouterParam(event, 'slug')
    const db = await connectDB()
    const job = await db.collection('nesting_jobs').findOne({ slug, ownerId: userId })
    if (!job) {
        throw createError({ statusCode: 404, statusMessage: 'Job not found' })
    }
    if (job.status !== 'pending' && job.status !== 'processing' && job.status !== 'awaiting_local') {
        return { ok: false, status: job.status }
    }

    // J-093 : un job local (navigateur) s'annule comme un échec local — le
    // pool de workers est terminé côté client, le serveur finalise et
    // refunde le quota (miroir de local-fail.post.js / worker refund.py).
    if (job.status === 'awaiting_local') {
        const chargeType = job.charge?.type
        const alreadyRefunded = Boolean(job.charge?.refunded)
        if (!alreadyRefunded && chargeType === 'free') {
            await db.collection('users').updateOne(
                { id: job.ownerId, freeNestingUsed: { $gt: 0 } },
                { $inc: { freeNestingUsed: -1 } }
            )
        } else if (!alreadyRefunded && chargeType === 'demo' && !job.charge?.skippedQuota) {
            await db.collection('users').updateOne(
                { id: job.ownerId, demoNestingUsed: { $gt: 0 } },
                { $inc: { demoNestingUsed: -1 } }
            )
        }
        await db.collection('nesting_jobs').updateOne(
            { _id: job._id },
            {
                $set: {
                    status: 'cancelled',
                    cancelRequested: true,
                    information: 'Nesting cancelled by user.',
                    finishedAt: new Date(),
                    update_ts: new Date(),
                    ...(alreadyRefunded ? {} : { 'charge.refunded': true }),
                },
                $unset: { progress: '', compute: '', localPayload: '', liveLayout: '' },
            }
        )
        return { ok: true, status: 'cancelled' }
    }

    if (job.status === 'pending') {
        await db.collection('nesting_jobs').updateOne(
            { _id: job._id },
            {
                $set: {
                    status: 'cancelled',
                    cancelRequested: true,
                    information: 'Nesting cancelled by user before it started.',
                    finishedAt: new Date(),
                    update_ts: new Date(),
                },
                $unset: { progress: '' },
            }
        )
        return { ok: true, status: 'cancelled' }
    }

    await db.collection('nesting_jobs').updateOne(
        { _id: job._id },
        { $set: { cancelRequested: true, update_ts: new Date() } }
    )
    return { ok: true, status: 'cancelling' }
})
