import { requireAdmin } from '../../utils/auth'
import { connectDB, COL } from '../../db/mongo'

// Toggle a promo code on/off. Deactivation only blocks NEW redeems — users
// who already redeemed keep their snapshotted quota (partnership promise).
//
// Body: { active: boolean }
export default defineEventHandler(async (event) => {
  const admin = requireAdmin(event)

  const code = String(getRouterParam(event, 'code') || '')
    .trim()
    .toUpperCase()
  if (!code) throw createError({ statusCode: 400, statusMessage: 'Missing code' })

  const body = await readBody(event).catch(() => ({}))
  if (typeof body?.active !== 'boolean') {
    throw createError({ statusCode: 400, statusMessage: 'Missing active (boolean)' })
  }

  const db = await connectDB()
  const res = await db
    .collection(COL.promoCodes)
    .updateOne({ code }, { $set: { active: body.active } })
  if (res.matchedCount === 0) {
    throw createError({ statusCode: 404, statusMessage: 'Code introuvable' })
  }

  db.collection('adminActions')
    .insertOne({
      adminId: admin.id,
      adminEmail: admin.email,
      action: 'promoCodeToggle',
      summary: `Code promo ${code} ${body.active ? 'activé' : 'désactivé'}`,
      raw: { code, active: body.active },
      at: new Date(),
    })
    .catch(() => {})

  return { ok: true, code, active: body.active }
})
