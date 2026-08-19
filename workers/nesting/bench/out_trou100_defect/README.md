# Repro défaut « trou d'une cellule » — SPP 100 carrés 100 mm, space 2, bande 1000×2000

Layout défectueux de référence : `seed_5594320138289656320/run/sol_instance.json`
(config `seed_5594320138289656320/config.json` = config out_trou100 avec
`prng_seed` remplacé). Reproductible à l'identique (MD5 stable entre runs).

## Replay

```bash
# run + analyse (écrit seed_<N>/run/)
python workers/nesting/bench/out_trou100_defect/sweep_seeds.py 5594320138289656320

# ou le binaire seul :
workers/nesting/engine/target/release/nest-engine.exe \
  -i workers/nesting/bench/out_trou100_defect/seed_5594320138289656320/instance.json \
  -c workers/nesting/bench/out_trou100_defect/seed_5594320138289656320/config.json \
  -s workers/nesting/bench/out_trou100_defect/seed_5594320138289656320/run -p spp
```

## Seeds défectueux trouvés (config banc : n_workers=1, separator=1, budget 30)

| Seed | Défaut |
|---|---|
| 5594320138289656320 | trou 104,01 mm (1 cellule) colonne x=308, entre y=1122,06 et y=1226,07 ; colonne x=104 courte d'une cellule (top 1632,11 vs 1734) |
| 8578442985024929247 | 2 trous de 308,01 mm (3 cellules chacun) colonne x=512 (11 pièces seulement) |
| 2806985829419873653 | escalier : 9 colonnes dont des singletons hors lattice |

## Config prod standard (n_workers=3, budget 300, separator défaut) — `run_custom/`

| Seed | Défaut |
|---|---|
| 8578442985024929237 | trou 104,01 mm colonne x=410, entre y=816,03 et y=920,04 ; colonne x=512 courte d'une cellule |
| 2806985829419873653 | trou 104,01 mm colonne x=308, entre y=1530,10 et y=1634,11 |

## Origine

Le défaut naît dans la recherche (sans post-passes : layout lâche avec gaps
3–42 mm) ; gravity + column_fill alignent sur la grille 102 mm mais ne
referment PAS un trou interne d'une cellule — il survit figé dans la sortie
finale. La largeur de bande est identique au layout propre (612,0 mm), donc
l'objectif (min largeur) ne voit pas le défaut.
