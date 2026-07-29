# nest-engine

Moteur de nesting 2D de Nest2D : optimiseur **séparation → compaction** construit
sur [jagua-rs](https://github.com/JeroenGar/jagua-rs) (moteur de détection de
collisions) et [sparrow](https://github.com/JeroenGar/sparrow) (heuristique
SOTA de strip packing, vendored dans `crates/sparrow` — voir `NOTICE`).

## Principes

- **Deux modes** :
  - `spp` (un seul type de tôle) — boucle sparrow complète : overlap autorisé et
    pénalisé, séparation par échantillonnage continu, compaction par réduction
    de la longueur de bande. Objectif = **longueur utilisée minimale**
    (= chute réutilisable maximale, natif).
  - `bpp` (plusieurs types de tôles, ou dépassement d'une tôle) — **recuit
    simulé** sur la séquence de placement (swaps, insertions, renversements),
    évaluée par un constructif **best-fit** : chaque pièce est cherchée dans
    TOUTES les tôles ouvertes via la machinerie sparrow (échantillonnage
    uniforme + descente de coordonnées, évaluateur left-bottom-fill), et une
    nouvelle tôle n'est ouverte que si la pièce ne rentre vraiment nulle part.
    Objectif lexicographique : toutes les pièces placées → coût des tôles
    minimal → remplissage inégal (Falkenauer) pour dégager une chute propre.
- **Compaction bi-axiale (SPP)** : minimiser la largeur seule est indifférent
  à l'usage des trous (empiler dans la colonne = imbriquer dans les découpes).
  Après la phase 1 (min largeur W*), le moteur **transpose le problème à 90°**
  et ré-optimise dans un couloir de hauteur W* (+`phase2_slack_mm`, 2 mm) :
  empiler devient impossible, donc minimiser la longueur transposée **pousse
  les pièces dans les trous** et réduit la hauteur consommée. Config :
  `two_phase` (défaut true), `phase1_ratio` (0.6), `phase2_slack_mm` (2.0).
- **Passe gravité** : après chaque recherche, chaque pièce est tirée vers le
  bas puis vers la gauche par bissection exacte contre le CDE (déterministe,
  sans chevauchement possible, la largeur ne peut que diminuer) — les layouts
  restent lisibles même quand le budget est court (machine lente).
- **Incumbent garanti** : la meilleure solution faisable rencontrée est toujours
  exportée — jamais de régression, quel que soit le budget.
- **Seed déterministe** : `prng_seed` obligatoire (dérivé d'un hash du job côté
  worker Python). La trajectoire de recherche est reproductible ; le cutoff
  étant temporel, le point d'arrêt peut varier légèrement sous charge machine
  (comportement standard des solveurs anytime).
- **Budget temps** (`time_budget_sec`) : la qualité croît avec le temps, sans
  paramètre opaque type `n_samples`.
- **Multi-start parallèle** (rayon) : N workers avec seeds dérivées ; les N
  meilleures solutions **distinctes** sont exportées comme alternatives.
- **Progression** : lignes JSON sur stdout (`start` / `progress` / `heartbeat` /
  `done` / `error`) relayées par le worker Python vers l'UI.

## CLI

```
nest-engine -i instance.json -c config.json -s out_dir -p spp|bpp
```

- `instance.json` : représentation externe jagua-rs
  (`ExtSPInstance` = `{name, items, strip_height}` ou
  `ExtBPInstance` = `{name, items, bins}`).
- `config.json` :

```json
{
  "time_budget_sec": 45,
  "prng_seed": 123456789,
  "n_alternatives": 3,
  "n_workers": null,
  "max_strip_width": 3000.0,
  "explore_ratio": 0.8,
  "min_item_separation": 0.5,
  "poly_simpl_tolerance": 0.001,
  "narrow_concavity_cutoff": null
}
```

  - `max_strip_width` (spp) : borne dure de faisabilité (longueur de la tôle).
  - `narrow_concavity_cutoff: null` : **obligatoire** pour les pièces à trous
    (ouvertes par un canal — voir `../core/holed_polygons.py`), sinon la
    fermeture des concavités étroites rebouche le canal.
- Sortie : `out_dir/sol_instance.json` (meilleure solution, format jagua) et
  `out_dir/alternatives.json` (top-N distinctes + métriques).

## Développement

```bash
cargo build --release          # binaire dans target/release/nest-engine
cargo test                     # tests unitaires + petite intégration BPP
```

Benchmarks ESICUP (instances dans `../benchmarks/instances`) :

```bash
pytest ../benchmarks/test_benchmarks.py -m slow
```

Densités de référence mesurées à 30 s de budget (cf. `../benchmarks/last_run.txt`) :
shirts 87 %, swim 74 %, albano 88 %, trousers 91 %, fu 91 % — dans ou au-dessus
des fourchettes de la littérature.

## Limites connues / travaux futurs

- Pièces à trous : le canal d'ouverture doit être plus large que
  `min_item_separation` (géré côté Python par `channel_width_for_space`) ; une
  intration résiduelle de ~space/2 le long du canal est théoriquement possible.
- BPP : pas encore de compaction sparrow par tôle en post-pass (le recuit
  compacte déjà via la loss bottom-left) — piste d'amélioration.
- Pas d'export SVG natif (les résultats sont reconstruits en Python depuis les
  DXF d'origine).
