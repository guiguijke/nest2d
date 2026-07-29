import { requireAdmin } from '../../utils/auth'
import { connectDB, COL } from '../../db/mongo'

// Admin replies to a user. Inserts a support message (sender: 'support') and
// emails the user a notification, mirroring the main app's behaviour.
const MESSAGE_SENDER = { USER: 'user', SUPPORT: 'support', WELCOME: 'welcome' } as const

export default defineEventHandler(async (event) => {
  const admin = requireAdmin(event)
  const userId = getRouterParam(event, 'userId')
  if (!userId) throw createError({ statusCode: 400, statusMessage: 'Missing userId' })

  const body = await readBody(event)
  const message = String(body?.message || '').trim()
  if (!message) throw createError({ statusCode: 400, statusMessage: 'Message vide' })

  const db = await connectDB()
  const record = await db.collection(COL.supportMessages).insertOne({
    userId,
    sender: MESSAGE_SENDER.SUPPORT,
    message,
    timestamp: new Date(),
    fromAdmin: true,
    repliedBy: admin.id,
  })

  // Best-effort email notification to the user.
  const user = await db.collection(COL.users).findOne({ id: userId }, { projection: { email: 1 } })
  if (user?.email) {
    const config = useRuntimeConfig()
    try {
      await $fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.resendToken}`,
        },
        body: {
          from: config.resendFrom || 'onboarding@resend.dev',
          to: user.email,
          subject: 'Nouveau message du support APlasma Nesting',
          html: `
            <p>Bonjour,</p>
            <p>Vous avez reçu un nouveau message de l'équipe support d'APlasma Nesting.</p>
            <blockquote style="border-left:3px solid #c87a1c;padding-left:12px;color:#333">${escapeHtml(message)}</blockquote>
            <p>Connectez-vous à votre compte pour répondre.</p>
          `,
        },
      })
    } catch {
      /* swallow — the message is stored regardless */
    }
  }

  return { ok: true, insertedId: record.insertedId }
})

function escapeHtml(s: string) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
