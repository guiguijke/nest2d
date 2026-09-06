# PR2 — Poids wasm (mesures 2026-08-07, cible wasm32-unknown-unknown)

Mesures release + `wasm-opt -Oz`, gzip niveau défaut. Le binaire DXF-only
est `--no-default-features --features wasm` (feature `svg` = default,
opt-in sur le bundle léger, conformément à la décision mission v2).

| Binaire | raw | gzip | raw opt | gzip opt |
|---|---|---|---|---|
| nest-import DXF-only | 273 Ko | 90 Ko | 225 Ko | 85 Ko |
| nest-import DXF+SVG | 450 Ko | 154 Ko | 364 Ko | 141 Ko |
| nest-preprocess (open_holes) | 521 Ko | 179 Ko | 416 Ko | 162 Ko |

**Budget mission** : bundle principal moteur+DXF ≈ 450 Ko gz (spike), +2 Mo
gz pour le reste. SVG ajoute ~56 Ko gz au-dessus du DXF-only ; open_holes
est un chunk séparé (~80 Ko gz de plus que le DXF+SVG, dont la majeure
partie est l'arrangement partagé). **Très largement sous le budget** — le
lazy-loading de usvg n'est plus le sujet qu'il était : usvg est écarté
(décision ci-dessous), et la réplique svgelements maison pèse ~60 Ko gz.

Note : nest-preprocess embarque nest-import (dépendance d'arrangement) — le
chiffre n'est pas additif à nest-import dans un même bundle ; en chunk
séparé le partage de code déduplique à l'intégration.

## PR3 — exports / rapport (mesures 2026-08-07, raw+gz, sans wasm-opt)

| Binaire | raw | gzip |
|---|---|---|
| nest-export (DXF+SVG) | 179 Ko | 70 Ko |
| nest-report (metrics) | 316 Ko | 112 Ko |

Les exports et le rapport sont des chunks séparés (appelés au moment du
résultat, pas au chargement) : leur poids s'ajoute au budget +2 Mo gz, très
largement respecté (total des 5 crates ≈ 0,6 Mo gz).
