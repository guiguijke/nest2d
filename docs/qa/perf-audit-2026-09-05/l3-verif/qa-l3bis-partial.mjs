// L3-bis / AF6 — le navigateur LIVRE une solution partielle : 2 tôles
// 1000×1000, 100 trou + 800 fan, effectif 4 mm (kerf 0 + sécurité 2) :
// ratio 0,8785 < seuil 0,88 → le pré-contrôle laisse passer, le moteur ne
// place pas tout (stock serré). Attendu : job DONE partiel — badge
// « n pièces non posées », leviers dans le modal, record unfit.partial,
// physique propre, AUCUN « retry in server mode » ni remboursement.
import { chromium } from 'file:///C:/Users/guiguijke/OneDrive/Projects/Nestorcut_Suite/Nestorcut/node_modules/playwright/index.mjs'
import fs from 'node:fs'
import path from 'node:path'

const BASE = process.env.QA_BASE_URL || 'http://localhost:7100'
const ROOT = 'C:/Users/guiguijke/OneDrive/Projects/Nestorcut_Suite/Nestorcut'
// AF7 : captures hors dossier suivi.
const OUT = process.env.QA_OUT || '.qa-pw/l3-verif'
fs.mkdirSync(OUT, { recursive: true })
const log = (...a) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a)
const browser = await chromium.launch({ headless: true })
const page = await (await browser.newContext({ locale: 'en-US', viewport: { width: 1680, height: 1000 } })).newPage()
const consoleErrors = []
page.on('pageerror', (e) => log('[pageerror]', String(e).slice(0, 300)))
page.on('console', (m) => {
    if (m.type() === 'error') { consoleErrors.push(m.text()); log('[console.error]', m.text().slice(0, 200)) }
})

try {
    await page.goto(BASE + '/auth/local', { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('.local-auth__form', { timeout: 30000 })
    if (await page.locator('.local-auth__form input[type="text"]').count()) {
        await page.locator('.local-auth__toggle').click()
    }
    await page.fill('.local-auth__form input[type="email"]', 'guillaume@local.dev')
    await page.fill('.local-auth__form input[type="password"]', 'nestorcut-local-2026')
    await page.locator('.local-auth__btn').click()
    await page.waitForURL('**/home', { timeout: 30000 })

    await page.setInputFiles('input[name="dxf"]', [
        path.join(ROOT, '.testparts', 'Piece_Trou.DXF'),
        path.join(ROOT, '.testparts', 'Piece_Fillx4.DXF'),
    ])
    await page.waitForURL('**/project/**', { timeout: 60000 })
    await page.waitForFunction(
        () => document.querySelectorAll('.files__item input.counter__value').length === 2,
        null, { timeout: 180000 })
    const cards = page.locator('.files__item')
    for (let i = 0; i < await cards.count(); i++) {
        const name = await cards.nth(i).locator('.file__name').innerText().catch(() => '')
        const target = /Piece_Trou/i.test(name) ? '100' : '800'
        const input = cards.nth(i).locator('input.counter__value')
        await input.click(); await input.fill(target); await input.blur()
    }
    // 2 tôles 1000×1000 (défaut usine) + effectif 4 mm.
    const field = (label) => page.locator('.settings .input', { has: page.locator('.input__prefix', { hasText: label }) }).locator('input')
    await field('Kerf').click(); await field('Kerf').fill('0'); await field('Kerf').blur()
    await field('Safety').click(); await field('Safety').fill('2'); await field('Safety').blur()

    log('nest (partiel attendu)')
    await page.locator('.atelier__nest').click()
    await page.locator('[data-testid="live-cancel"]').waitFor({ state: 'visible', timeout: 60000 })
    log('calcul lancé (~110 s)')
    await page.waitForFunction(
        () => !document.querySelector('[data-testid="live-cancel"]')
            && !document.querySelector('.stage__status')
            && document.querySelectorAll('.result__local').length > 0,
        null, { timeout: 300000 })
    log('job done')

    // PAS de message « rejected / retry in server mode », pas de bandeau rouge.
    const body = await page.locator('body').innerText()
    if (/rejected by physical validation|retry in server mode/i.test(body)) {
        throw new Error('AF6 NON CORRIGÉ : all_alternatives_invalid encore livré')
    }

    // Record complet (IndexedDB direct) — unfit.partial + physique.
    const rec = await page.evaluate(async () => {
        const db = await new Promise((res, rej) => {
            const r = indexedDB.open('nestorcut-local', 3)
            r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error)
        })
        const recs = await new Promise((res, rej) => {
            const rq = db.transaction('results', 'readonly').objectStore('results').getAll()
            rq.onsuccess = () => res(rq.result); rq.onerror = () => rej(rq.error)
        })
        recs.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
        const r = recs[0]
        const a0 = (r.alternatives || [])[0] || {}
        return {
            slug: r.slug, requested: r.requested, placed: r.placed,
            unfit: r.unfit || null,
            alt0: {
                strategy: a0.strategy,
                unplaced: a0.report?.unplaced ?? null,
                layoutCount: a0.layoutCount,
                overlapFree: a0.report?.overlapFree ?? null,
                insideSheet: a0.report?.insideSheet ?? null,
            },
        }
    })
    log('record =', JSON.stringify(rec))
    if (rec.placed >= rec.requested) throw new Error('cas devenu complet ?!')
    if (rec.alt0.unplaced <= 0) throw new Error('alt0 sans unplaced')
    if (rec.alt0.overlapFree !== true || rec.alt0.insideSheet !== true) throw new Error('physique sale')
    if (!rec.unfit || rec.unfit.reason !== 'partial') throw new Error('record.unfit.partial absent: ' + JSON.stringify(rec.unfit))

    // Modal : badge « n parts not placed » + bandeau partiel AVEC leviers.
    await page.locator('.results__item .result__area').first().click({ timeout: 10000 })
    await page.waitForTimeout(1800)
    const modal = await page.locator('.modal').first().innerText()
    if (!/not placed/i.test(modal)) throw new Error('badge « n pièces non posées » absent du modal')
    const partialPanel = page.locator('[data-testid="report-partial"]')
    await partialPanel.waitFor({ state: 'visible', timeout: 10000 })
    const levers = await partialPanel.locator('.report__unfit-levers li').allInnerTexts()
    log('leviers =', JSON.stringify(levers))
    if (!levers.length || !/\d/.test(levers.join(' '))) throw new Error('leviers partiel sans chiffres')
    await page.screenshot({ path: OUT + '/l3bis-partial-modal.png' })
    console.log(`PARTIAL OK — ${rec.placed}/${rec.requested} posés, ${rec.alt0.unplaced} non posées, leviers [${levers.join(' | ')}], physique propre`)
    await browser.close()
    process.exit(0)
} catch (e) {
    console.error('FAIL:', e.message)
    await page.screenshot({ path: OUT + '/l3bis-partial-fail.png' }).catch(() => {})
    await browser.close()
    process.exit(1)
}
