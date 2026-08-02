# AGENTS.md — NestorCut (Nest2D)

Guide de l'architecture et **liste des pièges** rencontrés (avec leur règle).
Objectif : ne jamais refaire ces erreurs. Lis la section Pièges avant de
toucher au moteur, au worker Python ou au visualizer.

## 1. Architecture

```
app/ (Nuxt 4, UI)  ──► server/ (API Nuxt, entitlement, SSE)  ──► MongoDB
workers/fileprocessing (DXF → polygonParts)
workers/nesting        (orchestrateur Python → nest-engine (Rust) → DXF/SVG)
workers/common         (worker_common: mongo, crypto, worker_loop, tokens)
workers/nesting/engine (Rust workspace: nest-engine + sparrow vendorisé,
                        jagua-rs = dep crates.io 0.7.2)
admin/                 (back-office Nuxt)
```

- **Deux modes moteur** : SPP (mono-tôle, sparrow = strip packing, minimise
  la largeur utilisée) si une seule tôle ET aire pièces ≤ 80 % de la tôle ;
  sinon BPP (recuit simulé maison sur la séquence + constructif
  `HoleFillEvaluator`, minimise le nombre de tôles).
- **Le worker daemon traite UN job à la fois par processus**
  (`worker_common/worker_loop.py`). Le parallélisme inter-jobs = réplicas
  docker + pool de jetons.
- **Compute par tier** : free 1 / standard 4 / privacy 8 vcores, écrit
  côté serveur dans `params.vcores` (jamais le client). Pool Mongo
  `compute_pool` (16 jetons par défaut, `NEST_COMPUTE_TOKENS`), acquire
  atomique (`$expr used+cost ≤ total`), leases avec heartbeat, reaper > 60 s.
- **Même qualité pour tous** : arrêt sur plateau partout (BPP : patience
  par walk ; SPP : `PlateauTerminator` sparrow). Le tier ne change que la
  vitesse de délivrance.

## 2. Pièges (règles à respecter)

### Géométrie
1. **Bulge DXF : rayon signé.** `r = d/(2·sin(θ/2))` est signé — il place le
   centre (apotheme signée) mais l'échantillonnage doit utiliser `|r|`,
   sinon l'arc est miré → anneaux auto-intersectants (TopologyException).
2. **jagua n'a pas de pièces à trous** : les trous sont ouverts par un canal
   capillaire (`core/holed_polygons.py`) ; `narrow_concavity_cutoff: null`
   obligatoire sinon le canal est refermé et les trous deviennent
   inaccessibles. Le canal doit être > `space` (inflation) mais ≤ 2.5 mm.
3. **`min_item_separation` = inflation jagua** (exacte, ±space/2). Toute
   validation d'ajustement (filler dans trou) doit éroder le trou de
   space/2, sinon promesses non tenables.
4. **Polygones placés = anneau externe MOINS les trous.** Avec l'anneau
   externe seul, un filler niché « intersecte » le matériau fantôme du hôte
   (faux badges overlap/gap 0). `_placed_polygon` inclut les trous.
5. **Géométrie libre du trou ≠ géométrie collision** : le trou n'existe que
   côté Python (`item['holes']`), jamais côté moteur.

### Moteur (Rust / sparrow)
6. **sparrow n'a PAS de borne dure** : une solution « feasible »
   (sans collision) peut dépasser `max_strip_width`. Tout affichage doit
   vérifier `fitsSheet` (largeur ≤ tôle) — sinon layouts hors-tôle à
   l'écran avec badge vert.
7. **Champion lock monotone** : n'afficher qu'un layout s'il est
   *strictement meilleur* que l'incumbent ET `fitsSheet`, avec throttle
   (600 ms). Sans ça, la vue flip-flope entre walks et « les pièces
   tournent ».
8. **Two-phase = la machine à remplir les trous** : phase 1 (min largeur)
   puis phase 2 transposée (min hauteur dans un corridor) — le corridor
   serré force les pièces dans les trous. Toute classe directionnelle doit
   avoir SA phase 2 orientée selon son axe, sinon trous sous-remplis.
9. **Séquence initiale ≠ warm-start gratuit** : à ~50 itérations SA/run,
   l'ordre initial domine la trajectoire. Un warm-start intercalé
   hôtes/fillers PERD (fillers ratés cassent le packing des hôtes —
   mesuré, voir `warm_start_160_ab` #[ignore]).
10. **Compteur d'évaluations = cumul du RUN.** Les `sep_stats` repartent de
    zéro à chaque round `separate()` — reporter leur valeur directe fait
    osciller le compteur. Cumuler dans explore/compress (+ base explore
    pour compress).
11. **serde ignore les champs inconnus** : un vieux binaire moteur ignore
    silencieusement les nouvelles clés de config (`biases`, `n_workers`,
    `plateau_patience_sec`) → comportement legacy sans erreur. Après un
    changement de config, vérifier la version du binaire en premier réflexe
    (`NEST_ENGINE_BIN` / rebuild image).
12. **export alternatives : grouper par classe de biais** (ordre canonique
    left/bottom/balanced) PUIS fallback qualité ; le tri Python final doit
    respecter cet ordre quand les tags existent (pas de re-tri global par
    densité).
13. **`import_solution` BPP = `unimplemented!()`** dans jagua 0.7.2 : pas
    de warm-start par placements en BPP. SPP OK.
14. **Plateau = vraies améliorations globales seulement** (nouveau best
    width / compression réussie). Les états de travail (ExplImproving /
    ExplInfeas pendant la séparation) ne doivent PAS réarmer l'horloge,
    sinon le plateau ne déclenche jamais.

### Métriques & pipeline Python
15. **largest_empty_rectangle : compter les sommets DES TROUS** dans le
    budget exact (anneaux 64-gons → le scan explose, worker bloqué des
    heures). Budget : 60 pièces / 600 sommets (outer+holes), garde-fou
    grille 40 000 → repli band offcut (exact pour les chutes en bande).
16. **Seed Mongo = BSON Int64** : sérialiser en `toString()` côté API,
    sinon `{low, high, unsigned}` à l'écran.
17. **Le seed déterministe exclut la config** (instance+space+budget) :
    modifier `config.json` ne change PAS le seed → A/B à seed égal
    gratuits.
18. **Le worker `$unset` doit couvrir tout champ éphémère** (progress,
    liveLayout, itemMap, compute) à la fin du job.
19. **`docker rm -f` = SIGKILL** : le handler SIGTERM du worker_loop ne
    s'exécute pas → job orphelin « processing » + lease de jetons bloquée
    (reaper après 60 s). Préférer `docker stop`.

### Frontend
20. **Apostrophes françaises dans i18n.js** : utiliser des doubles quotes
    pour les chaînes contenant `'` (sinon PARSE_ERROR au build).
21. **`var(--background-secondary)` est sombre** dans ce thème : ne jamais
    compter sur les vars de thème pour un canvas lisible — palette
    explicite (fond clair, pièces accent, texte foncé).
22. **Ids SVG uniques par instance** (clipPath) : plusieurs visualizers sur
    la même page.

## 3. Banc d'essai (workers/nesting/bench/)

Boucle de test de bout en bout, sans UI :

```bash
docker build -t nest2d-nesting-worker:dev -f workers/nesting/Dockerfile workers
docker compose up -d mongo
docker run -d --name bench-worker --network nest2d_nest2d \
    -e MONGO_URI=mongodb://mongo:27017/nest2d nest2d-nesting-worker:dev
docker run --rm -i --network nest2d_nest2d \
    -e MONGO_URI=mongodb://mongo:27017/nest2d \
    nest2d-nesting-worker:dev python - < workers/nesting/bench/seed_job.py
```

- `seed_job.py` : cas croix (3+3+50, tôle 1500×1000), asserte 3 alternatives
- `seed_holes.py` : cas trous (10 hôtes r=35 + 41 secteurs, 1000×2000),
  imprime `holesFilled` par classe (cible : 40/40 partout)
- `seed_nestforge.py` : rejoue les pièces démo du concurrent depuis son DXF
- `repro_pipeline.py` : exécute `nesting_process` in-process avec espion
  (dump instance/config moteur pour replay manuel)

Règle d'or : **tout changement moteur/pipeline se valide au banc avant
push**, avec les métriques objectives (holesFilled, offcut, usedSheetShare,
badges, itérations).

## 4. Dev local (docker)

`docker-compose.override.yml` (gitignoré) build app + workers depuis les
sources. Cycle : `docker compose build && docker compose up -d`.
Compte de test : `guillaume@local.dev` / `nestorcut-local-2026`
(tier standard granté 30 j, créé via `/api/auth/local/register` +
`grantedUntil` en base).

## 5. Avant de pousser

```bash
cd workers/nesting/engine && cargo test --release          # 17 + 1 ignore
cd workers/nesting && python -m pytest tests/ -q           # 33 (PYTHONPATH=workers/common)
cd workers/common && python -m pytest tests/ -q            # 5
npx nuxt build                                             # app
cd nestorcut-website && npm run build                      # site marketing
```

Benchmarks ESICUP (lents) : `pytest benchmarks/test_benchmarks.py -m slow`.
Harnais A/B warm-start : `cargo test --release warm_start_160_ab -- --ignored --nocapture`.

## 6. Conventions

- Commits en français, conventional commits (`feat(nesting): …`), petits et
  par phase. Ne jamais committer le travail non sollicité des autres
  (vérifier `git status` avant `git add -A`; préférer des adds ciblés).
- `main` direct (petit projet), merge requests pour les grosses branches.
- i18n : `app/utils/i18n.js` (EN+FR, dict plat) ; site : `src/i18n/ui.ts`.
