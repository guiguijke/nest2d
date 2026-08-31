import { describe, expect, it } from 'vitest'
import {
    belongsToProject,
    pickAwaitingLocal,
    pickLiveJob,
    pickRunningJob,
} from '../utils/liveJob'

const aLive = { slug: 'jA', projectSlug: 'pA', status: 'awaiting_local', isInProgress: true, liveLayout: { stage: 'x' } }
const bIdle = { slug: 'jB', projectSlug: 'pB', status: 'done', isInProgress: false, liveLayout: null }
const untagged = { slug: 'jOld', status: 'awaiting_local', isInProgress: true, liveLayout: { stage: 'y' } }

describe('liveJob — isolation by projectSlug', () => {
    it('refuses untagged items (stale SSE list during A→B navigation)', () => {
        expect(belongsToProject(untagged, 'pA')).toBe(false)
        expect(belongsToProject(untagged, 'pB')).toBe(false)
        expect(belongsToProject(aLive, 'pA')).toBe(true)
        expect(belongsToProject(aLive, 'pB')).toBe(false)
    })

    it('page B does not pick project A live / awaiting / running', () => {
        const list = [aLive, bIdle, untagged]
        expect(pickAwaitingLocal(list, 'pB')).toBe(null)
        expect(pickLiveJob(list, 'pB')).toBe(null)
        expect(pickRunningJob(list, 'pB')).toBe(null)
        expect(pickAwaitingLocal(list, 'pA')).toBe(aLive)
        expect(pickLiveJob(list, 'pA')).toBe(aLive)
        expect(pickRunningJob(list, 'pA')).toBe(aLive)
    })
})
