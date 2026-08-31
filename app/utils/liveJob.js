/**
 * Bind a results-list item to the project page currently on screen.
 * SSE reconnects on navigation (UserResults lives in the layout) so the
 * list can still hold the PREVIOUS project's jobs for a tick — never pick
 * an item whose projectSlug is missing or belongs to someone else.
 */
export function belongsToProject(item, projectSlug) {
    if (!item || !projectSlug) return false
    if (!item.projectSlug) return false
    return item.projectSlug === projectSlug
}

export function pickAwaitingLocal(list, projectSlug) {
    return (list || []).find(
        (r) => r.status === 'awaiting_local' && belongsToProject(r, projectSlug),
    ) || null
}

export function pickLiveJob(list, projectSlug) {
    return (list || []).find(
        (r) => r.liveLayout && belongsToProject(r, projectSlug),
    ) || null
}

export function pickRunningJob(list, projectSlug) {
    return (list || []).find(
        (r) => r.isInProgress && belongsToProject(r, projectSlug),
    ) || null
}
