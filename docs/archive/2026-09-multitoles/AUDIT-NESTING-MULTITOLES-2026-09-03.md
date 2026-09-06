# Audit complet du nesting multi-tôles (BPP) — 2026-09-03

Demande : « j'ai des bugs dans le nesting sur plusieurs tôles que je n'arrive
pas à résoudre ». Cas de référence : 100 × `Piece_Trou` + 800 × `Piece_Fillx4`
(`.testparts/`), 2 tôles 1000×1000, directions `['left']`, « Nest parts inside
holes » ON, space 0,1 et 2 mm, testé en serveur ET en navigateur (THIS DEVICE).

Périmètre audité : moteur Rust (`nest-engine` BPP + jagua vendorisé + sparrow),
chaîne Python (`core/main.py`, `holefill.py`, `residual.py`, `structure.py`,
`metrics.py`, `placement.py`), miroir JS navigateur (`residualClient.js`,
`localBridge.js`, `structureClient.js`, `localPool.js`, `localJobPrivate.js`,
`liveJob.js`, finalisation locale). Code audité = copie de travail du 03/09
(HEAD `10045ad` + modifications non commitées « poches BPP » du 02/09, présentes
dans les images Docker locales — vérifié par diff conteneur ↔ copie de travail).

Le plan d'exécution qui en découle : [`PLAN-NESTING-MULTITOLES-2026-09-03.md`](PLAN-NESTING-MULTITOLES-2026-09-03.md).

## 0. Verdict en une page

**Sur le corpus 100+800 à space 0,1 et 2, le code actuel ne produit plus de
chevauchement**, ni côté serveur ni côté navigateur (vérification shapely
exhaustive, 4 runs de 900 pièces — §1). Les bugs « que je n'arrive pas à
résoudre » sont de quatre natures, et c'est leur combinaison qui les rend
insaisissables :

1. **Le filet de vérification est muet exactement sur ce cas.** Au-delà de
   250 pièces par tôle, `verify_layout` (Python) et `nest-report` (wasm) ne
   mesurent ni chevauchements ni espacement (`overlapFree`/`spacingOk` =
   `null`, aucun badge). La garde anti-perte ne compte que le total : deux
   pièces à la même pose passent. Un post-pass qui échoue fait un rollback
   silencieux (Python) ou laisse un état partiel silencieux (JS). **Tant que ce
   filet n'existe pas, chaque correctif est validé à l'œil et chaque régression
   est découverte par l'utilisateur.**
2. **La vue live ment, des deux côtés.** Le sélecteur de frame BPP préfère le
   **plus petit** `remnant` (le sens est inversé par rapport au moteur, et un
   test verrouille le mauvais sens), et la frame finale post-passée n'est
   **jamais** affichée (elle n'a pas de `remnant`, donc perd toujours contre
   le champion moteur). Le panneau live termine sur une frame moteur dentelée,
   non compactée ; le modal montre autre chose. C'est une grande part du
   « manque de compaction » et de « vue incohérente » perçus.
3. **Trois bugs bloquants de correction physique subsistent, hors du corpus
   testé.** Python : à space 0 la validation du post-pass n'exclut plus rien
   (3 136 chevauchements mesurés) ; le rollback de la compaction restaure un
   état où les hôtes re-grillés recouvrent les pièces libres d'origine dès
   qu'une libre est irremplaçable (3ᵉ classe, rotation verrouillée, pièce
   large). JS : toute rotation qui n'est pas un quart de tour est traitée comme
   270° dans la **validation** (rotationCount 3, 6, 8… autorisés par l'UI) →
   poses réellement chevauchantes acceptées, navigateur seulement. Aucun ne se
   déclenche sur « 2 classes, 4 rotations, space > 0 » — d'où des tests verts
   et des jobs réels qui cassent.
4. **La cause racine de la mauvaise qualité multi-tôles est dans le moteur.**
   Le constructif choisit la tôle par « croissance d'AABB absolue » et le biais
   −X pénalise davantage la tôle pleine : rejoué sur le payload utilisateur, il
   laisse la tôle 1 avec 80 hôtes + **8** fans et empile 591 fans sur la tôle 2.
   Le recuit est inerte (4 améliorations, toutes dans la 1ʳᵉ seconde ; 200
   itérations puis arrêt plateau sur tous les runs) et il perd un hôte par tôle
   (80 au lieu de 81, pas final de descente 0,1 mm — visible en navigateur).
   Les six post-pass empilés depuis fin août rattrapent ce résultat ; chacun
   ajoute sa surface de bugs et ses seuils (trois tolérances différentes
   Python / JS / lattice ; côté JS la marge de validation est 1e-9 à space 0,1).

Ordre recommandé : filet + vue live (phase 0), correctifs bloquants Python et
JS (phase 1), moteur (phase 2), puis **retrait** progressif de post-pass au lieu
d'en ajouter (phase 3). Détail dans le plan.

## 1. Méthode et preuves

| Preuve | Où |
|---|---|
| Banc serveur, image locale = copie de travail, space 0,1 et 2 (jobs `bench-bpp2s-1-1788460125`, `bench-bpp2s-20-1788460129`) | `bench/seed_bpp_2sheets.py`, `bench/check_physical.py` |
| Navigateur Playwright (projet THIS DEVICE, import wasm, solve wasm 8 walks, space 0,1 et 2) | `scripts/qa-e2e-local-2sheets.mjs` (nouveau) ; SVG IndexedDB vérifiés par `bench/check_svg_dir.py` (nouveau, parse générique des `<path d>`) |
| Rejeu moteur du payload utilisateur exact (`bench/out_user_payload.json`, release, 1 walk, 25 s) | §3 |
| Chemin JS complet sur la fixture user (`out_user_payload.json` + `out_user_layouts_pre.json`, 999 fans) | §6 |
| Tests ad hoc shapely sur la copie de travail (space 0, rollback H1, corpus user-like à 4 espacements) | §4 (scripts dans le dossier de job — à réintégrer en pytest, plan B1) |
| Rendus PNG des 4 runs + captures navigateur | `docs/qa/audit-multitoles-2026-09-03/` |

Physique mesurée (polygones réels, trous soustraits, STRtree) :

| Run | Tôle 1 | Tôle 2 | Chevauch. | Hors tôle | min-dist | used | Chute tôle 2 |
|---|---|---|---|---|---|---|---|
| Serveur 0,1 | 81 hôtes + 508 fans (81,1 %) | 19 + 292 (29,7 %) | 0 | 0 | 0,0996 | 0,694 | 580×1000 |
| Serveur 2 | 81 + 474 (79,0 %) | 19 + 326 (31,7 %) | 0 | 0 | 2,0000 | 0,727 | 522×1000 |
| Navigateur 0,1 | 81 + 510 (81,2 %) | 19 + 290 (29,5 %) | 0 | 0 | 0,1000 | 0,695 | 580×1000 |
| Navigateur 2 | **80** + 478 (78,6 %) | **20** + 322 (32,1 %) | 0 | 0 | 1,9997 | 0,727 | 522×1000 |

Tous les runs : `iterations = 200` (arrêt au plafond minimal du plateau),
`overlapFree = null`, `spacingOk = null`.

## 2. La chaîne BPP telle qu'elle est

```
main.py
 ├─ pré-passe trous (holefill.plan_hole_fills → reduce_for_solve) : 100 hôtes FERMÉS + fans libres
 ├─ nest-engine BPP (8 walks) : sa::anneal → constructive::construct (best-fit inter-tôles) → merge_bp_runs
 ├─ expand_meta : rattache 4 fans figés à chaque hôte posé
 ├─ apply_hole_fill (par tôle) : recomplète les trous vides avec des libres
 ├─ fill_residual_bands (≥ 2 tôles) :
 │    ├─ bandes résiduelles des tôles receveuses ← libres de la donneuse (small_lattice)
 │    └─ _compact_last_sheet(donneuse) : _regrid_helices (hôtes + nichées en colonnes −X)
 │         puis libres → poches des colonnes partielles → bandes classiques (gravité −X)
 ├─ parse_result_containers → verify_layout (plafond 250 pièces/tôle) → export DXF/SVG
 └─ tri des alternatives, écriture Mongo
navigateur : même séquence en JS (localBridge → residualClient / structureClient),
             sur le THREAD PRINCIPAL, résultat en IndexedDB, POST de scalaires (local-quota)
```

Identité d'une tôle = index de `layouts[]` ; `container_id` = format. Repère
partagé (0,0)-(w,h) pour toutes les tôles (piège #52).

## 3. Moteur Rust (nest-engine BPP)

Rejeu du payload utilisateur : **tôle 1 = 80 hôtes + 8 fillers**, AABB
901×905, bande en L ≈ 184 000 mm² vide ; **tôle 2 = 20 hôtes + 591 fillers** ;
119 itérations en 25 s (~210 ms/it), 4 améliorations toutes à `elapsed_sec: 0`.

| Id | Sév. | Fichier:ligne | Constat | Correctif |
|---|---|---|---|---|
| **C1** | Bloquant (qualité) | `bpp/constructive.rs:179-188, 253-274` | Best-fit **inter-tôles** sur des pertes absolues (`growth` mm² + `bottom_left` en coordonnées absolues) : une poche à x=800 de la tôle 1 perd contre n'importe quel point à x<80 de la tôle 2. C'est la migration des petites pièces vers la dernière tôle (piège #51) — tout le post-pass résiduel existe pour rattraper ça. | Décision lexicographique **par tôle** : (1) pose à `growth == 0` sur la tôle la plus ancienne qui en offre ; (2) sinon first-fit sur la tôle la plus ancienne qui admet l'item ; pertes comparées seulement intra-tôle. |
| **C2** | Majeur | `constructive.rs:63, 107-117, 185` | `steer = 1 + 1,5·x_max/bin_w` en ratio **absolu** : la tôle pleine (x_max 900) est pénalisée 1,8× plus que la fraîche. Sous `['left']` la migration est maximale. | Steer sur le Δ d'extent `(merged.x_max − used.x_max)/bin_w`, ou steer intra-tôle seulement. |
| **C3** | Majeur | `bpp/sa.rs:237-263` | Items du même type indiscernables : swap/reverse entre fans = no-op (~73 % des moves) ; `construct` stochastique → le SA ré-évalue la même séquence avec un autre tirage (multi-start bruité). | Moves *type-aware* (positions d'ids différents, séquence compressée en blocs), rng d'évaluation dérivé de `(seed, hash(seq))`. |
| **C4** | Majeur | `sa.rs:102-125` | `remnant` = **moyenne** des bandes par tôle : neutre à la concentration de la chute. Falkenauer 4ᵉ critère jamais décisif. | `(unplaced, bin_cost, −max_remnant, −Σ fill²)` ; à terme plus grande zone libre intérieure. |
| **C5** | Majeur si 2 formats | `constructive.rs:277-291` | Ouverture d'un bin = premier type (id croissant) où l'item tient : coût et adéquation ignorés, le SA ne peut pas l'influencer. | Évaluer tous les types avec stock, `min(cost, loss)`. |
| **C6** | Majeur | sparrow `consts.rs:23`, `search.rs:91-101` | Pas final de descente = 0,001×min_dim = **0,1 mm** pour un hôte de 100 mm : colonnes à 50,1/150,2/250,4… (dérive +0,1/colonne), y_max 904,76, **80 hôtes au lieu de 81** (9×100,1 = 900,9 tient). Vu en navigateur (`navigateur-space2-tole1.png` : une cellule de la grille perdue, 8 fans en vrac dedans). | Pas final absolu `min(0,001×min_dim, 0,01 mm)` ou compaction par tôle après le constructif (équivalent BPP de `gravity.rs`). |
| C7 | Mineur | `sa.rs:212, 228-234` | `MIN_ITERS_BEFORE_PLATEAU = 200` × 210 ms = 42 s incompressibles ; non calibré à n. | Seuil temps/taille. |
| C8 | Mineur | `sa.rs:266-272` | Température au temps mur : même seed ≠ même run selon la charge (commentaire « deterministic per worker » faux hors `sa_max_iterations`). | Documenter ou schedule par itérations. |
| C9 | Mineur | `constructive.rs:200-211` | `pick_host` = dernier hôte d'aire max : les 100 échantillons focalisés tournent autour du même hôte même trou plein (chemin canal). | Hôte aléatoire / le moins rempli. |
| C10 | Mineur | `sa.rs:149-155` | Warm-start validé en longueur seule ; id hors plage → panic dans rayon → abort sans JSON. | Valider ids et multiplicités. |
| C11 | Mineur | `bpp/mod.rs:146-176` | Frames live non throttlées (30 Ko par amélioration + 1 Hz) ; SPP throttle 500 ms. | Même throttle. |
| C12 | Mineur | `mod.rs:85-88` | Champ live `bins` = `bin_cost` (coût), pas nombre de tôles. | Exporter les deux. |
| C13 | Mineur | jagua `probs/bpp/io/import.rs:33-63` | Une tôle `count: 0` au milieu de la liste → « consecutive IDs » opaque ; pas de garde Python. | Filtrer/renuméroter côté builder. |
| OK | — | — | Identité des bins (SecondaryMap, ordre d'ouverture, jamais de remove) cohérente live/coût/export ; stock respecté ; merge/wasm en parité ; `cmp_key`/`Move::revert` corrects ; **f32 hors de cause** (min-dist mesurée 0,10000, déficit ≤ 5e-6). | Verrou T1 (ordre des bins) à ajouter quand même. |

## 4. Post-pass Python

Suite existante sur la copie de travail : 97 passed, 2 skipped. Corpus
user-like (100 hôtes 81+19, 400 nichés, 335 libres) : propre à space 0,1 / 1 / 2.

| Id | Sév. | Fichier:ligne | Constat | Preuve | Correctif |
|---|---|---|---|---|---|
| **A1** | **Bloquant** | `residual.py:221` `_validate_batch` | À space 0, `distance < space − 1e-6` est toujours faux → **aucun rejet** ; seule la couverture tôle reste. Miroir exact du piège #56 corrigé en JS (`residualClient.js:203`), absent en Python. `space = 0` est accepté par l'API (`nest.post.js:203`). | Pose identique validée `True` ; corpus user-like à space 0 : **3 136 chevauchements, 191 poses dupliquées**, tout le stock dans x∈[0,200]. Comptes exacts → garde muette. | `d < max(space − ε, 0) or (d == 0 and intersection.area > OVERLAP_EPS)` ; verrou « paires à distance 0 sur chemin multi-itérations » côté Python. |
| **A2** | **Bloquant** | `residual.py:514-575` `_compact_last_sheet` | `_regrid_helices` déplace les hôtes **sans valider contre les libres** ; `fans_snapshot` pris APRÈS ; libres non re-posables → restaurées → validation → échec → rollback sur `fans_snapshot` = hôtes re-grillés **sur** les libres d'origine, retourné avec `moved > 0`. Le JS a exactement la même structure. | Fixture 19 hôtes + 1 pièce 700×500 rotation `[0]` + 120 fans : **47 chevauchements (space 0,1), 62 (space 2)**, `mind = 0`, hôtes à 50,1/150,2 (re-grillés), grande pièce à sa pose d'origine sous la grille. Log « residual-band pass moved parts », alternative exportée. | Snapshot **avant** le re-grid ; sur rollback restaurer tout et `moved = 0` ; ou détacher les libres avant le re-grid et valider la restauration contre l'état complet. Se déclenche dès qu'une libre est irremplaçable (3ᵉ classe, rotation verrouillée, pièce large, receveuses pleines). |
| **A3** | Majeur | `metrics.py:305, 389-391` ; `nest-report/lib.rs:303` ; `ResultModal.vue:709-714` | Plafond `VERIFY_MAX_PARTS_PER_SHEET = 250` → `overlapFree`/`spacingOk`/`smallestGapMm` = `None`, **aucun badge**. Le corpus fait 300-600 pièces/tôle. | Tous les runs de cet audit, y compris la tôle à 3 136 chevauchements. STRtree vérifie 900 pièces en ~0,1 s. | Passe par paires avec STRtree (Python) / broadphase bbox (Rust), plafond ≥ 5 000 ou supprimé ; sinon au minimum `verifyStatus: 'skipped'` visible. |
| **A4** | Majeur | `main.py:1448-1455` | Garde anti-perte = total seulement ; doublons et pertes compensées passent. Côté JS, pas de garde du tout sur les alternatives moteur (D13). | 191 doublons livrés. | Compte **par item_id** vs `count` + rejet (ou badge) si `verify_layout` voit chevauchement/doublon. |
| **A5** | Majeur | `residual.py:571-575, 626-631` | `except Exception` → rollback silencieux ; `_CompactRollback` silencieux ; rien dans `report`. | Lecture. | `report.postPass = {residualMoved, residualError, compactRollback}` (additif, piège #19b). |
| A6 | Majeur | `residual.py:379-478` | Cause racine de A2 : le re-grid ne valide que hôte↔hôte ; le pass dépend de la re-pose de 100 % des libres. | H1. | Idem A2. |
| **P1** | Majeur (qualité) | `residual.py:437-450` (`pocket = (…, top + space, x1, sh − space)`) | La poche de la colonne partielle monte jusqu'au **bord de tôle** : une fois remplie, l'AABB atteint y≈990 et la bande haute au-dessus des colonnes pleines (x∈[0,200] × y∈[900,1000]) devient une bande de 10 mm → jamais remplie. | Visible sur les 4 rendus tôle 2 (coin haut-gauche blanc, ≈ 20 000 mm² ≈ 25-30 fans, front −X reculé d'autant). | Clipper la poche à `top = max y des colonnes pleines` (la bande haute reste une bande classique pleine largeur), ou remplir la bande haute AVANT la poche (gravité −X : x0 = space < x0 poche). |
| **P2** | Majeur (qualité) | `structure.py:_lattice_rotated` (`nx = x0 + w − fy − rcx`) ; miroir `structureClient.js:latticeRotated` | La famille tournée 90/270 est ancrée à **droite** du rect. Dans une bande étroite où elle gagne par le compte (bande droite de la tôle 1), elle laisse un vide à gauche ; le score `(n, −far)` ne le voit pas (bande saturée : far = bord droit pour toutes les variantes). | Rendus tôle 1 : colonne de fans décollée du bloc d'hôtes de ~20 mm × 900 mm (≈ 18 000 mm² ≈ 25-30 fans perdus sur la tôle 1, donc autant de plus sur la tôle 2). | Après génération, translater rigidement le bloc de `−(min_x − x0)` quand `axis == 'x'` (validité conservée) ; tie-break du score sur le bord **proche**. |
| A7 | Mineur | `residual.py:296-321` | Retry `take //= 2` rejoue les **mêmes** premières poses ; `lat[0]` fautive = bande perdue ; STRtree importé inutilisé, validation O(take×n). | Lecture ; perf 1,3-3,5 s. | Filtrer les poses individuellement avec un STRtree construit une fois par appel. |
| A8 | Mineur | `residual.py:276` + T13 | `min_poses = 1` dès que `bands` est fourni = toujours en compaction ; docstring/T13 trompeurs. | Trace `want=1` accepté en bande `top`. | Corriger doc/test. |
| A9 | Mineur | `residual.py:519-521` | Donneuse sans hôte → jamais compactée (JS identique). | Lecture. | Ancre vide = bandes depuis le bord −X. |
| A10 | Mineur | `residual.py:609` ; `engine.py:204-208` | Retrait d'un layout vide sans recalcul de `solution.cost`/`metrics.layout_count` → `alternatives[].cost` périmé. (Collision de noms de fichiers `_part_N` **réfutée** : numérotation `seq_id` 1-based.) | Lecture. | `cost = len(layouts)`. |
| A11 | Mineur | `holefill.py:489-490, 545-546` | `free.remove(e)` par **valeur** (listes contenant un Polygon) : jumeaux → mauvaise entrée retirée, `recovered` faux. Même famille que le bug `_remove_by_identity` du 02/09. | Lecture. | Retrait par identité. |
| A12 | Mineur | `holefill.py:477-492` | `_apply_poses` téléporte la **première** libre du type (ordre du layout) ; budget 0,4 s partagé toutes tôles. | Lecture. | Libre la plus proche du trou. |
| A13 | Mineur | `holefill.py:551-609` | Slots distribués par ordre de parcours des layouts (cohérent) ; mais un trou vide sur une tôle **sans** libre reste vide alors que des libres existent ailleurs. | Lecture. | Re-lancer `apply_hole_fill` après `fill_residual_bands`. |
| A14 | Mineur | `residual.py:221` / `structure.py:432` / `metrics.py:406` | Trois seuils : lattice `space + 0,1` (brut), batch `space − 1e-6` (simplifié), verify `space − 0,01` (brut). Au DXF brut une pose peut sortir à ≈ `space − 0,1`. | Livraison mesure 0,0996. | Unifier (valider en brut à `space − ε`). |
| A15 | Mineur | `metrics.py:361` | `sheet.covers(poly)` strict ; le lattice cale au bord avec bruit flottant (`y = −6,7e−16`). | Non observé. | Tolérance ±1e-6. |
| A16 | Mineur | `tests/test_residual.py:295-303, 450-452` | T10/T12 ignorent volontairement les paires hôte↔hôte (fixtures physiquement invalides). | Lecture. | Fixtures légales + assertion sur toutes les paires. |
| OK | — | `structure.py` `stop_after`/`cap` | Équivalence vérifiée sur 56 configurations ; `_rotated_bbox` juste pour 90/180/270 ; déterministe. `placement.py` juste. | Scripts agent. | — |

## 5. Vérification, rapport, UI

| Id | Sév. | Constat | Correctif |
|---|---|---|---|
| U1 | Majeur | = A3/A4/A5/D12 : sur le cas de référence l'UI n'affiche que « Inside sheet » et « All 900 parts placed » ; un chevauchement réel n'a **aucun** signal. | Filet phase 0. |
| U2 | Majeur | = D1/D2 : le panneau live termine sur la **frame moteur brute** (hôtes manquants, fans en amas — `navigateur-space0.1-live-final.png`) alors que le modal montre le résultat post-passé (`-modal.png`). Serveur ET navigateur. | Phase 0. |
| U3 | Mineur | `usedSheetShare` (AABB/tôle) compte les poches internes comme « used » : 69,5 % affiché avec des trous visibles (F6 audit 02/09). La chute par tôle est déjà dans `report.sheets[].offcut`. | Afficher la chute réutilisable par tôle à côté du % ; à terme densité matière. |
| U4 | Mineur | Post-pass JS sur le thread principal : 6,5 s de gel sur 1 099 pièces (D8). | Web Worker de finalisation. |

## 6. Miroir JS navigateur

Chemin JS complet sur la fixture user (999 fans + 100 trous, space 0,1) :
physiquement sain (0 paire sous space, min-dist 0,100, 4 fans/trou), mais
`moved` compte 505 au 2ᵉ appel sans rien bouger, et 6,5 s sur le thread
principal.

| Id | Sév. | JS | Python / Rust | Constat | Correctif |
|---|---|---|---|---|---|
| **D1** | **Bloquant (vue live)** | `app/utils/liveJob.js:80-81` `if (ar !== br) return ar < br` ; `liveJob.test.js:80-83` verrouille ce sens | `bpp/sa.rs:22-25` : remnant **plus grand = mieux** | Le champion live BPP préfère la frame la **moins** compacte à tôles égales (registre `liveFrameBetter`, `LiveNestingView.offerChampion`). | `ar > br` ; corriger le test ; test « remnant 0,6 bat 0,4 ». |
| **D2** | **Bloquant (vue live)** | `localJobPrivate.js:331-361` frame finale sans `remnant` ; `[slug].vue:401` bascule vers `localReveal` **même slug** → champions conservés | `main.py:1392-1421` `_alt_to_live` sans `remnant` non plus | `frameIsBetter(final, champion)` : égalités puis `remnant` final = Infinity vs fini → **la frame finale post-pass n'est jamais affichée** (serveur ET navigateur). | Une frame `stage ∈ {final, reveal}` bat tout ; ou reset des champions à `stage === 'final'`. |
| **D3** | **Bloquant (si rotationCount ∉ {1,2,4})** | `structureClient.js:76-82 rotateRing`, `:502-509 rotatedBbox` : tout angle non multiple de 90 traité comme **270** ; utilisés par `validateBatch`, `layoutAabb`, `freePis`, `helixUnitsAndFree`, `pickClass` | `residual.py:59-60` shapely `rotate` exact | L'UI autorise `rotationCount` 1..360 (45°, 30°…) : la **validation** JS compare des anneaux faux → poses réellement chevauchantes acceptées, navigateur seulement. | Garde en tête de `fillResidualBands`/`applyHoleFill` : rotation non ≡ 0 mod 90 → no-op + compteur (JS et Python pour l'AABB) ; à terme `placedRing` cos/sin exact. |
| **D4** | Majeur (latent) | `residualClient.js:42-50 partRotations` : `part.rotations` absent du payload → lookup dans `payload.instance.items` = instance **réduite** (ids réindexés, piège #3b) | `residual.py:171, 268` | Dès que la classe fan est absorbée entièrement ou rotationCount = 1, le JS attribue à un hôte les rotations d'un autre item. | Ajouter `rotations` aux `parts` du payload (Python + builder). |
| **D5** | Majeur | `residualClient.js:203` `lim = max(1e-9, space − 0,1 − 1e-6)` sur anneaux **déjà simplifiés** | `residual.py:221` `space − 1e-6` | À space 0,1 le JS ne rejette que d < 1e-9 (un contact à 0,03 mm passe) ; à space 2 : 1,9 vs 2,0. F7 non résolue, seul le plancher a été ajouté. | `lim = space − EPS` (même géométrie simplifiée que Python) ; test « paire à 0,03 à space 0,1 rejetée ». |
| **D6** | Majeur | `residualClient.js:567-572` `catch (e) { … return moved }` avale **toute** exception | `residual.py:571-575` n'attrape que `_CompactRollback` | Une TypeError laisse un état partiel silencieux (c'est ce qui a masqué le `const moved`). | Sentinelle : `if (e !== COMPACT_ROLLBACK) throw e`. |
| **D7** | Majeur (fillHoles OFF) | `localBridge.js:737, 825` `payload?.fillHoles !== false` ; le `localPayload` Python ne porte pas `fillHoles` | `main.py:567-571, 1341` gate `has_holes` | Payload serveur-préparé avec trous fermés (ou space > 2,4) : le navigateur remplit quand même les trous. | Émettre `fillHoles`/`hasHoles` dans `localPayload` ; gate JS = `hasHoles`. |
| **D8** | Majeur (UX) | `localJobPrivate.js:494` post-pass sur le **thread principal** (6,5 s) ; `validateBatch` sans broadphase | worker Python | Gel de l'onglet, s'ajoute à D2. | Web Worker + broadphase bbox (1099² paires en ~200 ms). |
| D9 | Mineur | `structureClient.js:396-446` dichotomie sur anneau **décimé** (20 pts) + rescale ×1.06 | `structure.py:672-685` STRtree exact | (py,px) peuvent différer → non-bijection (`moved`, AABB, chute). Aucun test chiffré ne prouve la « bijection ». | Test de parité (plan B2-1). |
| D10 | Mineur | `latticeRotated` tronque après filtre | `_lattice_rotated(cap=cap)` tronque **avant** le filtre bbox | Peut rendre < cap poses côté Python (nouveau avec `stop_after`). | Python : `cap=None` pour la famille tournée. |
| D11 | Mineur | centroïde = moyenne des sommets (`residualClient.js:147-151`, `localBridge.js:89-93`) | centroïde d'aire shapely | Classement libre/niché divergent près d'un bord de trou. | `ringCentroid` (aire) partout. |
| D12 | Majeur | `nest-report/lib.rs:303` plafond 250 | `metrics.py:305` | = A3 côté navigateur. | Idem A3. |
| D13 | Mineur | `localJobPrivate.js:509-511` pas de part-loss guard sur les alts moteur | `main.py:1447-1455` | Alternative amputée livrée côté navigateur. | Même garde. |
| D14 | Mineur | `Math.round` half-up vs `round(tx,3)` half-even (clé de colonne du regrid) | — | Poche détectée d'un seul côté (théorique). | Regrouper par tolérance. |
| D15 | Mineur | contact exact : `< margin` sans ε / `< space − ε` / `< margin + ε` selon l'endroit | `_violates_spacing` (contact rejeté) vs `_loose` (permis) | Sémantique incohérente. | Constante documentée. |
| D16 | Mineur | `moved += 1 + fans` inconditionnel (JS et Python) | idem | 2ᵉ appel : `moved = 505` sans déplacement. | Compter les transformations changées. |
| D17 | Mineur | `local-result.post.js` stocke des alternatives brutes (chemin mort) | — | Si réactivé : résultat serveur ≠ artefacts. | Supprimer ou passer par `buildAlternativeArtifacts`. |
| D18 | Mineur | `sheets: [[w,h]]` (bin 0) dans les frames locales | `_alt_to_live` : tous formats | Multi-formats : panneaux live aux dimensions de la tôle 0. | `liveSheets(payload)`. |

Conformes (vérifiés) : `hi` global d'`expandMeta`, hole-fill scopé par tôle,
ordre meta → holefill → residual, alternatives structurelles sautées, transform
rigide des fans (radians, CCW), identité par référence, `wasInSrc`, validation
nouvelles-vs-nouvelles, couverture ±1e-6, `bin` = index de layout, champion
SPP-only, seeds string, flip SVG, `livePaneLayout`.

`try/catch` qui avalent (à instrumenter, plan phase 0) : `residualClient.js:567,
630` ; `localBridge.js:332, 766, 869, 1005` ; `localJobPrivate.js:550, 570` ;
`engine.worker.js:77` ; Python `residual.py:626`, `holefill.decorate_live_items`.

## 7. Ce qui fonctionne (mesuré, à ne pas casser)

- Physique des 4 runs de référence : 0 chevauchement, 0 hors tôle, 0 pose
  dupliquée, min-dist = space (0,0996 côté serveur = bruit simplify documenté).
- Parité serveur ↔ navigateur sur le même cas : 589/311 vs 591/309 pièces,
  used 0,694 vs 0,695, chute 580×1000 identique.
- Hole-fill scopé par tôle : 4 fans par trou exactement, `holesOverflow = 0`.
- Identité des bins moteur (live = coût = export), stock, merge wasm en parité.
- Bandes résiduelles de la tôle 1 : 508-510 fans à space 0,1 (81 % densité).

## 8. Questions à trancher par le propriétaire

1. **Politique à space 0** : contact permis (sémantique jagua/`OVERLAP_EPS`) ou
   plancher 1e-9 comme le JS actuel ? Les deux miroirs doivent choisir la même.
   Recommandation : contact permis, chevauchement d'aire > 0,01 mm² rejeté.
2. **Garantie `space` au DXF brut** (A14/D5) : recommandation : valider à
   `space − ε` sur la même géométrie simplifiée des deux côtés, documenter
   −2×SIMPLIFY au brut.
3. **Rollback de compaction** : recommandation : tout restaurer, `moved = 0`,
   compteur dans `report.postPass`.
4. **Deux formats de tôle simultanés** exposés au produit ? Si oui C5 devient
   bloquant et il faut un banc mixte (aucun n'existe).
5. **Reproductibilité temporelle** (C8) acceptée en prod ?
6. **Sémantique de `bins`** dans les frames live : nombre de tôles ou coût ?
7. Une fois C1/C2/C6 corrigés, quels post-pass garder ? Recommandation : garder
   hole-fill + bandes résiduelles (filet), rendre la compaction de la dernière
   tôle **conditionnelle**, retirer le reste sous verrous banc.
8. `rotationCount` hors {1,2,4} : à garder (alors D3 est bloquant à corriger)
   ou à restreindre côté UI ?

## 9. Pièges d'analyse rencontrés pendant cet audit

- Les SVG résultat sont en `translate(x, H−y) scale(1,−1)` : toute mesure de
  position doit repasser en y-up (piège §9 de l'audit du 02/09, confirmé).
- Les SVG **navigateur** n'ont pas les mêmes préfixes de `d` que ceux du serveur
  (anneau externe parcouru dans un autre ordre, fan démarrant à l'apex) :
  `check_physical.py` (préfixes figés) lit 0 pièce. `bench/check_svg_dir.py`
  parse les sous-chemins `M…Z` génériquement (outer + trous) et sert aux deux.
- Les fichiers GridFS des jobs banc sont purgés après 24 h (sweeper D-PRV-10) :
  rejouer un job de la veille n'a plus de SVG.
- Git Bash convertit `/app/...` en `C:/Program Files/Git/app/...` dans
  `docker exec` : `MSYS_NO_PATHCONV=1`.
- La page d'accueil a changé (carte « This device » `PrivacyModePicker` à la
  place de `.create__local-box`) : l'e2e du 20/08 ne passait plus, le nouveau
  script `scripts/qa-e2e-local-2sheets.mjs` est à jour.
- `replayUserBpp.test.js` (non commité) n'appelle pas `expandMeta` pour une
  meta 1+1 : il teste 699 pièces au lieu de 1 099 et ses seuils (0,05 mm,
  ±0,5 mm) sont trop lâches pour attraper quoi que ce soit.
