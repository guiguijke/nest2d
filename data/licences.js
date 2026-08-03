// Third-party dependencies shipped with NestorCut, grouped by stack.
// Versions = what is declared/installed today (package.json, requirements.txt,
// Cargo.toml). Keep this file in sync when bumping dependencies — it feeds
// the public /licences page.
// "—" = version not pinned in the manifest.
export const groups = [
    {
        id: "web",
        packages: [
            { name: "nuxt", version: "4.5.1", license: "MIT" },
            { name: "vue", version: "3.5.40", license: "MIT" },
            { name: "vue-router", version: "4.5.1", license: "MIT" },
            { name: "vite", version: "6.3.5", license: "MIT" },
            { name: "three", version: "0.182.0", license: "MIT" },
            { name: "dxf-viewer", version: "1.0.46", license: "MPL-2.0" },
        ],
    },
    {
        id: "server",
        packages: [
            { name: "mongodb", version: "6.8.2", license: "Apache-2.0" },
            { name: "bcryptjs", version: "3.0.3", license: "BSD-3-Clause" },
            { name: "archiver", version: "7.0.1", license: "MIT" },
            { name: "winston", version: "3.17.0", license: "MIT" },
            { name: "standard-slugify", version: "4.0.0", license: "MIT" },
            { name: "tslib", version: "2.8.1", license: "0BSD" },
        ],
    },
    {
        id: "workers",
        packages: [
            { name: "ezdxf", version: "1.4.4", license: "MIT" },
            { name: "shapely", version: "2.0.7", license: "BSD-3-Clause" },
            { name: "pymongo", version: "4.14.1", license: "Apache-2.0" },
            { name: "numpy", version: "≥ 1.21", license: "BSD-3-Clause" },
            { name: "Pillow", version: "10.4.0", license: "MIT-CMU" },
            { name: "matplotlib", version: "3.10.5", license: "Matplotlib (PSF-based)" },
            { name: "cryptography", version: "—", license: "Apache-2.0 OR BSD-3-Clause" },
            { name: "python-dotenv", version: "1.1.1", license: "BSD-3-Clause" },
            { name: "spyrrow", version: "0.9.0", license: "MIT" },
        ],
    },
    {
        id: "engine",
        packages: [
            {
                name: "jagua-rs",
                version: "0.7.2",
                license: "MPL-2.0",
                note: "© Jeroen Gardeyn, KU Leuven — github.com/JeroenGar/jagua-rs",
            },
            {
                name: "sparrow",
                version: "vendored",
                license: "MIT",
                note: "© 2025 Jeroen Gardeyn, KU Leuven — github.com/JeroenGar/sparrow",
            },
            { name: "rand", version: "0.10", license: "MIT OR Apache-2.0" },
            { name: "serde", version: "1.0", license: "MIT OR Apache-2.0" },
            { name: "rayon", version: "1.10", license: "MIT OR Apache-2.0" },
            { name: "clap", version: "4.5", license: "MIT OR Apache-2.0" },
            { name: "anyhow", version: "1.0", license: "MIT OR Apache-2.0" },
            { name: "log", version: "0.4", license: "MIT OR Apache-2.0" },
        ],
    },
]
