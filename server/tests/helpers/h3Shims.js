// Test-time shims for Nitro auto-imports (plain vitest has none).
// MUST be imported before any handler module under test.
import { createError } from 'h3'

globalThis.defineEventHandler = globalThis.defineEventHandler || ((fn) => fn)
globalThis.createError = globalThis.createError || createError
globalThis.readBody = globalThis.readBody || (async (event) => event._body)
globalThis.getRouterParam = globalThis.getRouterParam || ((event, name) => event._params?.[name])
// Fixed test IP for assertRateLimit (avoids touching event.node.req).
globalThis.getRequestIP = globalThis.getRequestIP || (() => '127.0.0.1')
// Default runtime config: every flag OFF (A2 tests assert the unchanged
// pipeline); flag-specific tests replace this with their own holder.
globalThis.useRuntimeConfig = globalThis.useRuntimeConfig || (() => ({ public: {} }))
