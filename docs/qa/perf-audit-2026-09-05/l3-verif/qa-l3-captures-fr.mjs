// Lot 3 — captures FR des parcours touchés : réglages kerf/sécurité +
// sens d'optimisation par bord (tôle PAYSAGE et PORTRAIT), page /plans
// connecté, /benchmarks, validation auth locale.
import { chromium } from 'file:///C:/Users/guiguijke/OneDrive/Projects/Nestorcut_Suite/Nestorcut/node_modules/playwright/index.mjs'
import path from 'node:path'

const BASE = process.env.QA_BASE_URL || 'http://localhost:7100'
const ROOT = 'C:/Users/guiguijke/OneDrive/Projects/Nestorcut_Suite/Nestorcut'
const OUT = 'docs/qa/perf-audit-2026-09-05/l3-verif'
const log = (...a) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a)
const browser = await chromium.launch({ headless: true })
const ctx = await browser.newContext({ locale: 'fr-FR', viewport: { width: 1680, height: 1000 } })
await ctx.addCookies([{ name: 'locale', value: 'fr', url: BASE }])
const page = await ctx.newPage()
page.on('pageerror', (e) => log('[pageerror]', String(e).slice(0, 300)))

try {
    // -- auth locale FR : mode INSCRIPTION d'abord (validation 3 champs +
    // mention CGU), puis bascule login.
    await page.goto(BASE + '/auth/local', { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('.local-auth__form', { timeout: 30000 })
    await page.locator('.local-auth__btn').click()
    await page.waitForTimeout(600)
    const errs = await page.locator('.local-auth__fielderror').allInnerTexts()
    log('erreurs validation (register):', JSON.stringify(errs))
    if (errs.length < 3) throw new Error('validation champ absente: ' + JSON.stringify(errs))
    if (!/mot de passe|nom|adresse e-mail/.test(errs.join(' '))) throw new Error('messages non traduits: ' + errs.join('|'))
    const legal = await page.locator('.local-auth__legal').innerText().catch(() => '')
    log('CGU =', JSON.stringify(legal.trim()))
    if (!/conditions d'utilisation/.test(legal)) throw new Error('mention CGU absente')
    await page.screenshot({ path: `${OUT}/l3-auth-fr-validation.png` })
    // Basculer en connexion.
    await page.locator('.local-auth__toggle').click()
    await page.fill('.local-auth__form input[type="email"]', 'guillaume@local.dev')
    await page.fill('.local-auth__form input[type="password"]', 'nestorcut-local-2026')
    await page.locator('.local-auth__btn').click()
    await page.waitForURL('**/home', { timeout: 30000 })
    log('logged in (FR)')

    // -- /plans FR connecté : « Gérer dans le profil ».
    await page.goto(BASE + '/plans', { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(1500)
    const manage = await page.locator('text=Gérer dans le profil').count()
    log('plans: CTA gestion profil =', manage)
    if (!manage) throw new Error('page offres ne reconnaît pas la session')
    await page.screenshot({ path: `${OUT}/l3-plans-fr.png`, fullPage: false })

    // -- /benchmarks FR.
    await page.goto(BASE + '/benchmarks', { waitUntil: 'domcontentloaded' })
    // SSR rend EN, le client bascule FR (cookie) — attendre le texte FR.
    await page.waitForSelector('text=Densité matière', { timeout: 15000 })
    const benchTxt = await page.locator('.bench').innerText()
    if (!/densité matière|espacement/i.test(benchTxt)) throw new Error('tableau benchmarks FR illisible')
    if (!/55,4 %/.test(benchTxt)) throw new Error('densité non localisée (55,4 % attendu)')
    await page.screenshot({ path: `${OUT}/l3-benchmarks-fr.png`, fullPage: true })
    log('benchmarks FR ok')

    // -- atelier FR : kerf/sécurité + sens par bord, paysage puis portrait.
    await page.goto(BASE + '/home', { waitUntil: 'domcontentloaded' })
    await page.setInputFiles('input[name="dxf"]', path.join(ROOT, '.testparts', 'Piece_Trou.DXF'))
    await page.waitForURL('**/project/**', { timeout: 60000 })
    await page.waitForSelector('.files__item input.counter__value', { timeout: 180000 })
    const field = (label) => page.locator('.settings .input', { has: page.locator('.input__prefix', { hasText: label }) }).locator('input')
    await field('Kerf').waitFor({ timeout: 15000 })
    const rule = await page.locator('.size__rule').innerText()
    log('règle FR =', JSON.stringify(rule))
    if (!/kerf \+ 2 × sécurité = 2 mm/.test(rule)) throw new Error('règle FR: ' + rule)
    const dirs = await page.locator('.compute__option').allInnerTexts()
    log('sens =', JSON.stringify(dirs))
    if (!/Bord gauche/.test(dirs.join(' ')) || !/Bord bas/.test(dirs.join(' '))) throw new Error('libellés par bord FR absents')
    await page.screenshot({ path: `${OUT}/l3-settings-fr-paysage.png` })

    // Portrait : tôle 600×300 (H>W).
    const sheet = page.locator('.size__sheet').first()
    const dims = sheet.locator('.size__line .input__value')
    await dims.nth(0).click(); await dims.nth(0).fill('600'); await dims.nth(0).blur()
    await dims.nth(1).click(); await dims.nth(1).fill('300'); await dims.nth(1).blur()
    await page.waitForTimeout(700)
    await page.screenshot({ path: `${OUT}/l3-settings-fr-portrait.png` })
    log('captures FR ok')
    console.log('CAPTURES FR OK')
    await browser.close()
    process.exit(0)
} catch (e) {
    console.error('FAIL:', e.message)
    await page.screenshot({ path: `${OUT}/l3-captures-fr-fail.png` }).catch(() => {})
    await browser.close()
    process.exit(1)
}
