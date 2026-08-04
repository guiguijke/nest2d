import { requireAdmin } from '../../utils/auth'
import { connectDB, COL } from '../../db/mongo'

// Update a promo code: toggle on/off and/or set the campaign end date.
//
// The campaign end (expiresAt) applies to NEW redeems AND to existing
// beneficiaries: changing it propagates to every users.promo snapshot of
// this code — this is the renewal lever ("reconduire le code pour N mois").
// Setting expiresAt to null makes the code (and its beneficiaries)
// unlimited again. Deactivation (active=false) only blocks new redeems.
//
// Body: { active?: boolean, expiresAt?: string|null } — at least one required.
export default defineEventHandler(async (event) => {
  const admin = requireAdmin(event)

  const code = String(getRouterParam(event, 'code') || '')
    .trim()
    .toUpperCase()
  if (!code) throw createError({ statusCode: 400, statusMessage: 'Missing code' })

  const body = await readBody(event).catch(() => ({}))
  const hasActive = typeof body?.active === 'boolean'
  const hasExpiry = body?.expiresAt !== undefined
  if (!hasActive && !hasExpiry) {
    throw createError({ statusCode: 400, statusMessage: 'Nothing to update (active or expiresAt required)' })
  }

  const $set: any = {}
  if (hasActive) $set.active = body.active

  let newExpiry: Date | null = null
  if (hasExpiry) {
    if (body.expiresAt === null || body.expiresAt === '') {
      newExpiry = null
    } else {
      newExpiry = new Date(String(body.expiresAt))
      if (isNaN(newExpiry.getTime())) {
        throw createError({ statusCode: 400, statusMessage: "Date d'expiration invalide" })
      }
    }
    $set.expiresAt = newExpiry
  }

  const db = await connectDB()
  const res = await db.collection(COL.promoCodes).updateOne({ code }, { $set })
  if (res.matchedCount === 0) {
    throw createError({ statusCode: 404, statusMessage: 'Code introuvable' })
  }

  // Propagate the new campaign end to every beneficiary of this code.
  let propagated = 0
  if (hasExpiry) {
    const users = await db
      .collection(COL.users)
      .updateMany({ 'promo.code': code }, { $set: { 'promo.expiresAt': newExpiry } })
    propagated = users.modifiedCount
  }

  const summaryParts: string[] = []
  if (hasActive) summaryParts.push(body.active ? 'activé' : 'désactivé')
  if (hasExpiry) {
    summaryParts.push(
      newExpiry
        ? `fin de campagne au ${newExpiry.toISOString().slice(0, 10)} (${propagated} bénéficiaire(s))`
        : `passé en illimité (${propagated} bénéficiaire(s))`,
    )
  }

  db.collection('adminActions')
    .insertOne({
      adminId: admin.id,
      adminEmail: admin.email,
      action: 'promoCodeUpdate',
      summary: `Code promo ${code} : ${summaryParts.join(', ')}`,
      raw: { code, ...$set, propagated },
      at: new Date(),
    })
    .catch(() => {})

  return { ok: true, code, ...$set, propagated }
})
