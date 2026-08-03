// Database index migration — mongosh flavour.
//
// Run automatically by the `mongo-init` service in docker-compose.yml, or
// manually:
//   docker compose run --rm mongo-init
//   # or, directly:
//   mongosh "mongodb://mongo:27017/nest2d" scripts/mongo-indexes.mongo.js
//
// createIndex is idempotent: re-running on every boot is safe and cheap —
// Mongo only builds an index if it does not already exist.
//
// Why these indexes (from the security/perf audit):
//  - users.id / users.email: looked up on every login (app + admin) and on
//    registration. `id` is unique to turn the register "check-then-insert"
//    race into a safe operation (duplicate key error instead of two docs).
//  - users.stripeCustomerId: the webhook updates the subscriber by customer id.
//  - users.subscriptionStatus / grantedUntil / lastActiveAt / signupCountry:
//    admin filters and digest queries.
//  - admins.id: admin login lookup.
//  - tracking.timestamp / http.timestamp: admin log views filter by time
//    window on large collections — without an index these are full scans.
//  - supportMessages.userId / sender: conversation list and admin support view.
//
// `db` is the global provided by mongosh, bound to the database in the URI
// (nest2d). Errors on unique-index creation (duplicate data, code 11000) are
// printed but do not stop the script, so the container exits cleanly.

const indexes = [
  // ── users ──
  ['users', { id: 1 }, { unique: true, name: 'uniq.id' }],
  // email is optional for some providers; unique + sparse keeps it unique
  // where present without rejecting legacy anonymous docs.
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

  // ── accounting (Stripe → Abby income book) ──
  // One Abby receipt per Stripe invoice, ever. The unique index is what makes
  // webhook retries idempotent: the second concurrent insert loses the race
  // with a duplicate key error instead of pushing a duplicate receipt.
  ['accounting_entries', { stripeInvoiceId: 1 }, { unique: true, name: 'uniq.stripeInvoiceId' }],
]

let created = 0
let failed = 0

for (const [collection, spec, options] of indexes) {
  try {
    const name = db.getCollection(collection).createIndex(spec, options)
    print(`  ✓ ${collection}.${name}`)
    created++
  } catch (err) {
    // A duplicate-key error means real duplicates exist in the data — surface
    // it loudly so the operator can de-duplicate, instead of silently leaving
    // the collection unindexed.
    if (err?.code === 11000) {
      print(`  ✗ ${collection}: cannot build unique index — duplicate data exists:`)
      print(`      ${err.errmsg || err.message}`)
    } else {
      print(`  ✗ ${collection}: ${err.message}`)
    }
    failed++
  }
}

print(`\nDone. Ensured ${created} index(es)${failed ? `, ${failed} failed (see above)` : ''}.`)
