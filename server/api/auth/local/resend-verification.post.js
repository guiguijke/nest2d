import { connectDB } from '~~/server/db/mongo'
import { sendEmailVerification } from '~~/server/features/notification/emailVerification'

/**
 * Resend the verification email. Requires an active session (the user is
 * logged in but unverified) — never leaks whether an email exists.
 */
export default defineEventHandler(async (event) => {
    const userId = event.context?.auth?.userId
    if (!userId) {
        throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
    }

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
