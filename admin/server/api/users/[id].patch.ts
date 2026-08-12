import { requireAdmin } from '../../utils/auth'
import { connectDB, COL } from '../../db/mongo'

// Generic user mutation from the admin panel.
//
// Supported actions (in the request body):
//   { action: 'ban', reason?: string }
//   { action: 'unban' }
//   { action: 'revokeSessions' }                   // sign out everywhere
//   { action: 'setGrantedUntil', until: Date | null }
//
// All writes are additive to the user doc; they never touch fields the Python
// workers rely on. An audit entry is appended to the `adminActions` collection.
export default defineEventHandler(async (event) => {
    const admin = requireAdmin(event)
    const id = getRouterParam(event, 'id')
    if (!id) throw createError({ statusCode: 400, statusMessage: 'Missing id' })

    const body = await readBody(event)
    const { action } = body || {}
    const db = await connectDB()
    const users = db.collection(COL.users)

    let update: any = null
    let summary = ''

    switch (action) {
        case 'ban': {
            const reason = String(body.reason || '').slice(0, 500)
            update = {
                $set: { banned: true, bannedAt: new Date(), bannedReason: reason, bannedBy: admin.id },
                $unset: { sessions: '' }, // force logout everywhere immediately
            }
            summary = `Banni${reason ? ` : ${reason}` : ''}`
            break
        }
        case 'unban': {
            update = { $set: { banned: false }, $unset: { bannedAt: '', bannedReason: '', bannedBy: '' } }
            summary = 'Bannissement levé'
            break
        }
        case 'revokeSessions': {
            update = { $set: { sessions: [] } }
            summary = 'Sessions révoquées'
            break
        }
        case 'setGrantedUntil': {
            // null/empty clears the grant (back to free); otherwise set a
            // date + an optional tier ('standard' = Illimité, 'privacy' =
            // Pro — absent = 'standard', historical behaviour). Lets the
            // admin promote a test account to any tier and back at will,
            // without Stripe (D-PAY-11).
            const until = body.until ? new Date(body.until) : null
            if (until && isNaN(until.getTime())) throw createError({ statusCode: 400, statusMessage: 'until invalide' })
            const tier = body.tier === 'privacy' ? 'privacy' : 'standard'
            const tierLabel = tier === 'privacy' ? 'Pro' : 'Illimité'
            update = until
                ? { $set: { grantedUntil: until, grantedBy: admin.id, grantedAt: new Date(), grantedTier: tier } }
                : { $unset: { grantedUntil: '', grantedBy: '', grantedAt: '', grantedTier: '' } }
            summary = until ? `Accès ${tierLabel} offert jusqu'au ${until.toLocaleDateString('fr-FR')}` : 'Accès offert retiré (retour Gratuit)'
            break
        }
        default:
            throw createError({ statusCode: 400, statusMessage: `action inconnue: ${action}` })
    }

    const res = await users.updateOne({ id }, update)
    if (res.matchedCount === 0) throw createError({ statusCode: 404, statusMessage: 'Utilisateur introuvable' })

    // Audit log (fire-and-forget; collection is created lazily).
    db.collection('adminActions')
        .insertOne({
            targetUserId: id,
            adminId: admin.id,
            adminEmail: admin.email,
            action,
            summary,
            raw: { ...body },
            at: new Date(),
        })
        .catch(() => {})

    return { ok: true, summary }
})
