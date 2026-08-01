import bcrypt from 'bcryptjs'
import { timingSafeEqual } from 'node:crypto'
import { connectDB, COL } from '../../db/mongo'
import { setupToken } from '../../utils/setupToken'

// Create the very first admin account.
//
// This endpoint is ONLY available when the `admins` collection is empty, and
// requires the one-time setup token (printed to the server logs at boot).
// Once the first admin exists, this endpoint is permanently disabled.
//
// Body: { email, name, password, token }
export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const token = String(body?.token || '')
  const email = String(body?.email || '').trim().toLowerCase()
  const name = String(body?.name || '').trim()
  const password = String(body?.password || '')

  // Validate the token in constant time to avoid a timing oracle on the
  // setup token. Different lengths short-circuit to false (no secret leak:
  // the token length is not sensitive, only its value).
  const tokenBuf = Buffer.from(token)
  const expectedBuf = Buffer.from(setupToken)
  const validToken =
    tokenBuf.length === expectedBuf.length &&
    timingSafeEqual(tokenBuf, expectedBuf)
  if (!token || !validToken) {
    throw createError({ statusCode: 403, statusMessage: 'Token de configuration invalide ou manquant.' })
  }

  if (!email || !name || password.length < 10) {
    throw createError({ statusCode: 400, statusMessage: 'Email, nom et mot de passe (≥ 10 caractères) requis.' })
  }

  const db = await connectDB()

  // HARD GATE: only works when no admin exists. Once an admin exists, this is
  // permanently locked — even with the token.
  const existingCount = await db.collection(COL.admins).estimatedDocumentCount()
  if (existingCount > 0) {
    throw createError({ statusCode: 409, statusMessage: 'Un compte admin existe déjà. Cette étape de configuration est verrouillée.' })
  }

  const id = `admin:${email}`
  // Defensive: an admin doc with this email but not counted? (e.g. race) — reject.
  const clash = await db.collection(COL.admins).findOne({ id })
  if (clash) {
    throw createError({ statusCode: 409, statusMessage: 'Un admin avec cet email existe déjà.' })
  }

  const passwordHash = await bcrypt.hash(password, 10)
  await db.collection(COL.admins).insertOne({
    id,
    email,
    name,
    passwordHash,
    sessions: [],
    createdAt: new Date(),
    lastActiveAt: new Date(),
  })

  return { ok: true, message: `Admin « ${email} » créé. Vous pouvez vous connecter.` }
})
