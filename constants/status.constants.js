export const statusType = {
    completed: 'completed',
    unfinished: 'processing',
    pending: 'pending',
    // C01 (audit UX 2026-09-05) : job préparé par le worker, en cours de
    // résolution NAVIGATEUR (Mode Local) — un état « en cours » à part
    // entière, pas un état inconnu.
    awaitingLocal: 'awaiting_local',
    failed: 'failed',
    unknown: 'unknown',
    done: 'done'
}

export const defaultStatusType = statusType.unknown
