#!/usr/bin/env node
/**
 * Promote a user to administrator.
 *
 * Usage:
 *   node scripts/promote-admin.js <email-or-userId>
 *
 * Looks up the user by:
 *   1. exact `id` (e.g. "google:123" or "local:user@example.com")
 *   2. case-insensitive `email`
 *
 * Sets `isAdmin: true` on the matching user document.
 *
 * Requires NUXT_MONGO_URI in the environment (or a local .env file that this
 * script loads best-effort). The database name must be present in the URI path.
 */

import { MongoClient } from 'mongodb'
import { readFileSync } from 'node:fs'

// Best-effort .env load so the script works without manually exporting env
// vars. We parse a minimal KEY=value format (no quoting/escaping edge cases).
try {
  const envContent = readFileSync('.env', 'utf8')
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    const key = trimmed.slice(0, eq).trim()
    let val = trimmed.slice(eq + 1).trim()
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1)
    }
    if (!(key in process.env)) process.env[key] = val
  }
} catch {
  // .env not present or unreadable — rely on real environment variables.
}

const MONGO_URI = process.env.NUXT_MONGO_URI || process.env.MONGO_URI

async function main() {
  const target = process.argv[2]
  if (!target) {
    console.error('Usage: node scripts/promote-admin.js <email-or-userId>')
    process.exit(1)
  }
  if (!MONGO_URI) {
    console.error('Error: NUXT_MONGO_URI (or MONGO_URI) environment variable is not set.')
    console.error('Set it in your .env or export it, e.g.:')
    console.error('  NUXT_MONGO_URI=mongodb://localhost:27017/nest2d node scripts/promote-admin.js me@example.com')
    process.exit(1)
  }

  const client = new MongoClient(MONGO_URI)
  try {
    await client.connect()
    const db = client.db()
    const users = db.collection('users')

    // Build a query: match exact id, or email (try both the raw value and the
    // local: prefixed id, since local users have id = "local:<email>").
    const lowered = target.toLowerCase()
    const query = {
      $or: [
        { id: target },
        { id: `local:${lowered}` },
        { email: lowered },
      ],
    }

    const user = await users.findOne(query)
    if (!user) {
      console.error(`No user found matching "${target}".`)
      console.error('Checked: id, "local:<email>", and email.')
      process.exit(2)
    }

    if (user.isAdmin) {
      console.log(`User "${user.email}" (${user.id}) is already an admin. Nothing to do.`)
      return
    }

    await users.updateOne({ _id: user._id }, { $set: { isAdmin: true } })
    console.log(`✓ User "${user.email}" (${user.id}) is now an admin.`)
    console.log('  The "Support" admin button will appear on their avatar after their next login.')
  } finally {
    await client.close()
  }
}

main().catch((err) => {
  console.error('Failed to promote user:', err)
  process.exit(1)
})
