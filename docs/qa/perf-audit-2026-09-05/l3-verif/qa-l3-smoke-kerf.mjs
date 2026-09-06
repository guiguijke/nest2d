// Lot 3 — smoke : les deux champs kerf/sécurité existent, la règle
// s'affiche, l'effectif = kerf + 2×sécurité se propage dans params.
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
const page = await (await browser.newContext({ viewport: { width: 1680, height: 1000 } })).newPage()
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
    log('logged in')

    await page.setInputFiles('input[name="dxf"]', path.join(ROOT, '.testparts', 'Piece_Trou.DXF'))
    await page.waitForURL('**/project/**', { timeout: 60000 })
    await page.waitForSelector('.settings .input__value', { timeout: 30000 })

    const field = (label) => page.locator('.settings .input', { has: page.locator('.input__prefix', { hasText: label }) }).locator('input')
    await field('Kerf').waitFor({ timeout: 15000 })
    const kerf = await field('Kerf').inputValue()
    const safety = await field('Safety').inputValue()
    log('kerf =', kerf, '| safety =', safety)
    // Défaut usine : kerf 0, sécurité 1 → effectif 2 (B.4).
    if (kerf !== '0' || safety !== '1') throw new Error(`defaults inattendus: ${kerf}/${safety}`)
    const rule = await page.locator('.size__rule').innerText()
    log('rule =', JSON.stringify(rule))
    if (!/kerf \+ 2 × safety/.test(rule)) throw new Error('règle absente : ' + rule)
    if (!/= 2 mm/.test(rule)) throw new Error('effectif attendu 2 mm : ' + rule)

    // Saisie : kerf 0.2 + sécurité 0.9 → effectif 2 (0.2 + 1.8).
    await field('Kerf').click(); await field('Kerf').fill('0.2'); await field('Kerf').blur()
    await field('Safety').click(); await field('Safety').fill('0.9'); await field('Safety').blur()
    await page.waitForTimeout(400)
    const rule2 = await page.locator('.size__rule').innerText()
    if (!/= 2 mm/.test(rule2)) throw new Error('effectif kerfisé attendu 2 mm : ' + rule2)
    log('rule après saisie =', JSON.stringify(rule2))

    // Hint trous > 2.4 : sécurité 1.3 → effectif 2.6.
    await field('Safety').click(); await field('Safety').fill('1.3'); await field('Safety').blur()
    await page.waitForTimeout(300)
    const hint = await page.locator('.size__warning', { hasText: 'cutouts' }).count()
    log('hint 2.4 visible:', hint)
    if (!hint) throw new Error('hint 2,4 mm absent')
    await page.screenshot({ path: OUT + '/l3-kerf-settings.png' })
    console.log('SMOKE KERF OK')
    await browser.close()
    process.exit(0)
} catch (e) {
    console.error('FAIL:', e.message)
    await page.screenshot({ path: OUT + '/l3-smoke-kerf-fail.png' }).catch(() => {})
    await browser.close()
    process.exit(1)
}
