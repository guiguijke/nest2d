// Lot 3 / C04 — refus capacité à effectif 0,3 mm : le levier « réduire
// l'espacement » doit être MASQUÉ (plus rien à gagner sous 0,5 mm) et la
// phrase « même sans espacement, ça ne tient pas » prend le relais.
import { chromium } from 'file:///C:/Users/guiguijke/OneDrive/Projects/Nestorcut_Suite/Nestorcut/node_modules/playwright/index.mjs'
import path from 'node:path'

const BASE = process.env.QA_BASE_URL || 'http://localhost:7100'
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

    await page.setInputFiles('input[name="dxf"]', path.join(ROOT, '.testparts', 'Piece_Trou.DXF'))
    await page.waitForURL('**/project/**', { timeout: 60000 })
    await page.waitForSelector('.files__item input.counter__value', { timeout: 180000 })
    const cnt = page.locator('.files__item input.counter__value').first()
    await cnt.click(); await cnt.fill('10'); await cnt.blur()
    // Tôle 200×300, 1 seule.
    const sheet = page.locator('.size__sheet').first()
    const dims = sheet.locator('.size__line .input__value')
    await dims.nth(0).click(); await dims.nth(0).fill('200'); await dims.nth(0).blur()
    await dims.nth(1).click(); await dims.nth(1).fill('300'); await dims.nth(1).blur()
    const countInput = sheet.locator('> .input__value, > label.input .input__value').first()
    if (String(await countInput.inputValue()) !== '1') { await countInput.fill('1'); await countInput.blur() }
    // Effectif 0,3 mm : kerf 0 + sécurité 0,15.
    const field = (label) => page.locator('.settings .input', { has: page.locator('.input__prefix', { hasText: label }) }).locator('input')
    await field('Kerf').click(); await field('Kerf').fill('0'); await field('Kerf').blur()
    await field('Safety').click(); await field('Safety').fill('0.15'); await field('Safety').blur()

    log('nest (refus 0,3 mm attendu)')
    await page.locator('.atelier__nest').click()
    const panel = page.locator('[data-testid="capacity-panel"]')
    await panel.waitFor({ state: 'visible', timeout: 30000 })
    // Levier MASQUÉ.
    await page.waitForTimeout(1200)
    const reduce = await page.locator('[data-testid="capacity-reduce-spacing"]').count()
    log('levier présent:', reduce)
    if (reduce) throw new Error('levier devrait être masqué sous 0,5 mm')
    // Phrase plancher.
    const floor = page.locator('.capacity-panel__floor')
    await floor.waitFor({ state: 'visible', timeout: 5000 })
    log('phrase =', JSON.stringify((await floor.innerText()).slice(0, 80)))
    if (!/zero spacing/i.test(await floor.innerText())) throw new Error('phrase « même sans espacement » absente')
    await page.screenshot({ path: 'docs/qa/perf-audit-2026-09-05/l3-verif/l3-refus-0.3mm-panel.png' })
    console.log('REFUS 0.3MM OK — levier masqué, phrase plancher affichée')
    await browser.close()
    process.exit(0)
} catch (e) {
    console.error('FAIL:', e.message)
    await page.screenshot({ path: 'docs/qa/perf-audit-2026-09-05/l3-verif/l3-refus-0.3mm-fail.png' }).catch(() => {})
    await browser.close()
    process.exit(1)
}
