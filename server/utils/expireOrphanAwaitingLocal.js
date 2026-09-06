import { connectDB } from '~~/server/db/mongo'

/**
 * A3/AH2/AH3 (lot 4, AF5) — expire les jobs `awaiting_local` ORPHELINS :
 * l'appareil qui devait les résoudre a fermé avant de prendre le payload
 * (`takenAt` absent, posé par le GET local-payload). Appelé au POST nest
 * ET à l'ouverture du flux SSE des résultats — sinon la carte « non pris
 * en charge » n'apparaît qu'au prochain lancement.
 *
 * AH3 : la transition du job est ATOMIQUE et conditionnée (statut +
 * absence de takenAt + non déjà remboursé) — le remboursement n'a lieu
 * que si CETTE transition a matché exactement 1 document : deux appels
 * concurrents (double clic, deux onglets) ne remboursent jamais deux
 * fois. Le TTL par défaut (10 min) vient de
 * runtimeConfig.awaitingLocalTtlMin (AH5).
 */
export async function expireOrphanAwaitingLocal(db, userId, { ttlMin = 10, now = Date.now() } = {}) {
    const cutoff = new Date(now - ttlMin * 60_000)
    const jobs = await db.collection('nesting_jobs').find({
        ownerId: userId,
        status: 'awaiting_local',
        takenAt: { $exists: false },
        createdAt: { $lt: cutoff },
        'charge.refunded': { $ne: true },
    }).project({ slug: 1, 'charge.type': 1, 'charge.skippedQuota': 1 }).toArray()

    const expired = []
    for (const job of jobs) {
        // Transition atomique D'ABORD — verrou Mongo : seul l'appel qui
        // fait basculer le statut rembourse.
        const res = await db.collection('nesting_jobs').updateOne(
            {
                slug: job.slug,
                status: 'awaiting_local',
                takenAt: { $exists: false },
                'charge.refunded': { $ne: true },
            },
            {
                $set: {
                    status: 'cancelled',
                    placed: 0,
                    // Carte dédiée : « non pris en charge par cet appareil ».
                    information: 'awaiting_local_expired',
                    finishedAt: new Date(),
                    update_ts: new Date(),
                    'charge.refunded': true,
                },
                $unset: { progress: '', compute: '', localPayload: '' },
            },
        )
        if (res?.matchedCount !== 1) continue
        expired.push(job.slug)
        const chargeType = job.charge?.type
        if (chargeType === 'free') {
            await db.collection('users').updateOne(
                { id: userId, freeNestingUsed: { $gt: 0 } },
                { $inc: { freeNestingUsed: -1 } },
            )
        } else if (chargeType === 'demo' && !job.charge?.skippedQuota) {
            await db.collection('users').updateOne(
                { id: userId, demoNestingUsed: { $gt: 0 } },
                { $inc: { demoNestingUsed: -1 } },
            )
        }
    }
    return expired
}

/** Variante route : db implicite + TTL depuis runtimeConfig. */
export async function expireOrphanAwaitingLocalForEvent(event, userId) {
    const ttlMin = Number(useRuntimeConfig(event)?.awaitingLocalTtlMin) || 10
    const db = await connectDB()
    return expireOrphanAwaitingLocal(db, userId, { ttlMin })
}
