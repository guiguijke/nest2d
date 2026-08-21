import { defineEventHandler } from 'h3'
import { connectDB } from '~~/server/db/mongo'

/**
 * Phase 2 (flag-gated QA): the exact engine payload (problem + instance +
 * engineConfig) the Python worker PREPARED for a local (browser) job. The
 * client fetches it once, runs the WASM engine on it, then POSTs the result
 * back to local-result. Only geometry the account could already see (owner,
 * or shared demo) — nothing more.
 *
 * J-090 : pour un projet « 100 % privé » (job.localConfig présent), le
 * payload moteur est ASSEMBLÉ PAR LE NAVIGATEUR (géométrie en IndexedDB) —
 * cette route ne sert alors QUE des métadonnées : params du job (tôles,
 * espacement, options), identifiants opaques + comptes/rotations, et le
 * profil compute imposé serveur. Aucune géométrie ni nom de fichier.
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
        { projection: { ownerId: 1, projectSlug: 1, status: 1, localPayload: 1, localConfig: 1, files: 1, params: 1 } }
    )
    // Owner-only, demo included (same rule as local-result/local-fail).
    if (!job || job.ownerId !== userId) {
        throw createError({ statusCode: 404, statusMessage: 'Job not found' })
    }
    if (job.status !== 'awaiting_local') {
        throw createError({ statusCode: 409, statusMessage: 'Job is not awaiting local compute' })
    }

    // J-090 — voie 100 % client : métadonnées + profil imposé, zéro géométrie.
    if (job.localConfig) {
        const p = job.params || {}
        return {
            mode: 'client-built',
            files: (job.files || []).map((f) => ({
                slug: f.slug,
                count: f.count || 0,
                rotations: f.rotations || null,
            })),
            params: {
                sheets: Array.isArray(p.sheets) ? p.sheets : null,
                width: p.width ?? null,
                height: p.height ?? null,
                sheetCount: p.sheetCount ?? null,
                space: p.space ?? 0,
                fillHoles: p.fillHoles !== false,
                addOutShape: Boolean(p.addOutShape),
                outputUnit: p.outputUnit || 'mm',
                directions: p.directions || ['left'],
                alternativesCount: p.alternativesCount || (Array.isArray(p.directions) ? p.directions.length : 1),
            },
            localConfig: job.localConfig,
        }
    }

    if (!job.localPayload) {
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
