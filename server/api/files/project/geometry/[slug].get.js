import { defineEventHandler } from 'h3'
import { connectDB } from '~~/server/db/mongo'
import { resolvePolygonParts } from '~~/server/utils/vault'

/**
 * Part geometry (outer rings + holes, local mm frame) for the live nesting
 * visualizer. Decrypted server-side when the vault session is active — the
 * browser never sees more than what the file owner could already download.
 */
export default defineEventHandler(async (event) => {
    const userId = event.context?.auth?.userId
    if (!userId) {
        throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
    }
    const slug = getRouterParam(event, 'slug')
    const db = await connectDB()
    const file = await db.collection('user_dxf_files').findOne({ slug, ownerId: userId })
    if (!file) {
        throw createError({ statusCode: 404, statusMessage: 'File not found' })
    }
    const parts = await resolvePolygonParts(userId, file)
    return {
        parts: (parts || []).map((p) => ({
            coordinates: p.coordinates,
            holes: p.holes || [],
        })),
    }
})
