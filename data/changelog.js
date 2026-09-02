import { useSiteConfig } from '~~/data/siteConfig'

/**
 * Changelog of the NestorCut fork — only the changes made after the
 * fork from VovaStelmashchuk/nest2d (step 0). Newest first.
 */
export function useChangelog() {
    const { supportEmail } = useSiteConfig()
    return [
        {
            title: 'The last sheet is now compacted too',
            datetime: '2026-09-02',
            sections: [
                {
                    title: 'Multi-sheet nesting',
                    content: [
                        'On multi-sheet jobs, the last sheet is now fully compacted along the optimization direction: host parts with their cutout fillers are re-packed into columns from the sheet edge, and leftover parts fill a compact block right behind them — the remaining offcut is once again a single clean reusable rectangle.',
                        'Fixed overlapping parts in browser-computed layouts for parts with finely detailed outlines.',
                    ],
                },
            ],
        },
        {
            title: 'Multi-sheet: clean live view and complete band filling',
            datetime: '2026-09-01',
            sections: [
                {
                    title: 'Multi-sheet nesting',
                    content: [
                        'During computation, each sheet now animates side by side in the live view instead of every sheet being drawn on top of the first one.',
                        'The side-band filling of the earlier sheets now completes the top band and the top-right corner (a coordinate mix-up could leave an empty staircase gap), and parts are no longer duplicated on top of cutout fillers when two sheets have coincident hole positions.',
                    ],
                },
            ],
        },
        {
            title: 'Fuller first sheets on multi-sheet jobs',
            datetime: '2026-08-31',
            sections: [
                {
                    title: 'Multi-sheet nesting',
                    content: [
                        'Leftover small parts now fill the empty side bands of the earlier sheets instead of piling onto the last one, so the last sheet keeps a larger, cleaner reusable offcut.',
                        'Host parts and parts nested inside cutouts never move; the filling is validated part by part and silently skipped whenever it cannot be done safely.',
                    ],
                },
            ],
        },
        {
            title: 'A grid that never leaves the sheet, and parts that only turn where allowed',
            datetime: '2026-08-31',
            sections: [
                {
                    title: 'Safety nets for the Grid layout',
                    content: [
                        'The Grid alternative is now only delivered when every part actually sits inside the sheet — an edge case that used to slip through is now an automatic fallback to the engine layout.',
                        'The grid tiling only uses part rotations you allowed: with a single allowed orientation, small parts are never placed upside down or sideways anymore.',
                    ],
                },
                {
                    title: 'Clearer "part too large" errors',
                    content: [
                        'A part that barely fits the sheet with the requested spacing is now rejected upfront with the exact message instead of crashing the computation (the engine counts the spacing on both sides of the part).',
                    ],
                },
            ],
        },
        {
            title: 'Fairer free quota, live view that keeps moving, settings that survive a reload',
            datetime: '2026-08-31',
            sections: [
                {
                    title: 'Free quota honesty',
                    content: [
                        'A submission that never starts a job — another nest already running, a locked vault, a server hiccup — no longer consumes one of your 10 free monthly nestings: the unit is refunded automatically.',
                        'The Nest button now blocks double-clicks while the request is in flight, and a rejected submission shows a clear message instead of failing silently with a frozen button.',
                    ],
                },
                {
                    title: 'Live view and local jobs',
                    content: [
                        'The live view keeps animating through the whole optimization: height-compaction frames and sheet-by-sheet plateau progress now count again, on every device mode.',
                        'Cancelling a queued local nesting really cancels it (no more zombie job waking up as an error), and a compute worker that dies mid-merge can no longer freeze a job forever.',
                    ],
                },
                {
                    title: 'Settings and results',
                    content: [
                        'Project settings (sheets, spacing, quantities) survive a full page reload even when you never left the project.',
                        'Layout options are ordered the same way on-device and on the server, and long working sessions release memory sooner.',
                    ],
                },
            ],
        },
        {
            title: 'Tighter Grid packing, live view stays on the right project',
            datetime: '2026-08-31',
            sections: [
                {
                    title: 'Grid packing',
                    content: [
                        'The Grid alternative now fills leftover pockets with a general tiling (axis-aligned grid, brick, interlocking zigzag, and the same zigzag rotated 90°) and keeps the variant that places the leftover parts closest to the origin — more reusable sheet, still a regular block.',
                        'A 90° bounding-box mismatch that silently dropped half the rotated tiles is fixed; Grid leftover now matches the compact –X engine on the 100-host + fillers bench (about 73.6 % of the strip).',
                    ],
                },
                {
                    title: 'Live view isolation',
                    content: [
                        'Switching project while a nest runs no longer paints project A’s live layout on project B, and a missed progress beat no longer throws away the best live frame.',
                        'The home project list shows a “nesting in progress” hint on the project that is computing.',
                    ],
                },
            ],
        },
        {
            title: 'Grid layouts, reliable multi-sheet nesting, live view that never freezes',
            datetime: '2026-08-29',
            sections: [
                {
                    title: 'Grid alternative (canonical layout)',
                    content: [
                        'When one dominant rectangular part is mixed with small parts, a Grid option is computed alongside the engine layouts: exact columns of rectangles, then successive filled rectangles for the small parts (compacted band by band), their cutouts filled, and the overflow in one dense band. It is deterministic and often beats the organic packing on material used.',
                        'Progress feedback during the grid phase shows the cumulative step (grid: step 2/3 · zone C).',
                    ],
                },
                {
                    title: 'Multi-sheet nesting fixed',
                    content: [
                        'Projects declaring several sheets with holed parts were collapsed into a single overloaded band — the one-sheet test now measures outer outlines, not net area.',
                        'The live result is never replaced by a mid-search frame in multi-sheet mode: only the merged engine solution is delivered.',
                        'During the search, the live view now refreshes every second with the incumbent layout instead of freezing after the first update.',
                    ],
                },
                {
                    title: 'Reliability',
                    content: [
                        'Navigating between projects while a compute runs no longer breaks anything: each project keeps its own solve, refresh does not restart a finished job, and cancel stops everything including grid sub-searches.',
                        'Free accounts run one nesting at a time (queued with a notice); paid tiers run several in parallel.',
                        'Part thumbnails load reliably: the display-geometry endpoint no longer shares the download rate-limit budget.',
                    ],
                },
            ],
        },
        {
            title: 'Hole nesting first, one direction = the best layout',
            datetime: '2026-08-17',
            sections: [
                {
                    title: 'Nesting in cutouts',
                    content: [
                        'Smaller parts are packed into holes first (any mix of shapes, not just a hardcoded pair), then the filled hosts and leftovers are nested on the sheet.',
                        'Default direction is –X (left): one direction returns the single best layout of 8 walks. Tick more directions to compare alternatives.',
                    ],
                },
                {
                    title: 'Local compute',
                    content: [
                        'A finished layout that stops improving ends the search sooner on small jobs, and waits longer when there are many parts (large jobs compute fewer frames per second).',
                        'The result you see live is the one you get — a later merge cannot replace it with a worse packing.',
                    ],
                },
            ],
        },
        {
            title: 'NestorCut rebrand',
            datetime: '2026-08-05',
            sections: [
                {
                    title: 'Branding',
                    content: [
                        'The project is renamed NestorCut — new logo, new home at nestorcut.com, same engine.',
                        'Vault key files are now generated as nestorcut-vault-*.key.json — your existing key files keep working.',
                    ],
                },
            ]
        },
        {
            title: 'UI polish & Changelog page',
            datetime: '2026-07-28',
            sections: [
                {
                    title: 'Fixes',
                    content: [
                        'Restored the base CSS reset lost when Tailwind was removed during the Nuxt 4 migration (nav bullets, underlined links, unstyled pages).',
                        'Licences page restyled to the design system.',
                    ],
                },
                {
                    title: 'New feature',
                    content: [
                        'The blog becomes this Changelog page — /blog redirects here automatically.',
                        'Header now shows the full APLASMA lockup and favicons were regenerated from it.',
                    ],
                },
            ]
        },
        {
            title: 'Nuxt 4 & Node 24',
            datetime: '2026-07-28',
            sections: [
                {
                    title: 'Tech upgrade',
                    content: [
                        'Migrated Nuxt 3.17.7 → 4.5.1 (app/ structure, shared constants, plan caching, route announcer).',
                        'Removed Tailwind (it was installed but unused).',
                        'Docker image now runs Node 24 LTS, required by Nuxt 4 / Vite 8.',
                    ],
                },
            ]
        },
        {
            title: 'Plans page & monthly free quota',
            datetime: '2026-07-28',
            sections: [
                {
                    title: 'New features',
                    content: [
                        'New /plans page with plan cards and a full comparison table.',
                        'The Pro card activates itself as soon as the product exists in Stripe — no deploy needed.',
                    ],
                },
                {
                    title: 'Free tier',
                    content: [
                        'The free quota is now 10 nestings every month (reset automatically each month) instead of 10 one-shot.',
                    ],
                },
            ]
        },
        {
            title: 'APlasma visual identity',
            datetime: '2026-07-28',
            sections: [
                {
                    title: 'Brand',
                    content: [
                        'Full rebrand to the APlasma brand guide: beige and anthracite palette with rust accents, light and dark themes.',
                        'Helios Stencil for headings, Montserrat for body text — both self-hosted.',
                        'Real APlasma logo in the header and footer, brand watermark on the landing, new favicons.',
                    ],
                },
            ]
        },
        {
            title: 'Tiered compute & Pro plan',
            datetime: '2026-07-27',
            sections: [
                {
                    title: 'New features',
                    content: [
                        'Compute budget per plan: free 8k samples / 1 alternative, Unlimited 20k / 3, Pro 50k / 3 — enforced server-side.',
                        'Priority queue: Pro jobs are processed first.',
                    ],
                },
            ]
        },
        {
            title: 'Nesting engine upgrades',
            datetime: '2026-07-27',
            sections: [
                {
                    title: 'New features',
                    content: [
                        'The sheet boundary is now drawn in the result (blue frame in the DXF and the thumbnails).',
                        'Better layouts: solver budget raised from 5k to 20k samples.',
                        '3 alternative layouts per nesting job — compare densities and pick your favorite.',
                        'Heterogeneous sheets: declare several sheet types with different sizes and stocks.',
                    ],
                },
            ]
        },
        {
            title: 'APlasma Nesting',
            datetime: '2026-07-27',
            sections: [
                {
                    title: 'Rebrand',
                    content: [
                        'The project is renamed APlasma Nesting (Inspired by Nest2D).',
                    ],
                },
            ]
        },
        {
            title: 'Zero-knowledge vault',
            datetime: '2026-07-27',
            sections: [
                {
                    title: 'New feature',
                    content: [
                        'Files are encrypted with AES-256-GCM using a key file only you hold — we store no copy of it.',
                        'Session unlock with 2h sliding TTL, key rotation, disable with full decryption or crypto-shredding.',
                        'Requires the Pro plan.',
                    ],
                },
            ]
        },
        {
            title: 'Professional landing & auth',
            datetime: '2026-07-27',
            sections: [
                {
                    title: 'New features',
                    content: [
                        'Complete landing page redesign: hero, features, pricing (19 € Unlimited / 39 € Pro), FAQ.',
                        'Password reset by email for local accounts.',
                    ],
                },
                {
                    title: 'Fixes',
                    content: [
                        'Removed dead pages and inconsistent marketing copy.',
                    ],
                },
            ]
        },
        {
            title: 'Payments & quotas',
            datetime: '2026-07-27',
            sections: [
                {
                    title: 'New features',
                    content: [
                        'Unified charge model: subscription, free quota and credits with automatic refund when a nesting fails.',
                        'Admins get unlimited nesting; free quota raised to 10.',
                    ],
                },
                {
                    title: 'Fixes',
                    content: [
                        'Checkout no longer forces USD — it falls back to the price’s own currency (EUR).',
                    ],
                },
            ]
        },
        {
            title: 'Step 0 — The fork',
            datetime: '2026-07-27',
            sections: [
                {
                    title: 'APlasma Nesting begins',
                    content: [
                        'Forked from VovaStelmashchuk/nest2d — huge thanks to the original author for the open-source base.',
                        'Personalized for homelab self-hosting: Docker Compose stack, CI-built images, Google PKCE auth fix.',
                        `Questions or issues: support chat or ${supportEmail}.`,
                    ],
                },
            ]
        },
    ]
}
