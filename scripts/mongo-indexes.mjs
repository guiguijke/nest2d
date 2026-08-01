// Database index migration.
//
// Run manually after deploying, or from CI:
//   NUXT_MONGO_URI="mongodb://..." node scripts/mongo-indexes.mjs
//
// createIndex is idempotent: re-running is safe and cheap — Mongo only builds
// an index if it does not already exist. Sparse/partial indexes are used where
// a field is optional so existing docs without the field don't fail the unique
// constraint.
//
// Why these indexes (from the security/perf audit):
//  - users.id / users.email: looked up on every login (app + admin) and on
//    registration. `id` is unique to turn the register "check-then-insert"
//    race into a safe operation (duplicate key error instead of two docs).
//  - users.stripeCustomerId: the webhook updates the subscriber by customer id.
//  - users.subscriptionStatus / grantedUntil / lastActiveAt / signupCountry:
//    admin filters and digest queries.
//  - admins.id: admin login lookup.
//  - tracking.timestamp / http.timestamp: admin log views filter by time window
//    on large collections — without an index these are full-collection scans.
//  - supportMessages.userId / sender: conversation list and admin support view.

import { MongoClient } from 'mongodb'

const uri = process.env.NUXT_MONGO_URI
if (!uri) {
  console.error('NUXT_MONGO_URI is required.')
  process.exit(1)
}

const client = new MongoClient(uri)

// Each entry: [collection, spec, options]. Unique constraints use sparse so
// docs missing the field don't collide (e.g. anonymous/stripeless users).
const indexes = [
  // ── users ──
  ['users', { id: 1 }, { unique: true, name: 'uniq.id' }],
  // email is optional for some providers / not always verified; unique + sparse
  // keeps it unique where present without rejecting legacy anonymous docs.
  ['users', { email: 1 }, { unique: true, sparse: true, name: 'uniq.email' }],
  ['users', { stripeCustomerId: 1 }, { sparse: true, name: 'stripeCustomerId' }],
  ['users', { subscriptionStatus: 1 }, { sparse: true, name: 'subscriptionStatus' }],
  ['users', { grantedUntil: 1 }, { sparse: true, name: 'grantedUntil' }],
  ['users', { signupCountry: 1 }, { sparse: true, name: 'signupCountry' }],
  ['users', { lastActiveAt: 1 }, { sparse: true, name: 'lastActiveAt' }],

  // ── admins ──
  ['admins', { id: 1 }, { unique: true, name: 'uniq.id' }],

  // ── logs (time-windowed admin queries) ──
  ['tracking', { timestamp: -1 }, { name: 'timestamp_desc' }],
  ['http', { timestamp: -1 }, { name: 'timestamp_desc' }],

  // ── support ──
  ['supportMessages', { userId: 1, createdAt: -1 }, { name: 'user_recent' }],
  ['supportMessages', { sender: 1 }, { sparse: true, name: 'sender' }],
]

async function run() {
  await client.connect()
  const db = client.db() // DB name comes from the URI path
  console.log(`Connected to "${db.databaseName}". Creating indexes…`)

  let created = 0
  let skipped = 0
  for (const [collection, spec, options] of indexes) {
    try {
      const name = await db.collection(collection).createIndex(spec, options)
      // createIndex returns the index name when it creates it, or the existing
      // name when it already existed — we can't distinguish cheaply, so we log
      // both cases and count "ensured".
      console.log(`  ✓ ${collection}.${name}`)
      created += 1
    } catch (err) {
      // A duplicate-key error on creation means real duplicates exist in the
      // data — surface it loudly instead of silently keeping the collection
      // unindexed.
      if (err?.code === 11000) {
        console.error(`  ✗ ${collection}: cannot build unique index — duplicate data exists:`)
        console.error(`      ${err.message}`)
      } else {
        console.error(`  ✗ ${collection}: ${err.message}`)
      }
      skipped += 1
    }
  }

  console.log(`\nDone. Ensured ${created} index(es)${skipped ? `, ${skipped} failed` : ''}.`)
  await client.close()
}

run().catch((err) => {
  console.error('Migration failed:', err)
  process.exit(1)
})
