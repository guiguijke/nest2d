import { requireAdmin } from '../../utils/auth'
import { connectDB, COL } from '../../db/mongo'

// Lists all support conversations, newest first, with the last message preview
// and the user's identity. Non-streaming version of the main app's chatlist SSE.
export default defineEventHandler(async (event) => {
  requireAdmin(event)
  const db = await connectDB()

  const pipeline = [
    { $match: { sender: { $ne: 'welcome' } } },
    { $sort: { userId: 1, timestamp: 1 } },
    {
      $group: {
        _id: '$userId',
        userId: { $first: '$userId' },
        lastMessage: { $last: '$message' },
        lastSender: { $last: '$sender' },
        timestamp: { $last: '$timestamp' },
        count: { $sum: 1 },
      },
    },
    { $sort: { timestamp: -1 } },
    {
      $lookup: { from: 'users', localField: 'userId', foreignField: 'id', as: 'user' },
    },
    { $unwind: { path: '$user', preserveNullAndEmptyArrays: true } },
    {
      $project: {
        _id: 0,
        userId: 1,
        lastMessage: 1,
        lastSender: 1,
        timestamp: 1,
        count: 1,
        userName: '$user.name',
        userEmail: '$user.email',
      },
    },
  ]

  const conversations = await db.collection(COL.supportMessages).aggregate(pipeline).toArray()
  return { items: conversations }
})
