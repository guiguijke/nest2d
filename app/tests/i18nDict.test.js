import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { LOCALES, translate } from '../utils/i18n'

// ---------------------------------------------------------------------------
// C06 (lot 3) : unicité des clés i18n. Le dictionnaire est un objet JS —
// une clé dupliquée dans un bloc est ÉCRASÉE silencieusement (le bug réel
// de l'audit : une valeur FR vivait dans le bloc EN). On parse donc le
// SOURCE, pas l'objet construit.
// ---------------------------------------------------------------------------

const src = readFileSync(fileURLToPath(new URL('../utils/i18n.js', import.meta.url)), 'utf8')
const enBlock = src.split('    en: {')[1].split('    fr: {')[0]
const frBlock = src.split('    fr: {')[1]

/** Clés littérales d'un bloc — ignore commentaires et lignes non-clés. */
function keysOf(block) {
    const keys = []
    for (const line of block.split('\n')) {
        const m = line.match(/^\s*'([^']+)':\s/)
        if (m) keys.push(m[1])
    }
    return keys
}

function duplicates(keys) {
    const seen = new Set()
    const dup = new Set()
    for (const k of keys) {
        if (seen.has(k)) dup.add(k)
        seen.add(k)
    }
    return [...dup]
}

describe('dictionnaire i18n (C06)', () => {
    it('aucune clé dupliquée dans le bloc EN', () => {
        expect(duplicates(keysOf(enBlock))).toEqual([])
    })

    it('aucune clé dupliquée dans le bloc FR', () => {
        expect(duplicates(keysOf(frBlock))).toEqual([])
    })

    it('chaque clé FR existe en EN (sinon clé morte)', () => {
        const en = new Set(keysOf(enBlock))
        const dead = keysOf(frBlock).filter((k) => !en.has(k))
        expect(dead).toEqual([])
    })

    it('les placeholders {x} sont identiques entre EN et FR', () => {
        const en = new Map()
        for (const line of enBlock.split('\n')) {
            const m = line.match(/^\s*'([^']+)':\s*(.+),\s*$/)
            if (m) en.set(m[1], m[2])
        }
        const problems = []
        for (const line of frBlock.split('\n')) {
            const m = line.match(/^\s*'([^']+)':\s*(.+),\s*$/)
            if (!m || !en.has(m[1])) continue
            const ph = (v) => new Set([...v.matchAll(/\{(\w+)\}/g)].map((x) => x[1]))
            const a = ph(en.get(m[1]))
            const b = ph(m[2])
            for (const p of a) if (!b.has(p)) problems.push(`${m[1]}: FR manque {${p}}`)
            for (const p of b) if (!a.has(p)) problems.push(`${m[1]}: FR a {${p}} en trop`)
        }
        expect(problems).toEqual([])
    })

    it('LOCALES intégré et fallback visible', () => {
        expect(LOCALES).toEqual(['en', 'fr'])
        expect(translate('settings.kerf', 'fr')).toContain('Kerf')
        expect(translate('settings.spacingRule', 'en')).toContain('kerf + 2 × safety')
        expect(translate('settings.spacingRule', 'fr')).toContain('kerf + 2 × sécurité')
    })

    // Glossaire FR (C06/C21) : « tôle » jamais « plaque », vouvoiement.
    // Formes précises (pas de regex \bTES\b — faux positifs sur les
    // accents : « concrètes »).
    it('glossaire FR : jamais « plaque », pas de tutoiement', () => {
        const forbidden = [
            'plaque', 'Plaque', 'plaques', 'Plaques',
            ' tes pièces', 'Tes pièces', 'tes appareils', 'Tous tes',
            'Réimporte-le', 'réimporte-le', 'dépose-les', 'Dépose-les',
            'essaie le projet', 'clé à toi',
        ]
        const hits = []
        for (const line of frBlock.split('\n')) {
            for (const bad of forbidden) {
                if (line.includes(bad)) hits.push(`${bad} → ${line.trim().slice(0, 70)}`)
            }
        }
        expect(hits).toEqual([])
    })
})
