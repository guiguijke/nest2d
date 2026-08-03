/**
 * Demo project constants shared between server and client. The demo is a
 * single read-only project (seeded at boot from server/seed/demo) visible to
 * every user, offering free demonstration nestings that do NOT consume the
 * regular free monthly quota — they draw from their own monthly allowance
 * (same lazy-reset mechanism, own counter on the user doc).
 */
export const DEMO_PROJECT_SLUG = 'demo'
export const DEMO_OWNER_ID = 'demo'
export const DEMO_NESTING_LIMIT = 10
// Server-side guard against compute abuse: total requested parts per demo
// nesting (the seeded default is ~300 on the 3000x1500 sheet).
export const DEMO_MAX_PARTS = 500
// Demo nesting parameters are imposed server-side (never client-tunable):
// standard-tier compute (4 vcores, all 3 directions) on a generous sheet,
// so newcomers see the engine at full power.
export const DEMO_SHEETS = [{ width: 3000, height: 1500, count: 3 }]
export const DEMO_SPACE_MM = 3
export const DEMO_TIME_BUDGET_SEC = 90
export const DEMO_VCORES = 4
export const DEMO_PRIORITY = 20
