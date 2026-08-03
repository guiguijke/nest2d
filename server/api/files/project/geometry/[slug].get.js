import { defineEventHandler } from 'h3'
import { connectDB } from '~~/server/db/mongo'
import { resolvePolygonParts } from '~~/server/utils/vault'
import { resolvePartColor } from '~~/server/utils/colors'

/**
 * Part geometry (outer rings + holes + display color, local mm frame) for the
 * live nesting visualizer. Decrypted server-side when the vault session is
 * active — the browser never sees more than what the file owner could already
 * download. Demo files (isDemo, shared read-only project) are world-readable.
 */
export default defineEventHandler(async (event) => {
    const userId = event.context?.auth?.userId
    if (!userId) {
        throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
    }
    const slug = getRouterParam(event, 'slug')
    const db = await connectDB()
    const file = await db.collection('user_dxf_files').findOne({
        slug,
        $or: [{ ownerId: userId }, { isDemo: true }],
    })
    if (!file) {
        throw createError({ statusCode: 404, statusMessage: 'File not found' })
    }
    const parts = await resolvePolygonParts(userId, file)
    return {
        parts: (parts || []).map((p, index) => ({
            coordinates: p.coordinates,
            holes: p.holes || [],
            // Persisted at import; deterministic fallback for legacy files.
            color: resolvePartColor(p, slug, index),
        })),
    }
})
