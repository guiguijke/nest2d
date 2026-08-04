import { requireAdmin } from '../../utils/auth'
import { connectDB, COL } from '../../db/mongo'

const CODE_REGEX = /^[A-Z0-9]{3,20}$/

// Create a partner promo code. A code raises the free monthly nesting quota
// of the users who redeem it (snapshot at redeem time — editing or
// deactivating the code later never affects existing beneficiaries).
//
// Body: {
//   code: string,            // 3-20 chars A-Z0-9 (normalized uppercase)
//   freeNestingLimit: int,   // 1-1000
//   partner: string,         // required, e.g. "JD's Garage"
//   expiresAt?: string|null, // ISO date — gates NEW redeems only
//   maxRedemptions?: int|null,
// }
export default defineEventHandler(async (event) => {
  const admin = requireAdmin(event)

  const body = await readBody(event).catch(() => ({}))

  const code = String(body?.code || '')
    .trim()
    .toUpperCase()
  if (!CODE_REGEX.test(code)) {
    throw createError({ statusCode: 400, statusMessage: 'Code invalide (3-20 caractères A-Z0-9)' })
  }

  const freeNestingLimit = Number(body?.freeNestingLimit)
  if (!Number.isInteger(freeNestingLimit) || freeNestingLimit < 1 || freeNestingLimit > 1000) {
    throw createError({ statusCode: 400, statusMessage: 'Limite invalide (entier 1-1000)' })
  }

  const partner = String(body?.partner || '')
    .trim()
    .slice(0, 120)
  if (!partner) {
    throw createError({ statusCode: 400, statusMessage: 'Partenaire requis' })
  }

  let expiresAt: Date | null = null
  if (body?.expiresAt) {
    expiresAt = new Date(String(body.expiresAt))
    if (isNaN(expiresAt.getTime())) {
      throw createError({ statusCode: 400, statusMessage: "Date d'expiration invalide" })
    }
  }

  let maxRedemptions: number | null = null
  if (body?.maxRedemptions != null && body?.maxRedemptions !== '') {
    maxRedemptions = Number(body.maxRedemptions)
    if (!Number.isInteger(maxRedemptions) || maxRedemptions < 1) {
      throw createError({ statusCode: 400, statusMessage: 'Max utilisations invalide (entier ≥ 1)' })
    }
  }

  const db = await connectDB()
  const codes = db.collection(COL.promoCodes)

  if (await codes.findOne({ code })) {
    throw createError({ statusCode: 409, statusMessage: 'Ce code existe déjà' })
  }

  const doc = {
    code,
    freeNestingLimit,
    partner,
    active: true,
    expiresAt,
    maxRedemptions,
    redemptionCount: 0,
    createdAt: new Date(),
  }
  try {
    await codes.insertOne(doc as any)
  } catch (err: any) {
    // Unique-index race (two admins creating the same code simultaneously).
    if (err?.code === 11000) {
      throw createError({ statusCode: 409, statusMessage: 'Ce code existe déjà' })
    }
    throw err
  }

  db.collection('adminActions')
    .insertOne({
      adminId: admin.id,
      adminEmail: admin.email,
      action: 'promoCodeCreate',
      summary: `Code promo ${code} créé (${freeNestingLimit}/mois, ${partner})`,
      raw: { ...doc },
      at: new Date(),
    })
    .catch(() => {})

  return { ok: true, code }
})
