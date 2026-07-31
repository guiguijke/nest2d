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
    if (job.status !== 'pending' && job.status !== 'processing') {
        return { ok: false, status: job.status }
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
