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
    // Bouton principal de la page projet (trackingTag="project_nest_start").
    'click_project_nest_start',
    'click_start_trial',
    'click_subscribe_pro',
    'click_subscription_cancel',
    // Chantier B : interrupteur turbo hybride (flag-gated dev).
    'click_turbo_toggle',
    // Ouverture de la boîte vault depuis le header.
    'click_vault_menu_open',
    // Réconciliation 2026-08-12 : tous les trackingTag/trackEvent réellement
    // émis par l'app (audit systématique — ils 400aient en silence).
    'click_account_delete',
    'click_account_discover_plan',
    'click_account_switch_free',
    'click_account_switch_privacy',
    'click_aside_close',
    'click_choose_files',
    'click_file',
    'click_file_fullscreen',
    'click_forgot_password_submit',
    'click_local_auth_submit',
    'click_login_email',
    'click_login_google',
    'click_logout',
    'click_menu_toggle',
    'click_modal_close',
    'click_nesting_report_button',
    'click_newsletter_prompt',
    'click_newsletter_prompt_no',
    'click_newsletter_prompt_yes',
    'click_open_projects',
    'click_open_results',
    'click_project_delete',
    'click_project_delete_cancel',
    'click_project_delete_confirm',
    'click_project_delete_open',
    'click_report_copy',
    'click_report_csv',
    'click_report_problem',
    'click_resend_verification',
    'click_reset_password_submit',
    'click_result',
    'click_result_download',
    'click_result_download_all',
    'click_result_fullscreen',
    'click_result_part_download',
    'click_result_part_next',
    'click_result_part_prev',
    'click_result_try_again',
    'click_strip_file',
    'click_strip_file_decrement',
    'click_strip_file_increment',
    'click_strip_nest_start',
    'click_strip_result',
    'click_strip_result_download',
    'click_subscription',
    'click_subscription_start_trial',
    'click_subscription_upgrade_pro',
    'click_support_chat_close',
    'click_support_chat_send',
    'click_toggle_theme',
    'click_turbo',
    'click_vault_destroy_full',
    'click_vault_disable_decrypt',
    'click_vault_disable_destroy',
    'click_vault_enable',
    'click_vault_forget_browser',
    'click_vault_generate_key',
    'click_vault_menu',
    'click_vault_menu_enable',
    'click_vault_menu_forget',
    'click_vault_menu_generate',
    'click_vault_menu_redownload',
    'click_vault_menu_rotate',
    'click_vault_menu_unlock',
    'click_vault_redownload',
    'click_vault_rotate',
    'click_vault_unlock',
    'click_vault_unlock_now',
    'click_vault_unlock_submit',
    'click_verify_email_cta',
    'result_view_mode',
    // Newsletter : prompt une-fois (home) + réglage d'abonnement (profil).
    'newsletter_prompt_shown',
    'newsletter_prompt_accept',
    'newsletter_prompt_dismiss',
    'newsletter_toggle_on',
    'newsletter_toggle_off',
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
