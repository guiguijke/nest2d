import { requireAdmin } from '../../utils/auth'
import { connectDB, COL } from '../../db/mongo'

// Returns the full message thread for one user.
export default defineEventHandler(async (event) => {
  requireAdmin(event)
  const userId = getRouterParam(event, 'userId')
  if (!userId) throw createError({ statusCode: 400, statusMessage: 'Missing userId' })

  const db = await connectDB()
  const messages = await db
    .collection(COL.supportMessages)
    .find({ userId })
    .sort({ timestamp: 1 })
    .project({ _id: 0, userId: 1, sender: 1, message: 1, timestamp: 1 })
    .toArray()

  const user = await db
    .collection(COL.users)
    .findOne({ id: userId }, { projection: { _id: 0, id: 1, name: 1, email: 1, createdAt: 1 } })

  return { user, messages }
})
