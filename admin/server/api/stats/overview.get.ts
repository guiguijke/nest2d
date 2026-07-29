import { requireAdmin } from '../../utils/auth'
import { getOverviewStats } from '../../utils/stats'

// Dashboard overview — all KPIs in one request.
export default defineEventHandler(async (event) => {
  requireAdmin(event)
  return getOverviewStats()
})
