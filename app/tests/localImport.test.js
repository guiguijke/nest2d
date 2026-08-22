import { beforeEach, describe, expect, it, vi } from 'vitest'

// J-090 — flux d'import navigateur : gardes-fous (extension, entités, pièces
// vides) + chaînage parse → canonical → couleurs → store. Le wasm
// (geometryClient) et le store IndexedDB sont mockés : la géométrie elle-
// même est verrouillée par les goldens Rust/côté crates.
const state = vi.hoisted(() => ({
    imported: null,
    canonical: null,
    saved: [],
}))

vi.mock('../composables/geometryClient', () => ({
    geoImportFile: vi.fn(async () => state.imported),
    geoCanonicalDxf: vi.fn(async () => state.canonical),
}))

vi.mock('../composables/localFilesStore', async (importOriginal) => {
    const actual = await importOriginal()
    return {
        ...actual,
        saveLocalFile: vi.fn(async (record) => {
            state.saved.push(record)
        }),
    }
})

import { importLocalFile, localRecordToUiFile } from '../composables/localImport'

const squarePart = {
    coordinates: [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]],
    holes: [],
    width: 10,
    height: 10,
    handles: ['A1'],
}

function fakeFile(name, bytes = new Uint8Array([1, 2, 3])) {
    return {
        name,
        arrayBuffer: async () => bytes.buffer,
    }
}

beforeEach(() => {
    state.imported = {
        parts: [squarePart],
        source_units: 4,
        entity_count: 1,
        warnings: [],
    }
    state.canonical = new Uint8Array([9, 9, 9])
    state.saved = []
})

describe('importLocalFile (J-090)', () => {
    it('stores a full record (geometry + canonical bytes + preview) in IndexedDB', async () => {
        const record = await importLocalFile(fakeFile('bracket.dxf'), 'proj-1')
        expect(record.slug).toMatch(/^f-[0-9a-f]{16}\.dxf$/)
        expect(record.name).toBe('bracket.dxf')
        expect(record.slug).not.toContain('bracket')
        expect(record.projectSlug).toBe('proj-1')
        expect(record.dxfBytes).toBeInstanceOf(ArrayBuffer)
        expect(record.parts).toHaveLength(1)
        expect(record.parts[0].color).toMatch(/^#[0-9A-F]{6}$/)
        expect(record.parts[0].handles).toEqual(['A1'])
        expect(record.previewSvg.startsWith('data:image/svg+xml')).toBe(true)
        expect(state.saved).toHaveLength(1)
    })

    it('rejects DWG with a dedicated i18n key (server-side conversion only)', async () => {
        await expect(importLocalFile(fakeFile('part.dwg'), 'p')).rejects.toThrow('localImport.dwgRejected')
        expect(state.saved).toHaveLength(0)
    })

    it('rejects unsupported types and unparseable files', async () => {
        await expect(importLocalFile(fakeFile('notes.txt'), 'p')).rejects.toThrow('localImport.unsupportedType')
        state.imported = null
        await expect(importLocalFile(fakeFile('broken.dxf'), 'p')).rejects.toThrow('localImport.parseError')
    })

    it('rejects entity floods and empty geometry like the server pipeline does', async () => {
        state.imported = { parts: [squarePart], source_units: 4, entity_count: 1000, warnings: [] }
        await expect(importLocalFile(fakeFile('flood.dxf'), 'p')).rejects.toThrow('localImport.tooManyEntities')
        state.imported = { parts: [], source_units: 4, entity_count: 3, warnings: [] }
        await expect(importLocalFile(fakeFile('empty.dxf'), 'p')).rejects.toThrow('localImport.noParts')
    })
})

describe('localRecordToUiFile', () => {
    it('mirrors the server mapper shape (light parts, done, never expired)', () => {
        const ui = localRecordToUiFile({
            slug: 'a.dxf',
            name: 'a.dxf',
            previewSvg: 'data:image/svg+xml;utf8,x',
            parts: [{ width: 10.04, height: 5.96, color: '#2563EB', coordinates: [[0, 0]] }],
        })
        expect(ui).toMatchObject({
            slug: 'a.dxf',
            processingStatus: 'done',
            expired: false,
            local: true,
        })
        // blob: en navigateur, null en environnement test (pas d'URL API).
        expect(ui.dxfUrl === null || String(ui.dxfUrl).startsWith('blob:')).toBe(true)
        expect(ui.parts[0]).toEqual({ width: 10, height: 6, color: '#2563EB' })
        expect(ui.svgUrl).toContain('data:image/svg+xml')
    })
})
