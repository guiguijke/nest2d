import { connectDB, COL } from '../db/mongo'

// Safety-net digest: periodically notifies the admin of any signups that were
// NOT already reported by the main app's instant notification (e.g. because
// Resend was unreachable at signup time).
//
// Maintains a cursor in the `admins` collection (metadata.digestCursor) so it
// only ever reports each user once. Runs every 5 minutes. Best-effort: any
// failure is logged and retried next cycle.
const INTERVAL_MS = 5 * 60 * 1000

async function sendDigestEmail(to: string, users: any[]) {
  const config = useRuntimeConfig()
  const rows = users
    .map(
      (u) =>
        `<tr>
          <td style="padding:3px 12px 3px 0">${escapeHtml(u.name || '—')}</td>
          <td style="padding:3px 12px 3px 0">${escapeHtml(u.email)}</td>
          <td style="padding:3px 12px 3px 0">${escapeHtml(u.provider || '—')}</td>
          <td style="padding:3px 12px 3px 0;font-family:monospace">${escapeHtml(u.signupCountry || '—')}</td>
          <td style="padding:3px 12px 3px 0">${new Date(u.createdAt).toLocaleString('fr-FR')}</td>
        </tr>`,
    )
    .join('')

  await $fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.resendToken}`,
    },
    body: {
      from: config.resendFrom || 'onboarding@resend.dev',
      to,
      subject: `APlasma — ${users.length} nouvelle(s) inscription(s)`,
      html: `
        <h2 style="margin:0 0 8px">Nouvelles inscriptions (synthèse)</h2>
        <p style="font-size:13px;color:#666">Utilisateurs apparus depuis le dernier passage :</p>
        <table style="border-collapse:collapse;font-family:Arial,sans-serif;font-size:13px;color:#222">
          <thead><tr style="color:#999;text-align:left">
            <th style="padding:4px 12px 4px 0">Nom</th><th style="padding:4px 12px 4px 0">Email</th>
            <th style="padding:4px 12px 4px 0">Provider</th><th style="padding:4px 12px 4px 0">Pays</th><th style="padding:4px 12px 4px 0">Date</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      `,
    },
  })
}

function escapeHtml(s: any) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export default defineNitroPlugin((nitro) => {
  const timer = setInterval(async () => {
    try {
      const config = useRuntimeConfig()
      const to = config.adminNotifyEmail as string
      if (!to) return // no destination configured → skip

      const db = await connectDB()
      const meta = db.collection('admins')
      const metaDoc = await meta.findOne({}, { projection: { 'digestCursor': 1 } })
      const cursor = metaDoc?.digestCursor ? new Date(metaDoc.digestCursor) : new Date(0)

      // Find users created after the cursor, newest first, capped to a batch.
      const fresh = await db
        .collection(COL.users)
        .find({ createdAt: { $gt: cursor } })
        .sort({ createdAt: 1 })
        .limit(200)
        .project({ _id: 0, id: 1, email: 1, name: 1, provider: 1, signupCountry: 1, createdAt: 1 })
        .toArray()

      if (!fresh.length) return

      await sendDigestEmail(to, fresh)

      // Advance the cursor to the newest signup we just reported.
      const newest = fresh.reduce((m, u) => (u.createdAt > m ? u.createdAt : m), cursor)
      await meta.updateOne(
        {},
        { $set: { digestCursor: newest } },
        { upsert: true },
      )
    } catch (err) {
      console.error('[signupDigest] failed:', err)
    }
  }, INTERVAL_MS)

  // Start after a short delay so the server is ready on boot.
  nitro.hooks.hook('close', () => clearInterval(timer))
})
