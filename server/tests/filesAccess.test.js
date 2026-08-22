import { Readable } from 'node:stream'
import { describe, expect, it } from 'vitest'
import './helpers/h3Shims'
import { openOwnedFileStream } from '~~/server/utils/vault'
import { makeOpaqueFileSlug, FILE_SLUG_RANDOM_LEN, titleFromFileName } from '~~/server/utils/strings'
import { DOMAINS } from '~~/server/core/domains'

function bucketWith(docs) {
    return {
        find: () => ({ toArray: async () => docs }),
        openDownloadStreamByName: () => Readable.from([Buffer.from('dxf-bytes')]),
    }
}

async function expectErr(promise, statusCode) {
    await expect(promise).rejects.toMatchObject({ statusCode })
}

describe('openOwnedFileStream (pentest C-1)', () => {
    it('404 when the slug does not exist', async () => {
        await expectErr(
            openOwnedFileStream({ context: { auth: { userId: 'u1' } } }, bucketWith([]), 'missing.dxf'),
            404,
        )
    })

    it('404 (not 401) when the file belongs to someone else', async () => {
        const bucket = bucketWith([{ filename: 'f-abc.dxf', metadata: { ownerId: 'victim' } }])
        await expectErr(
            openOwnedFileStream({ context: { auth: { userId: 'attacker' } } }, bucket, 'f-abc.dxf'),
            404,
        )
    })

    it('401 when unauthenticated', async () => {
        await expectErr(
            openOwnedFileStream({ context: {} }, bucketWith([]), 'x.dxf'),
            401,
        )
    })

    it('returns the stream for the owner of a plaintext file', async () => {
        const bucket = bucketWith([{ filename: 'mine.dxf', metadata: { ownerId: 'u1' } }])
        const out = await openOwnedFileStream({ context: { auth: { userId: 'u1' } } }, bucket, 'mine.dxf')
        expect(out.encrypted).toBe(false)
        expect(out.stream).toBeTruthy()
    })
})

describe('opaque file slug (pentest C-1)', () => {
    it('is f-{16 hex}{ext} and does not contain the original name', () => {
        const slug = makeOpaqueFileSlug('.dxf')
        expect(slug).toMatch(new RegExp(`^f-[0-9a-f]{${FILE_SLUG_RANDOM_LEN}}\\.dxf$`))
        expect(slug).not.toMatch(/marine|bracket|client/i)
        expect(makeOpaqueFileSlug('.svg')).not.toBe(makeOpaqueFileSlug('.svg'))
    })
})

describe('titleFromFileName', () => {
    it('strips path, extension and control chars', () => {
        expect(titleFromFileName('C:\\\\parts\\\\Marine LPL 001.DXF')).toBe('Marine LPL 001')
        expect(titleFromFileName('<img src=x>.dxf')).toBe('img src=x')
        expect(titleFromFileName('')).toBe('')
    })
})

describe('domains (pentest M-4)', () => {
    it('rejects foreign bin projects (404, not a 200 name leak)', () => {
        expect(DOMAINS.bin.rejectForeignProject).toBe(true)
        expect(DOMAINS.strip.rejectForeignProject).toBe(true)
    })
})
