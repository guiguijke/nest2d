import bcrypt from 'bcryptjs'
import { connectDB } from '~~/server/db/mongo'
import { assertRateLimit } from '~~/server/utils/ratelimit'
import { deleteUserAccount } from '~~/server/features/account/delete'

/**
 * Self-serve account deletion (GDPR right to erasure). Immediate and
 * irreversible: wipes every trace of the user (see features/account/delete.js
 * for the full inventory).
 *
 * Confirmation is two-factor to prevent both accidents and session-hijack
 * deletions:
 *  - confirmEmail must match the account email (typed, not clicked);
 *  - local accounts must also prove knowledge of the password (Google
 *    accounts have none — the email challenge is all we can ask).
 *
 * Error statusMessages are stable CODES (not prose) so the client translates
 * them — same pattern as 'vault_locked' / 'email_not_verified'.
 */
export default defineEventHandler(async (event) => {
    const userId = event.context?.auth?.userId
    if (!userId) {
        throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
    }

    assertRateLimit(event, 'account-delete', { limit: 5, windowMs: 60_000 })

    const db = await connectDB()
    const user = await db.collection('users').findOne({ id: userId })
    if (!user) {
        throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
    }

    const body = await readBody(event)
    const confirmEmail = String(body?.confirmEmail || '').trim()
    if (!confirmEmail || confirmEmail.toLowerCase() !== String(user.email || '').toLowerCase()) {
        throw createError({ statusCode: 400, statusMessage: 'confirmation_email_mismatch' })
    }

    if (user.provider === 'local') {
        const password = String(body?.password || '')
        if (!password) {
            throw createError({ statusCode: 400, statusMessage: 'password_required' })
        }
        const ok = await bcrypt.compare(password, user.passwordHash || '')
        if (!ok) {
            throw createError({ statusCode: 403, statusMessage: 'invalid_password' })
        }
    }

    const summary = await deleteUserAccount(event, user)

    // The account is gone: kill the session cookie exactly like logout.
    setCookie(event, 'sessionId', '', {
        expires: new Date(0),
    })
    setHeader(event, 'Clear-Site-Data', '"cache", "storage"')

    return { ok: true, ...summary }
})
