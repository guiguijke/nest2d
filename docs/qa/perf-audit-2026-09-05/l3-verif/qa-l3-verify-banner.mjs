// Lot 3 / 3.1.5 — inscription locale : bannière persistante « e-mail non
// vérifié » sur /home avec bouton de renvoi (compte neuf, non vérifié).
import { chromium } from 'file:///C:/Users/guiguijke/OneDrive/Projects/Nestorcut_Suite/Nestorcut/node_modules/playwright/index.mjs'
import fs from 'node:fs'

const BASE = process.env.QA_BASE_URL || 'http://localhost:7100'
const OUT = process.env.QA_OUT || '.qa-pw/l3-verif'
fs.mkdirSync(OUT, { recursive: true })
const log = (...a) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a)
const browser = await chromium.launch({ headless: true })
const ctx = await browser.newContext({ locale: 'fr-FR', viewport: { width: 1680, height: 1000 } })
await ctx.addCookies([{ name: 'locale', value: 'fr', url: BASE }])
const page = await ctx.newPage()
page.on('pageerror', (e) => log('[pageerror]', String(e).slice(0, 300)))

try {
    const email = `qa-l3-${Date.now()}@local.dev`
    await page.goto(BASE + '/auth/local', { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('.local-auth__form', { timeout: 30000 })
    await page.fill('.local-auth__form input[type="text"]', 'QA Lot 3')
    await page.fill('.local-auth__form input[type="email"]', email)
    await page.fill('.local-auth__form input[type="password"]', 'motdepasse-long-1')
    await page.locator('.local-auth__btn').click()
    await page.waitForURL('**/auth/check-email', { timeout: 30000 })
    log('check-email affiché')
    // « Plus tard » → /home.
    await page.locator('text=Je le ferai plus tard').click()
    await page.waitForURL('**/home', { timeout: 30000 })
    // La locale cliente peut mettre un tick à basculer.
    const banner = page.locator('[data-testid="verify-banner"]')
    await banner.waitFor({ state: 'visible', timeout: 15000 })
    const txt = await banner.innerText()
    log('bannière =', JSON.stringify(txt.slice(0, 160)))
    if (!/pas encore vérifié|not verified/i.test(txt)) throw new Error('bannière inattendue: ' + txt)
    if (!txt.includes(email)) throw new Error("l'e-mail n'est pas dans la bannière")
    await page.screenshot({ path: `${OUT}/l3-verify-banner-home.png` })
    // Renvoi : best-effort — en local sans mailer l'appel 500 et le
    // libellé reste « Renvoyer » (comportement attendu, aucune erreur de
    // page). La confirmation « renvoyé ✓ » se vérifie en prod (SMTP).
    await page.locator('[data-testid="verify-banner-resend"]').click()
    await page.waitForTimeout(2500)
    log('bouton après renvoi =', JSON.stringify(await page.locator('[data-testid="verify-banner-resend"]').innerText()))
    // Profil : PAS de badge Vérifié (non vérifié).
    await page.goto(BASE + '/profile', { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(1500)
    const badge = await page.locator('.profile__verified').count()
    log('badge vérifié (attendu 0):', badge)
    if (badge) throw new Error('badge Vérifié affiché sur un compte non vérifié')
    await page.screenshot({ path: `${OUT}/l3-verify-profile.png` })
    console.log('VERIFY BANNER OK')
    await browser.close()
    process.exit(0)
} catch (e) {
    console.error('FAIL:', e.message)
    await page.screenshot({ path: `${OUT}/l3-verify-banner-fail.png` }).catch(() => {})
    await browser.close()
    process.exit(1)
}
