import { connectDB } from '~~/server/db/mongo'

const VALID_UNITS = ['mm', 'inch']

/**
 * PATCH /api/user/preferences — per-user UI preferences.
 * Body: { preferredUnit: 'mm' | 'inch' }
 */
export default defineEventHandler(async (event) => {
    const userId = event.context?.auth?.userId
    if (!userId) {
        throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
    }

    const body = await readBody(event)
    const preferredUnit = body?.preferredUnit
    if (!VALID_UNITS.includes(preferredUnit)) {
        throw createError({ statusCode: 400, statusMessage: 'Invalid preferredUnit' })
    }

    const db = await connectDB()
    await db.collection('users').updateOne({ id: userId }, { $set: { preferredUnit } })

    return { ok: true, preferredUnit }
})
