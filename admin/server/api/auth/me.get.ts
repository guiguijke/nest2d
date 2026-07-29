import { requireAdmin } from '../../utils/auth'

// Returns the currently authenticated admin (or 401).
export default defineEventHandler((event) => {
  return requireAdmin(event)
})
