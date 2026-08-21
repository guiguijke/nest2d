# AGENTS.md — NestorCut (Nest2D)

Guide de l'architecture et **liste des pièges** rencontrés (avec leur règle).
Objectif : ne jamais refaire ces erreurs. Lis la section Pièges avant de
toucher au moteur, au worker Python ou au visualizer.

> **Specs (mémoire des décisions) : le dossier `specs/` (gitignored, local)
> fait foi pour le QUOI et le POURQUOI** — formats d'import, moteur,
> couleurs, démo, monétisation, vie privée, et le journal chronologique
> `specs/90-decisions.md`. **Avant de modifier un comportement tranché,
> vérifie la spec correspondante** ; toute nouvelle décision (ou infirmation
> d'une ancienne) y est ajoutée avec date et statut — jamais de retour en
> arrière silencieux. AGENTS.md (ce fichier) reste la référence des pièges
> techniques ; les specs restent la référence des décisions.
>
> **Stratégie produit (commitée) : `docs/STRATEGY.md`** — tiers
> Free/Unlimited/Pro, spectre privacy, rapport matière, codes promo,
> roadmap 2 phases, avec marqueurs `[prod]` / `[spéc]` / `[conditionnel]`
> (jamais `[prod]` sur du non-livré). Promesses privacy exactes et threat
> model : `docs/THREAT-MODEL.md` (interne, ne pas publier).

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

- **Deux modes moteur** : SPP (sparrow = strip packing, minimise la
  largeur utilisée) si **un seul format** de tôle, aire pièces ≤ 80 %
  d'une tôle, ET (`stock === 1` OU directions = `['left']` seulement) —
  un stock déclaré 100 + –X coché doit rester SPP (sinon BPP « rangées »,
  pas une bande). Sinon BPP (recuit simulé maison sur la séquence +
  constructif `HoleFillEvaluator`, minimise le nombre de tôles).
- **Qualité = 8 walks partout (D-PAY-12)** : `n_workers` BPP = `QUALITY_WALKS`
  ; `RAYON_NUM_THREADS` = vcores du tier (1 / 4 / 8). Le navigateur fait
  la même chose (`walks=8`, `concurrency` = tier).
- **Le worker daemon traite UN job à la fois par processus**
  (`worker_common/worker_loop.py`). Le parallélisme inter-jobs = réplicas
  docker + pool de jetons.
- **Compute par tier** : free 1 / standard 4 / privacy 8 vcores, écrit
  côté serveur dans `params.vcores` (jamais le client). Pool Mongo
  `compute_pool` (16 jetons par défaut, `NEST_COMPUTE_TOKENS`), acquire
  atomique (`$expr used+cost ≤ total`), leases avec heartbeat, reaper > 60 s.
  Noms code ↔ marketing : `free`/`standard`/`privacy` = Free/Unlimited/
  **Pro** (le tier code `privacy` est le Pro « budget moteur max » — le
  vault ZK n'est plus son exclusivité : opt-in tous plans en Phase 1, voir
  `docs/STRATEGY.md`).
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
   **Au-delà de ~2.4 mm d'espacement le canal est scellé par l'inflation** :
   ouvrir quand même écrase l'anneau et casse l'import moteur
   (« non-consecutive duplicate vertices » / « Offset resulted in an empty
   polygon ») — ce n'est PAS une dégradation sûre automatique. Toujours
   passer par `channels_usable(space)` : si scellé, laisser les trous
   fermés (outer plein) — trous inutilisés mais job vivant.
2b. **Strip initial jagua = aire totale / hauteur, DEFLATÉ de space/2** :
   si `total_part_area / strip_height ≤ space`, l'offset du strip sort vide
   et le moteur panique dans un thread rayon (« Offset resulted in an empty
   polygon », opaque). Garde côté Python avant `run_engine` (exception
   explicite : réduire l'espacement ou ajouter pièces/stock).
3. **`min_item_separation` = inflation jagua** (exacte, ±space/2 de chaque
   côté → séparation totale `space`). Toute validation d'ajustement (filler
   dans trou) doit garantir **distance ≥ `space` à la paroi** : candidat NON
   inflaté ⇒ éroder le trou de `space` en entier (adjonction dilation/
   érosion : filler ⊕ space/2 ⊆ trou ⊖ space/2 ⟺ filler ⊆ trou ⊖ space) ;
   candidat inflaté de space/2 ⇒ éroder de space/2. Sinon promesses non
   tenables (spacingOk=False au rapport).
3b. **jagua droppe les items à demande 0 puis exige des ids consécutifs** :
   l'importeur SPP fait `retain(demand > 0)` PUIS `ensure!(id == index)` —
   une instance réduite (pre-pass meta-pièces J-085) doit être **réindexée
   0..n-1** après suppression d'un item, et `meta["idMap"]` re-mappe
   solutions et live frames vers les ids d'origine. Sinon « importing SPP
   instance … consecutive IDs » → job en échec, serveur ET navigateur
   (panne prod 2026-08-09, filler uploadé avant l'hôte). Corollaire J-085 :
   l'hôte de l'instance réduite est résolu **trous fermés** (anneau externe
   propre) — ouverts, le moteur y placerait les fillers restants que
   l'expansion y rattache ensuite (double-remplissage = overlaps réels).
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
   (150 ms). Sans ça, la vue flip-flope entre walks et « les pièces
   tournent ». Un frame hole-fill (plus de pièces dans les trous) bat
   un incumbent de même largeur/densité — sinon la vue live ignore le
   post-pass et le modal « n'a rien à voir ». **Le merge wasm n'est pas
   le champion lock** : il peut rendre un layout plus large que le live.
   `preferChampion` préfixe l'incumbent live s'il bat le rang 0 ; le
   pool s'arrête dès que le champion faisable ne s'améliore plus
   (`championIdleMs`, pas un mur 2 s).
7b. **Arrêt idle champion = f(n), jamais 2 s fixes** : un grand n baisse
    la fréquence des frames live (une eval plus lente). Formule :
    plancher 2 s + 20 ms/pièce, au moins 2× l'écart live observé,
    plafond = `plateau_patience_sec` (J-083). 20 pièces ≈ 2,4 s ;
    500 pièces ≈ 12 s. Un 2 s fixe sur 100 hôtes + 400 fillers coupe
    après 0–1 eval. Mesuré 2026-08-17 : 100 carrés 100 mm / 1000×2000 /
    space 2 / –X = bande 614,03 mm (plancher géométrique 610 + 2+2 mm
    de marge tôle) — 6 rangées à 2,00 mm, déjà compact ; un post-pass
    de plus ne gagne rien. **Settle idle champion = mono-classe
    seulement** (mode local, `localPool.js`) : en multi-classes, les
    `strip_width` ne sont PAS comparables (largeur 'left' vs hauteur
    transposée 'bottom') → `liveBetter` ne réarme jamais le chrono et le
    settle tuait le pool pendant que les walks des autres classes
    tournaient (1 seule alternative au lieu d'une par direction, panne
    prod 100+800 pièces / ['left','bottom']). En multi-classes :
    complétion naturelle des walks (budget + plateau chacun) puis le
    merge par classe doit aller au bout ; `preferChampion` reste
    inoffensif (un champion d'unité non comparable ne bat jamais le
    rang 0 du merge).
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
14b. **Reproductibilité cross-device ⇒ libm contrôlée** : les
    transcendantales (`sin_cos`/`atan2`/`ln`/`exp`/`powf`) appellent la libm
    plateforme — msvcrt ≠ glibc ≠ Rust libm (wasm32) à l'ulp près, et la
    recherche est chaotique → trajectoires divergentes (mesuré : 7,9 M vs
    4,9 M évals à seed égal). Toute transcendantale du chemin moteur passe
    par le crate `libm` DES DEUX CÔTÉS (jagua `transformation.rs`,
    Box-Muller explicite dans sparrow `explore.rs`, pow/exp du SA BPP).
    `sqrt`/div/mul/add/round sont IEEE-exacts partout, ne pas y toucher.
    Verrou : `workers/nesting/bench/determinism_lock.py` (SHA-256 natif vs
    wasm, tolérance 0) — à rejouer après tout changement de ce périmètre.
14c. **wasm32 : horloge et threads** — `web_time::Instant`
    (jagua l'expose) sur `performance.now`, et **jamais** de soustraction
    naïve `Instant::now() - d` (l'horloge démarre à 0 au chargement →
    underflow/panic : `checked_sub` saturant, voir `progress.rs`). rayon =
    panic au spawn : chemin séquentiel partagé natif-1T/wasm (jagua vendored
    en import mono-thread, pool sparrow off si `n_workers<=1`, `map_workers`
    dans nest-engine). La forme navigateur = **mono-walk**
    (`n_workers=1`, `separator_workers=1`, 1 direction) — identique au
    profil démo produit.
14d. **Verrou latéral sub-mm sur grille serrée** : à space 2 mm, les gaps
    réels du solve tombent à ~1,998 mm → les shapes inflatées (±1 mm) se
    chevauchent de ~0,002 mm et TOUTE sonde verticale à x fixe collisionne
    (tighten/gravité no-op sur un trou interne de grille) ; pire, les
    fenêtres x valides ligne à ligne peuvent être disjointes (chicane).
    Les moves post-pass sont des téléportations : sonder la cible exacte
    via la fenêtre latérale calculée sur le span de destination
    (`settle_with_lateral_window` dans `column_fill.rs`), jamais un settle
    à x unique. Et gardes **granulaires par sous-passe** : une garde
    globale multi-passes jette le travail d'une passe réussie pour la
    régression d'une autre (restore pixel-identical — la cause réelle des
    « même DXF après plusieurs déploiments » de PACKING-X-100-TROU.md).
    Un restack accepté sans exiger des colonnes compactes commit des
    layouts troués (métriques de sommets aveugles aux trous internes).
14e. **La forme des couloirs est un post-pass, pas une métrique solveur** :
    à largeur égale, le SPP ne distingue pas [19×5+5] de [17×4,16×2] — le
    moignon survit au champion lock. `balance_lane_tops` (column_fill.rs)
    équilibre UNIQUEMENT sur grille uniforme détectée (lanes équidistantes
    ±0,1 mm, cellules identiques, colonnes compactes) et seulement si
    l'écart de comptage > 1 cellule (sinon no-op — [1,2] est déjà
    équilibré). Append au sommet des couloirs courts, jamais d'insertion,
    jamais d'élargissement ; cible canonique = comptages base/base+1 avec
    les cellules en plus à gauche. Piles J-085 déplacées COMPLÈTES (hôte +
    nichés, même delta — holesFilled intact). Corollaire shape : jagua
    CENTRE SUR LE CENTROÏDE, pas la bbox — placer un hôte non symétrique
    via translation = centre bbox le décale (le filler logé « à vue » dans
    la cavité finit dans la paroi → infaisable) : relire la bbox posée.
14f. **Snap des lanes = DERNIER recours, jamais par défaut** : un snap
    systématique retouche (churn µm) des layouts que tighten fermait déjà
    (panne no-op constatée sur 40/50 seeds). Ne le déclencher que si un
    défaut persiste après tighten+consolidate (`has_column_defect`), puis
    re-tasser. La respiration (+ε par gap) n'est engagée que si le pitch
    moyen est quasi au contact (≤ 0,5 µm de marge) ; sinon step = pitch,
    zéro élargissement.
14g. **Frames live = convention EXTERNE (source), jamais interne jagua** :
    `emit_layout` (progress.rs) sérialise `int_to_ext_transformation`
    comme `export_layout_snapshot` — une frame interne (ancrage centroïde)
    décale toute pièce non centrée à l'origine de R(θ)·(−centroïde) dès
    qu'un consommateur reconstruit un résultat depuis la frame (panne prod
    100+800 en mode local : Piece_Fillx4, centroïde +17,66 mm, amas de
    fillers hors tôle ; les hôtes centrés étaient immunisés). Le map-back
    phase 2 `(x,y)->(H−y,x)`, rotation inchangée, s'applique à la transform
    EXTERNE (world = R(+90°)∘world' ⇒ θ conservé même asymétrique). Règle :
    jamais de placed_items live vers l'export sans int_to_ext. Verrous :
    `live_frame_matches_final_export_asymmetric` et
    `live_frame_map_back_matches_phase2_export` (progress.rs) — frame ≡
    export final à l'arrondi d'impression près, pièce asymétrique.

### Métriques & pipeline Python
15. **largest_empty_rectangle : compter les sommets DES TROUS** dans le
    budget exact (anneaux 64-gons → le scan explose, worker bloqué des
    heures). Budget : 60 pièces / 600 sommets (outer+holes), garde-fou
    grille 40 000 → repli band offcut (exact pour les chutes en bande).
16. **Seed Mongo = BSON Int64** : sérialiser en `toString()` côté API,
    sinon `{low, high, unsigned}` à l'écran.
16b. **Seeds 63 bits côté JS : BigInt ou string, JAMAIS de JSON.parse nu** :
    `JSON.parse` arrondit tout entier > 2^53 (un seed `…84961` devient
    `…84900`) — tie-breaks et replay dérivent silencieusement. Pool
    J-093 : seeds calculées en BigInt (`localPool.deriveSeed`), réécrites
    en string sur les runs du merge (le JSON.parse du worker les mangle) ET
    re-patchées depuis la string brute de sortie du merge ; `prng_seed` du
    merge est un placeholder 0 (le parse EngineConfig exige u64 — la string
    63 bits serait manglée en number). Tout nouveau passage de seed par du
    JSON JS doit garder la forme string.
17. **Le seed déterministe exclut la config** (instance+space+budget) :
    modifier `config.json` ne change PAS le seed → A/B à seed égal
    gratuits.
18. **Le worker `$unset` doit couvrir tout champ éphémère** (progress,
    liveLayout, itemMap, compute) à la fin du job.
19. **`docker rm -f` = SIGKILL** : le handler SIGTERM du worker_loop ne
    s'exécute pas → job orphelin « processing » + lease de jetons bloquée
    (reaper après 60 s). Préférer `docker stop`.
19b. **Densité du rapport = aire vraie des pièces placées / aire tôle,
    MESURÉE** (`per_sheet_metrics`, polygones placés trous soustraits) —
    jamais la density déclarée par le moteur, jamais un bbox. Les champs de
    rapport sont ADDITIFS (`report.sheets[]`, `report.totals{}`,
    `report.offcut` enrichi) : aucun champ existant renommé/supprimé, les
    anciens jobs gardent l'affichage legacy. Chute « réutilisable » si
    min(w,h) ≥ `OFFCUT_REUSABLE_MIN_MM` (100 mm) — conservateur (« au
    moins »), l'offcut est le plus grand rectangle vide GARANTI.

### Frontend
20. **Apostrophes françaises dans i18n.js** : utiliser des doubles quotes
    pour les chaînes contenant `'` (sinon PARSE_ERROR au build).
20b. **SVG y-down vs moteur y-up : le flip est OBLIGATOIRE** — tout rendu de
    placements (live view, SVG résultat coloré) doit dessiner avec
    `translate(x, H-y) scale(1,-1) rotate(θ)` (les coords jagua/DXF sont
    y-up). Sans le scale, la feuille entière est MIRÉE verticalement par
    rapport à la vue DXF (rotate SVG horaire = rotation moteur anti-horaire
    une fois flippée — la formule est exacte, verrou :
    `test_svg_colored.py::test_transform_matches_the_production_dxf`).
21. **`var(--background-secondary)` est sombre** dans ce thème : ne jamais
    compter sur les vars de thème pour un canvas lisible — palette
    explicite (fond clair, pièces accent, texte foncé).
22. **Ids SVG uniques par instance** (clipPath) : plusieurs visualizers sur
    la même page.
23. **`$fetch` en auto-import Nuxt, jamais via `useNuxtApp()`** : 
    `nuxtApp.$fetch` peut être undefined → le fetch échoue dans le
    try/catch, le cache géométrie reste vide et **aucune pièce ne se
    dessine** (bug muet, vu en prod).
24. **Toute stat affichée porte un libellé visible** (« 144 M combinaisons »,
    « ×4 cœurs ») — un nombre nu (« 37.6 M », « ×4 ») est
    incompréhensible. Et le texte sur fond foncé utilise des couleurs
    explicites (#eef2f7 / #b8c2d0 / #6ea8ff), jamais les vars de thème
    (bleu sur bleu marine ici).
24b. **Stats live en Mode Local = forwarding explicite** : engine.worker.js
    ne poste au thread principal QUE les types d'événements explicitement
    routés (layout, evals/heartbeat) — un nouveau type d'événement moteur
    est droppé silencieusement et la stat correspondante ne s'affiche
    jamais en local (le chemin serveur, lui, lit tout : l'écart passe
    inaperçu tant que le local n'est pas le défaut). L'agrégation pool =
    **banque anti-reset PAR SLOT** dans localPool.js (le compteur wasm
    repart à zéro entre phases — miroir navigateur du #10). Et la page
    doit fournir des `compute`/`progress` synthétiques à LiveNestingView :
    ils étaient `null` en local → compteur de combinaisons et ×N cœurs
    jamais visibles (constat 2026-08-12, la vue SSE avait tout).

### Unités (mm canonique + inches)
25. **mm canonique interne, conversion aux 3 frontières seulement** :
    import DXF (`$INSUNITS` → mm dans `dxf_utils.read_dxf_file`), UI
    (display/saisie via `app/utils/units.js` + `useUnit`), export DXF
    (`params.outputUnit` écrit serveur). Jamais d'unité dans le pipeline,
    le moteur ou Mongo.
26. **Import = decompose PUIS scale** : `recursive_decompose` d'abord (les
    INSERT de blocs sont résolus en primitives), `Matrix44.scale(f,f,1)`
    ensuite — scaler le modelspace avant decompose laisserait les
    définitions de blocs non scalées (verrou : `test_dxf_units.py`).
27. **`ezdxf.new()` déclare des MÈTRES** (`$INSUNITS=6`) : tout doc reconstruit
    doit poser `$INSUNITS=4` + `$MEASUREMENT=1` explicitement. Les copies
    pipeline (bucket validDxf) sont déjà en mm — les relire avec
    `normalize_units=False` (les copies pré-feature déclarent 6 avec du
    contenu mm : re-normaliser = ×1000).
28. **Export = pleine précision + en-têtes cohérents** : ×1/25,4 exact,
    `$INSUNITS=1` + `$MEASUREMENT=0` pour les pouces. Zéro arrondi
    géométrique ; le 0.001" est une affaire d'UI uniquement.
29. **Env nitro : `NUXT_PUBLIC_FOO_BAR` → `public.fooBar`** — la clé config
    doit matcher le nom camelCase COMPLET de la variable
    (`NUXT_PUBLIC_UNIT_SWITCH_ENABLED` → `unitSwitchEnabled`, pas
    `unitsEnabled`). Et l'override runtime arrive en **string** (`'true'`),
    jamais en booléen : tester `=== true || === 'true'`.
29b. **Une clé partagée serveur+client exige DEUX mappings ou une vérité
    serveur** : `NUXT_ADMIN_LAN_OPEN` ne mappait que la clé PRIVÉE — le
    garde client (clé publique restée false) croyait le mode sécurisé et
    bouclait /setup ↔ / à l'infini (needsSetup + admin virtuel `lan`),
    page jamais hydratée, clics morts (panne prod 2026-08-12, fiches users
    inaccessibles). Règle : le garde côté client doit trancher sur la
    **réponse du serveur** (`/api/auth/me` renvoie l'admin `lan`) et/ou
    miroir `NUXT_PUBLIC_*` explicite dans compose. Corollaire :
    `runtimeConfig.public` est **figé** en Nitro récent — un plugin qui
    assigne `config.public.x = …` crash le boot (Cannot assign to read
    only).
29c. **Alias `~~/shared` sur Windows hôte** : Nitro réécrit trop de `../`
    et résout `C:\Users\…\shared\…` (module introuvable, boot mort).
    Imports serveur = chemins relatifs ; `nuxt.config.js` déclare
    `#shared` / `~~/shared` + `nitro.externals.inline` pour
    `shared/constants`. Les SFC Vue gardent `~~/shared` (le build
    Docker Linux casse si on les convertit en relatifs trop profonds).
30. **`watch` dans un composable singleton = scope du 1er appelant** : il
    meurt au démontage du composant (changement de layout à la navigation)
    et un garde `initialized` empêche toute réinscription → enregistrer le
    watch dans un **plugin** (scope app, immortel, `app/plugins/*.client.js`)
    et sourcer `useNuxtData('user')` (cache hydraté, réactif) plutôt qu'un
    store alimenté par middleware. **La persistance aussi** : le PATCH de
    préférence doit se conditionner à `useNuxtData('user').value?.id`, pas à
    `authStore.userIsSet` — sur un chargement SSR frais le store client
    démarre à `false` tant que le middleware n'a pas rejoué `setUser`, un
    switch rapide perdait le PATCH et le watch DB ramenait l'unité à
    l'ancienne valeur (flip-flop pouces→mm quelques secondes plus tard).

### Formats d'import (DXF + SVG + DWG)
31. **Détection par signature de contenu, JAMAIS par extension** : les slugs
    d'upload finissaient historiquement tous en `.dxf` quel que soit le
    format réel — `core/format_detect.py` lit les magic bytes (`<svg`,
    `AC10xx`), point d'injection unique `_make_dxf_copy`. La copie
    `validDxf` est TOUJOURS un DXF mm : tout l'aval est format-agnostique.
32. **SVG = px CSS 96 dpi → mm (formule unique)** : svgelements normalise
    unités/viewBox/transforms en px ; `mm = px × 25,4/96` couvre mm/in/px et
    viewBox mismatch (verrou : `test_svg_import.py`). y SVG inversé → y DXF.
    Segments droits = 2 points (sinon un rectangle = 1500 sommets, piège #15).
33. **DWG via `dwgread` (GNU LibreDWG, GPL v3) en subprocess** — jamais de
    linkage, jamais de binaire modifié (mere aggregation, voir
    `docs/dwg-license.md`). R2013+ expérimental → rejet propre avec message
    actionnable, jamais d'import partiel silencieux.
33b. **Import 100 % client (J-090) — deux verrous contre-intuitifs** :
    (a) les **handles canoniques = séquence ezdxf FRAÎCHE** (`2F, 30, 31…`) :
    `read_dxf_file` REBUILD le doc (`entity.copy()` jette le handle source,
    `EntityDB.add` réassigne en séquence hex uppercase) — la « préservation »
    des handles est une coïncidence des copies déjà pipeline ; les entités de
    blocs décomposés prennent les handles frais dans l'ordre d'explosion
    (verrou : `nest-import/tests/handles_canonical.rs`, sweep corpus 41/41) ;
    (b) le **seed canonique JS ≠ Python** : un float intégral s'écrit `1000`
    en JS vs `1000.0` en Python → le seed du flux navigateur est déterministe
    EN LUI-MÊME (le seul pertinent — un projet local ne croise jamais le
    pipeline serveur), mais ne reproduit pas le seed worker à géométrie
    identique. Et : le worker géométrie importe des symboles NOMMÉS du
    bundle wasm — ajouter une op = rebuild `build-wasm.sh` DANS LA MÊME PR,
    sinon worker mort au chargement.

### Server (quotas & promo)

34. **Toute limite user-specific passe par un resolver dans
    `entitlement.js`** — jamais de lecture directe de `FREE_NESTING_LIMIT`
    hors resolver. `effectiveFreeLimit(user)` = snapshot `user.promo` si
    `isPromoActive(promo)` (limite entière > 0 ET campagne non expirée),
    sinon défaut ; les projections Mongo doivent inclure `promo` en entier
    (limit + expiresAt — sinon la majoration est silencieusement ignorée).
    Le snapshot suit la **fin de campagne du code** : la reconduire côté
    admin propage la nouvelle date à tous les bénéficiaires ; promo expiré
    → retour à 10/mois et re-redeem d'un autre code possible. L'ordre de
    charge (grant → abonnement → quota free) prime toujours. Verrous :
    `server/tests/entitlement.test.js`, `server/tests/promo.test.js`
    (`npx vitest run`).
34b. **`crypto.createECDH('secp256r1')` peut jeter `ERR_CRYPTO_INVALID_CURVE`**
    (alias absent de certains builds OpenSSL 3.5, vu sur Node 24 Windows) →
    toujours fallback `prime256v1` (même courbe NIST P-256, format wire
    identique) — helper `createP256Ecdh` (`job-dek.post.js`,
    `verify_jobdek.mjs`). Et **QA curl d'un nesting SERVEUR = tier payant
    obligatoire** : un compte Free est routé `awaiting_local` (calcul
    navigateur), aucun worker ne produit de résultat — granter
    `grantedUntil` en base avant le scénario (verrou D-PRV-7 :
    `scripts/validate_vault_dprv7_e2e.sh`).
35. **Stratégie & tiers : `docs/STRATEGY.md` fait foi** (marqueurs
    `[prod]`/`[spéc]`/`[conditionnel]` — ne jamais marquer `[prod]` du
    non-livré). La privacy n'est **jamais une feature payante** : le vault
    ZK est opt-in sur TOUS les plans — le gate `hasPrivacyTier`
    (tier `privacy` requis) est legacy, son retrait est un chantier Phase 1.
    Pro 39 € = budget moteur max + file prioritaire ; le moteur n'est
    dégradé pour personne (le budget temps est le luxe Pro, pas la qualité
    de base). Toute revendication publique = feature flag vérifié en prod
    avant publication ; les promesses privacy exactes par mode (Local /
    Serveur / Vault ZK) sont dans `docs/THREAT-MODEL.md` — ne jamais
    promettre « nous ne pouvons pas vous lire » en mode serveur.
36. **Purge GridFS = delete par bucket, jamais un TTL seul** : un index TTL
    sur `<bucket>.files` supprime le doc mais laisse les `.chunks`
    orphelins. Le sweeper 24 h (`server/features/purge/sweep.js`, plugin
    `server/plugins/purge.js`, D-PRV-10) passe par `bucket.delete(_id)` et
    marque `purgedAt` les docs job/fichier (l'UI affiche « expiré » et
    masque les téléchargements ; les scalaires du rapport persistent).
    Exemptions : vault = `metadata.enc` (blob) / `encPolygonParts` (doc),
    démo = `ownerId 'demo'`. Verrous : `server/tests/purge.test.js`.
36b. **Plugins Nitro de démarrage (dev hôte Windows)** : pas d'alias `~~/`
    dans le code chargé par un plugin au boot (imports relatifs, pattern
    `4_demoProjectSeed.js` — sinon « Cannot find module 'C:\shared\…' » en
    dev), et **jamais de timer `unref`** (la boucle d'événements du worker
    dev se vide → « worker exited with code 0 »). Le flow docker/prod ne
    montre aucun des deux — seul le dev hôte les révèle. Et cargo :
    `panic = "abort"` en profile.release est redondant pour wasm32 (défaut)
    et casse `cargo test --release` natif dès qu'un test d'intégration
    (tests/) existe — ne pas le remettre (workers/geometry).
37. **Grant admin à tier variable (D-PAY-11)** : `grantedUntil` +
    `grantedTier` ('standard'|'privacy', absent = 'standard' — les grants
    historiques sont inchangés). Un abonnement Stripe actif prime TOUJOURS
    sur le grant (ordre de charge, #34). `free-month` écrase `grantedTier`
    à 'standard' pour ne pas laisser survivre un Pro de test. Résolution
    unique dans `getComputeTier` (projection Mongo incluant `grantedTier`).
    Verrous : `server/tests/entitlement.test.js` (5 cas grant tier).
38. **Chaîne « email fin de nesting » inatteignable** (constat 2026-08-12) :
    `emailNotify: 'need_notify'` n'est produit QUE par
    `nest/[slug]/notify.post.js` (zéro appelant nulle part) → le plugin
    `2_nest-notify` ne déclenche jamais, alors que pricing/STRATEGY
    annoncent les notifications email en paid. À trancher par le
    propriétaire : recâbler (statut posé à l'enqueue selon le tier) ou
    retirer le claim + les 3 maillons.

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
npx vitest run                                             # server (33)
cd workers/nesting/engine && cargo test --release          # 64 + 1 ignore
cd workers/nesting && python -m pytest tests/ -q           # 70 (PYTHONPATH=workers/common)
cd workers/common && python -m pytest tests/ -q            # 46
cd workers/fileprocessing && python -m pytest tests/ -q    # 32 (+2 skipped)
npx nuxt build                                             # app
cd nestorcut-website && npm run build                      # site marketing
```

Benchmarks ESICUP (lents) : `pytest benchmarks/test_benchmarks.py -m slow`.
Harnais A/B warm-start : `cargo test --release warm_start_160_ab -- --ignored --nocapture`.

## 6. Conventions

- **Branding : NestorCut = produit, APlasma = entité légale** (Guillaume
  Jerke EI — encaissements Stripe, mentions légales, factures, fiscalité).
  APlasma ne disparaît JAMAIS des contextes légaux/paiement ; la brandLine
  officielle est « NestorCut by APlasma » (`data/siteConfig.js`). Le nom de
  produit seul (NestorCut) s'emploie partout ailleurs.
- Commits en français, conventional commits (`feat(nesting): …`), petits et
  par phase. Ne jamais committer le travail non sollicité des autres
  (vérifier `git status` avant `git add -A`; préférer des adds ciblés).
- **Code mort déclaré par un agent ⇒ sweep résiduel avant suppression** :
  le grep de vérification doit couvrir `scripts/`, les tests et `workers/`
  — pas seulement le périmètre confié à l'agent (`fingerprint_key` marqué
  mort alors que `scripts/crypto-interop/verify_vector.py` l'importe,
  audit du 2026-08-12).
- `main` direct (petit projet), merge requests pour les grosses branches.
- i18n : `app/utils/i18n.js` (EN+FR, dict plat) ; site : `src/i18n/ui.ts`.
