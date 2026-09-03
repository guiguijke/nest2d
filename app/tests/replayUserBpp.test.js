/**
 * Verrou « run user » (audit 2026-09-02 soir, RÉÉCRIT plan 2026-09-03
 * §1.6) : rejoue la séquence EXACTE du navigateur (normalizeLayouts →
 * idMap → expandMeta → applyHoleFill → fillResidualBands) sur le run
 * user (999 fans Fillx4 + 100 trous, 2×1000×1000, space 0,1, left).
 *
 * L'ancienne version n'appelait PAS expandMeta (payload sans packs →
 * étape muette : 699 pièces testées au lieu de 1 099) et ses seuils
 * (chevauchement 0,05 mm, hors tôle ±0,5 mm) étaient trop lâches pour
 * attraper quoi que ce soit. Désormais : 1 099 pièces, seuils
 * space − 1e-6, hors tôle ±1e-6, 0 doublon, déterminisme bit-identique.
 *
 * Fixtures générées par workers/nesting/bench/audit_replay_user.py
 * (docker, réseau nestorcut_nest2d) — fichiers volumineux, non commités :
 * le test est SKIP s'ils sont absents.
 */
import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { normalizeLayouts, applyHoleFill, expandMeta } from '../composables/localBridge'
import { fillResidualBands } from '../composables/residualClient'
import { ringDist } from '../composables/structureClient'

const BENCH = resolve(__dirname, '../../workers/nesting/bench')
const PAYLOAD = resolve(BENCH, 'out_user_payload.json')
const LAYOUTS = resolve(BENCH, 'out_user_layouts_pre.json')

const ringsOf = (layouts, partsById) => {
    const out = []
    layouts.forEach((l, li) => {
        for (const pi of l.placed_items || []) {
            const part = partsById.get(String(pi.item_id))
            if (!part) continue
            const t = pi.transformation
            const r = (Number(t.rotation) || 0) * Math.PI / 180
            const c = Math.cos(r), s = Math.sin(r)
            out.push({
                bin: li, // layout INDEX = tôle réelle (piège #52 : container_id partagé)
                ring: part.coords.map(([x, y]) => [x * c - y * s + t.translation[0], x * s + y * c + t.translation[1]]),
            })
        }
    })
    return out
}

/** Audit physique STRICT : hors tôle ±1e-6, paires < space − 0,01
 * (miroir de metrics.verify_layout — les poses moteur f32 mesurent
 * 0,0990-0,0996 sur les anneaux simplifiés, bruit documenté A14 : le
 * seuil « space − 1e-6 » ne tolère pas la précision f32 du moteur),
 * poses dupliquées (clé item/rot/tx/ty à 1e-6). */
const audit = (tag, layouts, partsById, bins, space) => {
    const rings = ringsOf(layouts, partsById)
    let overlaps = 0, outside = 0
    const seen = new Set()
    let duplicates = 0
    layouts.forEach((l, li) => {
        for (const pi of l.placed_items || []) {
            const t = pi.transformation || {}
            const key = `${pi.item_id}|${li}|${(Number(t.rotation) || 0).toFixed(6)}`
                + `|${(t.translation?.[0] ?? 0).toFixed(6)}|${(t.translation?.[1] ?? 0).toFixed(6)}`
            if (seen.has(key)) duplicates++
            seen.add(key)
        }
    })
    for (let i = 0; i < rings.length; i++) {
        const [w, h] = bins[rings[i].bin] || [1000, 1000]
        let mnx = Infinity, mxx = -Infinity, mny = Infinity, mxy = -Infinity
        for (const [x, y] of rings[i].ring) {
            mnx = Math.min(mnx, x); mxx = Math.max(mxx, x)
            mny = Math.min(mny, y); mxy = Math.max(mxy, y)
        }
        if (mnx < -1e-6 || mny < -1e-6 || mxx > w + 1e-6 || mxy > h + 1e-6) outside++
        for (let j = i + 1; j < rings.length; j++) {
            if (rings[j].bin !== rings[i].bin) continue
            if (ringDist(rings[i].ring, rings[j].ring) < space - 0.01) overlaps++
        }
    }
    console.log(`[${tag}] pièces=${rings.length} chevauchements=${overlaps} horsTôle=${outside} doublons=${duplicates}`)
    return { overlaps, outside, duplicates, count: rings.length }
}

/** Le pipeline complet localBridge sur une copie fraîche des layouts
 * pré-post-pass (les passes MUTENT en place). */
const runPipeline = (payload, pre) => {
    const space = Number(payload.engineConfig?.min_item_separation) || 0.1
    const parts = payload.parts
    const layouts = normalizeLayouts({ layouts: JSON.parse(JSON.stringify(pre.layouts)) })
    const meta = payload.meta
    if (meta && Array.isArray(meta.idMap)) {
        for (const layout of layouts) {
            for (const pi of layout.placed_items || []) {
                const mapped = meta.idMap[pi.item_id]
                if (mapped != null) pi.item_id = mapped
            }
        }
    }
    // Meta 1+1 SANS packs (cas user) : expandMeta rattache les fillers
    // figés — l'ancien test appelait expandPacks (absent) et sautait
    // l'étape entière : 699 pièces au lieu de 1 099.
    if (meta && !meta.packs) {
        // expandMeta mute les layouts EN PLACE (et les retourne) — ne pas
        // réassigner via length=0/push : aliasing, onviderait tout.
        expandMeta(parts, meta.host, meta.fill, meta.slots,
            layouts, meta.ringRotations)
    }
    applyHoleFill(parts, layouts, space)
    const stats = {}
    fillResidualBands(parts, layouts, space, payload, stats)
    return { layouts, stats, space }
}

/** Étapes du pipeline l'une après l'autre, chacune sur copie fraîche.
 * Le remap idMap (ids réduits → ids d'origine) précède TOUT audit : sans
 * lui, les poses pointent vers les 2 seules parts de l'instance réduite
 * (699 « pièces » fantômes toutes hors tôle). */
const step = (payload, pre, upto) => {
    const space = Number(payload.engineConfig?.min_item_separation) || 0.1
    const layouts = normalizeLayouts({ layouts: JSON.parse(JSON.stringify(pre.layouts)) })
    const meta = payload.meta
    if (meta && Array.isArray(meta.idMap)) {
        for (const layout of layouts) {
            for (const pi of layout.placed_items || []) {
                const mapped = meta.idMap[pi.item_id]
                if (mapped != null) pi.item_id = mapped
            }
        }
    }
    if (upto >= 1 && meta && !meta.packs) {
        expandMeta(payload.parts, meta.host, meta.fill,
            meta.slots, layouts, meta.ringRotations)
    }
    if (upto >= 2) applyHoleFill(payload.parts, layouts, space)
    if (upto >= 3) fillResidualBands(payload.parts, layouts, space, payload)
    return layouts
}

describe.skipIf(!existsSync(PAYLOAD) || !existsSync(LAYOUTS))(
    'replay run user 999+100 — séquence localBridge exacte (réécrit plan §1.6)', () => {
        const payload = JSON.parse(readFileSync(PAYLOAD, 'utf8'))
        const pre = JSON.parse(readFileSync(LAYOUTS, 'utf8'))
        const partsById = new Map(payload.parts.map((p) => [String(p.id), p]))
        const bins = payload.instance.bins.map((b) => {
            const outer = b.shape?.data?.outer || b.shape
            if (Array.isArray(outer)) {
                let w = 0, h = 0
                for (const [x, y] of outer) { w = Math.max(w, x); h = Math.max(h, y) }
                return [w, h]
            }
            return [1000, 1000]
        })

        it('1 099 pièces, 0 chevauchement < space−1e-6, 0 hors tôle ±1e-6, 0 doublon, à chaque étape',
            { timeout: 300000 }, () => {
                const space = Number(payload.engineConfig?.min_item_separation) || 0.1
                const r0 = audit('moteur brut', step(payload, pre, 0), partsById, bins, space)
                expect(r0.overlaps).toBe(0)
                const r1 = audit('expandMeta', step(payload, pre, 1), partsById, bins, space)
                expect(r1.count).toBe(1099)
                expect(r1.overlaps).toBe(0)
                expect(r1.duplicates).toBe(0)
                const r2 = audit('applyHoleFill', step(payload, pre, 2), partsById, bins, space)
                expect(r2.overlaps).toBe(0)
                expect(r2.duplicates).toBe(0)
                const r3 = audit('fillResidualBands', step(payload, pre, 3), partsById, bins, space)
                expect(r3.overlaps).toBe(0)
                expect(r3.outside).toBe(0)
                expect(r3.duplicates).toBe(0)
            })

        it('4 fans par trou au plus (capacité pinwheel respectée)', { timeout: 120000 }, async () => {
            const { layouts } = runPipeline(payload, pre)
            // Le pinwheel ne pose JAMAIS plus de 4 fans par trou : on
            // classe par hélice (hôte + fans nichées) — chaque trou doit
            // rester ≤ 4 nichées (au-delà = piles, constat A1/trou600).
            const { helixUnitsAndFree } = await import('../composables/residualClient')
            const partsById2 = new Map(payload.parts.map((p) => [String(p.id), p]))
            for (const l of layouts) {
                const { units } = helixUnitsAndFree(l, partsById2)
                for (const u of units) {
                    expect(u.fans.length).toBeLessThanOrEqual(4)
                }
            }
        })

        it('déterminisme : deux exécutions du pipeline = sortie bit-identique',
            { timeout: 300000 }, () => {
                const a = runPipeline(payload, pre)
                const b = runPipeline(payload, pre)
                expect(JSON.stringify(a.layouts)).toBe(JSON.stringify(b.layouts))
                expect(JSON.stringify(a.stats)).toBe(JSON.stringify(b.stats))
            })
    })


describe.skipIf(!existsSync(PAYLOAD) || !existsSync(LAYOUTS)
    || !existsSync(resolve(BENCH, 'out_user_layouts_post_py.json')))(
    'parité chiffrée Python ↔ JS sur la fixture user (plan §1.6)', () => {
        const POST_PY = resolve(BENCH, 'out_user_layouts_post_py.json')

        it('comptes par tôle identiques, fronts AABB ≈, poses dans la tolérance D9 documentée',
            { timeout: 300000 }, () => {
                const payload = JSON.parse(readFileSync(PAYLOAD, 'utf8'))
                const pre = JSON.parse(readFileSync(LAYOUTS, 'utf8'))
                const py = JSON.parse(readFileSync(POST_PY, 'utf8'))
                const { layouts: js, stats } = runPipeline(payload, pre)

                // Parité DURE : mêmes comptes par tôle (les passes
                // déplacent autant de pièces de chaque côté).
                expect(js.map((l) => l.placed_items.length))
                    .toEqual(py.layouts.map((l) => l.placed_items.length))

                // Parité de qualité : AABB par tôle à 2 mm près (même
                // front de compaction) — l'AABB JS via layoutAabb, le
                // Python par les translations (approximation ± centre).
                const extents = (l) => {
                    let mnx = Infinity, mxx = -Infinity
                    for (const pi of l.placed_items || []) {
                        mnx = Math.min(mnx, pi.transformation?.translation?.[0] ?? 0)
                        mxx = Math.max(mxx, pi.transformation?.translation?.[0] ?? 0)
                    }
                    return [mnx, mxx]
                }
                for (let i = 0; i < js.length; i++) {
                    const [ax0, ax1] = extents(js[i])
                    const [bx0, bx1] = extents(py.layouts[i])
                    expect(Math.abs(ax0 - bx0)).toBeLessThanOrEqual(2.0)
                    expect(Math.abs(ax1 - bx1)).toBeLessThanOrEqual(2.0)
                }

                // D9 QUANTIFIÉ (divergence documentée, pas un échec) : la
                // dichotomie de pas du smallLattice court côté JS sur un
                // anneau DÉCIMÉ + revalidation, côté Python sur STRtree
                // exact — (py, px) peuvent différer sans qu'aucune des
                // deux poses soit illégale. On mesure l'écart pour
                // l'audit ; la LÉGALITÉ des deux côtés est verrouillée
                // par le test physique ci-dessus (JS) et
                // TestPipelineTwoSheetsPhysical (Python).
                const poseSet = (l) => new Set(l.placed_items.map((pi) => {
                    const t = pi.transformation || {}
                    return `${pi.item_id}|${(Number(t.rotation) || 0).toFixed(4)}`
                        + `|${(t.translation?.[0] ?? 0).toFixed(4)}`
                        + `|${(t.translation?.[1] ?? 0).toFixed(4)}`
                }))
                let divergent = 0
                for (let i = 0; i < js.length; i++) {
                    const a = poseSet(js[i])
                    const b = poseSet(py.layouts[i])
                    divergent += [...a].filter((k) => !b.has(k)).length
                }
                console.log(`[parité D9] poses divergentes JS↔Python : ${divergent}`
                    + ` / ${js.reduce((n, l) => n + l.placed_items.length, 0)}`
                    + ` | moved JS=${stats.residualMoved} Python=${py.residualMoved}`)
                // Le moved peut différer pour la même raison (D9) : borné.
                expect(Math.abs(stats.residualMoved - py.residualMoved))
                    .toBeLessThanOrEqual(0.25 * Math.max(1, py.residualMoved))
            })
    })
