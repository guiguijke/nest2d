import { connectDB } from '~~/server/db/mongo'
import { sendEmailVerification } from '~~/server/features/notification/emailVerification'
import { assertRateLimit } from '~~/server/utils/ratelimit'

/**
 * Resend the verification email. Requires an active session (the user is
 * logged in but unverified) — never leaks whether an email exists.
 */
export default defineEventHandler(async (event) => {
    const userId = event.context?.auth?.userId
    if (!userId) {
        throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
    }

    assertRateLimit(event, 'resend-ip', { limit: 10, windowMs: 60 * 60_000 })

    const db = await connectDB()
    const user = await db.collection('users').findOne({ id: userId })
    if (!user) {
        throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
    }
    if (user.emailVerified) {
        return { ok: true }
    }

    await sendEmailVerification(event, userId, user.email)
    return { ok: true }
})
