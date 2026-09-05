// C02/C03 (audit UX 2026-09-05) — rendu du modal résultat après un calcul
// navigateur complet : ligne qualité unique (densité matière + chute),
// ligne « proposée en premier », sous-titre méthode Grille, PLUS de barre
// « Sheet utilization », badges sans post-pass, détails techniques
// repliés contenant le post-pass.
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

    let outcome = 'timeout'
    const t0 = Date.now()
    while (Date.now() - t0 < 300000) {
        await page.waitForTimeout(3000)
        const errTxt = (await page.locator('.content__error').allInnerTexts().catch(() => [])).join(' ')
        if (errTxt) { outcome = 'page-error: ' + errTxt; break }
        const stageRunning = await page.locator('.stage__status').count()
        const doneBtn = await page.locator('.controls__report').count()
        if (doneBtn && !stageRunning) { outcome = 'done'; break }
    }
    log('compute outcome:', outcome, `(${((Date.now() - t0) / 1000).toFixed(0)}s)`)
    if (outcome !== 'done') throw new Error('nest did not complete: ' + outcome)
    await page.waitForTimeout(1500)

    // ouvre le modal du dernier résultat
    await page.locator('.controls__report').first().click()
    await page.waitForSelector('.modal', { timeout: 15000 })
    await page.waitForTimeout(1000)

    const check = async (name, ok, extra = '') => {
        log(`${ok ? 'OK ' : 'FAIL'} — ${name}${extra ? ' : ' + extra : ''}`)
        if (!ok) throw new Error(name)
    }

    // --- C02 : ligne qualité unique dans l'onglet actif ---
    const tabText = (await page.locator('.alts__tab--active').innerText().catch(() => '')) || ''
    await check('onglet actif porte la densité matière', /material/i.test(tabText), JSON.stringify(tabText.replace(/\s+/g, ' ').slice(0, 90)))
    await check('onglet actif ne dit plus "% used"', !/used/i.test(tabText))

    // --- C02 : ligne pourquoi en premier ---
    const why = await page.locator('.alts__why').count()
    await check('ligne « proposée en premier » présente (rang 0)', why === 1, (await page.locator('.alts__why').first().innerText().catch(() => '')) + '')

    // --- C02 : sous-titre méthode grille ---
    const explain = await page.locator('.headline__explain').innerText().catch(() => '')
    await check('sous-titre explicatif Grille', /regular rows/i.test(explain), explain.slice(0, 80))

    // --- C02 : la barre unique est la densité (plus de Sheet utilization) ---
    const summaryLabel = await page.locator('.summary__label').innerText().catch(() => '')
    await check('barre sommaire = Material density', /material density/i.test(summaryLabel), summaryLabel)
    const modalText = await page.locator('.modal').last().innerText()
    await check('« Sheet utilization » absent du modal', !/sheet utilization/i.test(modalText))

    // --- C02 : headline avec densité + chute ---
    const headline = await page.locator('.headline__title').innerText().catch(() => '')
    await check('headline porte densité matière + chute', /material density/i.test(headline) && /offcut/i.test(headline), headline.replace(/\s+/g, ' ').slice(0, 100))

    // --- C03 : badges sans post-pass ; rouge seulement pour un vrai KO ---
    const badges = await page.locator('.report__badges .report__badge').allInnerTexts()
    await check('aucun badge « Post-pass »', !badges.some((b) => /post-pass/i.test(b)), JSON.stringify(badges))
    const koBadges = await page.locator('.report__badges .report__badge--ko').allInnerTexts().catch(() => [])
    log('badges KO:', JSON.stringify(koBadges))

    // --- C03 : détails techniques repliés, contenant seed/itérations ---
    const tech = page.locator('[data-testid="report-tech"]')
    await check('détails techniques repliés présents', await tech.count() === 1)
    const closed = await tech.getAttribute('open') === null
    await check('détails fermés par défaut', closed)
    await tech.locator('summary').click()
    await page.waitForTimeout(300)
    const engineLine = await page.locator('.report__engine').innerText().catch(() => '')
    // Grille : ni seed ni itérations (générée, pas moteur) → masqués (C03)
    await check('ligne moteur propre (absents masqués, pas de « seed — »)', /nest-engine/i.test(engineLine) && !/—|null|undefined/.test(engineLine), engineLine.replace(/\s+/g, ' ').slice(0, 90))
    await check('plus de « combinations tested »', !/combinations tested/i.test(engineLine))

    // Option 2 (moteur) : le post-pass vit DANS les détails, pas en badge
    await page.locator('.alts__tab').nth(1).click()
    await page.waitForTimeout(600)
    const badges2 = await page.locator('.report__badges .report__badge').allInnerTexts()
    await check('option 2 : aucun badge « Post-pass »', !badges2.some((b) => /post-pass/i.test(b)), JSON.stringify(badges2))
    const tech2 = page.locator('[data-testid="report-tech"]')
    if (await tech2.count()) {
        await tech2.locator('summary').click()
        await page.waitForTimeout(300)
        const lines2 = await page.locator('.report__tech-line').allInnerTexts().catch(() => [])
        log('lignes post-pass option 2 :', JSON.stringify(lines2))
        await check('option 2 : ligne « proposée en premier » absente (rang 1)', (await page.locator('.alts__why').count()) === 0)
    } else {
        log('option 2 : pas de détails techniques (rien à montrer)')
    }

    console.log('C02/C03 OK — modal : indicateur qualité unique, méthode, badges verdict, détails techniques repliés')
    await browser.close()
    process.exit(0)
} catch (e) {
    console.error('C02/C03 FAIL:', e.message)
    await page.screenshot({ path: '.qa-pw/e2e-local/c02c03-fail.png' }).catch(() => {})
    await browser.close()
    process.exit(1)
}
