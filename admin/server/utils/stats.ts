import { connectDB, COL } from '../db/mongo'

// Shared aggregation helpers for dashboard KPIs.
//
// All counts run against the SAME collections the main app + workers write to.
// They are intentionally defensive (the collections/fields may be sparse on a
// fresh install) so the dashboard never 500s on an empty DB.

const ACTIVE_SUB_STATUSES = ['trialing', 'active']

function daysAgo(n: number): Date {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000)
}
function minsAgo(n: number): Date {
  return new Date(Date.now() - n * 60 * 1000)
}

export async function getOverviewStats() {
  const db = await connectDB()
  const users = db.collection(COL.users)
  const jobs = db.collection(COL.nestingJobs)
  const stripJobs = db.collection(COL.stripJobQueue)
  const tracking = db.collection(COL.tracking)
  const support = db.collection(COL.supportMessages)
  const transactions = db.collection(COL.transactions)

  const since24h = daysAgo(1)
  const since7d = daysAgo(7)
  const since30d = daysAgo(30)
  const active5m = minsAgo(5)

  // Run independent counts in parallel.
  const [
    totalUsers,
    signups24h,
    signups7d,
    signups30d,
    bannedUsers,
    activeSubscribers,
    activeUsers5m,
    totalAdmins,
  ] = await Promise.all([
    users.estimatedDocumentCount(),
    users.countDocuments({ createdAt: { $gte: since24h } }),
    users.countDocuments({ createdAt: { $gte: since7d } }),
    users.countDocuments({ createdAt: { $gte: since30d } }),
    users.countDocuments({ banned: true }),
    users.countDocuments({ 'subscription.status': { $in: ACTIVE_SUB_STATUSES } }),
    users.countDocuments({ lastActiveAt: { $gte: active5m } }),
    db.collection(COL.admins).estimatedDocumentCount(),
  ])

  // Job stats across both nesting systems.
  const [jobsQueued, jobsProcessing, jobsFailed, jobsDone24h] = await Promise.all([
    jobs.countDocuments({ status: 'queued' }),
    jobs.countDocuments({ status: 'processing' }),
    jobs.countDocuments({ status: 'failed' }),
    jobs.countDocuments({ status: 'done', updatedAt: { $gte: since24h } }),
  ])
  const [stripQueued, stripProcessing, stripFailed] = await Promise.all([
    stripJobs.countDocuments({ status: 'queued' }),
    stripJobs.countDocuments({ status: 'processing' }),
    stripJobs.countDocuments({ status: 'failed' }),
  ])

  // Signups per day for the last 30 days (for the sparkline).
  const signupsSeries = await users
    .aggregate([
      { $match: { createdAt: { $gte: since30d } } },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ])
    .toArray()

  // Unread support threads (threads where the last message is from a user
  // i.e. not from an admin). We approximate "unread" by absence of a recent
  // admin reply; the support page gives the precise view.
  const unreadSupport = await support
    .aggregate([
      { $sort: { timestamp: 1 } },
      { $group: { _id: '$userId', lastFromAdmin: { $last: '$fromAdmin' } } },
      { $match: { lastFromAdmin: { $ne: true } } },
      { $count: 'threads' },
    ])
    .toArray()
    .then((r) => r[0]?.threads || 0)

  // Tracking events in the last 24h (activity pulse).
  const events24h = await tracking.countDocuments({ timestamp: { $gte: since24h } })

  return {
    users: {
      total: totalUsers,
      signups24h,
      signups7d,
      signups30d,
      banned: bannedUsers,
      activeSubscribers,
      active5m: activeUsers5m,
    },
    jobs: {
      queued: jobsQueued + stripQueued,
      processing: jobsProcessing + stripProcessing,
      failed: jobsFailed + stripFailed,
      done24h: jobsDone24h,
    },
    signupsSeries: signupsSeries.map((s: any) => ({ date: s._id, count: s.count })),
    support: { unreadThreads: unreadSupport },
    activity: { events24h },
    meta: { admins: totalAdmins, generatedAt: new Date() },
  }
}
