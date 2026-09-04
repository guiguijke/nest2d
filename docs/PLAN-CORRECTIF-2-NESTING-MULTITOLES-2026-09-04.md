# Vérification du lot correctif + plan correctif n° 2 — nesting multi-tôles — 2026-09-04

Vérification indépendante des 6 commits `f2b656a..0325692` décrits dans
[`RAPPORT-CORRECTIF-NESTING-MULTITOLES-2026-09-04.md`](RAPPORT-CORRECTIF-NESTING-MULTITOLES-2026-09-04.md)
(plan [`PLAN-CORRECTIF-NESTING-MULTITOLES-2026-09-04.md`](PLAN-CORRECTIF-NESTING-MULTITOLES-2026-09-04.md),
constats V1-V22). Méthode : suites rejouées ; images locales = HEAD (diff
conteneur, hash wasm) ; banc serveur 7 jobs (multi 0 / 0,1 ×3 / 2, mono SPP
0,1 / 2) et navigateur 4 e2e (multi 0,1 / 0 / 2, mono 0,1) avec vérification
physique sur anneaux bruts ; relecture ciblée du code (les relectures
déléguées ont été interrompues par une limite de session — la relecture
ci-dessous est la mienne, plus courte que celle du tour précédent). Les
identifiants **W** sont les constats de ce tour.

## 0. Verdict

**Les 8 défauts du plan correctif sont bien corrigés** (V1, V2, V4, V5, V6,
V7, V8, V14 — vérifiés dans le code et par les bancs), le mono-tôle n'est
pas régressé (SPP + grille + BPP stock 1, serveur et navigateur, 300/300,
physique propre), la parité navigateur/serveur à space 0,1 est réelle sur
le run où la compaction receveuse ne se déclenche pas (front 399,7 des deux
côtés, chute 600,3).

**Mais la nouvelle « compaction receveuse » (V3) fait perdre ce que le tour
précédent avait gagné** : quand elle se déclenche (2 runs sur 3 à space
0,1 côté serveur), la chute retombe de 600 à 580 mm et la tôle 1 perd 6 à
9 fans ; à space 2 elle ne récupère rien (119 fans moteur restent 119, la
cible 474 reste hors d'atteinte : 443-449) ; et la compaction donneuse,
toujours sans critère d'acceptation, recule le front là où le moteur était
meilleur (serveur space 0 : 388 → 437 mm ; navigateur space 2 : 490 → 499).
La livraison peut se faire **en désactivant la compaction receveuse** (un
drapeau) ; la vraie correction est en §3.

## 1. Mesures

Suites : pytest 181 + 1 skip, vitest 408, cargo nest-engine 71 + 1 ignoré ;
`tests/retry_overshoot.rs` (SPP, budget 16 s) a échoué **une fois sous charge
CPU** puis passé 2/2 — test dépendant du temps mur, à noter (W8).

Banc serveur (images HEAD, 100 Trou + 800 Fillx4, 2×1000×1000, −X, trous ON) :

| Run | Tôle 1 | Tôle 2 | Chute t2 | used | compactReceivers | Physique (brut) |
|---|---|---|---|---|---|---|
| 0 | 81 + 508 (589) | 19 + 292 (311) | 562×1000 | 0,716 | 0 | 3 × 0,02 mm² (V20) |
| 0,1 run A | 81 + 502 (**583**) | 19 + 298 | **580×1000** | 0,681 | **1** | OK, min-dist 0,1000 |
| 0,1 run B | 81 + 505 (**586**) | 19 + 295 | **580×1000** | 0,679 | **1** | OK |
| 0,1 run C | 81 + 509 (590) | 19 + 291 | **600×1000** | 0,693 | 0 | OK |
| 2 | 81 + 447 (528) | 19 + 353 (372) | 500,8×1000 | 0,733 | 1 | OK, min-dist 2,0000 |
| mono SPP 0,1 | 300 (grille) | — | 399,4×1000 | 0,597 | — | OK, 0,0990 (alt moteur) / 0,1000 (grille) |
| mono SPP 2 | 300 (grille) | — | 388×1000 | 0,607 | — | OK |

Navigateur (Playwright, THIS DEVICE, dump `pre-solve.json` = moteur brut) :

| Run | Moteur brut t1 / t2 (fans libres, x max t2) | Final t1 / t2 | Chute t2 | Physique (brut) |
|---|---|---|---|---|
| 0,1 | 81 h + 185 f / 19 h + 215 f, x max 399,1 | 590 / 310 | **600,3** (front 399,7) | 0 chevauch. ; **586 + 453 paires à 0,0990-0,0999** (W6) |
| 0 | 81 + 187 / 19 + 213, x max 388,3 | 592 / 308 | 610 (compaction **rollback**, résultat = moteur brut) | 8 × 0,02 mm² (V20) |
| 2 | 81 + 119 / 19 + 281, x max 490,5 | 524 / 376 | 500,5 (front **499,5 > 490,5 moteur**) | OK |
| mono 0,1 (50 + 250) | 50 + 50 | 300 (grille 399,4 ; moteur 399,3) | — | OK, 0,1000 / 0,0997 |

Références : tour précédent (avant lot correctif) serveur 0,1 = 592 / chute
600 ; audit initial serveur 2 = 474 fans sur la tôle 1.

## 2. Constats

### 2.1 Corrigé et vérifié

| Id | Vérification |
|---|---|
| V1 | Deux `#[test]` distincts (`mod.rs:320`, `:376`) ; `cargo build --tests` sans `duplicated attribute` ni `never used` (reste `field 0 is never read` sur `Move::Restart(u64)`, W9). |
| V2 | `Move::Restart(n)` avec rng d'évaluation dérivé de `(seed, hash, compteur)`, `revert` no-op, heartbeat atteint ; test discriminant (l'ancien `continue` donnait 0 heartbeat). |
| V4 / V5 | `_pair_violates` : `space > ε → d < space − ε` ; `space ≤ ε → contact permis, aire > 0,01 rejetée` ; JS identique ; assertion d'espacement dans le pipeline (`test_residual.py:837`) ; bancs : 0 paire à d = 0 à space > 0. |
| V6 | `offerChampion` : frame `final/reveal` remplace toutes les classes (`LiveNestingView.vue:277-287`). |
| V7 | `_sheet_needs_compaction` ↔ `sheetNeedsCompaction` : miroir exact (largeur tournée, `hosts_left`, `frees_left`, tolérances). |
| V8 | `keptIdx` vide → `throw 'all_alternatives_invalid'` → local-fail ; message serveur distinct ; piège 56b. |
| V10 | Payload J-090 : `rotations` par part, `hasHoles`/`fillHoles` à la racine (fixture B). |
| V11 | `main.py:480` et `localPayloadBuilder.js:703` : `cost = round(aire / aire_min × 100)` ; `alternatives[].cost` renormalisé à `len(layouts)`. |
| V14 | Frame `layout` inconditionnelle après `anneal` (`mod.rs:205-209`). |
| V15 | `containerMapBack` à la racine du payload ; map-back Python appliqué. |
| Mono | SPP + grille + BPP stock 1 : contrats T8 respectés, physique propre, `postPass` à zéro. |

### 2.2 À corriger

| Id | Sév. | Où | Constat | Preuve |
|---|---|---|---|---|
| **W1** | **B (qualité)** | `residual.py:709-746` `_compact_receivers` ; `residualClient.js:819-847` | Acceptation sur le **front** seulement (`after[2] ≤ before[2] + 0,5`), pas sur le **compte** comme le plan le demandait. Sur une receveuse pleine le front est au bord de toute façon : la re-pose au lattice qui perd des fans est acceptée, les fans restent sur la donneuse. | Serveur 0,1 : runs A/B (`compactReceivers 1`) = 583-586 pièces, chute 580 ; run C (0) = 590, chute 600. Rendu `verif2-0904-serveur-space0.1-tole1-receveuse-compactee.png` : bande droite re-latticée plus étroite (x max 974 au lieu de 999). |
| **W2** | **M (qualité)** | `residual.py:749+` `_compact_last_sheet` ; JS `compactLastSheet` | Aucun critère d'acceptation sur la donneuse : la re-pose au lattice est conservée même quand le front recule par rapport au moteur. | Serveur space 0 : moteur ≈ 388, final 437 (chute 562 au lieu de ≈ 610) ; navigateur space 2 : 490,5 → 499,5. À space 0 côté navigateur le rollback a **sauvé** le résultat (610). |
| **W3** | **M (qualité)** | ordre des passes `residual.py:880-911` | À space 2 la compaction receveuse n'apporte rien parce qu'elle s'exécute **après** le remplissage inter-tôles : les bandes sont déjà jugées pleines (AABB au bord) → 0 fan transférée, puis la receveuse est re-latticée seule. Les donneuses ne participent jamais au re-lattice de la receveuse. La cible 474 (audit) reste à 443-449. | Navigateur space 2 : pré 119 fans libres sur t1 → post 119 ; `residualMoved 495` = donneuse seule. |
| **W4** | M (parité, latent) | `residualClient.js:193-213` `pairViolates` | Le containment V9 n'est testé qu'à `space ≤ ε`. À space > 0 (cas normal) : `d = ringDist` puis `d < space − ε` → un anneau **inclus** (fan sur le corps d'un hôte, à ≥ space de son bord externe et de ses trous) est accepté. Python (shapely, d = 0) le rejette. | Lecture du code ; non exercé par les bancs (les poses lattice sont hors hôtes par construction). |
| **W5** | M (test) | `constructive.rs` T7 refondu | T7 ne vérifie plus « 81 carrés 100×100 à space 0,1 sur une seule tôle » : 12 carrés 250 sur 1520×600 avec `layout_snapshots.len() ≤ 2` (non discriminant : 12 tiennent sur 1). Le verrou unitaire `snd_refine_step_limit` teste la formule, pas la dérive. Le comportement C6 est OK aux bancs (81/81 partout ce tour) mais plus verrouillé. | Diff `2cf9f21..HEAD`. |
| W6 | m (parité) | lattice JS | À space 0,1 le navigateur produit 1 039 paires à 0,0990-0,0999 mm sur anneaux bruts (serveur : 0, min-dist 0,1000). Sous `space − 0,01` donc `spacingOk` vrai, mais la marge est consommée côté navigateur seulement (dichotomie JS sur anneau décimé, D9). | check_svg_dir navigateur 0,1. |
| W7 | m (hygiène) | commit `4639bf2` | 6,9 Mo d'artefacts de banc commités (11 SVG `bench/out_*.svg`, `out_grid_alt.png` 2,2 Mo, 3 JSON `out_user_*`) ; `.gitignore` n'exclut que `out*/`. | `git show --stat 4639bf2`. |
| W8 | m (test) | `tests/retry_overshoot.rs` | Test SPP à budget temps (16 s, plateau 0,5 s) : échec sous charge CPU, passe à vide. Flaky, pas une régression. | 1 échec / 3 runs. |
| W9 | m | `sa.rs:411` ; `AGENTS.md:686` | `Restart(u64)` : champ jamais lu (warning) ; AGENTS.md : #54 toujours après #61 malgré le « réordonné » du rapport. | `cargo build --tests` ; grep. |
| W10 | m | V20 | Micro-intersections 0,01-0,02 mm² à space 0 sur anneaux bruts (serveur 3, navigateur 8) : inchangé, documenté. | check_svg_dir. |

## 3. Plan correctif n° 2 (ordre)

### Étape A — Rendre le lot livrable (½ jour)

1. **W1** : `_compact_receivers`/`compactReceivers` : acceptation
   `count_after ≥ count_before` **et** `front_after ≤ front_before + 0,5`,
   sinon restauration ; test : receveuse 81 hôtes + fans épars → jamais
   moins de pièces après le pass (Python + JS, parité de décision).
   Tant que W3 n'est pas fait, cette étape suffit à retrouver 590 / 600.
2. **W2** : `_compact_last_sheet`/`compactLastSheet` : snapshot du front
   moteur (`layout_aabb` avant) ; si `front_after > front_before + 0,5` →
   restauration complète, `postPass.compactRollback = true` avec raison
   `'front'`. Test : donneuse déjà compacte (x max 388) → no-op.
3. **W7** : `git rm --cached` des artefacts ; `.gitignore` : `workers/nesting/bench/out_*` ;
   garder `out_user_*.json` seulement s'ils servent aux tests vitest
   (sinon les régénérer en CI ou les réduire).
4. **W9** : `Restart` sans champ (ou `#[allow]` justifié) ; réordonner
   AGENTS.md (#54 avant #55).

GO A : serveur 0,1 ×3 runs ≥ 590 / chute ≥ 600 ; space 0 serveur chute
≥ 600 (moteur brut) ; navigateur = serveur ± 3 pièces ; physique OK.

### Étape B — Récupérer space 2 (1 jour)

5. **W3** : fusionner remplissage inter-tôles et compaction receveuse :
   pour chaque receveuse, ancre = hôtes + nichées ; candidates = libres
   de la receveuse **+ libres de la donneuse** ; bandes depuis l'AABB de
   l'ancre ; lattice ; acceptation : `count_receveuse_after ≥ before`
   (sinon restauration), les candidates non posées retournent à leur
   tôle d'origine (validées). Exécuter AVANT la compaction donneuse.
   GO : space 2 tôle 1 ≥ 474 fans ; space 0,1 ≥ 590 ; physique OK ;
   navigateur ± 3.
6. Si 5 ne suffit pas : lancer le spike phase 4 (SPP à séparateurs) —
   c'est seulement à ce moment que la « saturation » sera démontrée.

### Étape C — Complétude (½ jour)

7. **W4** : `pairViolates` : appliquer le test de containment aussi quand
   `space > ε` (bbox incluse → centroïde strict → violation) ; test « fan
   sur le corps d'un hôte à space 2 → rejetée » (Python attendu `True`).
8. **W5** : rétablir un T7 discriminant : 81 carrés 100×100, tôle
   1000×1000, `Importer::new(cde, Some(0.001), Some(0.1), None)` →
   `layout_snapshots.len() == 1` ; le garder même s'il est lent (~1 s).
9. **W6** : la dichotomie JS sur anneau complet (ou validation finale du
   pas sur anneau complet) pour retrouver min-dist 0,1000 côté
   navigateur ; verrou : « 0 paire < space − 1e-4 sur anneaux bruts » dans
   le replay user JS.
10. **W8** : `retry_overshoot` en `sa_max_iterations`/budget plus large ou
    marqué `#[ignore]` hors CI dédié.
11. **W10** : avertissement UI pour `space < 0,05` (kerf) ; vérification
    finale sur anneaux bruts quand `space == 0`.

## 4. Décisions propriétaire

- Livrer après l'étape A (sûreté + parité + qualité 0,1 retrouvée), ou
  attendre B (space 2) ?
- Phase 4 : pas avant le résultat de B.5.
- C8 (température au temps mur) : la variance observée ce tour est de
  ±4 pièces/tôle et jusqu'à 20 mm de chute entre runs identiques —
  recommandation : `sa_max_iterations` calibré par taille d'instance pour
  les tiers payants (reproductibilité des tickets).

## 5. Exigence transverse (propriétaire, 2026-09-04) : « le nesting doit fonctionner pour toute pièce »

Les pièces `Piece_Trou` / `Piece_Fillx4` sont un cas de torture, pas la
cible. Or les post-pass (lattice, hélices, poches, re-grid, compaction) ont
été calibrés sur elles ; les correctifs moteur sont génériques. Règles à
appliquer à partir de maintenant :

1. **Critères d'acceptation génériques, jamais en « nombre de fans ».**
   Toute passe qui déplace des pièces est acceptée seulement si, pour
   chaque tôle touchée : `pièces_after ≥ pièces_before`, `front_after ≤
   front_before + 0,5 mm` (axe de l'objectif), physique valide ; sinon
   restauration complète et trace dans `postPass`. C'est l'invariant
   « jamais pire que le moteur », valable pour toute géométrie (W1/W2).
2. **Garde de compétence de chaque passe.** Une passe ne s'exécute que si
   ses hypothèses tiennent (rotations quarts de tour, classe petite
   convexe-ou-presque pour le lattice, hôtes à trous pour le re-grid) ;
   hors hypothèses : no-op **tracé** dans `postPass.errors` et visible dans
   le modal — jamais un comportement dégradé silencieux.
3. **Corpus de torture multi-tôles à jouer à chaque lot** (banc serveur +
   e2e navigateur, physique sur anneaux bruts, tous VERDICT OK et « jamais
   pire que le moteur brut ») — à créer dans `bench/seed_corpus.py` avec un
   dump pré/post par cas :
   - T-A : le corpus actuel (100 Trou + 800 Fillx4, 2×1000×1000, space 0 /
     0,1 / 2) ;
   - T-B : 3 classes de rectangles de tailles proches (300×200, 250×180,
     120×90), 3 tôles 1500×1000, space 2 — aucune hélice, pas de lattice
     pertinent : les passes doivent être no-op ou gagnantes ;
   - T-C : pièces en L et en U (non convexes, centroïde hors matière),
     2 tôles, space 1 — cible les tests de containment/doublon JS (W4) ;
   - T-D : pièces longues et fines (900×40) + petites, 2 tôles 1000×1000 :
     une seule orientation possible, rotations `[0, 90]` ;
   - T-E : rotations à 30° (rotationCount 12) sur le corpus T-A : les
     passes JS doivent être no-op tracé, le résultat moteur livré tel quel
     et physiquement propre ;
   - T-F : deux formats (1000×1000 ×1 + 2000×1000 ×1), coût ∝ surface :
     la petite tôle admettant l'item est ouverte d'abord ; `container_id`,
     SVG/DXF par tôle et rapport cohérents ;
   - T-G : grande pièce unique presque pleine tôle (950×950) + 200 petites :
     la grande sur la tôle 1, les petites derrière ou sur la tôle 2, jamais
     de rollback destructeur ;
   - T-H : classe unique (600 × un même rectangle) sur 3 tôles : recuit
     vivant (V2), heartbeats, `iterations` > 200 ;
   - T-I : ESICUP `shirts`/`swim`/`trousers` en BPP (stock 3, tôle = bande
     découpée) pour les formes libres, comparaison brut vs post-pass.
4. **Chaque cas du corpus a une fiche** : pièces, tôles, space, résultat
   moteur brut, résultat final, verdict physique, « pire que le moteur ? ».
   Un lot n'est GO que si aucun cas n'est « pire que le moteur » et que
   T-A ne régresse pas.
5. **Objectif à moyen terme** : ramener la qualité dans le moteur
   (phase 4 ou objectif de front par tôle) et **retirer** les passes
   spécifiques une fois le corpus vert sans elles — le nombre de lignes de
   post-pass est une dette, pas une feature.
