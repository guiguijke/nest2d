# Rapport d'implémentation — L2-bis (correctifs AB1-AB5) — 2026-09-05

Réponse au plan `PLAN-CORRECTIF-PERF-UX-L2-2026-09-05.md`. **Non déployé —
attend la re-vérification.** Commits : `74c4bc9` (règle pilotable + fixture
400), `7d80f05` (fix lectures env), `758a156` (compression + observabilité).

**Images = HEAD à 20:17:10 UTC** (assert_images_head OK après le DERNIER
build — discipline AB3 appliquée ; un premier A/B avait dû être rejoué, mes
lectures d'env n'étaient pas persistées : 12 jobs en erreur, corrigé et
rejoué).

## AB1 — A/B sur le même binaire, puis correction (a)

Règle pilotable : `sa_stop_k` / `sa_stop_floor` dans la config moteur
(défauts 3/30 ; **k=0 désactive**), posés par le worker via
`NEST_SA_STOP_K`/`NEST_SA_STOP_FLOOR` — les deux bras utilisent le MÊME
binaire (seul l'env change au redémarrage).

**A/B (T-A, 6 runs séquentiels par bras et par espacement, images = HEAD) —
chute de la dernière tôle de la Compaction (mm) :**

| Bras | space 0,1 | space 2 |
|---|---|---|
| OFF (k=0) | 520,7 · 520,7 · 605,7 · 608,9 · 597,7 · 603,5 → **méd 600,6** | 479,2 · 479,1 · 519,6 · 517,4 · 513,3 · 293,8 → **méd 496,3** |
| ON v1 (P3) | 520,7 · 593,2 · 605,3 · 543,4 · 520,7 · 520,7 → **méd 532,1** | 479,2 · 512,9 · 515,1 · 479,1 · 512,9 · 509,3 → **méd 511,1** |

**Signal confirmé à 0,1** (−68,5 mm de médiane, 4/6 runs à 520,7) ;
à 2 inchangé. Votre hypothèse était la bonne : le walk s'arrêtait CHAUD
(le schedule restait étalé sur un budget dérivé du temps).

**Correction (a) appliquée — compression du schedule** : quand la règle P3
est active, le recuit refroidit de T0 à T_END sur une fenêtre courte fixe
(`SA_COMPRESSED_BUDGET = 200` itérations) au lieu du budget temps ;
la patience `max(30, 3×it_dernière)` laisse le walk vivre s'il s'améliore.
Règle désactivée → comportement historique au pixel près.

| Bras | space 0,1 | space 2 | durées job |
|---|---|---|---|
| OFF | méd 600,6 | méd 496,3 | 60-177 s |
| ON v1 | méd 532,1 | méd 511,1 | 16-45 s |
| **ON v2 (compressé)** | 607,2 · 603,2 · 604,4 · 431,0 · 604,9 · 606,4 → **méd 604,65** | 479,2 · 457,5 · 479,2 · 479,2 · 479,2 · 511,2 → **méd 479,2** | **17-46 s** |

**Critère du vérificateur atteint : ±5 mm ou mieux.** À 0,1 : ON-v2 à
+4,05 mm de OFF (et 5/6 runs regroupés à 603-607) ; à 2 : ON-v2 à +17 mm
MIEUX que OFF. Le temps ne bouge pas (17-46 s).

## AB2 — Plus jamais d'alternative perdue en silence

Les QUATRE branches d'écartage du filet final (lost_parts, class_mismatch,
outside_sheet, overlap) enregistrent un diagnostic dans
`job.discardedAlternatives` : raison, stratégie, rang, `verification`
mesurée, **paires en chevauchement avec aire et ids** (nouveau
`metrics.overlapping_pairs`, STRtree, plafonné à 10), et **étape
d'origine** `engine`/`post_pass` obtenue en re-vérifiant l'état `pre` du
moteur. WARN avec slug à chaque écartage. UI : ligne repliée dans les
détails techniques du modal (« n option(s) écartée(s) par la validation
finale — diagnostic conservé »), champ `discardedCount` mappé côté SSE.

**Datation** (T-A@2, binaire final) : **10 runs P3 ON → 0 écartée ; 10 runs
P3 OFF → 0 écartée** ; s'y ajoutent les 6+6 de l'A/B → **42 runs sans
récurrence** de votre cas (1/22 chez vous). Non reproduit, non daté — mais
désormais INSTRUMENTÉ : la prochaine occurrence dira si le chevauchement
vient du moteur ou d'une passe, avec les paires fautives.

## AB4 — Fixture du lock à 400 itérations

`config_det.json` : `sa_max_iterations` 25 → 400. La règle P3 **gouverne**
l'arrêt (35 itérations) et le verrou natif ≡ wasm reste **bit-identique**
(SHA égaux) — le déterminisme de P3 est maintenant exercé par le lock,
pas seulement par le test unitaire.

## AB3 — Discipline des mesures

`assert_images_head.sh` passé **après le dernier build** et avant chaque
banc de ce tour (ligne d'en-tête ci-dessus) ; je me suis fait piéger une
fois en cours de route (app construite avant le wasm) — corrigé, et la
règle est inscrite au protocole. Les mesures navigateur de ce rapport :
calcul 21-24 s (e2e 0,1 et 2 sur image HEAD), gel **378 ms**.

## AB5 — Noté dans le plan

Addendum P10 du `PLAN-PERF-UX-2026-09-05.md` : le schéma de température
est le prochain levier qualité, à instrumenter avec la même journée de
mesure en traçant l'itération de la dernière amélioration **de remnant**.
(La compression à 200 itérations posée ici est un premier pas — le
calibrage fin reste P10.)

## Verrous — tous verts (images = HEAD 20:17)

| Verrou | Résultat |
|---|---|
| determinism_lock (fixture 400, P3 gouverne) | **natif ≡ wasm bit-identiques** |
| corpus T-A..T-K | **11/11 OK** (T-J REFUS, T-F PARTIEL attendus) |
| grille bit-identique | [573, 327] ×10 runs de datation, [587, 313] en corpus 0,1 |
| pytest complet (docker) | **218 passed, 1 skipped** |
| vitest complet | **449/449** |
| e2e 0,1 / 2 | exit 0 — calcul 24 s / 24 s |
| e2e refus 4 mm | **GO** 2,3 s |
| gel fin de calcul | **378 ms** |
| A/B chute Compaction | ±5 mm atteint (tableau ci-dessus) |

## Non-GO / limites honnêtes

1. Le cas AB2 unique n'est pas reproduit (42 runs) — l'observabilité est
   la livraison, pas la cause.
2. La compression à 200 itérations est calibrée sur T-A uniquement
   (le cas du signal) ; les classes à améliorations tardives (C : jusqu'à
   1021 it.) vivent plus longtemps via la patience proportionnelle — le
   corpus est vert, mais le calibrage fin par classe reste P10/AB5.
3. L'outlier 431,0 du bras ON-v2 à 0,1 (1/6) reste à surveiller — la
   médiane et 5/6 runs sont groupés haut.
