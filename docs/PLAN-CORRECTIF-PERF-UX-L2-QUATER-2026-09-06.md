# Vérification de L2-ter (AC1-AC6) + plan L2-quater — 2026-09-06, 8 h

Vérification indépendante des commits `285dcce..84a965e` (rapport
[`RAPPORT-PERF-UX-L2-TER-2026-09-06.md`](RAPPORT-PERF-UX-L2-TER-2026-09-06.md),
plan [`PLAN-CORRECTIF-PERF-UX-L2-TER-2026-09-06.md`](PLAN-CORRECTIF-PERF-UX-L2-TER-2026-09-06.md)).
Méthode : `assert_images_head.sh` OK contre HEAD `84a965e` à mon arrivée ;
vitest, pytest docker ; 10 bancs serveur T-A séquentiels (2 à 0,1, 8 à 2)
avec lecture de `discardedAlternatives` et `residualRolledBack` ; e2e
navigateur 0,1 et 2 instrumentés (la ceinture exacte ajoute du calcul en
fin de job : le gel est re-mesuré) ; physique des SVG ; corpus ; relecture
des diffs (`residual.py`, `residualClient.js`, `main.py`, `metrics.py`,
`localJobPrivate.js`) ; **analyse des diagnostics persistés** des deux
récidives de l'implémenteur (`bench-corpus-a-1788662464-0`,
`-1788663539-0`) et lecture du code de la passe fusionnée. Identifiants
**AD** = constats de ce tour.

## 0. Verdict

**GO déploiement de L2-ter** : l'instrumentation AC1/AC2 est correcte et
utile, la ceinture exacte est un filet légitime (miroir Python/JS, dans le
`try`, restauration complète, tests), les suites et bancs sont verts, les
temps ne bougent pas. **Mais la cause racine annoncée dans le rapport
n'est pas la bonne**, et la vraie cause est identifiable dans le code à
partir des diagnostics persistés — elle se corrige en une ligne de
validation plus un test, à faire dans la foulée (L2-quater, une
demi-journée).

## 1. Mesures (images = HEAD `84a965e`)

| Mesure | L2-bis | L2-ter | Cible |
|---|---|---|---|
| Job serveur T-A 0,1 / 2 (création → fin) | 19-29 s | **15,6-19,2 s** (0,1) · **16,5-29,5 s** (2) | 15-25 s |
| Grille 0,1 / 2 | bit-identique | [587, 313] · 580,4 / [573, 327] · 544,1, 10/10 | idem |
| Compaction 0,1 chute dernière tôle | 520,7 / ≈ 605 | 603,5 · 520,7 (bimodal connu) | — |
| Compaction 2 chute dernière tôle | 457,5-479,2 | 457,5 · 479,2 · 508,3 · 514,6 · 510,9 · 516,9 · 484,2 · 479,2 (8 runs, dans la dispersion connue) | — |
| Alternatives écartées / ceinturées sur mes bancs | 1 écartée / 10 | **0 écartée, 0 ceinturée / 10** | 0 écartée |
| Navigateur, calcul 0,1 / 2 | 30 s (charge) / 9 s | 27 s (pytest en parallèle) / 15 s | 8-12 s |
| Gel fin de calcul 0,1 / 2 (ceinture JS comprise) | 0,27 / 0,30 s | **0,35 s** à vide (0,62 s avec pytest en parallèle) / 0,71 s (charge résiduelle probable) | < 0,5 s |
| Physique navigateur 0,1 / 2 | OK | OK / OK (0 chevauchement, 1 800 pièces ×2) | OK |
| Corpus | 11/11 | **11/11** (T-A [587, 313], T-F 89/90 partiel attendu) | 11/11 |
| vitest / pytest | 449 / 226 + 1 | **449** / **232 + 1** | vert |

Artefacts : `docs/qa/perf-audit-2026-09-05/l2ter-verif/`.

## 2. Constats

### 2.1 Vérifié conforme

- **AC1** : `_pre_layouts` = deepcopy après remap des ids, avant
  expansion ; attribution en trois étages avec rejeu de l'expansion seule
  sur une copie ; `origin = "unknown"` si le snapshot manque. Les deux
  récidives donnent `post_pass` avec pré-vérification et expansion
  propres : l'hypothèse « pinwheel » du tour précédent est **réfutée par
  la mesure**, comme il se doit.
- **AC2** : paires par pose (tôle, index, item, aire, centroïde), poses
  compactes, `postPass`, SVG `_discarded` — le rejeu hors ligne est
  possible à partir de l'état final (voir §2.3 : c'est ce qui m'a permis
  d'identifier la cause).
- **AC3 (ceinture)** : `_exact_overlap_area` sur anneaux bruts, intra-tôle,
  STRtree, différentielle (`> before + 0,05 mm²`), dans le `try`,
  restauration du snapshot complet, `residualMoved = 0`, trace ; miroir JS
  par comptage de paires avec exemption des trous. Tests ×3 + ×3. La
  récidive de l'implémenteur a bien été convertie en alternative valide
  (`bench-corpus-a-1788664161-0` : « 0,00 → 37,58 mm², état d'entrée
  restauré »).
- **AC4/AC5/AC6** : conformes (formatage corrigé à la main, hashes
  corrigés, miroir navigateur + correction du `ReferenceError`).

### 2.2 À corriger

| Id | Sév. | Constat | Preuve |
|---|---|---|---|
| **AD1** | **B (cause racine)** | Le rapport attribue les chevauchements à « des gardes qui jugent des anneaux simplifiés avec la tolérance A14 ». Une simplification à 0,05 mm ne laisse pas passer **20 à 310 mm²** de recouvrement (une fan = 615 mm²). La vraie cause est dans `_merge_fill_compact_receivers` : les candidates **non posées** — issues **des deux tôles** (X1.2 : « TOUTES les non-posées vont sur la DONNEUSE ») — sont rendues sur la donneuse **à leurs coordonnées d'origine**, puis validées par `_validate_return(remaining, donor, …)`, qui (a) **exclut toutes les rendues de l'occupancy** (`exclude=[id(pi) for pi in pis]`) et (b) **ne juge pas les paires entre rendues** (docstring : « on ne re-juge … ni les paires entre retournées »). Cette exemption n'est valable que si toutes les rendues viennent de la même tôle. Une fan **d'origine receveuse** rendue sur la donneuse à ses coordonnées receveuse peut donc recouvrir une fan **d'origine donneuse** rendue elle aussi (exclue de l'occupancy) : jamais testée. | Diagnostics persistés : les paires fautives sont fan-fan sur la **donneuse** (tôle 1), entre des poses d'index bas (95-100, rotation 0, y ≈ 917, pas régulier ≈ 44 mm — une rangée receveuse) et des poses d'index haut (263-342, poses moteur dispersées de la donneuse) ; `postPass` : `mergedReceivers 1`, comptes 525/375 → 577/323 ; code `residual.py:826-836` (retour sur la donneuse), `:345-360` (`_validate_return`, exclusion + pas de paires entre rendues). |
| **AD2** | M (méthode) | Le correctif livré (ceinture) **masque** le défaut au lieu de le corriger : quand elle tire, la passe perd tous ses déplacements (150-172 pièces), soit ≈ 1 job sur 30 sur T-A à space 2 qui livre une Compaction moins bonne qu'elle ne pourrait. Le plan demandait la cause et le correctif de l'étape ; le rapport reconnaît la « micro-cause ouverte ». | Rapport §Non-GO 1 ; `residualRolledBack` sur `bench-corpus-a-1788664161-0`. |
| AD3 | m | `_pre_layouts` n'est pas persisté dans le diagnostic : le rejeu **pas à pas** de la passe à partir de l'état moteur reste impossible a posteriori (la passe est déterministe à entrée donnée — c'est le test décisif). Une ligne. | Rapport §Non-GO 1. |
| AD4 | m | Miroir JS : `validateReturn` de `residualClient.js` a la même exemption des paires entre rendues (parité D9) — à corriger en même temps que le Python, sinon la ceinture JS tirera à la place. | `residualClient.js` (`validateReturn`). |
| AD5 | m (coût) | La ceinture coûte deux passes complètes (Python : STRtree sur anneaux bruts, ~600 polygones par tôle ; JS : `ringsOverlap` sur toutes les paires voisines, sans pré-filtre bbox par paire) par alternative. À vide le gel navigateur passe de 0,26 à 0,35 s ; sous charge il dépasse 0,5 s (0,62-0,71 s). Rendre la mesure **différentielle sur les pièces modifiées** (nouveaux chevauchements ⇒ au moins une pièce déplacée par la passe : ne juger que ces pièces contre leurs voisines) divise le coût par ~10 et reste exact. | `longtasks-s01.json`, `-s2.json`, run à vide `e2e-l2ter-s01-clean.log`. |

### 2.3 Comment je l'ai établi

À partir des `layouts` persistés de `bench-corpus-a-1788662464-0` :
comptes finals [577, 323] contre `pre` [525, 375] (52 pièces passées de
la donneuse à la receveuse) ; les paires fautives sont toutes sur la
tôle 1 ; les poses 95-98 sont alignées (rotation 0, y = 917,5-918,0,
x = 362 / 410 / 451) alors que les poses 263 et 304 ont des voisines
dispersées (rotations mixtes, y de 77 à 863) — signature d'une rangée
receveuse déposée à ses coordonnées d'origine sur la donneuse, au-dessus
de fans moteur de la donneuse. Le code de retour (X1.2 + `_validate_return`)
explique exactement pourquoi ce recouvrement n'est jamais testé ; le
rollback de compaction qui suit restaure cet état fautif (son snapshot
est pris après la fusion), d'où « survit au rollback ».

## 3. Plan L2-quater (0,5 jour)

1. **AD1 — validation des rendues d'origine receveuse.** Dans
   `_merge_fill_compact_receivers`, séparer `remaining` en
   `remaining_donor` (origine donneuse : légales entre elles et contre la
   donneuse intacte → `_validate_return` comme aujourd'hui) et
   `remaining_recv` (origine receveuse) ; ces dernières passent par
   `_validate_batch(remaining_recv, donor, …)` (nouvelles contre **toute**
   la donneuse, y compris les rendues donneuses, et entre elles, bornes
   tôle comprises) ; échec → `_CompactRollback("restore")` avec
   `rollback_reason = "restore-recv-on-donor"`. Miroir JS dans
   `validateReturn` / la passe fusionnée. Alternative plus simple si la
   séparation est lourde : ne rendre sur la donneuse **que** les pièces
   d'origine donneuse, et remettre les receveuses non posées sur la
   receveuse **après** validation batch (elles y étaient légales avant la
   passe ; si le lattice occupe leur place, rollback).
2. **Test** : fixture deux tôles, une candidate receveuse dont les
   coordonnées d'origine coïncident avec une fan libre de la donneuse non
   re-posée → avant correctif la passe « réussit » avec un chevauchement
   (la ceinture le rattrape) ; après correctif → rollback tracé
   `restore-recv-on-donor`, aucune ceinture. Python + vitest.
3. **AD3** : persister `_pre_layouts` (poses compactes) dans le
   diagnostic d'écartage et dans `postPass` quand `residualRolledBack`
   est vrai ; script `bench/replay_residual.py` qui rejoue
   `fill_residual_bands` sur ce snapshot et imprime l'étape et les paires
   fautives — pour confirmer AD1 sur les deux récidives déjà en base.
4. **Vérification** : 30 bancs T-A@2 → 0 écartée **et 0 ceinturée** ;
   corpus ; e2e 0,1 / 2 ; le résidu de la ceinture reste en place comme
   filet.
5. AD5 : ceinture différentielle sur les pièces modifiées (Python + JS,
   même résultat qu'aujourd'hui sur les fixtures de test), et durée de la
   mesure ajoutée à `postPass` pour la journée P8. Verrou : gel < 0,5 s
   sous charge sur `qa-e2e-freeze.mjs` 0,1 et 2.

## 4. Suite

Déployer L2-ter (GO), enchaîner L2-quater (une demi-journée, même
implémenteur), puis lot 3 (T1 du masterplan).

## 5. Vérification de L2-quater (commits `0f2e0c2..fc086e8`) — 2026-09-06, 9 h

Contrôles : `assert_images_head.sh` OK contre HEAD `fc086e8` ; relecture des
diffs (`residual.py`, `residualClient.js`, `main.py`, tests, `replay_residual.py`) ;
vitest, pytest docker ; 10 bancs serveur T-A séquentiels (2 à 0,1, 8 à 2)
avec `discardedAlternatives` et `residualRolledBack` ; e2e navigateur 0,1
et 2 instrumentés ; physique ; corpus ; **test direct de la ceinture JS
différentielle** (fichier `l2quater-verif/belt_blindspot.test.js`).

### 5.1 Conforme

- **AD1 (Python)** : les non-posées d'origine receveuse retournent sur la
  receveuse à leur pose d'origine et passent par `_validate_batch` contre
  toute la receveuse (lattice compris) et entre elles ; échec → rollback
  `restore-recv` ; les rendues donneuses gardent le chemin Y2 (exemption
  valide : même tôle d'origine). C'est la variante 2 du plan, correcte.
  Test Python pertinent (fan receveuse posée sur une fan donneuse → jamais
  sur la donneuse, de retour sur sa tôle, ceinture muette).
- **AD1 (JS)** : miroir structurel correct (`recvIds` par identité,
  `validateBatch` sur la receveuse). Le test vitest est faible : il accepte
  tout résultat où `n > 0` et attend une raison `restore-recv-on-donor`
  qui n'existe pas dans le code (`restore-recv`) — à resserrer comme le
  test Python.
- **AD3** : `preLayouts` persisté, `replay_residual.py` rejoue moteur →
  expansion → hole-fill → résiduel. Conforme.
- **AD5 (Python)** : diff multiset entrée/sortie, grille complète,
  vérification restreinte aux pièces touchées, `j == i` (toutes les paires
  d'une pièce touchée, quel que soit l'ordre des index). Exact.

### 5.2 À corriger

| Id | Sév. | Constat | Preuve |
|---|---|---|---|
| **AE1** | **M (filet navigateur aveugle)** | `exactOverlapArea` JS garde le `if (j <= i) continue` de la version complète tout en sautant les `i` non surveillés : une pièce **nouvelle** (index élevé — les poses de lattice sont ajoutées en fin de liste) qui recouvre une pièce **ancienne** d'index inférieur n'est **jamais comptée**. C'est exactement le motif du défaut (nouvelles poses sur anciennes fans). Le Python a été corrigé (`j == i`), le JS non. Test direct : deux carrés superposés, ancien à l'index 0, nouveau surveillé à l'index 1 → mesure complète 1, mesure différentielle **0** ; l'inverse (nouveau à l'index 0) → 1. Le test vitest livré empile deux pièces **toutes deux nouvelles**, d'où sa réussite. | `residualClient.js:1320-1330` ; `l2quater-verif/belt_blindspot.test.js` (1 échec / 2). |
| AE2 | m | Test vitest AD1 permissif (voir 5.1). | `app/tests/residualClient.test.js`. |
| **AE3** | **B (régression fonctionnelle)** | La variante 2 telle qu'implémentée **désactive de fait la passe fusionnée** sur le cas de référence : à space 2, la fusion est annulée avec la nouvelle raison `restore-recv` dans **7 bancs sur 8** (et dans l'e2e navigateur), contre 1 rollback sur 8 avant L2-quater (fusion acceptée 5/8 : 555-557/343-345, moved 400). Mécanisme : les candidates d'origine receveuse non re-posées reviennent sur la receveuse **à leur pose d'origine**, or le lattice vient précisément d'occuper cette zone → `_validate_batch` échoue → rollback intégral. Le gain X1 (+31 fans sur la tôle 1 à space 2) est perdu. Sur T-A l'indicateur visible (chute) n'en souffre pas, car la compaction de la dernière tôle est de toute façon annulée (`front`), mais la passe ne remplit plus son rôle sur les géométries où fusion + compaction gagnent. Le rapport L2-quater (« 30 bancs, 0 écartée, 0 ceinturée ») ne mesurait pas le taux d'acceptation de la fusion. | Mongo, `mergedRollbackReason` : avant (`…59150/59183/59214`, `…74108/74140`) = fusion acceptée ; après (`…77011/77030/77054/77117/77149/77181/77206`) = `restore-recv` ; e2e `e2e-l2quater-s2/full.json` idem. |

Correctif AE3 (une demi-journée) — **cascade** au lieu de la variante 2
seule : pour chaque candidate d'origine receveuse non re-posée, (1)
essayer la donneuse à sa pose d'origine, validée par `_validate_batch`
contre toute la donneuse **y compris les rendues donneuses** (c'est la
variante 1, mais pièce par pièce, sans rollback intégral) ; (2) sinon la
receveuse à sa pose d'origine, validée par batch (variante 2) ; (3) sinon
rollback tracé `restore-recv`. Miroir JS. Nouveau verrou chiffré : sur
8 bancs T-A à space 2, fusion acceptée dans au moins 4 (référence
555 ± 3 / 345 ± 3, moved 400) **et** 0 écartée / 0 ceinturée ; ajouter le
taux d'acceptation (`mergedReceivers` / jobs) à `eval_corpus.py`. Le test
T9 qui a fait abandonner la variante 1 doit être relu : si sa fusion
« légitime » livrait un chevauchement receveuse-sur-donneuse, c'est le test
qui était faux.

Correctif AE1 (10 minutes) : dans `exactOverlapArea`, remplacer
`if (j <= i) continue` par `if (j === i) continue` et dédoublonner par clé
`min(i,j) * n + max(i,j)` (le `seen` existe déjà), ajouter le test
`belt_blindspot.test.js` à la suite, rejouer `qa-e2e-freeze.mjs` 0,1 et 2
(le coût double au plus pour les pièces touchées : rester < 0,5 s).

### 5.3 Mesures

| Mesure | L2-ter | L2-quater | Cible |
|---|---|---|---|
| Job serveur T-A 0,1 / 2 | 15,6-19,2 / 16,5-29,5 s | 16,5-16,7 / **16,4-27,6 s** | 15-25 s |
| Grille 0,1 / 2 | bit-identique | [587, 313] · 580,4 / [573, 327] · 544,1, 10/10 | idem |
| Fusion acceptée à space 2 (`mergedReceivers = 1`) | 5/8 (+1 `count`, +1 `restore-donor`, +1 `front` seul) | **1/8** (7 × `restore-recv`) | ≥ 4/8 |
| Compaction serveur 2, comptes / chute | 555-557/343-345 · 479 ; 541/359 · 457 | 525-529/371-375 · 511-520 (état moteur, fusion annulée) ; 678/222 · 490 | — |
| Alternatives écartées / ceinturées | 0 / 0 sur 10 | 0 / 0 sur 10 | 0 |
| Navigateur, calcul 0,1 / 2 | 27 / 15 s (charge) | 27 s (pytest en parallèle) / 24 s | 8-12 s |
| Gel fin de calcul 0,1 / 2 | 0,35 s à vide ; 0,62-0,71 s sous charge | **0,44 s sous charge**, 0,25 s à vide / **0,31 s** | < 0,5 s |
| Physique navigateur 0,1 / 2 | OK | OK / OK (min-dist 1,999 à space 2 = résidu moteur connu) | OK |
| Corpus | 11/11 | **11/11** | 11/11 |
| vitest / pytest | 449 / 232 + 1 | **450** / **233 + 1** | vert |

Artefacts : `docs/qa/perf-audit-2026-09-05/l2quater-verif/`.

### 5.4 Verdict

**Pas de GO déploiement pour L2-quater en l'état.** AD3 et AD5 (Python)
sont bons, la cause racine est bien celle démontrée, mais le correctif
choisi annule la passe fusionnée dans 7 cas sur 8 sur le cas de référence
(AE3), et le filet navigateur est aveugle au motif du défaut (AE1). Deux
corrections courtes (cascade donneuse → receveuse → rollback, `j === i`
dans la ceinture JS), un verrou chiffré sur le taux d'acceptation de la
fusion, puis re-vérification. L2-ter reste déployé et sûr : sa ceinture
serveur couvre le cas pendant ce temps.

## 6. Vérification de L2-quater v2 (commits `7d66854..fb5e184`) — 2026-09-06, 11 h 30

Contrôles : `assert_images_head.sh` OK contre HEAD `fb5e184` ; relecture des
diffs (cascade à trois étapes Python et JS, diagnostic `recvCascade`,
ceinture JS `j === i` + clé symétrique + pré-filtre bbox par paire +
exemption trou avant `ringsOverlap`, tests) ; propreté des commits après
l'incident `git add -A` (un seul fichier ajouté : `belt_blindspot.test.js`,
`.gitignore` étendu) ; vitest, pytest docker ; 10 bancs séquentiels avec
lecture de `mergedReceivers` / `mergedRollbackReason` ; e2e 0,1 et 2 ;
physique ; corpus.

| Mesure | v1 (variante 2) | **v2 (cascade)** | Cible |
|---|---|---|---|
| Fusion acceptée à space 2 | 1/8 (7 × `restore-recv`) | **6/8** (1 × `restore-recv`, 1 × `count`) | ≥ 4/8 |
| Compaction serveur 2, comptes · chute | 525-529/371-375 · 511-520 | **557/343 · 479 ; 555/345 · 479 ×2 ; 555/345 · 457,5 ; 577/323 · 479 ; 577/323 · 486,8** ; rollbacks : 528/372 · 516 ; 539/361 · 518 | référence 555 ± 3 / 345 ± 3 |
| Alternatives écartées / ceinturées | 0 / 0 | **0 / 0** sur 10 | 0 |
| Job serveur T-A 0,1 / 2 | 16,5-16,7 / 16,4-27,6 s | 17,5-18,9 / **16,6-30,3 s** (la cascade et son diagnostic ajoutent 1 à 3 s quand elle joue) | 15-25 s |
| Grille 0,1 / 2 | bit-identique | [587, 313] · 580,4 / [573, 327] · 544,1, 10/10 | idem |
| Gel navigateur 0,1 / 2 | 0,25 s à vide / 0,31 s | **0,35 s** (pytest en parallèle) / **0,37 s** | < 0,5 s |
| Physique navigateur 0,1 / 2 | OK | OK / OK (navigateur space 2 : fusion **acceptée**, 555/345 · 482,3) | OK |
| Corpus | 11/11 | **11/11** (T-F 90/90 ce run ; `FUSION: acceptée 1/11` — seul T-A fusionne, attendu) | 11/11 |
| vitest / pytest | 450 / 233 + 1 | **452** (dont `belt_blindspot` 2/2) / **233 + 1** | vert |

### 6.1 Relecture

- **AE3 (cascade)** : pose par pose, chaque pose acceptée persiste avant la
  suivante ; (1) donneuse validée par batch contre toute la donneuse (rendues
  comprises), (2) receveuse validée par batch, (3) re-relais **en lot** des
  fans sans pose valide (receveuse puis donneuse, `min_poses = 1`), sinon
  rollback `restore-recv`. Les pièces en re-relais sont détachées des deux
  tôles pendant l'essai ; `_fill_one_batch` / `fillOneBatch` tolèrent une
  pièce absente de la source (retrait par identité gardé). Rollback = snapshots
  des deux tôles. Correct, et le gain de la fusion est de retour.
- **AE1** : `j === i`, clé `min·n + max`, pré-filtre bbox par paire (exact),
  exemption trou avant `ringsOverlap` (exact : une fan dans un trou n'est pas
  un chevauchement de matière quel que soit le résultat du test d'anneaux).
  Mon test adopté (2/2).
- **AE2** : test réécrit sur l'invariant (pose propre, mesure exacte à zéro
  autour de la fan). Conforme.

### 6.2 Résidus (non bloquants)

- `stats.recvCascade.okRelayed` est écrit **avant** le re-relais : toujours 0
  dans le diagnostic (le compteur vit après). À déplacer.
- `_fail_kind` reconstruit une occupancy STRtree par fan en échec et par tôle
  (4 à 10 fans par run) : 1 à 3 s de post-pass serveur quand la cascade
  joue ; à restreindre (STRtree construite une fois par tôle) lors de P8.
- Le taux de fusion dépend de la charge machine (variance Y6 du moteur) :
  le verrou « ≥ 4/8 » doit rester une mesure sur bancs séquentiels, images =
  HEAD, pas sur une file.

### 6.3 Verdict

**GO déploiement de L2-quater v2.** Les deux défauts du tour précédent sont corrigés et prouvés : la fusion est de retour (6/8 serveur, acceptée aussi dans le navigateur à space 2), la ceinture JS voit le motif du défaut, aucune alternative écartée ni ceinturée sur 10 bancs, suites, corpus et physique verts, gel sous 0,4 s. Les résidus 6.2 vont dans la journée P8. Après déploiement : lot 3 (T1 du masterplan).
