import { connectDB } from '../db/mongo'
import { hashToken, readAdminSessionToken, verifyToken } from './sessions'

// Resolves the current admin from the `adminSessionId` cookie, or null.
// Mirrors the main app's getUserBySessionId but against the `admins` collection.
export async function getAdminBySession(event: any) {
  const token = readAdminSessionToken(event)
  if (!token) return null

  const db = await connectDB()
  // We don't know which admin owns this token without scanning. We store the
  // token hash on the admin doc and match it directly via the array elemMatch.
  const admin = await db.collection('admins').findOne({
    sessions: {
      $elemMatch: {
        tokenHash: hashToken(token),
        expiresAt: { $gt: new Date() },
      },
    },
  })

  if (!admin) return null
  if (!verifyToken(token, admin.sessions.find((s: any) => s.tokenHash === hashToken(token))?.tokenHash)) {
    return null
  }

  // Bump lastActiveAt (fire and forget).
  db.collection('admins')
    .updateOne({ _id: admin._id }, { $set: { lastActiveAt: new Date() } })
    .catch(() => {})

  return {
    id: admin.id,
    email: admin.email,
    name: admin.name,
    createdAt: admin.createdAt,
    lastActiveAt: admin.lastActiveAt,
  }
}

// Helper used by every admin API route to enforce authentication.
export function requireAdmin(event: any) {
  const admin = event.context?.admin
  if (!admin) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  }
  return admin
}
