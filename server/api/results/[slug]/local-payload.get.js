import { defineEventHandler } from 'h3'
import { connectDB } from '~~/server/db/mongo'

/**
 * Phase 2 (flag-gated QA): the exact engine payload (problem + instance +
 * engineConfig) the Python worker PREPARED for a local (browser) job. The
 * client fetches it once, runs the WASM engine on it, then POSTs the result
 * back to local-result. Only geometry the account could already see (owner,
 * or shared demo) — nothing more.
 */
export default defineEventHandler(async (event) => {
    const userId = event.context?.auth?.userId
    if (!userId) {
        throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
    }
    const config = useRuntimeConfig(event)
    const enabled = config.public.localComputeEnabled === true || config.public.localComputeEnabled === 'true'
    if (!enabled) {
        throw createError({ statusCode: 404, statusMessage: 'Not found' })
    }

    const slug = getRouterParam(event, 'slug')
    const db = await connectDB()
    const job = await db.collection('nesting_jobs').findOne(
        { slug },
        { projection: { ownerId: 1, projectSlug: 1, status: 1, localPayload: 1 } }
    )
    if (!job || (job.ownerId !== userId && job.projectSlug !== 'demo')) {
        throw createError({ statusCode: 404, statusMessage: 'Job not found' })
    }
    if (job.status !== 'awaiting_local' || !job.localPayload) {
        throw createError({ statusCode: 409, statusMessage: 'Job is not awaiting local compute' })
    }
    const payload = job.localPayload
    // Seed Mongo = BSON Int64: serialize toString(), otherwise the JSON
    // shows {low, high, unsigned} (AGENTS.md #16).
    return {
        ...payload,
        engineConfig: {
            ...payload.engineConfig,
            prng_seed: String(payload.engineConfig?.prng_seed ?? '0'),
        },
    }
})
