/**
 * Parcours privacy P0/P1 contre l'app Docker (localhost:7100).
 * Usage: node scripts/privacy-ui-check.mjs [baseUrl]
 */
import { chromium } from 'playwright'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const BASE = process.argv[2] || 'http://localhost:7100'
const EMAIL = 'guillaume@local.dev'
const PASSWORD = 'nestorcut-local-2026'
const OUT = join('docs', 'qa', 'atelier-ui')
const DXF = join('server', 'seed', 'demo', 'marine_lpl_001.dxf')
const DWG = join(tmpdir(), 'nestorcut-privacy-dummy.dwg')

mkdirSync(OUT, { recursive: true })
writeFileSync(DWG, 'fake-dwg')

const fail = (msg) => {
    console.error('FAIL', msg)
    throw new Error(msg)
}

const shot = async (page, name) => {
    const file = join(OUT, `${name}.png`)
    await page.screenshot({ path: file, fullPage: true })
    console.log('shot', file)
}

const dismissNoise = async (page) => {
    const dismiss = page.getByRole('button', { name: /no thanks|non merci/i })
    if (await dismiss.isVisible().catch(() => false)) {
        await dismiss.click()
        await page.waitForTimeout(300)
    }
}

const main = async () => {
    const browser = await chromium.launch({ headless: true })
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
    page.setDefaultTimeout(25000)

    const login = await page.request.post(`${BASE}/api/auth/local/login`, {
        data: { email: EMAIL, password: PASSWORD },
    })
    if (!login.ok()) {
        fail(`login API ${login.status()} ${await login.text()}`)
    }

    await page.goto(`${BASE}/home`, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(1500)
    await dismissNoise(page)

    const deviceCard = page.getByRole('radio', { name: /this device|cet appareil/i })
    const cloudCard = page.getByRole('radio', { name: /our servers|nos serveurs/i })
    if (!(await deviceCard.count()) || !(await cloudCard.count())) {
        fail('privacy cards missing on /home')
    }
    if ((await deviceCard.getAttribute('aria-checked')) !== 'true') {
        fail('This device should be selected by default')
    }
    const homeText = await page.locator('.create').innerText()
    if (/saved securely|sauvegardés en toute sécurité/i.test(homeText)) {
        fail('contradictory uploadHint still visible')
    }
    if (!/DXF or SVG|DXF ou SVG/i.test(homeText)) {
        fail('device dropzone should mention DXF/SVG only')
    }
    if (/DXF, SVG or DWG|DXF, SVG ou DWG/i.test(homeText)) {
        fail('device dropzone still advertises DWG')
    }
    await shot(page, 'privacy-home-device')

    // DWG on device card → explicit error, no project created.
    await page.locator('.upload input[type="file"]').setInputFiles(DWG)
    await page.waitForTimeout(600)
    const err = page.locator('.create__error')
    if (!(await err.isVisible().catch(() => false))) {
        fail('DWG on This device should show an error')
    }
    const errText = await err.innerText()
    if (!/Our servers|Nos serveurs|DWG/i.test(errText)) {
        fail(`DWG error copy unexpected: ${errText}`)
    }
    await shot(page, 'privacy-home-dwg-reject')

    await cloudCard.click()
    await page.waitForTimeout(200)
    if ((await cloudCard.getAttribute('aria-checked')) !== 'true') {
        fail('Our servers card did not select')
    }
    const cloudText = await page.locator('.create').innerText()
    if (!/DXF, SVG or DWG|DXF, SVG ou DWG/i.test(cloudText)) {
        fail('cloud dropzone should mention DWG')
    }
    await shot(page, 'privacy-home-cloud')

    await deviceCard.click()
    await page.waitForTimeout(200)
    await page.locator('.upload input[type="file"]').setInputFiles(DXF)
    await page.waitForURL(/\/project\//, { timeout: 30000 })
    await page.waitForTimeout(1500)

    const chip = page.locator('.content__chip, .chip--device').first()
    const chipText = ((await chip.textContent().catch(() => '')) || '').trim()
    if (!/this device|cet appareil/i.test(chipText)) {
        fail(`device project chip missing, got "${chipText}"`)
    }
    const status = page.locator('.content__privacy')
    if (!(await status.isVisible().catch(() => false))) {
        fail('device status sentence missing under title')
    }
    const statusText = await status.innerText()
    if (!/this browser|ce navigateur/i.test(statusText)) {
        fail(`device status copy unexpected: ${statusText}`)
    }
    await shot(page, 'privacy-project-device')

    await page.goto(`${BASE}/home`, { waitUntil: 'domcontentloaded' })
    await dismissNoise(page)
    const listChip = page.locator('.project__badge, .chip').filter({
        hasText: /this device|cet appareil/i,
    }).first()
    if (!(await listChip.count())) {
        fail('This device chip missing on project list')
    }
    await shot(page, 'privacy-home-list-chip')

    // Cloud project (needs file-processing worker). Same DXF, other card.
    await cloudCard.click()
    await page.waitForTimeout(200)
    await page.locator('.upload input[type="file"]').setInputFiles(DXF)
    await page.waitForURL(/\/project\//, { timeout: 30000 })
    await page.waitForTimeout(2000)
    const headingChip = page.locator('.content__heading .chip')
    await headingChip.waitFor({ timeout: 10000 })
    const cloudChipText = ((await headingChip.textContent().catch(() => '')) || '').trim()
    if (!/cloud/i.test(cloudChipText)) {
        fail(`cloud project chip missing, got "${cloudChipText}"`)
    }
    const cloudStatus = await page.locator('.content__privacy').innerText().catch(() => '')
    if (!/24 h|24h/i.test(cloudStatus)) {
        fail(`cloud status copy unexpected: ${cloudStatus}`)
    }
    await shot(page, 'privacy-project-cloud')

    // Vault panel copy.
    const vaultBtn = page.getByRole('button', { name: /zero-knowledge vault|coffre-fort/i })
    if (await vaultBtn.count()) {
        await vaultBtn.click()
        await page.waitForTimeout(500)
        const help = page.locator('.panel__help-summary, details')
        if (await help.count()) {
            await help.first().click()
            await page.waitForTimeout(300)
        }
        const panel = await page.locator('.vault-menu__panel, .panel').innerText().catch(() => '')
        if (/never with us|jamais chez nous/i.test(panel) && !/in memory|en mémoire/i.test(panel)) {
            fail('vault help still overclaims (key never on server)')
        }
        await shot(page, 'privacy-vault-panel')
    }

    await browser.close()
    console.log('privacy UI OK')
}

main().catch(async (err) => {
    console.error(err)
    process.exit(1)
})
