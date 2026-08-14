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
// Demo nesting ANTI-ABUSE profile, imposed server-side (never
// client-tunable): wall-clock cap and parallelism are fixed. The client only
// picks geometry (sheets, spacing, rotations, hole filling) and ONE of the
// 3 layout directions — the 3 stay selectable so newcomers see them all,
// but a demo nesting computes a single alternative (server cost control).
export const DEMO_TIME_BUDGET_SEC = 600
export const DEMO_VCORES = 4
export const DEMO_PRIORITY = 20
export const DEMO_MAX_DIRECTIONS = 1
// Demo-only walk picker (D-DEM-12): Free / Unlimited / Pro parallelism,
// even on a Free account. Anything else falls back to 1 (never inflate).
export const DEMO_WALK_CHOICES = [1, 4, 8]
export function resolveDemoWalks(raw) {
    const n = Math.trunc(Number(raw))
    return DEMO_WALK_CHOICES.includes(n) ? n : 1
}
// Initial demo settings pre-filled in the UI (fully adjustable afterwards —
// the demo plays like a regular project). 2 mm spacing keeps hole channels
// OPEN (channel = space + 0.1, capped at 2.5 mm): the demo must showcase
// hole filling, which a sealed channel (spacing >= 2.4 mm) would silently
// disable.
// Physical stock: width (X, largeur) × length (Y, longueur). The live
// view rotates portrait sheets so the long side is horizontal on 16:9
// screens; engine axes are unchanged (left = –X, bottom = –Y).
export const DEMO_SHEETS = [{ width: 1500, height: 3000, count: 3 }]
export const DEMO_SPACE_MM = 2
