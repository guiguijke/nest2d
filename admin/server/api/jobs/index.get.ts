import { requireAdmin } from '../../utils/auth'
import { connectDB, COL } from '../../db/mongo'

// Job monitoring across both nesting systems (classic + strip).
//
// Query params:
//   status  — queued | processing | done | failed (default: all non-done)
//   ownerId — filter by user
//   page, limit
//
// Returns a merged, recent list. We project a small set of fields to keep the
// payload light; jobs can carry large result blobs we never need here.
export default defineEventHandler(async (event) => {
  requireAdmin(event)
  const q = getQuery(event)

  const page = Math.max(1, parseInt(q.page as string) || 1)
  const limit = Math.min(200, Math.max(1, parseInt(q.limit as string) || 50))

  const baseQuery: any = {}
  if (q.status) baseQuery.status = String(q.status)
  else baseQuery.status = { $in: ['queued', 'processing', 'failed'] }
  if (q.ownerId) baseQuery.ownerId = String(q.ownerId)

  const proj = { _id: 0, slug: 1, ownerId: 1, status: 1, processingStatus: 1, projectSlug: 1, createdAt: 1, updatedAt: 1, error: 1, priority: 1 }

  const db = await connectDB()
  const [classic, strip] = await Promise.all([
    db
      .collection(COL.nestingJobs)
      .find(baseQuery, { projection: proj })
      .sort({ updatedAt: -1, createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .toArray()
      .then((rows) => rows.map((r) => ({ ...r, system: 'nesting' }))),
    db
      .collection(COL.stripJobQueue)
      .find(baseQuery, { projection: proj })
      .sort({ updatedAt: -1, createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .toArray()
      .then((rows) => rows.map((r) => ({ ...r, system: 'strip' }))),
  ])

  const merged = [...classic, ...strip].sort((a, b) => {
    const at = new Date(a.updatedAt || a.createdAt).getTime()
    const bt = new Date(b.updatedAt || b.createdAt).getTime()
    return bt - at
  })

  return {
    items: merged.slice(0, limit),
    page,
    limit,
    counts: {
      classic: await db.collection(COL.nestingJobs).countDocuments({ status: baseQuery.status }),
      strip: await db.collection(COL.stripJobQueue).countDocuments({ status: baseQuery.status }),
    },
  }
})
