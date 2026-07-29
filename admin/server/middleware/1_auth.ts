import { getAdminBySession } from '../utils/auth'

// Runs on every request. Resolves the admin from the session cookie and
// attaches it to event.context.admin. Individual routes enforce auth via
// requireAdmin(); this middleware never blocks (it lets the 401 surface from
// the handler with the right JSON shape, and lets /api/auth/login through).
export default defineEventHandler(async (event) => {
  try {
    const admin = await getAdminBySession(event)
    if (admin) {
      event.context.admin = admin
    }
  } catch {
    // DB unreachable, etc. — leave context.admin unset; routes will 401.
  }
})
