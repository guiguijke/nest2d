import bcrypt from 'bcryptjs'
import { connectDB } from '../../db/mongo'
import { generateSession, setAdminSessionCookie } from '../../utils/sessions'

// Admin login. Email + password → bcrypt verify → session cookie.
//
// We compare against a dummy hash when the admin is unknown so that timing
// stays constant (limits user enumeration), mirroring the main app's login.
const DUMMY_HASH =
  '$2a$10$CwTycUXWue0Thq9StjUM0uJ8.0a7sQ2f3AaFv1lFq1nU5Xm9c.W.'

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const email = String(body?.email || '').trim().toLowerCase()
  const password = String(body?.password || '')

  if (!email || !password) {
    throw createError({ statusCode: 400, statusMessage: 'Email et mot de passe requis.' })
  }

  const db = await connectDB()
  const admin = await db.collection('admins').findOne({ email })

  const hash = admin?.passwordHash || DUMMY_HASH
  const ok = await bcrypt.compare(password, hash)

  if (!admin || !ok) {
    throw createError({ statusCode: 401, statusMessage: 'Identifiants invalides.' })
  }

  const session = generateSession()
  await db.collection('admins').updateOne(
    { _id: admin._id },
    {
      $push: { sessions: { tokenHash: session.tokenHash, createdAt: session.createdAt, expiresAt: session.expiresAt } },
      $set: { lastActiveAt: new Date() },
    },
  )

  setAdminSessionCookie(event, session.token, session.expiresAt)

  return {
    ok: true,
    admin: {
      id: admin.id,
      email: admin.email,
      name: admin.name,
    },
  }
})
