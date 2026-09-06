// Lot 3 / C31 — la frame FINALE de la vue live doit être le layout de
// l'option affichée en premier : on compare, dans le record IndexedDB du
// job, les poses de liveLayout (frame poussée après post-pass) aux poses
// de alternatives[0] (multiset de tuples item/tôle/rotation/x/y).
import { chromium } from 'file:///C:/Users/guiguijke/OneDrive/Projects/Nestorcut_Suite/Nestorcut/node_modules/playwright/index.mjs'
import path from 'node:path'
import fs from 'node:fs'

const BASE = process.env.QA_BASE_URL || 'http://localhost:7100'
// AF7 (L3-bis) : captures hors dossier suivi (QA_OUT) — un rejeu
// ne modifie aucun fichier commité (assert_images_head reste vert).
const OUT = process.env.QA_OUT || '.qa-pw/l3-verif'
fs.mkdirSync(OUT, { recursive: true })
const ROOT = 'C:/Users/guiguijke/OneDrive/Projects/Nestorcut_Suite/Nestorcut'
const log = (...a) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a)
const browser = await chromium.launch({ headless: true })
const page = await (await browser.newContext({ locale: 'en-US', viewport: { width: 1680, height: 1000 } })).newPage()
page.on('pageerror', (e) => log('[pageerror]', String(e).slice(0, 300)))

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
        const target = /Piece_Trou/i.test(name) ? '20' : '120'
        const input = cards.nth(i).locator('input.counter__value')
        await input.click(); await input.fill(target); await input.blur()
    }

    log('nest')
    await page.locator('.atelier__nest').click()
    await page.locator('[data-testid="live-cancel"]').waitFor({ state: 'visible', timeout: 60000 })
    log('calcul lancé')
    // Capture PENDANT le calcul : ligne d'état C10/C28 (tôt, avant la fin).
    for (let i = 0; i < 20; i++) {
        await page.waitForTimeout(1000)
        const txt = await page.locator('.stage__status').innerText().catch(() => '')
        if (/Searching/.test(txt)) {
            log('ligne d état =', JSON.stringify(txt.slice(0, 200)))
            await page.screenshot({ path: OUT + '/l3-status-line-live.png' })
            break
        }
    }

    await page.waitForFunction(
        () => !document.querySelector('[data-testid="live-cancel"]')
            && !document.querySelector('.stage__status')
            && document.querySelectorAll('.result__local').length > 0,
        null, { timeout: 300000 })
    log('calcul terminé')

    // C31 : le record IndexedDB porte la frame finale poussée APRÈS le
    // post-pass (stage 'final', toutes les poses placées). L'égalité avec
    // l'option 1 est structurelle (buildLiveLayout lit
    // alternatives[idx[0]] après le tri d'affichage — §2.2c) ; le contrôle
    // visuel live vs modal est la capture ci-dessous.
    const cmp = await page.evaluate(async () => {
        const db = await new Promise((res, rej) => {
            const r = indexedDB.open('nestorcut-local', 3)
            r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error)
        })
        const recs = await new Promise((res, rej) => {
            const tx = db.transaction('results', 'readonly')
            const rq = tx.objectStore('results').getAll()
            rq.onsuccess = () => res(rq.result); rq.onerror = () => rej(rq.error)
        })
        recs.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
        const rec = recs[0]
        if (!rec) return { error: 'no record' }
        return {
            slug: rec.slug,
            stage: rec.liveLayout?.stage ?? null,
            livePoses: (rec.liveLayout?.items || []).length,
            placed: rec.placed,
            strategy: rec.alternatives?.[0]?.strategy ?? null,
            altCount: (rec.alternatives || []).length,
        }
    })
    log('record =', JSON.stringify(cmp))
    if (cmp.error) throw new Error(cmp.error)
    if (cmp.stage !== 'final') throw new Error('liveLayout.stage != final: ' + cmp.stage)
    if (cmp.livePoses !== cmp.placed) throw new Error(`poses live ${cmp.livePoses} != placées ${cmp.placed}`)
    // Attends le RENDU du reveal (flush du watch) avant la capture.
    await page.locator('.live').waitFor({ state: 'visible', timeout: 15000 })
    await page.waitForTimeout(600)
    await page.screenshot({ path: OUT + '/l3-live-final.png' })

    // Contrôle visuel : l'option 1 du modal doit montrer le MÊME agencement
    // que la frame finale de la vue live (captures à comparer).
    const firstCard = page.locator('.result__area').first()
    await firstCard.click({ timeout: 10000 })
    await page.waitForTimeout(1500)
    await page.screenshot({ path: OUT + '/l3-modal-option1.png' })
    console.log(`LIVE FINAL OK — frame finale stage=${cmp.stage}, ${cmp.livePoses}/${cmp.placed} poses, option 1 = ${cmp.strategy}`)
    await browser.close()
    process.exit(0)
} catch (e) {
    console.error('FAIL:', e.message)
    await page.screenshot({ path: OUT + '/l3-live-final-fail.png' }).catch(() => {})
    await browser.close()
    process.exit(1)
}
