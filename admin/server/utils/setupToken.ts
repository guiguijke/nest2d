import { randomBytes } from 'node:crypto'

// One-time setup token, generated at server boot.
//
// The first-admin endpoint (POST /api/setup/first-admin) only works when NO
// admin exists in the DB yet, AND requires this token. The token is printed to
// the server logs on boot so the operator can grab it from `docker compose logs`.
//
// This keeps bootstrap passwordless-friendly (no baked-in secret) while
// preventing anonymous first-admin creation from anyone who can reach the port.

export const setupToken = randomBytes(16).toString('hex')

export function printSetupTokenIfEmpty() {
  // Defer to a tick so Nitro is ready to log cleanly.
  setTimeout(async () => {
    try {
      const { connectDB, COL } = await import('../db/mongo')
      const db = await connectDB()
      const count = await db.collection(COL.admins).estimatedDocumentCount()
      if (count === 0) {
        console.log('')
        console.log('========================================================')
        console.log('  APLASMA ADMIN — FIRST-TIME SETUP')
        console.log('========================================================')
        console.log('  No admin account exists yet.')
        console.log('  Create one with:')
        console.log('')
        console.log(`    curl -X POST http://localhost:7200/api/setup/first-admin \\`)
        console.log('      -H "Content-Type: application/json" \\')
        console.log(`      -H "X-Setup-Token: ${setupToken}" \\`)
        console.log('      -d \'{"email":"you@example.com","name":"Admin","password":"your-strong-password"}\'')
        console.log('')
        console.log('  (Or open the setup page at http://localhost:7200/setup')
        console.log(`   and use this token: ${setupToken})`)
        console.log('========================================================')
        console.log('')
      }
    } catch {
      // DB not reachable yet — nothing to do, the page will explain.
    }
  }, 1000)
}
