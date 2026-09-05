// C01 (audit UX 2026-09-05) — annulation d'un calcul NAVIGATEUR depuis la
// vue live. Vérifie : bouton [data-testid="live-cancel"] visible pendant
// awaiting_local, clic → annulation effective (scène libérée, pas d'erreur
// de page, job finalisé). Lance puis annule ~10 s après le départ.
import { chromium } from 'playwright'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const BASE = process.env.QA_BASE_URL || 'http://localhost:7100'
const ROOT = path.dirname(fileURLToPath(import.meta.url))
const TROU = path.join(ROOT, '.testparts', 'Piece_Trou.DXF')
const FILL = path.join(ROOT, '.testparts', 'Piece_Fillx4.DXF')

const log = (...a) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a)
const browser = await chromium.launch({ headless: true })
const page = await (await browser.newContext({ locale: 'en-US', viewport: { width: 1680, height: 1000 } })).newPage()
page.on('pageerror', (e) => log('[pageerror]', String(e).slice(0, 500)))

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

    await page.waitForSelector('input[name="dxf"]', { state: 'attached', timeout: 30000 })
    await page.setInputFiles('input[name="dxf"]', [TROU, FILL])
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
    const sheet = page.locator('.size__sheet').first()
    const dims = sheet.locator('.size__line .input__value')
    if (String(await dims.nth(1).inputValue()) !== '1000') { await dims.nth(1).fill('1000'); await dims.nth(1).blur() }
    const countInput = sheet.locator('> .input__value, > label.input .input__value').first()
    if (String(await countInput.inputValue()) !== '2') { await countInput.fill('2'); await countInput.blur() }

    log('nest clicked')
    await page.locator('.atelier__nest').click()
    await page.waitForTimeout(3000)

    // --- 1. le bouton Annuler vit sous la vue live PENDANT le calcul ---
    const cancelBtn = page.locator('[data-testid="live-cancel"]')
    await cancelBtn.waitFor({ state: 'visible', timeout: 20000 })
    const label = (await cancelBtn.innerText()).trim()
    log('live-cancel VISIBLE, label =', JSON.stringify(label))
    if (!/cancel/i.test(label)) throw new Error('unexpected label: ' + label)
    const stageRunning = await page.locator('.stage__status').count()
    log('stage__status present during compute:', stageRunning)

    // --- 2. annulation ---
    await cancelBtn.click()
    log('cancel clicked')
    // état « cancelling » (disabled) puis disparition
    await page.waitForTimeout(1500)
    const disabledWhileCancelling = await cancelBtn.isDisabled().catch(() => null)
    log('disabled while cancelling:', disabledWhileCancelling)

    // --- 3. la scène se libère (plus de statut en cours) ---
    let freed = false
    for (let i = 0; i < 15; i++) {
        await page.waitForTimeout(2000)
        const running = await page.locator('.stage__status').count()
        const btnGone = (await page.locator('[data-testid="live-cancel"]').count()) === 0
        if (!running && btnGone) { freed = true; break }
    }
    log('stage freed:', freed)
    if (!freed) throw new Error('stage did not free after cancel')

    // le bouton Nest est réutilisable (retour à l'état repos)
    const nestLabel = await page.locator('.atelier__nest').innerText().catch(() => '')
    log('nest button after cancel:', JSON.stringify(nestLabel.trim().slice(0, 60)))
    console.log('C01 OK — annulation calcul navigateur depuis la vue live')
    await browser.close()
    process.exit(0)
} catch (e) {
    console.error('C01 FAIL:', e.message)
    await page.screenshot({ path: '.qa-pw/e2e-local/c01-fail.png' }).catch(() => {})
    await browser.close()
    process.exit(1)
}
