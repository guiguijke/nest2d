import { requireAdmin } from '../../utils/auth'
import { connectDB, COL } from '../../db/mongo'

// Server-Sent Events stream of live KPIs. The dashboard keeps one open
// connection and re-polls a lightweight subset of counters every ~10s, so the
// numbers on screen feel live without hammering the DB.
//
// We use the same SSE pattern as the main app (setEventStream + manual writes).

function daysAgo(n: number) {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000)
}

async function liveCounts() {
  const db = await connectDB()
  const since24h = daysAgo(1)
  const [queued, processing, failed, signups24h, active5m, events24h] = await Promise.all([
    db.collection(COL.nestingJobs).countDocuments({ status: 'queued' }),
    db.collection(COL.nestingJobs).countDocuments({ status: 'processing' }),
    db.collection(COL.nestingJobs).countDocuments({ status: 'failed' }),
    db.collection(COL.users).countDocuments({ createdAt: { $gte: since24h } }),
    db.collection(COL.users).countDocuments({ lastActiveAt: { $gte: new Date(Date.now() - 5 * 60 * 1000) } }),
    db.collection(COL.tracking).countDocuments({ timestamp: { $gte: since24h } }),
  ])
  return { queued, processing, failed, signups24h, active5m, events24h, at: new Date() }
}

export default defineEventHandler(async (event) => {
  requireAdmin(event)
  setHeader(event, 'content-type', 'text/event-stream')
  setHeader(event, 'cache-control', 'no-cache, no-transform')
  setHeader(event, 'connection', 'keep-alive')
  // Disable Nitro buffering so chunks flush immediately.
  event.node.req.socket.setTimeout(0)
  event.node.req.socket.setNoDelay(true)

  const send = async () => {
    try {
      const data = await liveCounts()
      event.node.res.write(`data: ${JSON.stringify(data)}\n\n`)
    } catch {
      /* swallow transient DB errors on a live stream */
    }
  }

  // Send immediately, then on an interval. Clean up when the client disconnects.
  await send()
  const timer = setInterval(send, 10_000)

  event.node.req.on('close', () => {
    clearInterval(timer)
  })

  // Keep the response open without holding the event loop in user code — the
  // interval + socket listeners are enough.
  return new Promise(() => {})
})
