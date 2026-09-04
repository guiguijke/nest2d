import { defineEventHandler } from 'h3'
import { connectDB } from '~~/server/db/mongo'

/**
 * PR5 (Mode Local productisé) : le navigateur rapporte la FIN d'un nesting
 * local RÉUSSI en ne transmettant que de la COMPTABILITÉ (scalaires) —
 * AUCUNE géométrie ne quitte le navigateur (décision centrale J-077).
 * Les résultats complets (alternatives, placements, artefacts) restent en
 * IndexedDB côté client pour re-lecture/téléchargement hors serveur.
 *
 * Le quota a été consommé à l'enqueue (assertCanNest) ; un succès ne
 * rembourse rien (échec ≠ quota : le refund passe par local-fail).
 *
 * Corps accepté : { placed?, layoutCount?, density? } — tous numériques,
 * bornés ; tout le reste est ignoré. Owner-only, flag-gaté, status
 * awaiting_local uniquement (mêmes règles que local-result).
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
    if (!job || job.ownerId !== userId) {
        throw createError({ statusCode: 404, statusMessage: 'Job not found' })
    }
    if (job.status !== 'awaiting_local') {
        throw createError({ statusCode: 409, statusMessage: 'Job is not awaiting local compute' })
    }

    const body = await readBody(event)
    const num = (v, lo, hi) => {
        const n = Number(v)
        return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : null
    }
    const placed = num(body?.placed, 0, 10_000_000)
    const layoutCount = num(body?.layoutCount, 0, 10_000)
    const density = num(body?.density, 0, 1)
    // Z3 (vérif 2026-09-05) : leviers d'une solution partielle locale —
    // scalaires bornés uniquement, mêmes règles que local-fail.
    const rawUnfit = body?.unfit
    const unfit = (rawUnfit && typeof rawUnfit === 'object')
        ? {
            reason: String(rawUnfit.reason || 'partial').slice(0, 24),
            ...(num(rawUnfit.unplaced, 0, 10_000_000) != null
                ? { unplaced: num(rawUnfit.unplaced, 0, 10_000_000) } : {}),
            ...(num(rawUnfit.ratio, 0, 100) != null ? { ratio: num(rawUnfit.ratio, 0, 100) } : {}),
            ...(num(rawUnfit.sheetsNeeded, 0, 10_000) != null
                ? { sheetsNeeded: num(rawUnfit.sheetsNeeded, 0, 10_000) } : {}),
            ...(num(rawUnfit.maxPartsAtSpacing, 0, 10_000_000) != null
                ? { maxPartsAtSpacing: num(rawUnfit.maxPartsAtSpacing, 0, 10_000_000) } : {}),
            ...(num(rawUnfit.maxSpacingForFitMm, 0, 10_000) != null
                ? { maxSpacingForFitMm: num(rawUnfit.maxSpacingForFitMm, 0, 10_000) } : {}),
        }
        : null

    await db.collection('nesting_jobs').updateOne(
        { slug },
        {
            $set: {
                status: 'done',
                // Comptabilité seule — la géométrie reste dans le navigateur.
                placed: placed ?? job.requested ?? 0,
                layoutCount: layoutCount ?? 0,
                density: density ?? null,
                localOnly: true,
                ...(unfit ? { unfit } : {}),
                finishedAt: new Date(),
                update_ts: new Date(),
            },
            $unset: { progress: '', compute: '', localPayload: '', liveLayout: '' },
        },
    )
    return { ok: true }
})
