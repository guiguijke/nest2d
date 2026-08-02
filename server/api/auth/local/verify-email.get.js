import { consumeVerificationToken } from '~~/server/features/notification/emailVerification'

/**
 * Landing target of the verification link sent by email. Consumes the token
 * and redirects to a friendly page reflecting the outcome.
 */
export default defineEventHandler(async (event) => {
    const { token } = getQuery(event)
    if (!token) {
        return sendRedirect(event, '/auth/verify-email?status=invalid', 302)
    }

    const userId = await consumeVerificationToken(token)
    if (!userId) {
        return sendRedirect(event, '/auth/verify-email?status=invalid', 302)
    }
    return sendRedirect(event, '/auth/verify-email?status=ok', 302)
})
