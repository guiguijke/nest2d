import { defineEventHandler } from 'h3'
import { connectDB } from '~~/server/db/mongo'

/**
 * Phase 2 (flag-gated QA): the browser POSTs the engine's alternatives after
 * a local solve. The job is marked done with a LIGHT result shape — the
 * heavy worker finalization (DXF/SVG exports, measured report, offcut) does
 * NOT run for local jobs yet: `report`, `offcut`, `dxf_files`, `svg_files`
 * and `usedSheetShare` are absent by design (additive fields, D-RAP-2 — the
 * result modal degrades gracefully like legacy jobs). The quota consumed at
 * enqueue stays consumed (successful nesting).
 */
export default defineEventHandler(async (event) => {
    const userId = event.context?.auth?.userId
    if (!userId) {
        throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
    }
    const config = useRuntimeConfig(event)
    const enabled = config.public.localComputeEnabled === true || config.public.localComputeEnabled === 'true'
    if (!enabled) {
        throw createError({ statusCode: 404, statusMessage: 'Not found' })
    }

    const slug = getRouterParam(event, 'slug')
    const db = await connectDB()
    const job = await db.collection('nesting_jobs').findOne({ slug })
    // Owner-only, demo included: the local flow always runs in the LAUNCHER's
    // browser — a shared-demo job still belongs to its owner (never let a
    // user write to another user's job).
    if (!job || job.ownerId !== userId) {
        throw createError({ statusCode: 404, statusMessage: 'Job not found' })
    }
    if (job.status !== 'awaiting_local') {
        throw createError({ statusCode: 409, statusMessage: 'Job is not awaiting local compute' })
    }

    const body = await readBody(event)
    const engineAlts = body?.alternatives
    if (!Array.isArray(engineAlts) || engineAlts.length === 0) {
        throw createError({ statusCode: 400, statusMessage: 'alternatives must be a non-empty array' })
    }

    // Normalize engine alternatives to the modal shape (layouts + density +
    // layoutCount + strategy + seed + metrics subset). Mirror of the Python
    // worker's _normalize_solution — light version (see header comment).
    const alternatives = engineAlts.map((alt, i) => {
        const solution = alt.solution || {}
        const layouts = (solution.layouts || (solution.layout ? [solution.layout] : [])).map((layout) => ({
            ...layout,
            container_id: layout.container_id ?? 0,
        }))
        return {
            rank: alt.rank ?? i,
            seed: alt.seed ?? null,
            strategy: alt.bias || null,
            layouts,
            layoutCount: layouts.length,
            density: solution.density ?? alt.density ?? null,
            cost: solution.cost ?? null,
            iterations: alt.iterations ?? null,
            evaluations: alt.evaluations ?? null,
            metrics: {
                density: solution.density ?? alt.density ?? null,
                cost: solution.cost ?? null,
                strip_width: alt.strip_width ?? solution.strip_width ?? null,
                layout_count: layouts.length,
            },
        }
    })
    const best = alternatives[0]

    // Final frame for the live panel (the flag's only visual result for now):
    // [item_id, bin, rot_deg, x, y] per placed item (BPP shape; SPP bin=0).
    const liveItems = []
    best.layouts.forEach((layout, bin) => {
        for (const pi of layout.placed_items || []) {
            liveItems.push([
                pi.item_id,
                bin,
                pi.transformation?.rotation ?? 0,
                pi.transformation?.translation?.[0] ?? 0,
                pi.transformation?.translation?.[1] ?? 0,
            ])
        }
    })

    await db.collection('nesting_jobs').updateOne(
        { slug },
        {
            $set: {
                alternatives,
                placed: job.requested ?? best.layouts.reduce((n, l) => n + (l.placed_items?.length || 0), 0),
                layoutCount: best.layoutCount,
                density: best.density,
                status: 'done',
                finishedAt: new Date(),
                update_ts: new Date(),
                liveLayout: {
                    stage: 'final',
                    feasible: true,
                    density: best.density,
                    bins: best.cost ?? best.layoutCount,
                    sheets: (job.params?.sheets || []).map((s) => [Number(s.width), Number(s.height)]),
                    isSpp: job.localPayload?.problem === 'spp',
                    items: liveItems,
                },
            },
            $unset: { progress: '', compute: '', localPayload: '' },
        }
    )
    return { ok: true }
})
