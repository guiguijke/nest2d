import { getResults } from '~~/server/features/results/resultcontroller'

export default defineEventHandler(async (event) => {
    const userId = event.context?.auth?.userId
    if (!userId) {
        setResponseStatus(401)
        return
    }

    const projectSlug = getRouterParam(event, 'slug')

    const eventStream = createEventStream(event)

    // AH2 (lot 4) : orphelins awaiting_local expirés à L'OUVERTURE du
    // flux — sinon la carte « non pris en charge » n'apparaît qu'au
    // prochain POST nest du propriétaire.
    try {
        const { expireOrphanAwaitingLocalForEvent } = await import('~~/server/utils/expireOrphanAwaitingLocal')
        await expireOrphanAwaitingLocalForEvent(event, userId)
    } catch { /* best-effort : la liste reste servie */ }

    const result = await getResults(userId, projectSlug)
    const items = result.items

    eventStream.push(JSON.stringify({
        type: 'initial',
        data: {
            items: items,
            needNotification: false,
        }
    }))

    const heartbeatInterval = setInterval(async () => {
        eventStream.push(JSON.stringify({
            type: 'heartbeat',
            ts: Date.now()
        }))
    }, 30000)

    let previousResult = result
    const interval = setInterval(async () => {
        const newResult = await getResults(userId, projectSlug)
        if (JSON.stringify(previousResult) !== JSON.stringify(newResult)) {
            eventStream.push(JSON.stringify({
                type: 'update',
                data: {
                    items: newResult.items,
                    needNotification: newResult.items.some(item => {
                        const previousItem = previousResult.items.find(prev => prev.slug === item.slug)
                        return previousItem && previousItem.isInProgress !== item.isInProgress
                    }),
                }
            }))
            previousResult = newResult
        }
    }, 1000)

    eventStream.onClosed(async () => {
        clearInterval(heartbeatInterval)
        clearInterval(interval)
    })

    return eventStream.send()
});