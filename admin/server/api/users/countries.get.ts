import { requireAdmin } from '../../utils/auth'
import { connectDB, COL } from '../../db/mongo'

// Country options for the users page filter dropdown: distinct signupCountry
// with user counts, most frequent first. Draws only from users.signupCountry —
// the same field the list filter matches on (unlike geo/distribution, which
// also merges tracking events).
export default defineEventHandler(async (event) => {
    requireAdmin(event)
    const db = await connectDB()
    const countries = await db
        .collection(COL.users)
        .aggregate([
            { $match: { signupCountry: { $type: 'string', $ne: '' } } },
            { $group: { _id: '$signupCountry', count: { $sum: 1 } } },
            { $sort: { count: -1 } },
            { $project: { _id: 0, code: '$_id', count: 1 } },
        ])
        .toArray()
    return { countries }
})
