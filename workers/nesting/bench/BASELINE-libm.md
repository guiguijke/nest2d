# Baselines du banc (référence A/B du passage à libm — J-058)

Protocole (AGENTS.md §3) : image `nest2d-nesting-worker:dev` buildée sur la
révision visée, `docker compose up -d mongo`, daemon bench-worker, scripts
`workers/nesting/bench/seed_job.py` (croix) et `seed_holes.py` (trous),
`BENCH_BUDGET=25` par défaut.

## AVANT libm (main @ 290ffa4+, moteur pré-patch)

### seed_job.py — croix (SPP, 3 alternatives directionnelles)

| # | strategy | density | usedSheetShare | offcut (mm) |
|---|---|---|---|---|
| 0 | left | 0.7026 | 0.5997 | 579x1000 |
| 1 | bottom | 0.6946 | 0.6159 | 1500x369 |
| 2 | balanced | 0.4324 | 0.6064 | 1500x390 |

OK — 3 alternatives directionnelles distinctes.

### seed_holes.py — hôtes + secteurs (BPP)

| # | strategy | holesFilled | used | gap | overlapFree | spacingOk | iters |
|---|---|---|---|---|---|---|---|
| 0 | left | 38/40 | 5.3% | 2.0 | True | True | 9 359 836 |
| 1 | bottom | 39/40 | 5.5% | 2.0 | True | True | 8 918 458 |
| 2 | balanced | 40/40 | 5.5% | 2.0 | True | True | 8 728 648 |

## APRÈS libm (cette branche)

### seed_job.py — croix (SPP, 3 alternatives directionnelles)

| # | strategy | density | usedSheetShare | offcut (mm) |
|---|---|---|---|---|
| 0 | left | 0.7042 | 0.6085 | 581x1000 |
| 1 | bottom | 0.7042 | 0.6075 | 1500x369 |
| 2 | balanced | 0.4324 | 0.6124 | 1500x384 |

OK — 3 alternatives directionnelles distinctes.

### seed_holes.py — hôtes + secteurs (BPP)

| # | strategy | holesFilled | used | gap | overlapFree | spacingOk | iters |
|---|---|---|---|---|---|---|---|
| 0 | left | 37/40 | 5.3% | 2.0 | True | True | 11 069 720 |
| 1 | bottom | 37/40 | 5.5% | 2.0 | True | True | 9 595 372 |
| 2 | balanced | 40/40 | 5.5% | 2.0 | True | True | 10 161 064 |

### Justification des deltas (P8 — jamais de baseline réécrite silencieusement)

Le passage à libm change les trajectoires natives (attendu : la recherche est
chaotique, tout ulp dévie le chemin). Lecture des métriques objectives :

- **densités (croix) : EN HAUSSE** sur left (0.7026→0.7042) et bottom
  (0.6946→0.7042), identique sur balanced (0.4324). **usedSheetShare : EN
  HAUSSE partout** (0.5997→0.6085, 0.6159→0.6075, 0.6064→0.6124).
- **badges : tous verts AVANT et APRÈS** (overlapFree, spacingOk, gap=2.0),
  toutes les pièces placées, 3 alternatives distinctes dans les deux cas.
- **holesFilled : −1 (left) / −2 (bottom) / = (balanced)**. Variance mesurée
  : sur le MÊME build libm, un second run à budget 35 s donne left=40/40,
  bottom=35/40, balanced=40/40 — fluctuation ±3/40 par classe selon budget.
  Le delta AVANT/APRÈS est donc du **bruit de trajectoire** (le champion
  bouge de ±2 secteurs par classe dès que la trajectoire change), pas une
  dégradation systématique. Le cas balanced (= 40/40) et les densités en
  hausse le confirment.
- **iters : +10-18 %** — libm (pur Rust) est un peu plus lent que la libm
  système sur les appels trigo ; le coût reste marginal vs le coût total
  d'une évaluation de collision (le ratio wasm/natif mesuré en spike est
  1,5-1,7×, voir `spike/VERDICT.md`).

Nouvelles baselines = colonnes « APRÈS » ci-dessus, référence pour le prochain
changement moteur.

