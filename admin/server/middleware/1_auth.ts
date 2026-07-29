import { getAdminBySession } from '../utils/auth'

// Runs on every request. Resolves the admin from the session cookie and
// attaches it to event.context.admin. Individual routes enforce auth via
// requireAdmin().
//
// In LAN-open mode (NUXT_ADMIN_LAN_OPEN=true), there is no login at all: every
// request is treated as a full admin. Intended for a trusted LAN where the
// port is never exposed to the Internet.
const LAN_ADMIN = {
  id: 'lan',
  email: 'lan',
  name: 'Accès réseau local',
  createdAt: null,
  lastActiveAt: null,
}

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig(event)
  // NUXT_ADMIN_LAN_OPEN maps to runtimeConfig.adminLanOpen (Nuxt camelCases the
  // env var suffix). Accept either spelling defensively.
  if (config.adminLanOpen === true || config.adminLanOpen === 'true') {
    event.context.admin = LAN_ADMIN
    return
  }
  try {
    const admin = await getAdminBySession(event)
    if (admin) {
      event.context.admin = admin
    }
  } catch {
    // DB unreachable, etc. — leave context.admin unset; routes will 401.
  }
})
