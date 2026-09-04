import { defineEventHandler } from 'h3'
import { connectDB } from '~~/server/db/mongo'

/**
 * Phase 2 (flag-gated QA): the browser reports a local solve failure (engine
 * error, allocation refused, timeout). The job is marked failed and the
 * quota consumed at enqueue is REFUNDED inline — same semantics as the
 * worker's refund (worker_common/refund.py stays the reference): free →
 * freeNestingUsed -1, demo → demoNestingUsed -1, grant/subscription →
 * nothing was consumed. Guarded $gt: 0 like the worker.
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
    const job = await db.collection('nesting_jobs').findOne({ slug })
    // Owner-only, demo included (same rule as local-result): refunding or
    // failing someone else's job is never allowed.
    if (!job || job.ownerId !== userId) {
        throw createError({ statusCode: 404, statusMessage: 'Job not found' })
    }
    if (job.status !== 'awaiting_local') {
        throw createError({ statusCode: 409, statusMessage: 'Job is not awaiting local compute' })
    }

    const body = await readBody(event)
    const message = String(body?.error || 'Local compute failed').slice(0, 400)
    // Plan 2026-09-05 §1.2b : `unfit` structuré (infaisabilité bande /
    // capacité) persisté avec l'échec pour le bandeau UI.
    const unfit = body?.unfit && typeof body.unfit === 'object'
        ? {
            reason: String(body.unfit.reason || 'layout').slice(0, 32),
            ratio: Number.isFinite(Number(body.unfit.ratio)) ? Number(body.unfit.ratio) : undefined,
            sheetsNeeded: Number.isFinite(Number(body.unfit.sheetsNeeded)) ? Number(body.unfit.sheetsNeeded) : undefined,
            maxPartsAtSpacing: Number.isFinite(Number(body.unfit.maxPartsAtSpacing)) ? Number(body.unfit.maxPartsAtSpacing) : undefined,
            maxSpacingForFitMm: Number.isFinite(Number(body.unfit.maxSpacingForFitMm)) ? Number(body.unfit.maxSpacingForFitMm) : undefined,
            bestStripWidthMm: Number.isFinite(Number(body.unfit.bestStripWidthMm)) ? Number(body.unfit.bestStripWidthMm) : undefined,
        }
        : undefined

    // Inline refund — mirror of worker_common/refund.py (kept as reference).
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
        { slug },
        {
            $set: {
                status: 'error',
                placed: 0,
                information: message,
                finishedAt: new Date(),
                update_ts: new Date(),
                ...(unfit ? { unfit } : {}),
                ...(alreadyRefunded ? {} : { 'charge.refunded': true }),
            },
            $unset: { progress: '', compute: '', localPayload: '', liveLayout: '' },
        }
    )
    return { ok: true }
})
