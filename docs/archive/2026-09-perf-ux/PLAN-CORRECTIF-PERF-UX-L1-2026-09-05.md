# Vérification du lot 1 (perf + UX) + plan correctif L1-bis — 2026-09-05 (soir)

Vérification indépendante des commits `623cdd1..e5b0042` (rapport
[`RAPPORT-PERF-UX-L1-2026-09-05.md`](RAPPORT-PERF-UX-L1-2026-09-05.md),
plan [`PLAN-PERF-UX-2026-09-05.md`](../../PLAN-PERF-UX-2026-09-05.md) §1 P1-P2,
§2.1.1-2.1.3, §3.1.1-3.1.2). Méthode : `assert_images_head.sh` OK contre
HEAD `e5b0042` (images en place, pas de rebuild nécessaire : le moteur n'a
pas changé) ; vitest complet ; pytest workers en docker sur la copie de
travail ; banc serveur 2 tôles space 0,1 avec **échantillonnage CPU par
thread** du worker (`/proc/<pid>/task/*/stat`, 2 s) ; e2e navigateur space
0,1 instrumenté (`PerformanceObserver('longtask')` + profil CPU V8 via
CDP) ; contrôle physique des SVG navigateur ; test C01 rejoué avec un
**second** calcul ; relecture des six diffs. Identifiants **AA** = constats
de ce tour.

## 0. Verdict

**Pas livrable tel quel — deux corrections courtes avant déploiement.**

- **C02 n'est pas atteint** : la « densité matière » affichée n'a pas la
  même définition pour les deux options. Grille = matière / Σ tôles
  (55,4 %) ; Compaction = densité moteur (matière / emprise, 62,3 %). Les
  900 mêmes pièces sur les 2 mêmes tôles affichent deux chiffres
  différents, et l'option 1 paraît toujours la moins bonne — exactement le
  défaut que le lot devait supprimer. De plus la ligne « Proposée en
  premier — plus grande chute propre » est **fausse** sur le banc serveur de
  ce tour (chute Compaction 599,6 > Grille 580,4), et la carte de l'aside
  affiche toujours « 68,8 % used ».
- **C01 : après une annulation, on ne peut pas relancer** — le bouton
  Nest reste grisé tant qu'un paramètre n'a pas changé (`isNewParams`
  jamais réinitialisé par l'annulation), testé deux fois ; et le bouton
  Annuler lui-même n'est pas réarmé (`liveCancelling` n'est remis à
  `false` que sur erreur).

Le reste est conforme ou en progrès mesuré : suites vertes (vitest
439/439, pytest 223 + 1), grille bit-identique serveur/navigateur
[587, 313] chute 580,4, physique OK (0 chevauchement, min-dist 0,1000 sur
la grille), A1/A2/C03/C12 conformes. **P1 : le gel passe de 5,7 s à 2,7 s**
(mesuré sur le scénario exact `rollback front`), pas sous 0,3 s. **P2 : le
thread décorateur coûte encore 9,6 s CPU pour 52 s de solve** (0,19 cœur ;
avant : 17 s / 40 s = 0,43 cœur) — gain réel de moitié, pas « rendu aux
walks ».

## 1. Mesures

| Mesure | Avant (audit 05/09) | Lot 1 (ce tour) | Cible plan |
|---|---|---|---|
| Gel navigateur fin de calcul (long task max, space 0,1, rollback front) | 5,7 s | **2,7 s** (+ 0,66 s juste avant) | < 0,3 s |
| Long tasks pendant le solve navigateur (vue live) | — | 183 tâches, 28 s cumulés (≈ 170 ms/frame) | (C31, lot 3) |
| CPU thread décorateur serveur | 17 s / 40 s de solve | **9,6 s / 52 s** (0,37-0,50 s par tranche de 2 s) | ≈ 0 |
| CPU main thread Python après le moteur (post-pass complet) | — | 9,4 s CPU / 11 s mur | (P8, lot 6) |
| Job serveur 0,1 (2 tôles, budget 120) | 60-115 s | 67 s (moteur 52 s + post-pass 11 s + 4 s) | 15-25 s (après P3) |
| Grille serveur / navigateur | [587, 313] · 580,4 | [587, 313] · 580,4 (bit-identique) | idem |
| Compaction serveur 0,1 | 589/311 · 600 | 699/201 · **599,6** (front tôle 1 = 5,8 mm) | — |
| Compaction navigateur 0,1 | 590/310 · 603,7 | 590/310 · 603,7 (rb front/count) | — |
| Physique navigateur (check_svg_dir, 0,1) | OK | OK — 1 800 pièces, 0 chevauchement, 25 paires à 0,099 (résidu moteur W6/D9) | OK |
| vitest / pytest | 436 / 215+1 | **439 / 223+1** | vert |

Fichiers : banc `bench-bpp2s-1-1788614831`, échantillons CPU et e2e dans
`docs/qa/perf-audit-2026-09-05/l1-verif/` (threads-w1.log, longtasks.json,
cpuprofile.json, modal-report.json).

## 2. Constats

### 2.1 Vérifié conforme

- **P1 (exactitude)** : le pré-filtre est bien exact — `bboxGapDist` ≤
  distance réelle, branche court-circuitée identique à celle de `ringDist`
  dans les deux régimes (space > ε et space ≤ ε) ; `OccupancyIndex.near`
  renvoie un sur-ensemble (cellules communes garanties dès que les bbox
  élargies de `pad ≥ space` s'intersectent ; les collisions de clé
  `cx·8192+cy` n'ajoutent que des candidats) ; `bbOf` sûr (aucune mutation
  d'anneau en place dans le module). Parité D9 et grille bit-identique
  confirmées par mes runs.
- **P2 (exactitude)** : `_pinwheel_capacity_cached` — clé (anneau, filler,
  space, rotations) complète, copie en sortie, `_centroid` accepte les
  tuples ; le décorateur s'est bien arrêté avec le moteur dans mon run
  (thread disparu à t = 60 s, post-pass démarré immédiatement).
- **C01 (partiel)** : `awaiting_local` reconnu, bouton visible pendant le
  calcul, annulation effective en 3 s (job `cancelled` en base, scène
  libérée). La relance est cassée : voir AA2.
- **C03/C12** : plus de badge post-pass, détails techniques repliés, seed
  masqué si absent, compteur combinaisons retiré.
- **A1** : `--error-text` opaque dans les deux thèmes ; il ne reste que des
  usages `border-color` de `--error-border` (4, rôle correct).
- **A2** : peek avant bcrypt, incrément sur échec seul, reset au succès,
  429 avec code + délai, message traduit. Tests 8/8.

### 2.2 À corriger

| Id | Sév. | Où | Constat | Preuve |
|---|---|---|---|---|
| **AA1** | **B (produit)** | `ResultModal.vue` `densityPct` / `altQualityLine` / `headlineTitle` ; `UserResultItem.vue:281-289` ; `main.py:1741` (`density` moteur) ; `localJobPrivate.js:365` | (a) `alt.density` de la Grille = matière / Σ tôles (`main.py:1537`, `localJobPrivate.js:580`) ; celui de la Compaction = densité **moteur** (SPP : matière / emprise, `merge.rs:256`). Mêmes 900 pièces, mêmes 2 tôles : Grille 55,4 %, Compaction 62,3 % — l'option 1 paraît encore moins bonne. (b) `result.whyFirst` est affiché **inconditionnellement** au rang 0 ; sur le banc serveur de ce tour la Compaction a la plus grande chute (599,6 vs 580,4) : la phrase ment. (c) La carte de l'aside affiche toujours `usedSheetShare` « xx % used » (emprise, moins = mieux). | banc `bench-bpp2s-1-1788614831` : alts `[grid density 0,554 offcut 580,4] [left density 0,623 offcut 599,6]` ; e2e `full.json` : 0,554 / 0,623 ; `UserResultItem.vue:288`. |
| **AA2** | **B (UX)** | `app/pages/project/[slug].vue:230-241` et `:622` ; `app/composables/files.js:602` | (a) **Après une annulation, impossible de relancer le calcul** : le bouton Nest reste désactivé (`btnIsDisable` ← `!isNewParams`, et `isNewParams = requestBody !== lastParams` n'est jamais réinitialisé quand le job est annulé). Testé : après « Cancel », le bouton « Nest 900 files » est grisé, un clic normal est intercepté, un clic forcé ne lance rien ; l'utilisateur doit modifier un paramètre ou recharger. Le script `qa-c01-cancel-live.mjs` ne lisait que le libellé du bouton (« Nest réutilisable » non prouvé). (b) `liveCancelling` passe à `true` au clic et n'est remis à `false` que dans le `catch` : au calcul suivant le bouton Annuler apparaîtrait désactivé avec « Annulation… ». | `l1-verif/c01-renest.log` (deux runs, 13:35 et 13:38) + capture `c01-before-renest.png` ; jobs Mongo `status: cancelled` en 3 s (l'annulation elle-même fonctionne). |
| **AA3** | M (perf) | `residualClient.js` / finalisation navigateur | Le gel résiduel est de **2,7 s** (long task unique à la fin du solve, scénario `rollback front` rejoué), plus 0,66 s juste avant — pas < 0,3 s. Attribution par profil CPU : voir §2.3. | `longtasks.json` : `[63633, 2714]`, `[62927, 658]`. |
| **AA4** | M (perf) | `holefill.decorate_live_items` ; `main.py` décorateur | Le décorateur consomme encore 0,19 cœur en continu (9,6 s CPU / 52 s) : chaque frame refait `expand_meta` (400 fans) + `apply_hole_fill` (100 hôtes) sur ~900 items. La mémoïsation de `pinwheel_capacity` n'en couvre qu'une partie. Le « −17 s CPU » du plan n'est pas atteint (−7,4 s à cadence égale, ≈ −55 % par seconde de solve). | `threads-w1.log` : tid 531, 0,35-0,52 s par 2 s pendant toute la durée du moteur. |
| AA5 | m (sûreté latente) | `main.py` `_stop_live_decorator` | `put_nowait(None)` sur une file `maxsize=1` : si une frame est en attente à l'arrêt, le sentinel est **abandonné**, `join(5)` attend 5 s pour rien, le thread décore encore la frame en attente et écrit `liveLayout` sur un job déjà finalisé, puis reste bloqué sur `get()` (fuite d'un thread par job). Non observé dans mon run (file vide à l'arrêt), mais le décorateur est occupé ~40 % du temps : cas atteignable. | Lecture du code (`_live_q.put_nowait(None)` / `except Full: pass`). |
| AA6 | m (compte) | `login.post.js:27` | Le compteur **par IP** (`login-ip`, 20 / 15 min) compte toujours les succès : un atelier derrière un NAT avec > 20 connexions en 15 min est bloqué. Même classe que A2. | Lecture. |
| AA7 | m (méthode) | rapport L1 | « Indicateur unique partout » et « gel éliminé » sont surévalués : la carte aside garde « % used », la densité n'est pas homogène, le gel vaut 2,7 s. Le script `qa-c02c03-modal.mjs` n'assertait pas l'égalité des densités entre options ni la véracité de `whyFirst`. | §1, AA1-AA3. |
| AA8 | m (perf, hors lot) | post-pass Python | Après le moteur, le main thread consomme 9,4 s CPU (11 s mur) : expand + hole-fill + résiduel + vérification + métriques. Une fois P3 livré (moteur ≈ 20 s), c'est un tiers du job. À avancer du lot 6 (P8) au lot 2 ou 4. | `threads-w1.log` t = 60-71 s. |

### 2.3 Attribution du gel résiduel (profil CPU V8)

Profil CPU V8 (2 ms) du solve navigateur complet (`cpuprofile-s01.json`,
60,8 s, 24 545 échantillons), fenêtre des 8 dernières secondes : 3,6 s
occupées sur le thread principal (long task max 1,5 s dans ce run, 2,7 s
dans le run non profilé), réparties ainsi (temps inclusif, chunks minifiés
relus à la colonne indiquée par le profil) :

| Part | Code | Ce que c'est |
|---|---|---|
| ≈ 1,4 s | `residualClient.js` : `ringDist` (boucle arête × arête, `a` = intersection de segments, `r` = point-segment) | Les paires **proches** (écart bbox < space − ε), non court-circuitées par P1 : dans une tôle dense, chaque pose candidate du lattice a des voisines à moins de 0,1 mm dont les anneaux se chevauchent ou se frôlent ; `ringDist` ne sort tôt que s'il trouve un croisement, sinon O(n·m) complet. |
| ≈ 1,2 s | `localBridge.js` : `applyHoleFill` → capacité pinwheel (`PINWHEEL`, `st = 400`), `W` point-dans-polygone, `Z`/`nt` distances | Le **miroir JS de P2 n'a pas été fait** : la capacité pinwheel est recalculée pour chacun des 100 hôtes à chaque appel (`localBridge.js:785, 885, 924`), alors que Python la mémoïse désormais. |
| ≈ 0,15 s | Vue `reactive` proxy `get` | Les tableaux de la solution sont parcourus **à travers un proxy réactif** pendant la géométrie (chaque accès de coordonnée passe par le `get`). |
| ≈ 0,8 s | rendu, GC, divers | — |

Pendant le solve lui-même : 183 long tasks de ≈ 170 ms (28 s cumulés) =
re-rendu de la vue live à chaque frame ; c'est le sujet C31 (lot 3), à ne
pas confondre avec le gel de fin de calcul.

## 3. Plan correctif L1-bis (≈ 1 jour)

1. **AA1 — une seule définition de la densité, mesurée.**
   - `ResultModal.vue` : `densityPct` ← `activeReport.totals.densityPct`
     (mesuré par `metrics.py` = Σ aires pièces / Σ aires tôles, déjà
     présent dans chaque `alt.report.totals`) ; `altQualityLine(alt)` et
     `headlineTitle` ← `alt.report?.totals?.densityPct` ; repli sur
     `alt.density` **uniquement** si `report` absent (jobs antérieurs), et
     dans ce cas sans afficher de comparaison entre options.
   - `UserResultItem.vue:281-289` : même source, libellé
     `result.densityShort` (« 55,4 % matière »), plus jamais `result.used`.
   - `result.whyFirst` : afficher seulement si `alt0.offcut.area` ≥ max des
     autres options (à 1 mm² près) ; sinon afficher
     `result.whyFirstGrid` : « Proposée en premier — rangées régulières,
     découpes prévisibles » (FR/EN).
   - Optionnel mais recommandé : normaliser le champ stocké `density` de
     l'alternative moteur à matière / Σ tôles dans `main.py:1741` et
     `localJobPrivate.js:365` (même formule que la grille), pour que
     l'accueil et les listes n'aient plus deux échelles.
   - Verrou : `qa-c02c03-modal.mjs` assert **densité option 1 == option 2**
     (mêmes pièces, mêmes tôles, à 0,1 pt près) et `whyFirst` présent ⇔
     chute option 1 maximale ; test vitest sur le computed.
2. **AA2 — une annulation rend la main.** (a) `files.js` : action
   `resetLastParams()` (`state.lastParams = null`) appelée sur toute
   annulation (bouton vue live, bouton de la carte résultat, et quand le
   job du projet passe `cancelled` via le flux SSE) ; le bouton Nest
   redevient actif avec les mêmes paramètres. (b) `liveCancelling.value =
   false` dans un `finally` ou un `watch(cancellableLiveSlug)`. Verrou :
   `qa-c01-cancel-live.mjs` étendu à **deux** cycles (annuler, cliquer Nest
   **sans changer de paramètre**, vérifier bouton Annuler actif + libellé
   « Annuler », annuler) — script fourni : `docs/qa/perf-audit-2026-09-05/
   l1-verif/qa-c01-renest.mjs` (échoue aujourd'hui au second clic).
3. **AA3 — finir le gel** (attribution §2.3), trois changements :
   (a) `localBridge.js` : mémoïser la capacité pinwheel par (anneau du trou,
   filler, space, rotations) — clé = coordonnées jointes, `Map` de module —
   miroir exact de `_pinwheel_capacity_cached` ; résultat copié en sortie ;
   (b) `residualClient.js` `pairViolates`, régime space > ε, quand l'écart
   bbox est < space − ε : avant `ringDist`, tester **un sommet de A
   strictement dans B ou de B dans A** (`pointStrictlyInside`, O(n)) — si
   vrai, les anneaux se chevauchent ou s'incluent, donc d = 0 < space − ε :
   `return true` **exact** (à space ≤ ε ne rien changer) ; conserver
   `ringDist` pour le reste ; (c) `markRaw`/`toRaw` sur le payload de
   solution avant `finalizeLocalResult`/post-pass pour sortir la géométrie
   du proxy réactif. Verrou : `longtasks.json` du script e2e instrumenté
   (`qa-e2e-freeze.mjs`, fourni) : long task max < 0,5 s en fin de calcul
   à space 0,1 (scénario rollback) et space 2 (scénario merge).
4. **AA4 — décorer moins, pas seulement moins souvent.** Deux options,
   au choix de l'implémenteur, mesurées par `threads-w1.log` :
   (a) mémoïser `decorate_live_items` par hôte : clé (item_id, rotation,
   translation arrondie 0,01 mm) → fans locaux déjà expansés ; entre deux
   frames SA la plupart des hôtes changent, donc préférer (b) ;
   (b) ne **pas** faire `apply_hole_fill` en live (garder `expand_meta`
   seul, qui est une transformation de poses locales déjà connues, ~10 ms)
   et laisser la vue live afficher les hôtes non remplis (le remplissage
   apparaît au résultat final). Cible : < 2 s CPU décorateur par minute de
   solve.
5. **AA5 — arrêt sûr du décorateur.** `_live_q.put(None, timeout=5)`
   (bloquant : le consommateur draine la frame en attente puis prend le
   sentinel) ; à défaut, drapeau `_stop` testé après chaque `get`. Test
   unitaire : file pleine à l'arrêt → thread terminé < 1 s, aucune écriture
   Mongo après `finishedAt`.
6. **AA6** : `login-ip` sur les échecs seulement (même mécanique que
   `login-email`), limite 50 / 15 min pour les échecs.
7. **AA8** : inscrire dans le plan la promotion de P8 (STRtree/mesures du
   post-pass Python) au lot 2 ou 4, avec la mesure de référence 9,4 s CPU.

GO déploiement du lot 1 : après 1 et 2 (bloquants) ; 3-5 peuvent suivre
dans le même lot ou ouvrir le lot 2. Avant `up -d` : `assert_images_head.sh`
sur les images publiées, corpus T-A..T-K, e2e 0,1 + 2 + refus 4 mm,
`qa-c01` à deux cycles, `qa-c02c03` avec les nouvelles assertions.

## 4. Rappel des décisions en attente (lot 2)

Inchangées : constante d'arrêt par itérations et compromis
`SAMPLE_CFG` après la journée de mesure P3. Ajouter à cette journée la
mesure AA4 (CPU décorateur) et AA8 (post-pass Python), déjà outillée par
`sample_threads.sh` (fourni dans `l1-verif/`).

## 5. Vérification de L1-bis (commits `e492dd5..4fb25cd`) — 2026-09-05, 17 h 40

Contrôles : `git status` propre, `assert_images_head.sh` OK contre HEAD
`4fb25cd` ; vitest **449/449** ; pytest docker sur la copie de travail
(voir tableau) ; banc serveur 0,1 avec CPU par thread ; e2e navigateur
0,1 instrumenté (long tasks) ; physique des SVG ; scripts
`qa-c01-cancel-live.mjs` (2 cycles) et `qa-c02c03-modal.mjs` rejoués ;
relecture des cinq diffs.

| Mesure | Lot 1 | L1-bis (ce tour) | Cible |
|---|---|---|---|
| Gel navigateur fin de calcul (long task max, 0,1, rollback front) | 2,7 s | **0,47 s** (pytest docker en parallèle ; 0,26 s chez l'implémenteur) | < 0,5 s |
| Long tasks cumulées sur tout le run navigateur | 28 s | **2,3 s** (29 tâches) | — |
| CPU thread décorateur serveur | 9,6 s / 52 s | **0,5 s / 51 s** (0,6 s par minute) | < 2 s/min |
| CPU main thread Python après le moteur | 9,4 s | 5,8 s | (P8) |
| Job serveur 0,1 | 67 s | 62 s | — |
| Densité affichée grille / compaction (serveur ET navigateur) | 55,4 % / 62,3 % | **55,4 % / 55,4 %** (`alt.density` normalisé 0,554 ×2, `totals.densityPct` 55,4 ×2) | égales |
| Grille serveur / navigateur | [587, 313] · 580,4 | [587, 313] · 580,4 (bit-identique) | idem |
| Compaction navigateur 0,1 | 590/310 · 603,7 (rb front/count) | **590/310 · 603,7 — identique au lot 1** : le test sommet, `ringDistBelow` et le pré-filtre segment n'ont rien changé au résultat | idem |
| Physique navigateur (0,1) | OK | OK — 1 800 pièces, 0 chevauchement, min-dist 0,1000 grille | OK |

Scripts rejoués par moi sur HEAD : `qa-c01-cancel-live.mjs` **OK en deux
cycles** (bouton Nest `disabled = false` après annulation, relance sans
changer de paramètre, bouton Annuler « Cancel » actif, seconde annulation
effective) ; `qa-c02c03-modal.mjs` **18/18** (densités égales, spread
0,00 pt ; `whyFirst` bascule sur « regular rows » quand la chute de
l'option 1 n'est pas la plus grande : 580 400 < 603 700 ; carte aside
« 55.4% material · 2 sheets »). Suites : vitest 449/449, pytest 226 + 1.

**Verdict L1-bis : livrable.** Les deux bloquants AA1 et AA2 sont corrigés
et prouvés ; AA3 atteint la cible ; AA4 mesuré à 0,6 s CPU par minute de
solve ; AA5/AA6 conformes. GO déploiement du lot 1 + L1-bis : procédure
habituelle (build images publiées, `assert_images_head.sh`, corpus
T-A..T-K, e2e 0,1 / 2 / refus 4 mm, `qa-c01` ×2, `qa-c02c03`).

### 5.1 Relecture des diffs

- **AA3 (exactitude)** — `ringDistBelow(c1, c2, s)` ⇔ `ringDist(c1, c2) < s`
  (même `segSegDist`, prédicat strict) ; pré-filtre par segment : rejet
  seulement si l'arête B est entièrement au-delà de la bbox de l'arête A
  gonflée de `s` **sur un axe** (séparation > s ⇒ distance > s) — exact, y
  compris pour `s ≤ 0` (le prédicat est alors faux de toute façon). Les
  deux usages conservent la comparaison d'origine (`< space − ε` dans
  `pairViolates`, `< threshold − 1e-9` dans `latticeVariant`). Test sommet :
  seul le **premier** sommet de chaque anneau est testé — suffisant (un
  sommet strictement intérieur ⇒ croisement ou inclusion ⇒ violation dans
  l'original aussi, sauf le cas concave documenté où le nouveau code est
  plus strict **et** aligné sur shapely). Verdict : exact, conforme.
- **AA1** — `altDensityPctOf` lit `report.totals.densityPct` ; repli
  `alt.density` seulement sans rapport ; `whyFirstKind` compare les aires de
  chute à 1 mm² ; `main.py` et `toServerShapeAlternatives` normalisent le
  champ stocké. Aucun tri ni classement par `density` côté serveur
  (vérifié) : la normalisation ne change pas l'ordre des options.
- **AA2** — `resetLastParams` (`lastParams = ''`) sur les trois chemins ;
  `wasCancelled` posé par `resultcontroller` ; `liveCancelling` réarmé en
  `finally` + watch. Conforme.
- **AA4** — `apply_fill=False` en live ; la densité live reste calculée.
  Effet mesuré ci-dessus.
- **AA5** — `LiveDecorator` : drapeau avant sentinel, frame en attente
  abandonnée, `join` borné. Conforme au plan ; tests 3/3.
- **AA6** — `login-ip` en peek / incrément sur échec / reset au succès,
  50 / 15 min. Conforme.

### 5.2 Résidus (non bloquants)

- Variance C8 toujours visible côté serveur : compaction 0,1 = 589/311 ·
  chute 520,7 ce tour (699/201 · 599,6 au tour précédent, 589/311 · 600 le
  04/09) — moteur, hors périmètre L1.
- Paires à 0,099 mm sur la compaction navigateur (W6/D9, résidu connu).
- Vue live : les hôtes apparaissent vides pendant le calcul (AA4 option b,
  assumé) — à mentionner dans la ligne d'état C10 du lot 3 (« remplissage
  des trous au résultat final »).
- Gel : 0,47 s mesuré sous charge, 0,26 s à vide — marge faible sur la
  cible 0,5 s ; le prochain gain viendra du worker de finalisation (P4,
  lot 4), pas d'une nouvelle micro-optimisation.
