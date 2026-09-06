// Lot 4 phase A / A3+AH2+AH3 — orphelin awaiting_local : POST nest →
// fermeture du contexte AVANT toute prise du payload → vieillissement
// createdAt en base (TTL réel, pas d'override) → réouverture : carte
// « Non pris en charge par cet appareil » (expiration à L'OUVERTURE du
// flux SSE, AH2), statut cancelled + remboursement, POST suivant ACCEPTÉ.
import { chromium } from 'file:///C:/Users/guiguijke/OneDrive/Projects/Nestorcut_Suite/Nestorcut/node_modules/playwright/index.mjs'
import path from 'node:path'
import fs from 'node:fs'
import { execSync } from 'node:child_process'

const BASE = process.env.QA_BASE_URL || 'http://localhost:7100'
const ROOT = 'C:/Users/guiguijke/OneDrive/Projects/Nestorcut_Suite/Nestorcut'
const OUT = process.env.QA_OUT || '.qa-pw/l4-verif'
fs.mkdirSync(OUT, { recursive: true })
const log = (...a) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a)
const mongosh = (py) => execSync(
    `docker run --rm -i --network nestorcut_nest2d -e MONGO_URI=mongodb://mongo:27017/nest2d nest2d-nesting-worker:dev python -c "${py.replace(/"/g, '\\"')}"`,
    { encoding: 'utf8' }).trim()

const browser = await chromium.launch({ headless: true })

async function loginCtx() {
    const ctx = await browser.newContext({ locale: 'en-US', viewport: { width: 1680, height: 1000 } })
    const page = await ctx.newPage()
    await page.goto(BASE + '/auth/local', { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('.local-auth__form', { timeout: 30000 })
    if (await page.locator('.local-auth__form input[type="text"]').count()) {
        await page.locator('.local-auth__toggle').click()
    }
    await page.fill('.local-auth__form input[type="email"]', 'guillaume@local.dev')
    await page.fill('.local-auth__form input[type="password"]', 'nestorcut-local-2026')
    await page.locator('.local-auth__btn').click()
    await page.waitForURL('**/home', { timeout: 30000 })
    return { ctx, page }
}

try {
    // 0. s'assurer qu'aucun actif ne traîne (409).
    mongosh("from pymongo import MongoClient; from datetime import datetime, timedelta; MongoClient('mongodb://mongo:27017/nest2d').get_default_database()['nesting_jobs'].update_many({'ownerId':'local:guillaume@local.dev','status':{'\$in':['pending','processing','awaiting_local']}},{'\$set':{'status':'cancelled','information':'qa cleanup','finishedAt':datetime.now()}})")

    const { ctx, page } = await loginCtx()
    await page.setInputFiles('input[name="dxf"]', path.join(ROOT, '.testparts', 'Piece_Trou.DXF'))
    await page.waitForURL('**/project/**', { timeout: 60000 })
    await page.waitForSelector('.files__item input.counter__value', { timeout: 180000 })
    const cnt = page.locator('.files__item input.counter__value').first()
    await cnt.click(); await cnt.fill('5'); await cnt.blur()

    // 1. POST nest — on attend SA RÉPONSE puis on FERME avant toute prise
    //    (le registre prend le job au tick SSE suivant).
    // Orphelin fidèle : le GET local-payload ne doit JAMAIS aboutir
    // (l'appareil ferme avant la prise) — sinon takenAt est posé et le
    // job est légitimement protégé de l'expiration.
    await page.route('**/api/results/*/local-payload', (route) => route.abort())
    const postDone = page.waitForResponse((r) => /\/nest$/.test(r.url()) && r.request().method() === 'POST', { timeout: 30000 })
    await page.locator('.atelier__nest').click()
    const resp = await postDone
    log('POST nest:', resp.status())
    if (resp.status() >= 400) throw new Error('POST refusé: ' + resp.status())
    // La réponse porte un slug pré-calculé qui diffère parfois du doc —
    // le job réel est le DERNIER awaiting_local du user.
    const jobSlug = mongosh("from pymongo import MongoClient; j=MongoClient('mongodb://mongo:27017/nest2d').get_default_database()['nesting_jobs'].find_one({'ownerId':'local:guillaume@local.dev','status':'awaiting_local'},sort=[('createdAt',-1)]); print(j['slug'] if j else 'ABSENT')")
    log('job créé:', jobSlug)
    if (jobSlug === 'ABSENT') throw new Error('pas de awaiting_local après le POST')
    const projectUrl = page.url()
    const projectApi = projectUrl.replace('/project/', '/api/project/')
    // AH6.1 : sauver la session SEULEMENT après une lecture projet 200
    // du contexte 1 — sinon le 2e contexte part sans session et le flux
    // SSE répond 401 AVANT d'atteindre l'expiration (faux négatif).
    const check1 = await page.request.get(projectApi)
    log('lecture projet ctx1:', check1.status())
    if (check1.status() !== 200) throw new Error('session ctx1 invalide: ' + check1.status())
    const savedState = await ctx.storageState()
    await ctx.close() // orphelin : le payload ne sera jamais pris
    await page.waitForTimeout(500).catch(() => {})

    // 2. Le job est awaiting_local, sans takenAt.
    const st = mongosh(`from pymongo import MongoClient; j=MongoClient('mongodb://mongo:27017/nest2d').get_default_database()['nesting_jobs'].find_one({'slug':'${jobSlug}'}); print(j['status'], 'takenAt' in j)`)
    log('état après fermeture:', st)
    if (!/awaiting_local\s+False/.test(st)) throw new Error('état inattendu: ' + st)

    // 3. Vieillir createdAt de 11 min (le VRAI TTL, sans override).
    mongosh(`from pymongo import MongoClient; from datetime import datetime, timedelta; MongoClient('mongodb://mongo:27017/nest2d').get_default_database()['nesting_jobs'].update_one({'slug':'${jobSlug}'},{'\$set':{'createdAt':datetime.now()-timedelta(minutes=11)}})`)
    log('createdAt vieilli de 11 min')

    // 4. Réouverture : expiration À L'OUVERTURE du flux (AH2) → carte.
    const secondCtx = await browser.newContext({ locale: 'en-US', storageState: savedState, viewport: { width: 1680, height: 1000 } })
    const second = { ctx: secondCtx, page: await secondCtx.newPage() }
    const p2 = second.page
    // AH6.2 : asserter la session AVANT d'ouvrir la page — échec
    // explicite « session absente », jamais de faux négatif silencieux.
    const check2 = await p2.request.get(projectApi)
    log('lecture projet ctx2:', check2.status())
    if (check2.status() !== 200) throw new Error('session absente dans le contexte 2: ' + check2.status())

    // AH6.3 : attendre la RÉPONSE du flux de résultats du projet et lire
    // le job PAR SON SLUG dans l'évènement initial (la liste du layout
    // est globale — le premier « Non pris en charge » n'est pas forcément
    // le nôtre).
    await p2.goto(projectUrl, { waitUntil: 'domcontentloaded' })
    // AH6 (adaptation) : la page hydratée tarde à ouvrir son EventSource
    // sous Playwright — le test ouvre le flux du projet LUI-MÊME avec la
    // session (exactement la preuve du vérificateur) : le handler exécute
    // l'expiration AVANT le premier évènement. Timeout court : le stream
    // reste ouvert, seul l'effet nous intéresse.
    await p2.request.get(projectApi + '/results', { timeout: 3500 }).catch(() => {})
    // AH6.3 : l'évènement initial du flux porte déjà le job annulé
    // (constat vérificateur). Le waitForResponse ne résout pas sur les
    // flux SSE de ce Chromium — preuve par la BASE (poll < 6 s : le flux
    // ouvre → expiration AH2 immédiate) puis la carte UI du projet.
    let expired = false
    for (let k = 0; k < 6 && !expired; k++) {
        await p2.waitForTimeout(1000)
        const one = mongosh(`from pymongo import MongoClient; j=MongoClient('mongodb://mongo:27017/nest2d').get_default_database()['nesting_jobs'].find_one({'slug':'${jobSlug}'}); print(j['status'], j.get('information'), j.get('charge',{}).get('refunded'))`)
        log(`t+${k + 1}s état:`, one)
        expired = /cancelled awaiting_local_expired True/.test(one)
    }
    if (!expired) throw new Error("l'ouverture du flux n'a PAS expiré l'orphelin (AH2)")
    // La carte : recharger — l'évènement initial du flux porte
    // désormais le job annulé (le projet ne contient que CE job).
    await p2.reload({ waitUntil: 'domcontentloaded' })
    await p2.waitForTimeout(2500)
    const carte = /Not picked up|Non pris en charge/i.test(await p2.locator('body').innerText())
    log('carte orphelin visible (page projet):', carte)
    // AH6.3 : la preuve par le slug — le doc est déjà annulé au moment
    // de l'évènement initial (Fable : le 1er évènement porte le job
    // annulé). La lecture base ci-dessous fait foi, la carte UI confirme.
    const st2 = mongosh("from pymongo import MongoClient; js=list(MongoClient('mongodb://mongo:27017/nest2d').get_default_database()['nesting_jobs'].find({'ownerId':'local:guillaume@local.dev'}).sort('createdAt',-1).limit(3)); [print(j['slug'], j['status'], j.get('information'), j.get('charge',{}).get('refunded')) for j in js]")
    log('3 derniers jobs:', st2.split('\n').join(' | '))
    if (!st2.includes(jobSlug + ' cancelled awaiting_local_expired True')) {
        throw new Error('job non expiré: ' + st2)
    }
    if (!carte) throw new Error('carte « Non pris en charge » absente à la réouverture')
    await p2.screenshot({ path: OUT + '/l4-orphan-card.png' })

    // 5. POST suivant ACCEPTÉ (plus de 409). Le contexte 2 ne porte que
    // les cookies (IndexedDB du projet local = contexte 1) : nouveau
    // projet dans CE contexte, petit calcul annulé juste après.
    await p2.goto(BASE + '/home', { waitUntil: 'domcontentloaded' })
    await p2.setInputFiles('input[name="dxf"]', path.join(ROOT, '.testparts', 'Piece_Trou.DXF'))
    await p2.waitForURL('**/project/**', { timeout: 60000 })
    await p2.waitForSelector('.files__item input.counter__value', { timeout: 180000 })
    const c2 = p2.locator('.files__item input.counter__value').first()
    await c2.click(); await c2.fill('2'); await c2.blur()
    const post2 = p2.waitForResponse((r) => /\/nest$/.test(r.url()) && r.request().method() === 'POST', { timeout: 30000 })
    await p2.locator('.atelier__nest').click()
    const resp2 = await post2
    log('POST suivant:', resp2.status(), resp2.status() === 409 ? 'ENCORE BLOQUÉ' : 'accepté')
    if (resp2.status() === 409) throw new Error('409 après expiration — déblocage KO')
    // Annulation propre du 2e job pour ne pas laisser d'actif.
    mongosh("from pymongo import MongoClient; from datetime import datetime; MongoClient('mongodb://mongo:27017/nest2d').get_default_database()['nesting_jobs'].update_many({'ownerId':'local:guillaume@local.dev','status':{'\$in':['awaiting_local','pending','processing']}},{'\$set':{'status':'cancelled','information':'qa cleanup','finishedAt':datetime.now()}})")
    await second.ctx.close()
    console.log('ORPHAN OK — expiré à la réouverture (carte + cancelled + refunded), POST suivant accepté')
    await browser.close()
    process.exit(0)
} catch (e) {
    console.error('FAIL:', e.message)
    await browser.close()
    process.exit(1)
}
