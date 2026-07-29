import { COUNTRY_HEADER_NAME } from '../../tracking/const'
import logger from '../../utils/logger'

// Notifies the platform administrator (by email) when a new user signs up.
//
// The destination address is NUXT_ADMIN_NOTIFY_EMAIL. If unset, this is a no-op
// (the admin panel's periodic digest is the safety net that catches any signup
// missed here, e.g. when Resend was unreachable at signup time).
//
// This is fire-and-forget from the caller's perspective: a failure to send the
// notification must never block registration. Country/IP are derived from the
// Cloudflare cf-ipcountry header (best-effort; null behind a non-Cloudflare proxy).
export async function notifyAdminNewUser(event, { id, email, name, provider }) {
  const config = useRuntimeConfig(event)
  const notifyEmail = config.adminNotifyEmail
  if (!notifyEmail) return

  const country = event.node.req.headers[COUNTRY_HEADER_NAME] || null
  const ip =
    event.node.req.headers['x-forwarded-for']?.toString().split(',')[0]?.trim() ||
    event.node.req.socket?.remoteAddress ||
    null

  const subject = `Nouvelle inscription — ${name} (${email})`
  const html = `
    <h2 style="margin:0 0 8px">Nouvel utilisateur sur APlasma Nesting</h2>
    <table style="border-collapse:collapse;font-family:Arial,sans-serif;font-size:14px;color:#222">
      <tr><td style="padding:2px 12px 2px 0;color:#666">Nom</td><td>${escapeHtml(name || '—')}</td></tr>
      <tr><td style="padding:2px 12px 2px 0;color:#666">Email</td><td>${escapeHtml(email || '—')}</td></tr>
      <tr><td style="padding:2px 12px 2px 0;color:#666">Provider</td><td>${escapeHtml(provider || '—')}</td></tr>
      <tr><td style="padding:2px 12px 2px 0;color:#666">Pays</td><td>${escapeHtml(country || '— inconnu')}</td></tr>
      <tr><td style="padding:2px 12px 2px 0;color:#666">IP</td><td>${escapeHtml(ip || '—')}</td></tr>
      <tr><td style="padding:2px 12px 2px 0;color:#666">Identifiant</td><td style="font-family:monospace">${escapeHtml(id)}</td></tr>
      <tr><td style="padding:2px 12px 2px 0;color:#666">Date</td><td>${new Date().toLocaleString('fr-FR')}</td></tr>
    </table>
    <p style="margin-top:16px;font-size:13px;color:#666">Connectez-vous au panneau d'administration pour voir le détail.</p>
  `

  try {
    await $fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.resendToken}`,
      },
      body: {
        from: config.resendFrom || 'onboarding@resend.dev',
        to: notifyEmail,
        subject,
        html,
      },
    })
  } catch (err) {
    // Swallow — the periodic digest in the admin panel covers missed signups.
    logger.warn('Failed to notify admin of new signup', { id, err: String(err) })
  }
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
