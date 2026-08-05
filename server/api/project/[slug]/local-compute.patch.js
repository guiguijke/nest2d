import { defineEventHandler } from 'h3'
import { connectDB } from '~~/server/db/mongo'

/**
 * Phase 2 (flag-gated QA): persists the paid project's local-compute opt-in
 * (free is always local when the flag is on — J-059). Resolved SERVER-SIDE
 * at enqueue (P3) — the toggle only exists for paid plans.
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
    const project = await db.collection('projects').findOne({ slug })
    if (!project || project.ownerId !== userId || project.isDemo) {
        throw createError({ statusCode: 404, statusMessage: 'Project not found' })
    }

    const { getComputeTier } = await import('~~/server/utils/entitlement')
    const tier = await getComputeTier(userId, null)
    if (tier === 'free') {
        throw createError({ statusCode: 400, statusMessage: 'The Free plan always computes locally' })
    }

    const body = await readBody(event)
    const localCompute = body?.localCompute === true
    await db.collection('projects').updateOne({ slug }, { $set: { localCompute } })
    return { ok: true, localCompute }
})
