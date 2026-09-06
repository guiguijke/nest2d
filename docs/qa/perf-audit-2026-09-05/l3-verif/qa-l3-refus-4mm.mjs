// Lot 3 / C04-C09 — refus capacité à 4 mm : panneau UNIQUE ancré sous le
// bouton Nest, levier « réduire l'espacement » VISIBLE (> 0,5 mm) et
// fonctionnel (réduit la SÉCURITÉ, jamais le kerf), aucune carte
// « Nesting failed » fantôme. Cas = T-J : 100 trou + 900 fans, 1 tôle
// 1000×2000, effectif 4 mm (kerf 0 + sécurité 2).
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
        const target = /Piece_Trou/i.test(name) ? '100' : '900'
        const input = cards.nth(i).locator('input.counter__value')
        await input.click(); await input.fill(target); await input.blur()
    }
    // Tôle unique 1000×2000.
    const sheet = page.locator('.size__sheet').first()
    const dims = sheet.locator('.size__line .input__value')
    if (String(await dims.nth(0).inputValue()) !== '1000') { await dims.nth(0).fill('1000'); await dims.nth(0).blur() }
    if (String(await dims.nth(1).inputValue()) !== '2000') { await dims.nth(1).fill('2000'); await dims.nth(1).blur() }
    const countInput = sheet.locator('> .input__value, > label.input .input__value').first()
    if (String(await countInput.inputValue()) !== '1') { await countInput.fill('1'); await countInput.blur() }
    // Effectif 4 mm : kerf 0 + sécurité 2.
    const field = (label) => page.locator('.settings .input', { has: page.locator('.input__prefix', { hasText: label }) }).locator('input')
    await field('Kerf').click(); await field('Kerf').fill('0'); await field('Kerf').blur()
    await field('Safety').click(); await field('Safety').fill('2'); await field('Safety').blur()

    log('nest (refus attendu)')
    await page.locator('.atelier__nest').click()
    // Panneau : UNIQUE, dans l'aside params (sous le bouton Nest).
    const panel = page.locator('[data-testid="capacity-panel"]')
    await panel.waitFor({ state: 'visible', timeout: 30000 })
    const inAside = await page.locator('.atelier__params [data-testid="capacity-panel"]').count()
    log('panneau dans aside:', inAside)
    if (inAside !== 1) throw new Error('panneau pas ancré sous le bouton Nest')
    const panelCount = await page.locator('[data-testid="capacity-panel"]').count()
    if (panelCount !== 1) throw new Error('panneau multiple: ' + panelCount)
    // Levier VISIBLE (4 > 0,5).
    const reduce = page.locator('[data-testid="capacity-reduce-spacing"]')
    await reduce.waitFor({ state: 'visible', timeout: 10000 })
    log('levier visible:', await reduce.innerText())
    // Phrase plancher absente.
    if (await page.locator('.capacity-panel__floor').count()) throw new Error('phrase plançon inattendue à 4 mm')
    // AF1 (L3-bis) : UN SEUL message — l'ancien bandeau rouge sous la
    // scène (content__error) doit disparaître quand le panneau est affiché.
    const redBanners = await page.locator('.content__error').count()
    log('bandeaux rouges:', redBanners)
    if (redBanners) throw new Error('double message de refus (content__error présent)')
    const refundedNote = await page.locator('.capacity-panel__refunded').innerText().catch(() => '')
    log('mention non-facturé =', JSON.stringify(refundedNote.trim()))
    if (!refundedNote.trim()) throw new Error('mention remboursement absente du panneau')
    // AUCUNE carte « Nesting failed » fantôme.
    await page.waitForTimeout(1500)
    const failedCards = await page.locator('.result__placeholder', { hasText: /failed|Nesting/i }).count()
    log('cartes failed:', failedCards)
    if (failedCards) throw new Error('carte Nesting failed fantôme')
    await page.screenshot({ path: OUT + '/l3-refus-4mm-panel.png', fullPage: false })

    // Clic levier : la SÉCURITÉ est réduite (kerf intact), effectif = cible.
    await reduce.click()
    await page.waitForTimeout(500)
    const safetyAfter = await field('Safety').inputValue()
    const kerfAfter = await field('Kerf').inputValue()
    log('après levier : kerf =', kerfAfter, 'sécurité =', safetyAfter)
    if (kerfAfter !== '0') throw new Error('le kerf a bougé !')
    const eff = Number(kerfAfter) + 2 * Number(safetyAfter)
    log('effectif après levier =', eff)
    if (!(eff < 4 && eff >= 2)) throw new Error('effectif après levier inattendu: ' + eff)
    // Le panneau se ferme après action (dismissNestUnfit).
    if (await page.locator('[data-testid="capacity-panel"]').count()) throw new Error('panneau non dismissé')
    console.log('REFUS 4MM OK — panneau ancré, levier vivant, sécurité réduite (kerf intact), zéro carte fantôme')
    await browser.close()
    process.exit(0)
} catch (e) {
    console.error('FAIL:', e.message)
    await page.screenshot({ path: OUT + '/l3-refus-4mm-fail.png' }).catch(() => {})
    await browser.close()
    process.exit(1)
}
