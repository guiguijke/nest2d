import { describe, expect, it } from 'vitest'
import { titleFromFileName } from '../utils/projectTitle'
import { overlayLocalProjectTitles } from '../composables/projects'

describe('titleFromFileName', () => {
    it('uses the basename without extension', () => {
        expect(titleFromFileName('marine_lpl_001.dxf')).toBe('marine_lpl_001')
        expect(titleFromFileName('/tmp/foo/bar.svg')).toBe('bar')
    })

    it('strips characters that would be XSS-ish in a title', () => {
        expect(titleFromFileName('<script>alert(1)</script>.dxf')).toBe('script')
    })
})

describe('overlayLocalProjectTitles', () => {
    it('leaves cloud projects untouched when IndexedDB is empty', async () => {
        const cloud = [{ slug: 'a', name: 'swift-newton', local: false }]
        expect(await overlayLocalProjectTitles(cloud)).toEqual(cloud)
    })
})
