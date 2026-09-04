// QA E2E navigateur — 100×Piece_Trou + 800×Piece_Fillx4 en MODE LOCAL (THIS DEVICE),
// 2 tôles 1000×1000 (count 2), space QA_SPACE (défaut 0,1), –X, fillHoles ON.
// Sortie QA_OUT : captures, full.json (record IndexedDB), alt<k>_<strategy>_sheet<n>.svg
// → à vérifier avec workers/nesting/bench/check_svg_dir.py (audit 2026-09-03).
// Scratch uniquement sous .qa-pw/e2e-local/ — aucun fichier tracké modifié.
import { chromium } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'

const BASE = process.env.QA_BASE_URL || 'http://localhost:7100'
const OUT = process.env.QA_OUT || path.resolve('.qa-pw/e2e-local')
fs.mkdirSync(OUT, { recursive: true })

const TROU = path.resolve('.testparts/Piece_Trou.DXF')
const FILL = path.resolve('.testparts/Piece_Fillx4.DXF')

const logs = []
const log = (...a) => { const s = `[${new Date().toISOString().slice(11, 19)}] ${a.join(' ')}`; logs.push(s); console.log(s) }
const flushLogs = () => fs.writeFileSync(path.join(OUT, 'run.log'), logs.join('\n') + '\n')

const browser = await chromium.launch({ headless: true })
const ctx = await browser.newContext({
    locale: 'en-US',
    viewport: { width: 1680, height: 1000 },
    acceptDownloads: true,
})
const page = await ctx.newPage()
page.on('console', (m) => { const t = m.type(); if (t === 'error' || t === 'warning') log(`[console:${t}]`, m.text().slice(0, 500)) })
page.on('pageerror', (e) => log('[pageerror]', String(e).slice(0, 800)))
page.on('response', (r) => { if (r.status() >= 400) log(`[http ${r.status()}]`, r.url()) })
page.on('requestfailed', (r) => log('[reqfail]', r.url(), r.failure()?.errorText))

// Screenshot JAMAIS fatal : pendant le solve wasm la vue live re-rend ~900
// polygones en continu et la rasterisation peut dépasser le timeout — on
// loggue et on continue (les shots utiles sont pris après la fin, page statique).
const shot = async (name, clip) => {
    try {
        await page.screenshot({ path: path.join(OUT, name), fullPage: false, timeout: 90000, ...(clip ? { clip } : {}) })
        log('screenshot:', name)
    } catch (e) { log('screenshot FAILED (non fatal):', name, String(e).slice(0, 120)) }
}

let failed = null
try {
    // ---------- 1. Login (compte local existant, email vérifié) ----------
    log('goto /auth/local')
    await page.goto(BASE + '/auth/local', { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('.local-auth__form', { timeout: 30000 })
    if (await page.locator('.local-auth__form input[type="text"]').count()) {
        log('register form shown -> toggle to login')
        await page.locator('.local-auth__toggle').click()
    }
    await page.fill('.local-auth__form input[type="email"]', 'guillaume@local.dev')
    await page.fill('.local-auth__form input[type="password"]', 'nestorcut-local-2026')
    await page.locator('.local-auth__btn').click()
    await page.waitForURL('**/home', { timeout: 30000 })
    log('logged in ->', page.url())

    // ---------- 2. Création projet LOCAL + dépôt des 2 DXF ----------
    // PrivacyModePicker : « This device » est le choix par défaut (localImportEnabled)
    await page.waitForSelector('input[name="dxf"]', { state: 'attached', timeout: 30000 })
    const devCard = page.locator('.create__privacy [class*="option"], .create__privacy button, .create__privacy label').filter({ hasText: /This device/i }).first()
    if (await devCard.count()) { await devCard.click().catch(() => {}); log('clicked This device card') } else log('no device card found (default assumed)')
    await page.setInputFiles('input[name="dxf"]', [TROU, FILL])
    await page.waitForURL('**/project/**', { timeout: 60000 })
    const projectUrl = page.url()
    log('project created ->', projectUrl)

    // ---------- 3. Import navigateur (wasm) des 2 fichiers ----------
    await page.waitForFunction(
        () => document.querySelectorAll('.files__item input.counter__value').length === 2,
        null,
        { timeout: 180000 },
    )
    log('2 files imported (done state)')

    // Quantités : Trou=100, Fillx4=800
    const cards = page.locator('.files__item')
    const nCards = await cards.count()
    for (let i = 0; i < nCards; i++) {
        const name = await cards.nth(i).locator('.file__name').innerText().catch(() => '')
        const target = /Piece_Trou/i.test(name) ? '100' : /Piece_Fillx4/i.test(name) ? '800' : null
        log(`file card ${i}: "${name.trim()}" -> count ${target}`)
        if (target) {
            const input = cards.nth(i).locator('input.counter__value')
            await input.click()
            await input.fill(target)
            await input.blur()
        }
    }
    await page.waitForTimeout(400)
    for (let i = 0; i < nCards; i++) {
        const v = await cards.nth(i).locator('input.counter__value').inputValue().catch(() => '?')
        log(`file card ${i} count now: ${v}`)
    }

    // ---------- 4. Réglages : tôle 1000×2000×1, spacing 2, rot 4, –X, fillHoles ----------
    const unitSuffix = await page.locator('.size__sheet .input__suffix').first().innerText()
    log('unit suffix:', unitSuffix.trim())
    if (!/mm/i.test(unitSuffix)) {
        log('unit not mm -> switch via UnitSwitcher')
        await page.locator('.unit-switch__segment', { hasText: 'mm' }).first().click()
        await page.waitForTimeout(400)
    }
    const sheet = page.locator('.size__sheet').first()
    const dims = sheet.locator('.size__line .input__value')
    const w = await dims.nth(0).inputValue()
    const h = await dims.nth(1).inputValue()
    log(`sheet inputs: ${w} x ${h}`)
    if (String(w) !== '1000') { await dims.nth(0).fill('1000'); await dims.nth(0).blur() }
    if (String(h) !== '1000') { await dims.nth(1).fill('1000'); await dims.nth(1).blur() }
    const countInput = sheet.locator('> .input__value, > label.input .input__value').first()
    const cnt = await countInput.inputValue()
    log('sheet count:', cnt)
    if (String(cnt) !== '2') { await countInput.fill('2'); await countInput.blur() }

    const spacing = page.locator('label.input', { hasText: 'Spacing' }).locator('.input__value')
    await spacing.fill(process.env.QA_SPACE || '0.1')
    await spacing.blur()
    const rot = page.locator('label.input', { hasText: 'Rotations' }).locator('.input__value')
    const rotVal = await rot.inputValue()
    log('rotations:', rotVal)
    if (String(rotVal) !== '4') { await rot.fill('4'); await rot.blur() }

    // Directions : exactement « left » (–X) — toggle multi pour tier standard
    const dirOpts = page.locator('.compute__options .compute__option')
    const nOpts = await dirOpts.count()
    for (let i = 0; i < nOpts; i++) {
        const active = (await dirOpts.nth(i).getAttribute('class') || '').includes('--active')
        const label = (await dirOpts.nth(i).innerText()).trim().replace(/\s+/g, ' ')
        log(`direction ${i}: "${label}" active=${active}`)
        if (i === 0 && !active) await dirOpts.nth(i).click()
        if (i > 0 && active) await dirOpts.nth(i).click()
    }
    await page.waitForTimeout(300)
    for (let i = 0; i < nOpts; i++) {
        const active = (await dirOpts.nth(i).getAttribute('class') || '').includes('--active')
        log(`direction ${i} active now: ${active}`)
    }

    const fillHoles = page.locator('label.size__checkbox', { hasText: 'Nest parts inside holes' }).locator('input')
    if (!(await fillHoles.isChecked())) { log('fillHoles OFF -> check'); await fillHoles.check() }
    log('fillHoles checked:', await fillHoles.isChecked())
    await shot('01-preflight.png')

    // ---------- 5. Lancer le nesting ----------
    const nestBtn = page.locator('.atelier__nest')
    const nestLabel = (await nestBtn.innerText()).trim().replace(/\s+/g, ' ')
    log('nest button label:', nestLabel)
    if (!/900/.test(nestLabel)) throw new Error(`expected 900 files on nest button, got "${nestLabel}"`)
    await nestBtn.click()
    log('nest clicked')

    // Attendre le début du calcul local (stage status OU spinner du bouton)
    await page.waitForSelector('.stage__status', { timeout: 60000 }).catch(() => log('WARN: no .stage__status within 60s'))
    log('local compute running')
    await page.waitForTimeout(15000)
    {
        const bb = await page.locator('.stage').first().boundingBox().catch(() => null)
        if (bb) await shot('02-live-early.png', bb)
    }

    // ---------- 6. Attendre la fin (item résultat done/failed dans l'aside) ----------
    const t0 = Date.now()
    let outcome = 'timeout'
    while (Date.now() - t0 < 12 * 60 * 1000) {
        const err = await page.locator('.content__error').allInnerTexts().catch(() => [])
        const errTxt = err.map((s) => s.trim()).filter(Boolean).join(' | ')
        if (errTxt) { outcome = 'page-error: ' + errTxt; break }
        const stageRunning = await page.locator('.stage__status').count()
        const item = page.locator('.results__item').first()
        if (await item.count()) {
            const running = await item.locator('.result__cancel').count()
            const failedPh = await item.locator('.result__placeholder').count()
            const doneBtn = await item.locator('.controls__report, .controls__download').count()
            if (failedPh) { outcome = 'result-failed'; break }
            if (!running && doneBtn && !stageRunning) { outcome = 'done'; break }
        }
        await page.waitForTimeout(3000)
    }
    log('compute outcome:', outcome, `(${((Date.now() - t0) / 1000).toFixed(0)}s)`)
    await page.waitForTimeout(1500)
    await shot('03-stage-final.png')
    if (outcome !== 'done') throw new Error('compute did not complete: ' + outcome)

    // ---------- 7. Modal résultat : rapport ----------
    await page.locator('.results__item .result__area').first().click()
    await page.waitForSelector('.modal', { timeout: 30000 })
    await page.waitForTimeout(1500)
    await shot('04-modal-color.png')

    const info = await page.locator('.modal__info .info__label').allInnerTexts()
    const badges = await page.locator('.report__badges .report__badge').allInnerTexts()
    const badgeClasses = await page.locator('.report__badges .report__badge').evaluateAll(
        (els) => els.map((e) => e.className),
    )
    const detailRows = await page.locator('.modal__report .report__row--detail').allInnerTexts()
    const engine = await page.locator('.report__engine').innerText().catch(() => '')
    const usedPct = await page.locator('.modal__summary .summary__value').innerText().catch(() => '?')
    const sheetRows = await page.locator('.report__table tbody tr').allInnerTexts().catch(() => [])
    const report = {
        info: info.map((s) => s.trim()),
        badges: badges.map((b, i) => ({ text: b.trim(), ko: badgeClasses[i].includes('--ko') })),
        detailRows: detailRows.map((s) => s.trim().replace(/\s+/g, ' ')),
        engine: engine.trim().replace(/\s+/g, ' '),
        usedPct: usedPct.trim(),
        sheetRows: sheetRows.map((s) => s.trim().replace(/\s+/g, ' | ')),
    }
    log('REPORT', JSON.stringify(report, null, 1))
    fs.writeFileSync(path.join(OUT, 'modal-report.json'), JSON.stringify(report, null, 1))

    // Vue DXF (toggle) + screenshot
    const dxfToggle = page.locator('.view-toggle__btn', { hasText: 'DXF' }).first()
    if (await dxfToggle.count()) {
        await dxfToggle.click()
        await page.waitForTimeout(2500)
        await shot('05-modal-dxf.png')
    }

    // ---------- 8. Dump IndexedDB (record riche : report + dxfs + liveLayout) ----------
    const idb = await page.evaluate(async () => {
        const db = await new Promise((res, rej) => {
            const req = indexedDB.open('nestorcut-local')
            req.onsuccess = () => res(req.result)
            req.onerror = () => rej(req.error)
        })
        const recs = await new Promise((res, rej) => {
            const r = db.transaction('results', 'readonly').objectStore('results').getAll()
            r.onsuccess = () => res(r.result || [])
            r.onerror = () => rej(r.error)
        })
        return recs
            .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
            .map((r) => ({
                slug: r.slug,
                projectSlug: r.projectSlug,
                createdAt: r.createdAt,
                requested: r.requested,
                placed: r.placed,
                isSpp: r.isSpp,
                sheets: r.sheets,
                alternatives: (r.alternatives || []).map((a) => ({
                    altId: a.altId,
                    seed: a.seed,
                    strategy: a.strategy,
                    density: a.density,
                    layoutCount: a.layoutCount,
                    offcut: a.offcut,
                    report: a.report,
                    dxfNames: (a.dxfs || []).map((d) => d.fileName),
                    dxfSizes: (a.dxfs || []).map((d) => (d.content || '').length),
                })),
                liveItems: r.liveLayout?.items?.length ?? null,
                liveStripWidth: r.liveLayout?.strip_width ?? null,
            }))
    })
    fs.writeFileSync(path.join(OUT, 'idb-results.json'), JSON.stringify(idb, null, 1))
    log('IDB records:', idb.length, 'latest:', JSON.stringify(idb[0]?.alternatives?.map((a) => ({
        seed: a.seed, strategy: a.strategy, density: a.density,
        holesFilled: a.report?.holesFilled, holesOverflow: a.report?.holesOverflow,
        overlapFree: a.report?.overlapFree, spacingOk: a.report?.spacingOk,
        smallestGapMm: a.report?.smallestGapMm, overlaps: a.report?.overlaps,
    })), null, 1))

    // Dump SVG + rapport de TOUTES les alternatives du dernier record
    const full = await page.evaluate(async () => {
        const db = await new Promise((res, rej) => {
            const req = indexedDB.open('nestorcut-local')
            req.onsuccess = () => res(req.result)
            req.onerror = () => rej(req.error)
        })
        const recs = await new Promise((res, rej) => {
            const r = db.transaction('results', 'readonly').objectStore('results').getAll()
            r.onsuccess = () => res(r.result || [])
            r.onerror = () => rej(r.error)
        })
        recs.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
        const rec = recs[0]
        return {
            slug: rec?.slug, requested: rec?.requested, placed: rec?.placed, isSpp: rec?.isSpp, sheets: rec?.sheets,
            keys: Object.keys(rec || {}),
            alternatives: (rec?.alternatives || []).map((a) => ({
                altId: a.altId, strategy: a.strategy, seed: String(a.seed), density: a.density, layoutCount: a.layoutCount,
                usedSheetShare: a.usedSheetShare, offcut: a.offcut, report: a.report, keys: Object.keys(a),
                svgs: a.svgs || [], dxfNames: (a.dxfs || []).map((d) => d.fileName),
            })),
        }
    })
    for (const a of full.alternatives) {
        a.svgs.forEach((svg, i) => fs.writeFileSync(path.join(OUT, `alt${a.altId}_${a.strategy}_sheet${i + 1}.svg`), svg))
        a.svgs = a.svgs.length
    }
    fs.writeFileSync(path.join(OUT, 'full.json'), JSON.stringify(full, null, 1))
    // QA (vérif 2026-09-04) : pré-état moteur AVANT post-pass — diagnostic
    // de parité navigateur/serveur (front, distribution, compaction).
    try {
        const pre = await page.evaluate(() => window.__lastSolveResult || null)
        if (pre) fs.writeFileSync(path.join(OUT, 'pre-solve.json'), JSON.stringify(pre))
    } catch { /* page fermée */ }
    log('FULL', JSON.stringify(full, null, 1).slice(0, 3000))

    // ---------- 9. Téléchargement via le bouton du modal (chemin UI) ----------
    const dlBtn = page.locator('.modal .controls__download, .modal button:has-text("Download")').first()
    if (await dlBtn.count()) {
        try {
            const [download] = await Promise.all([
                page.waitForEvent('download', { timeout: 15000 }),
                dlBtn.click(),
            ])
            const p = path.join(OUT, 'ui-' + (download.suggestedFilename() || 'download.bin'))
            await download.saveAs(p)
            log('UI download saved:', p)
        } catch (e) { log('UI download skipped:', String(e).slice(0, 200)) }
    }
    await shot('06-modal-final.png')
} catch (e) {
    failed = e
    log('FATAL', String(e && e.stack || e).slice(0, 1500))
    await shot('99-error.png').catch(() => {})
} finally {
    flushLogs()
    await browser.close()
}
process.exit(failed ? 1 : 0)
