import { requireAdmin } from '../../utils/auth'
import { connectDB, COL } from '../../db/mongo'

// List all partner promo codes, newest first. Volume is small (a handful of
// partners), so no pagination — a hard cap guards against accidents.
export default defineEventHandler(async (event) => {
  requireAdmin(event)

  const db = await connectDB()
  const items = await db
    .collection(COL.promoCodes)
    .find(
      {},
      {
        projection: {
          code: 1,
          partner: 1,
          freeNestingLimit: 1,
          active: 1,
          expiresAt: 1,
          maxRedemptions: 1,
          redemptionCount: 1,
          createdAt: 1,
        },
      },
    )
    .sort({ createdAt: -1 })
    .limit(500)
    .toArray()

  return { items }
})
