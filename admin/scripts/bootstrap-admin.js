#!/usr/bin/env node
/**
 * Create or update an administrator account for the admin panel.
 *
 * The admin panel uses its OWN authentication (collection `admins`), fully
 * separate from the main app's `users` collection. This script creates the
 * first admin so you can log in.
 *
 * Usage (interactive):
 *   node scripts/bootstrap-admin.js
 *
 * Usage (non-interactive, e.g. Docker entrypoint):
 *   ADMIN_BOOTSTRAP_EMAIL=you@example.com \
 *   ADMIN_BOOTSTRAP_NAME="Guillaume" \
 *   ADMIN_BOOTSTRAP_PASSWORD="a-strong-password" \
 *   node scripts/bootstrap-admin.js
 *
 * Requires NUXT_ADMIN_MONGO_URI (or NUXT_MONGO_URI) in the environment. The DB
 * name must be present in the URI path (same convention as the main app).
 *
 * Re-running with the same email updates the password hash in place and prunes
 * all existing sessions (forces re-login everywhere).
 */
import { MongoClient } from 'mongodb'
import bcrypt from 'bcryptjs'
import { randomBytes, createHash } from 'node:crypto'
import { createInterface } from 'node:readline/promises'
import { stdin, stdout } from 'node:process'
import { readFileSync } from 'node:fs'

// Best-effort .env load (same minimal parser as the main app's promote-admin).
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
  // no .env — rely on real environment variables
}

function ask(question, { secret = false } = {}) {
  const rl = createInterface({ input: stdin, output: stdout })
  // For secrets we mute the TTY manually (readline has no built-in hide).
  const onData = (b) => {
    const chars = b.toString()
    switch (chars) {
      case '\u0004': // Ctrl-D
      case '\r':
      case '\n':
        break
      case '\u0003': // Ctrl-C
        process.exit(130)
        break
      default:
        stdout.cursorTo(rl.line.length + question.length)
        stdout.write('*'.repeat(chars.length))
    }
  }
  if (secret) stdin.on('data', onData)
  const cleanup = () => secret && stdin.off('data', onData)
  return rl.question(question).finally(() => {
    cleanup()
    rl.close()
  })
}

const MONGO_URI = process.env.NUXT_ADMIN_MONGO_URI || process.env.NUXT_MONGO_URI

async function main() {
  if (!MONGO_URI) {
    console.error('Error: NUXT_ADMIN_MONGO_URI (or NUXT_MONGO_URI) is not set.')
    console.error('  Set it in your .env or export it.')
    process.exit(1)
  }

  let email = process.env.ADMIN_BOOTSTRAP_EMAIL || (await ask('Admin email: '))
  email = String(email).trim().toLowerCase()
  let name = process.env.ADMIN_BOOTSTRAP_NAME || (await ask('Display name: '))
  name = String(name).trim()

  let password = process.env.ADMIN_BOOTSTRAP_PASSWORD
  if (!password) {
    password = await ask('Password (min 10 chars): ', { secret: true })
  }
  if (String(password).length < 10) {
    console.error('Password must be at least 10 characters.')
    process.exit(1)
  }

  const client = new MongoClient(MONGO_URI)
  try {
    await client.connect()
    const db = client.db()
    const admins = db.collection('admins')

    const id = `admin:${email}`
    const passwordHash = await bcrypt.hash(String(password), 10)

    const existing = await admins.findOne({ id })
    if (existing) {
      await admins.updateOne(
        { _id: existing._id },
        { $set: { name, passwordHash, lastActiveAt: new Date() }, $set: { sessions: [] } },
      )
      console.log(`✓ Admin "${email}" updated. All sessions revoked.`)
    } else {
      await admins.insertOne({
        id,
        email,
        name,
        passwordHash,
        sessions: [],
        createdAt: new Date(),
        lastActiveAt: new Date(),
      })
      console.log(`✓ Admin "${email}" created.`)
    }
    console.log('  You can now sign in at the admin panel login page.')
  } finally {
    await client.close()
  }
}

main().catch((err) => {
  console.error('Failed to bootstrap admin:', err)
  process.exit(1)
})
