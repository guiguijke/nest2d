import { defineEventHandler, getCookie, readBody } from 'h3'
import { saveTrackRecordInBackground, type TrackDBRecord } from '~~/server/tracking/add'
import { COUNTRY_HEADER_NAME, TRACKING_COOKIE_NAME } from '~~/server/tracking/const'
import type { TrackRequest } from '~~/shared/types/track_body'

// Strict allowlist of accepted tracking actions (snake_case), derived from the
// trackEvent() call sites in app/. Anything else is rejected: this endpoint is
// public + unauthenticated, so without validation a client could fill the
// `tracking` collection with arbitrary payloads (storage DoS) or smuggle data
// later surfaced in the admin logs view.
const ALLOWED_ACTIONS = new Set([
    'click_download_button',
    'click_forgot_password',
    'click_login',
    'click_open_workspace',
    'click_reset_password',
    'dialog_view_support_chat',
    'page_view',
    'result_alt_selected',
    'vault_destroyed',
    'vault_disabled',
    'vault_enabled',
    'vault_forget_browser',
    'vault_key_generated',
    'vault_rotated',
    'vault_unlocked',
    // client-side nesting UI events (from project/strip pages)
    'click_file_decrement',
    'click_file_increment',
    'click_nest_files',
    'click_start_trial',
    'click_subscribe_pro',
    'click_subscription_cancel',
    // Chantier B : interrupteur turbo hybride (flag-gated dev).
    'click_turbo_toggle',
    // Ouverture de la boîte vault depuis le header.
    'click_vault_menu_open',
])

// Bounded validation of the client payload before it touches the DB.
const MAX_ACTION_LEN = 64
const MAX_DATA_KEYS = 20
const MAX_DATA_VALUE_LEN = 500

function validateTrackRequest(body: unknown): body is TrackRequest {
    if (!body || typeof body !== 'object') return false
    const { action, data } = body as Record<string, unknown>
    if (typeof action !== 'string' || action.length === 0 || action.length > MAX_ACTION_LEN) {
        return false
    }
    if (!ALLOWED_ACTIONS.has(action)) {
        return false
    }
    // data is optional; when present it must be a flat string->string map with
    // bounded size, mirroring the TrackRequest type.
    if (data == null) {
        (body as TrackRequest).data = {}
        return true
    }
    if (typeof data !== 'object' || Array.isArray(data)) return false
    const entries = Object.entries(data as Record<string, unknown>)
    if (entries.length > MAX_DATA_KEYS) return false
    for (const [k, v] of entries) {
        if (typeof k !== 'string' || k.length > MAX_DATA_VALUE_LEN) return false
        if (v != null && typeof v !== 'string') return false
        if (typeof v === 'string' && v.length > MAX_DATA_VALUE_LEN) return false
    }
    return true
}

export default defineEventHandler(async (event) => {
    const trackRequest = await readBody<TrackRequest>(event)

    // Reject malformed or unexpected payloads early — no DB write.
    if (!validateTrackRequest(trackRequest)) {
        throw createError({ statusCode: 400, statusMessage: 'Bad request' })
    }

    const sessionKey = getCookie(event, TRACKING_COOKIE_NAME) as string
    const country = event.node.req.headers[COUNTRY_HEADER_NAME] as string
    const userId = event.context.auth?.userId

    const trackRecond: TrackDBRecord = {
        action: trackRequest.action,
        country: country,
        data: trackRequest.data,
        sessionKey: sessionKey,
        timestamp: new Date(),
        userId: userId,
    }

    await saveTrackRecordInBackground(trackRecond)
})
