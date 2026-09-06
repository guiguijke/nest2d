# Rapport d'implémentation — L2-ter (AC1-AC6) — 2026-09-06

Réponse au plan `PLAN-CORRECTIF-PERF-UX-L2-TER-2026-09-06.md`. **Non
déployé — attend la vérification.** Le lot 2 + L2-bis est en prod depuis
le 06/09 04h30 UTC (743aa1d) ; ce lot est le chantier cause racine.

## Résumé en trois lignes

1. L'instrumentation AC1/AC2 a fait son travail : le rejet s'est reproduit
   (2 fois sur 60 bancs cumulés) et le diagnostic dit **origin =
   post_pass** — l'expansion pinwheel (hypothèse n°1 du vérificateur) est
   ÉCARTÉE, le moteur aussi (snapshots propres).
2. La cause précise est le **pass résiduel** : des poses de lattice en
   bande haute (y≈910-940, rotations mixtes 0/±90) restent en chevauchement
   dans l'état restauré par le rollback de compaction — les gardes du pass
   jugent des anneaux SIMPLIFIÉS avec tolérances (A14) et laissent passer
   21-310 mm² de recouvrement réel.
3. Correctif livré = **invariant exact demandé par le plan** : ceinture
   différentielle dans `fill_residual_bands` (anneaux bruts, intra-tôle,
   avant/après) — un pass qui salit restaure l'état d'entrée. **30 bancs
   finaux : 0 écartée, 1 ceinturée** (récidive attrapée et convertie en
   alternative valide moins compacte).

## AC1 — Attribution par étage (le « engine » faux)

**Fait.** `engine_alt["_pre_layouts"]` = deepcopy APRÈS remap des ids,
AVANT expansion. `_record_discard` vérifie (1) le snapshot moteur, (2)
l'expansion seule REJOUÉE sur une copie du snapshot (`expand_meta` ou
`expand_packs` selon le pré-pass), (3) l'état final → `originStage` ∈
{engine, expand, post_pass}. Test ×3 (`test_discard_observability.py`) :
expansion forcée en chevauchement → « expand » ; moteur sale → « engine » ;
passe finale sale → « post_pass ».

**Sur les 60 bancs** : les deux occurrences donnent
`originStage = "post_pass"`, `preVerification.overlapFree = True`,
`expandVerification.overlapFree = True` — vos deux défauts signalés
(attribution toujours « engine », pré-vérification = état final) sont
corrigés et la mesure tranche votre hypothèse n°1.

## AC2 — Rejeu hors ligne possible

**Fait.** `discardedAlternatives[]` porte désormais : `layouts` (poses
compactes `[item_id, rot°, tx, ty]` par tôle), `postPass` de
l'alternative, paires par **POSE** — `{sheet, idxA, idxB, itemA, itemB,
areaMm2, centroid}` (cap 20) — et les **SVG GridFS** suffixés
`_discarded` (même purge 24 h que le reste).

## AC3 — Cause racine et correctif

**Reproduction.** 60 bancs T-A@2 séquentiels (30 + 30) sur images = HEAD :
2 occurrences (bench-corpus-a-1788662464 et -1788663539), signature
identique : 3-8 paires fan-fan, 21-310 mm², bande haute tôle 2
(y≈910-940), `duplicatePoses 0`, hôtes épargnés, postPass
`mergedReceivers: 1` + `compactRollback: true (front)`.

**Attribution.** Le chevauchement survit dans l'état que le rollback de
compaction restaure (= état post-merge). Les poses fautives sont des
poses de lattice (rotations alternées) — pas des poses pinwheel (les
jumeaux de trou sont à distance 0 au même centroïde ; ici offsets de
13-30 mm). Le moteur et l'expansion sont propres (AC1). Le déficit
précis : les gardes du pass (`_validate_return` tolérance A14, anneaux
simplifiés `_SIMPLIFY_MM = 0,05`) acceptent des états que la vérification
exacte du filet final (anneaux bruts) rejette.

**Correctif (invariant du plan).** Ceinture exacte dans
`fill_residual_bands` (Python + miroir JS `residualClient`) : mesure de
l'aire de chevauchement cumulée sur anneaux BRUTS, **au sein de chaque
tôle** (les tôles BPP partagent le repère — comparer à travers comptait
des coïncidences fictives, 48 paires sur le fixture T3 : corrigé), avant
et après le pass ; dégradation > 0,05 mm² (Python) / > 0 (JS) →
restauration du snapshot d'entrée, `moved = 0`,
`stats.residualRolledBack = True` + erreur tracée. La mesure vit DANS le
try (géométrie sabotée → filet A5, pas de raise hors pass).

**Preuve du GO.** 30 bancs finaux : **0 alternative écartée** ; la
récidive est survenue 1 fois et a été **ceinturée** (« chevauchement
0,00 → 37,58 mm², état d'entrée restauré ») — l'alternative est restée
livrée et découpe. 29 passes normales : ceinture muette (aucune
restauration intempestive — vérifié : aucune trace residualRolledBack
sur les 29).

**T-L.** La pose fautive n'est pas reproductible déterministement côté
moteur (budget mur, variance Y6 — 2/60 selon la charge). Le cas est donc
verrouillé en TEST (`test_residual_belt.py` ×3, miroir test dans les
fixtures) : relais qui pose deux candidates au même point → ceinture
restaure + trace ; relais propre → inchangé ; la mesure exacte compte
les recouvrements réels. Un T-L de corpus figé exigerait un seed moteur
déterministe par itérations pures (P10).

## AC4/AC5/AC6

- **AC4** : formatage des call sites corrigé à la main (un `cargo fmt`
  global reformaterait tout le workspace jamais formaté — diff massif
  hors sujet ; les 5 fichiers touchés sont propres).
- **AC5** : hashes du rapport L2-bis corrigés (`2da3e5a`, `048cf20`,
  `758a156`).
- **AC6** : miroir navigateur — les gardes de `localJobPrivate`
  enregistrent `localDiscarded` (raison, stratégie, vérification),
  persisté dans le record IndexedDB (`discardedAlternatives`) et hydraté
  en `discardedCount` (badge replié existant). **Bug trouvé et corrigé
  par l'e2e** : la déclaration était dans une portée de bloc →
  ReferenceError APRÈS le post de quota (job réussi affiché en crash) —
  déplacée en portée fonction.

## Verrous — tous verts (images = HEAD à chaque banc, AB3)

| Verrou | Résultat |
|---|---|
| 30 bancs T-A@2 (critère GO du plan) | **0 écartée, 1 ceinturée** (récidive convertie) |
| corpus T-A..T-K | **11/11 OK** (T-A [587, 313] bit-identique, T-J REFUS, T-F PARTIEL attendus) |
| pytest (docker) | **224 passed, 1 skipped** (+3 ceinture, +3 observabilité) |
| vitest complet | **449/449** |
| e2e 0,1 / 2 / refus 4 mm | exit 0 / exit 0 / **GO 2,2 s** — calcul 6 s |
| determinism_lock | inchangé (aucun changement moteur ce lot) |

## Non-GO / limites honnêtes

1. La **micro-cause** exacte (quelle sous-étape du merge/compaction pose
   les fans fautives) reste ouverte : la ceinture neutralise le défaut
   (l'alternative reste livrée), mais le pass perd ~150 déplacements quand
   elle déclenche (1/30). Le rejeu pas-à-pas exige le snapshot moteur
   persisté — livrable rapide si vous le demandez (AC2 a tout ce qu'il
   faut sauf `_pre_layouts` dans le diagnostic).
2. T-L corpus figé : impossible déterministement en l'état (budget mur) —
   verrouillé en tests ; un vrai T-L viendra avec P10 (seed par
   itérations).
3. La ceinture JS compte des PAIRES (pas des aires) — seuil binaire
   légèrement plus sensible que le Python (0,05 mm²) : miroir acceptable,
   documenté.
