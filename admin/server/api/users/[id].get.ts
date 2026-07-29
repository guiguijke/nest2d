import { requireAdmin } from '../../utils/auth'
import { connectDB, COL } from '../../db/mongo'

// Full detail for one user: profile + activity + sessions + recent events.
export default defineEventHandler(async (event) => {
  requireAdmin(event)
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Missing id' })

  const db = await connectDB()
  const users = db.collection(COL.users)

  const user = await users.findOne(
    { id },
    {
      projection: {
        passwordHash: 0,
        // sessions: keep so we can show a count, but never expose tokens.
      },
    },
  )
  if (!user) throw createError({ statusCode: 404, statusMessage: 'Utilisateur introuvable' })

  // Parallel activity counts.
  const [projects, stripProjects, jobsTotal, jobsFailed, dxfFiles, trackingEvents] = await Promise.all([
    db.collection(COL.projects).countDocuments({ ownerId: id }),
    db.collection(COL.stripProjects).countDocuments({ ownerId: id }),
    db.collection(COL.nestingJobs).countDocuments({ ownerId: id }),
    db.collection(COL.nestingJobs).countDocuments({ ownerId: id, status: 'failed' }),
    db.collection('user_dxf_files').countDocuments({ ownerId: id }),
    db.collection(COL.tracking).countDocuments({ userId: id }),
  ])

  const activeSessions = (user.sessions || []).filter((s: any) => new Date(s.expiresAt) > new Date()).length

  // Recent tracking events for this user.
  const recentEvents = await db
    .collection(COL.tracking)
    .find({ userId: id })
    .sort({ timestamp: -1 })
    .limit(20)
    .project({ _id: 0, action: 1, country: 1, timestamp: 1 })
    .toArray()

  return {
    user: {
      ...user,
      sessions: undefined, // never leak tokens
    },
    activity: { projects, stripProjects, jobsTotal, jobsFailed, dxfFiles, trackingEvents, activeSessions },
    recentEvents,
  }
})
