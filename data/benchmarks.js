/**
 * Page /benchmarks (3.9 — preuve publique de qualité) : chiffres du corpus
 * interne T-A..T-K, extraits du DERNIER run de vérification sur les images
 * Docker PUBLIÉES (commit fb5e184, run 2026-09-06 09:32 UTC — celui du GO
 * L2-quater v2). Extraction : workers/nesting/bench/densities_corpus.py.
 *
 * Méthode (reproductible) : chaque cas = un job standard du produit (BPP
 * multi-tôles, 1 direction –X, fillHoles on, 4 cœurs, budget 90 s), semé
 * par workers/nesting/bench/seed_corpus.py ; densité matière MESURÉE sur
 * le rapport vérifié (aire des pièces posées / aire des tôles utilisées),
 * physique validée (aucun recouvrement, tout dans la tôle, écart minimal
 * ≥ l'espacement demandé).
 */
export const BENCHMARKS = {
    meta: {
        runDate: '2026-09-06',
        // Image Docker publiée qui a produit les chiffres (workflow
        // « Build and publish Docker images » du commit fb5e184).
        version: 'fb5e184',
        machine: {
            en: 'Docker worker on an AMD Ryzen 9 9900X (12 cores/24 threads), 4 vcores allocated per job, 90 s budget',
            fr: 'Worker Docker sur AMD Ryzen 9 9900X (12 cœurs/24 threads), 4 vcores alloués par job, budget 90 s',
        },
        method: {
            en: 'Every case is a standard product job (multi-sheet BPP, one –X direction, nesting-in-cutouts on). Material density is measured on the verified report: area of the placed parts over the area of the used sheets. Physical validation checks zero overlap, every part inside its sheet, and a minimal gap no smaller than the requested spacing.',
            fr: 'Chaque cas est un job standard du produit (BPP multi-tôles, un sens –X, imbrication dans les trous activée). La densité matière est mesurée sur le rapport vérifié : aire des pièces posées sur l’aire des tôles utilisées. La validation physique vérifie zéro recouvrement, toutes les pièces dans leur tôle, et un écart minimal jamais inférieur à l’espacement demandé.',
        },
    },
    cases: [
        {
            id: 'A',
            geometry: {
                en: 'Ringed part (100×100 mm, Ø35 cutout) + 4-lobed fan nesting inside the cutouts — the reference corpus (100 + 800 parts)',
                fr: 'Pièce annulaire (100×100 mm, découpe Ø35) + éventail 4 lobes imbriqué dans les découpes — le corpus de référence (100 + 800 pièces)',
            },
            sheets: '2 × 1000×1000',
            spaceMm: 0.1,
            placed: 900,
            requested: 900,
            layouts: 2,
            densityPct: 55.4,
            smallestGapMm: 0.1,
            verdict: 'ok',
        },
        {
            id: 'B',
            geometry: {
                en: 'Three close rectangle classes (300×200, 250×180, 120×90) — pure lattice packing',
                fr: 'Trois classes de rectangles proches (300×200, 250×180, 120×90) — pavage lattice pur',
            },
            sheets: '3 × 1500×1000',
            spaceMm: 2.0,
            placed: 80,
            requested: 80,
            layouts: 2,
            densityPct: 84.4,
            smallestGapMm: 2.0,
            verdict: 'ok',
        },
        {
            id: 'C',
            geometry: {
                en: 'Non-convex L (200×200) and U (240×200) parts',
                fr: 'Pièces non convexes en L (200×200) et U (240×200)',
            },
            sheets: '2 × 1200×1000',
            spaceMm: 1.0,
            placed: 60,
            requested: 60,
            layouts: 2,
            densityPct: 60.0,
            smallestGapMm: 1.0,
            verdict: 'ok',
        },
        {
            id: 'D',
            geometry: {
                en: 'Long thin parts (900×40) + 300 small rectangles — one dominant orientation',
                fr: 'Pièces longues et fines (900×40) + 300 petits rectangles — une orientation dominante',
            },
            sheets: '2 × 1000×1000',
            spaceMm: 1.0,
            placed: 330,
            requested: 330,
            layouts: 2,
            densityPct: 76.5,
            smallestGapMm: 1.0,
            verdict: 'ok',
        },
        {
            id: 'E',
            geometry: {
                en: 'Ringed part + fan with free rotations every 30° (12 orientations)',
                fr: 'Pièce annulaire + éventail en rotations libres tous les 30° (12 orientations)',
            },
            sheets: '3 × 1000×1000',
            spaceMm: 0.1,
            placed: 460,
            requested: 460,
            layouts: 1,
            densityPct: 61.5,
            smallestGapMm: 0.1,
            verdict: 'ok',
        },
        {
            id: 'F',
            geometry: {
                en: '90 rectangles 200×150 on two sheet formats (cost ∝ area) — tight stock',
                fr: '90 rectangles 200×150 sur deux formats de tôles (coût ∝ surface) — stock serré',
            },
            sheets: '1000×1000 + 2000×1000',
            spaceMm: 1.0,
            placed: 89,
            requested: 90,
            layouts: 2,
            densityPct: 89.0,
            smallestGapMm: 1.0,
            verdict: 'partial',
        },
        {
            id: 'G',
            geometry: {
                en: 'One near-full-sheet part (950×950) + 200 small parts around it',
                fr: 'Une pièce quasi pleine tôle (950×950) + 200 petites pièces autour',
            },
            sheets: '2 × 1000×1000',
            spaceMm: 0.5,
            placed: 201,
            requested: 201,
            layouts: 2,
            densityPct: 60.1,
            smallestGapMm: 0.5,
            verdict: 'ok',
        },
        {
            id: 'H',
            geometry: {
                en: 'Single class of 200 identical rectangles (120×80) — annealing at steady state',
                fr: 'Classe unique de 200 rectangles identiques (120×80) — recuit à l’équilibre',
            },
            sheets: '3 × 1000×1000',
            spaceMm: 1.0,
            placed: 200,
            requested: 200,
            layouts: 3,
            densityPct: 64.0,
            smallestGapMm: 1.0,
            verdict: 'ok',
        },
        {
            id: 'J',
            geometry: {
                en: 'Same as A but 1000 parts on ONE 1000×2000 sheet at 4 mm — over capacity on purpose',
                fr: 'Comme A mais 1000 pièces sur UNE tôle 1000×2000 à 4 mm — dépassement de capacité volontaire',
            },
            sheets: '1 × 1000×2000',
            spaceMm: 4.0,
            placed: 0,
            requested: 1000,
            layouts: null,
            densityPct: null,
            smallestGapMm: null,
            verdict: 'refused',
        },
        {
            id: 'K',
            geometry: {
                en: '1000 parts at 2.4 mm on two 1000×1000 sheets — right at the measured packing limit',
                fr: '1000 pièces à 2,4 mm sur deux tôles 1000×1000 — juste à la limite d’empilement mesurée',
            },
            sheets: '2 × 1000×1000',
            spaceMm: 2.4,
            placed: 1000,
            requested: 1000,
            layouts: 2,
            densityPct: 58.5,
            smallestGapMm: 2.4,
            verdict: 'ok',
        },
    ],
    // T-I (free-form ESICUP shapes) : l'instance vit dans ses propres
    // unités normalisées — la densité n'y est PAS comparable à des mm²
    // produit ; le cas reste dans la suite interne de robustesse.
    robustness: {
        en: 'The internal torture corpus also runs a free-form ESICUP instance (shirts, 12 orientations) and a 12-orientation variant of case A. Those live in their own normalized units, so their density is not comparable to the product cases above — they exist to prove the engine never overlaps, never drops a part, and never returns an uncuttable layout on unfamiliar geometry.',
        fr: 'Le corpus de torture interne exécute aussi une instance ESICUP à formes libres (shirts, 12 orientations) et une variante du cas A en 12 orientations. Elles vivent dans leurs propres unités normalisées : leur densité n’est pas comparable aux cas produit ci-dessus — elles prouvent que le moteur ne recouvre jamais, ne perd jamais une pièce et ne rend jamais un agencement non découpable sur une géométrie inconnue.',
    },
    honesty: {
        en: 'What we do NOT claim: these densities are ours, on our corpus, at the stated budgets — not a third-party certification, and no benchmark makes one engine universally “best”. Every number above was produced by the exact Docker image deployed in production at the date shown, and re-verified after each engine release.',
        fr: 'Ce que nous ne prétendons pas : ces densités sont les nôtres, sur notre corpus, aux budgets indiqués — pas une certification tierce, et aucun benchmark ne fait d’un moteur « le meilleur » universellement. Chaque chiffre ci-dessus a été produit par l’image Docker exacte déployée en production à la date indiquée, et revérifié après chaque livraison du moteur.',
    },
}
