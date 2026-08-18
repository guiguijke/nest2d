import { useSiteConfig } from '~~/data/siteConfig'

/**
 * Changelog of the NestorCut fork — only the changes made after the
 * fork from VovaStelmashchuk/nest2d (step 0). Newest first.
 */
export function useChangelog() {
    const { supportEmail } = useSiteConfig()
    return [
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
