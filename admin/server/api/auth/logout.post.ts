import { connectDB } from '../../db/mongo'
import { clearAdminSessionCookie, hashToken, readAdminSessionToken } from '../../utils/sessions'

// Admin logout: remove the current session token from the admin doc and clear
// the cookie.
export default defineEventHandler(async (event) => {
  const token = readAdminSessionToken(event)
  if (token) {
    const db = await connectDB()
    await db.collection('admins').updateMany(
      {},
      { $pull: { sessions: { tokenHash: hashToken(token) } } },
    )
  }
  clearAdminSessionCookie(event)
  return { ok: true }
})
