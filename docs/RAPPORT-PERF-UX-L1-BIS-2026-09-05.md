# Rapport d'implémentation — Lot 1-bis (correctifs AA1-AA8) — 2026-09-05

Réponse au plan correctif `PLAN-CORRECTIF-PERF-UX-L1-2026-09-05.md` (vérification
du lot 1, verdict « pas livrable tel quel »). Implémenté par constat, verrous
rejoués sur le build final. **Non déployé** — attend validation puis GO.

## AA1 — Une seule définition de la densité, mesurée (bloquant)

**Fait.**

- `app/utils/resultQuality.js` (nouveau, testé) : `altDensityPctOf` lit
  `alt.report.totals.densityPct` (mesuré par `metrics.report_totals` /
  `compute_report` = Σ aires pièces / Σ aires tôles, déjà en %) ; repli sur
  `alt.density` UNIQUEMENT si l'alternative n'a pas de rapport (jobs
  antérieurs). `whyFirstKind` décide de la justification du rang 0.
- `ResultModal.vue` : `densityPct`, `altQualityLine`, `headlineTitle` et les
  DEUX barres (sommaire + rapport) passent par `altDensityPctOf`.
- `UserResultItem.vue` (carte de l'aside) : même source, libellé
  `result.densityShort` (« 55,4 % matière ») — plus jamais `result.used`.
- `whyFirst` : affiché au rang 0 seulement si la chute du rang 0 est
  maximale (à 1 mm² près) ; sinon nouvelle clé `result.whyFirstGrid`
  (« rangées régulières, découpes prévisibles ») — la phrase ne ment plus.
- Normalisation du champ STOCKÉ (recommandé) : `main.py`
  `_finalize_alternative` et `localBridge.js` `toServerShapeAlternatives`
  posent `alt.density` = totals.densityPct/100 pour l'alternative moteur —
  l'accueil et les listes n'ont plus deux échelles. La densité moteur
  (matière/emprise) reste celle des frames live.

**Preuves.** e2e space 0,1 : onglets « Option 1 · 2 sheets · **55.4% material**
· offcut 580.4 mm × 1000 mm » et « Option 2 · **55.4% material** · offcut
603.7 mm × 1000 mm » — même chiffre, même définition. `qa-c02c03-modal.mjs`
(renforcé) : spread des densités **0,00 pt** ; aires de chute
[580 400, 603 700] mm² → whyFirst affiche la variante « regular rows »
(véridique) ; carte aside « 55.4% material · 2 sheets », zéro « % used ».
Test vitest dédié `resultQuality.test.js` (10 cas, dont le banc Fable
580 406 < 599 600 → 'grid').

## AA2 — Une annulation rend la main (bloquant)

**Fait.**

- `files.js` : action `resetLastParams()` (`state.lastParams = ''`).
- Appelée sur TOUTES les annulations : bouton de la vue live
  (`cancelLiveCompute`), bouton de la carte résultat
  (`UserResultItem.cancelNesting`), et annulation venue d'ailleurs via le
  flux SSE — `resultcontroller.js` pose `wasCancelled: true` (le statut
  brut « cancelled » était mapé « failed »), la page projet le surveille
  (`belongsToProject`) et réarme.
- `liveCancelling` : réarmé dans un `finally` ET sur changement de
  `cancellableLiveSlug` (nouveau calcul = bouton frais).

**Preuves.** `qa-c01-cancel-live.mjs` étendu à DEUX cycles avec la VRAIE
assertion (`isDisabled`) : après Cancel, bouton Nest **disabled = false**,
relance SANS changer un paramètre, live-cancel **« Cancel » / disabled =
false** au second calcul, seconde annulation effective, scène libérée deux
fois. (Votre script `l1-verif/qa-c01-renest.mjs` couvre le même scénario —
le mien ajoute le `isDisabled` explicite.)

## AA3 — Finir le gel (2,7 s → 260 ms)

**Fait, avec une extension mesurée au-delà du plan.**

- (a) `localBridge.js` : `_jsPinwheelCapacity` mémoïisée (Map module,
  4 096 entrées, valeur copiée) — miroir exact de
  `_pinwheel_capacity_cached` (même clé : anneaux joints + space +
  rotations) ; paie sur le double appel d'`applyHoleFill` par alternative
  et les trous multi-membres.
- (b) `residualClient.js` `pairViolates` (régime space > ε) : test d'un
  sommet strictement intérieur (`pointStrictlyInside`, O(n)) avant
  `ringDist`, comme prescrit.
- (c) `localJobPrivate.js` : `markRaw(result)` + `markRaw(payload)` avant
  les passes et la finalisation (le profil V8 montrait 0,15 s de proxy
  `get`).
- **Extension mesurée** (le plan laissait le gel à 1,3 s après (a)(b)(c),
  cible non atteinte — profil V8 : le restant était la RECHERCHE DE PAS de
  `smallLattice`, pas `pairViolates`) :
  1. `ringDistBelow(c1, c2, threshold)` (structureClient) : prédicat
     « min < seuil » à sortie anticipée — même `segSegDist`, même ordre de
     parcours que `ringDist`, donc exact ; faux ⇒ d ≥ seuil > 0 ⇒ la
     branche `containedOverlap` W4 est exactement celle de l'original.
     Utilisé dans `pairViolates` (régime space > ε) et dans
     `tryPitchOn` (dichotomie de pas).
  2. Pré-filtre bbox PAR SEGMENT dans `ringDistBelow` : rejet par axe
     (l'arête B tout entière d'un côté de la bbox de A gonflée de
     `threshold` ⇒ distance ≥ threshold). C'est le P1 du lot 1 appliqué au
     niveau inférieur.
  - Rejeté en route : un cache de la recherche de pas par (anneau, space)
    — la validation du patch 5×8 est écrêtée par la ZONE (sous-ensemble de
    paires différent par bande) ; il cassait la parité Python
    (`small lattice invalide`). Réverté, verrous repassés.

**Preuves.** `qa-e2e-freeze.mjs` (votre script) : long task max fin de
calcul **260 ms à space 0,1** (rollback) et **294 ms à space 2** — cible
< 0,5 s atteinte. Cumul des long tasks pendant le solve : 28 s (183
tâches) → **0,4 s**. Verrous : replayUserBpp bit-identique, parité D9
(509 = 509), latticeScallop, 449/449 vitest.

**Note d'exactitude (transparence).** Le test sommet (b) est exact dans
tous les cas atteignables SAUF une géométrie pathologique : anneau A
entièrement inclus dans un hôte concave B SANS croisement, avec le
centroïde de A dans l'encoche de B (hors matériau) — l'original renvoyait
false (`containedOverlap` au centroïde), le raccourci renvoie true (plus
conservateur : c'est un vrai chevauchement matière que l'ancien code
laissait passer). Aucune divergence observée sur corpus/replay/physique.

## AA4 — Décorer moins (option b retenue)

**Fait.** `main.py` : `decorate_live_items(..., apply_fill=False)` en live
— plus d'`apply_hole_fill` par frame, seule l'expansion des fans reste
(~10 ms). La vue live montre les hôtes non remplis ; le remplissage
apparaît au résultat final (assumé par le plan). La densité mesurée reste
calculée.

**Preuves.** Corpus 11/11 sur le worker corrigé (T-A [587, 313]
bit-identique — le résultat final ne dépend pas de la décoration live).
La mesure CPU du décorateur (< 2 s / min de solve) est à faire pendant la
journée de mesure P3 avec `sample_threads.sh` — non re-mesurée ici, le
coût dominant (apply_hole_fill par frame) est supprimé par construction.

## AA5 — Arrêt sûr du décorateur

**Fait.** Mécanique extraite dans `workers/nesting/core/livedeco.py`
(`LiveDecorator` : drapeau d'abord, sentinel pour réveiller un `get()`
bloquant, join) ; `main.py` l'utilise. Test unitaire
`test_livedeco.py` (3 tests) : **file pleine à l'arrêt → thread terminé
< 1 s** (mesuré 0,3 s de décorations en cours + sortie immédiate, frame
en attente ABANDONNÉE, jamais décorée après stop), coalescing drop-stale,
submit après stop no-op.

## AA6 — Compteur IP sur les échecs seuls

**Fait.** `login.post.js` : `login-ip` passe en peek/incrément-échec/reset
(réussite), limite **50 / 15 min** pour les échecs ; même mécanique que
`login-email` (5/15 min). `denyRateLimit` porte code + délai pour les
deux.

## AA7 — Rapport corrigé

Les formulations surévaluées du rapport L1 sont remplacées par le présent
rapport (chiffres mesurés ci-dessus) ; les deux scripts QA portent
maintenant les assertions qui manquaient (égalité des densités,
véracité de whyFirst, `isDisabled` du bouton Nest).

## AA8 — Promotion de P8

**Fait.** Addendum daté ajouté en fin de `PLAN-PERF-UX-2026-09-05.md` :
P8 (STRtree + dry-run lattice) promu au lot 2 ou 4, mesure de référence
9,4 s CPU / 11 s mur, mesure à ajouter à la journée P3 (outillée par
`sample_threads.sh`).

## Verrous du lot — tous verts (build final)

| Verrou | Résultat |
|---|---|
| vitest complet | **449/449** (38 fichiers ; +10 resultQuality, +3 ratelimit, assertion densité corrigée) |
| pytest workers (docker) | **218 passed, 1 skipped** (incl. test_livedeco 3/3) |
| corpus T-A..T-K | **11/11 OK** — T-A [587, 313] bit-identique, T-J REFUS, T-F PARTIEL attendus |
| e2e navigateur 0,1 / 2 | exit 0 — onglets 55,4 % matière ×2, chutes 580,4/603,7 |
| e2e refus 4 mm | **GO** — 3 leviers + actions, 2,2 s |
| gel fin de calcul (qa-e2e-freeze) | **260 ms** (0,1) / **294 ms** (2) — cible < 0,5 s |
| long tasks cumulées pendant le solve | 28 s → **0,4 s** |
| qa-c01-cancel-live (2 cycles, isDisabled) | **OK** |
| qa-c02c03-modal (18 assertions) | **OK** — densités homogènes, whyFirst véridique, carte aside |
| grille bit-identique serveur/navigateur | replayUserBpp + parité structureMulti (vitest) + corpus T-A |

## Non-GO / limitations honnêtes

1. CPU décorateur serveur (cible < 2 s/min) non re-mesuré — la cause
   dominante (apply_hole_fill par frame) est supprimée par construction ;
   mesure à la journée P3.
2. La cible gel a exigé une extension au-delà des trois changements du plan
   (ringDistBelow + pré-filtre segment) — exactitude argumentée ci-dessus,
   verrous bit-identiques verts.
3. La recherche de pas de smallLattice reste intrinsèquement coûteuse côté
   Python (9,4 s mesurés, P8 promu — AA8) ; un cache par (anneau, space)
   est impossible côté JS sans casser la parité (patch écrêté par zone,
   démontré par test).
4. Déploiement NON fait — attend GO. Procédure : build images +
   `assert_images_head.sh`, corpus vert sur images publiées, e2e 0,1/2/4,
   qa-c01 ×2, qa-c02c03.
