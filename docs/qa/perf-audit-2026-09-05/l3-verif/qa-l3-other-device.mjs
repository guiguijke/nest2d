// Lot 3 / C05 — résultat calculé dans le navigateur A, ouvert depuis le
// navigateur B (autre appareil : même compte, IndexedDB vierge) :
// message explicite « Autre appareil », AUCUN « 0 sheets » ni bouton
// « Download All » fantôme.
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
const ctxA = await browser.newContext({ locale: 'en-US', viewport: { width: 1680, height: 1000 } })
const page = await ctxA.newPage()
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
    const urlA = page.url()
    await page.waitForFunction(
        () => document.querySelectorAll('.files__item input.counter__value').length === 2,
        null, { timeout: 180000 })
    const cards = page.locator('.files__item')
    for (let i = 0; i < await cards.count(); i++) {
        const name = await cards.nth(i).locator('.file__name').innerText().catch(() => '')
        const target = /Piece_Trou/i.test(name) ? '20' : '100'
        const input = cards.nth(i).locator('input.counter__value')
        await input.click(); await input.fill(target); await input.blur()
    }
    log('nest (calcul local navigateur A)')
    await page.locator('.atelier__nest').click()
    // Race fix : attendre d'abord que le calcul SOIT lancé (live-cancel
    // visible), PUIS sa fin (disparition + carte done locale).
    await page.locator('[data-testid="live-cancel"]').waitFor({ state: 'visible', timeout: 60000 })
    log('calcul A lancé')
    await page.waitForFunction(
        () => !document.querySelector('[data-testid="live-cancel"]')
            && !document.querySelector('.stage__status')
            && document.querySelectorAll('.result__local').length > 0,
        null, { timeout: 300000 })
    log('calcul A terminé (carte done locale visible)')

    // Contexte B : mêmes cookies de session, IndexedDB vierge.
    const state = await ctxA.storageState()
    const ctxB = await browser.newContext({ locale: 'en-US', storageState: state, viewport: { width: 1680, height: 1000 } })
    const pageB = await ctxB.newPage()
    await pageB.goto(urlA, { waitUntil: 'domcontentloaded' })
    await pageB.waitForSelector('.result', { timeout: 60000 })
    await pageB.waitForTimeout(2500)
    const body = await pageB.locator('.results').innerText().catch(() => pageB.locator('body').innerText())
    log('carte B =', JSON.stringify(body.slice(0, 220)))
    if (!/another device|autre appareil/i.test(body)) throw new Error('message « autre appareil » absent')
    if (/0 sheets|0 tôles/i.test(body)) throw new Error('« 0 tôles » encore visible')
    const dl = await pageB.locator('.controls__download').count()
    log('boutons download sur la carte:', dl)
    if (dl) throw new Error('bouton Download fantôme')
    const ph = await pageB.locator('.result__placeholder--elsewhere').count()
    log('placeholder elsewhere:', ph)
    if (!ph) throw new Error('placeholder « Autre appareil » absent')
    await pageB.screenshot({ path: OUT + '/l3-other-device-card.png' })
    console.log('OTHER DEVICE OK — message explicite, aucun téléchargement fantôme')
    await browser.close()
    process.exit(0)
} catch (e) {
    console.error('FAIL:', e.message)
    await page.screenshot({ path: OUT + '/l3-other-device-fail.png' }).catch(() => {})
    await browser.close()
    process.exit(1)
}
