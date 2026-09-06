# Vérification de L2-bis (AB1-AB5) + plan L2-ter — 2026-09-06, 4 h

Vérification indépendante des commits `2da3e5a..e4032d3` (rapport
[`RAPPORT-PERF-UX-L2-BIS-2026-09-05.md`](RAPPORT-PERF-UX-L2-BIS-2026-09-05.md),
plan [`PLAN-CORRECTIF-PERF-UX-L2-2026-09-05.md`](PLAN-CORRECTIF-PERF-UX-L2-2026-09-05.md)).
Méthode : `assert_images_head.sh` OK contre HEAD `e4032d3` à mon arrivée
(discipline AB3 respectée) ; aucune variable `NEST_SA_STOP_*` résiduelle
dans les conteneurs (vérifié) ; cargo test, `determinism_lock.py`, vitest,
pytest docker ; **10 bancs serveur T-A séquentiels** (6 à 0,1, 4 à 2) ;
e2e navigateur 0,1 et 2 instrumentés ; physique des SVG ; corpus ;
relecture des diffs (`sa.rs`, `config.rs`, `mod.rs`, `metrics.py`,
`main.py`, UI/SSE). Identifiants **AC** = constats de ce tour.

## 0. Verdict

**GO déploiement du lot 2 + L2-bis.** AB1 est corrigé et confirmé ; AB4,
AB3, AB5 conformes ; AB2 livre l'instrumentation demandée et **elle a
servi dès ce tour** : le rejet d'alternative s'est reproduit chez moi
(1 run sur 4 à space 2) avec un diagnostic exploitable — cinq paires de
fans en chevauchement franc (23 à 309 mm²), ce qui pointe vers
l'expansion pinwheel d'un hôte plutôt que vers le moteur. Deux défauts de
l'instrumentation restent à corriger avant de pouvoir conclure (AC1,
AC2), et la cause racine est le prochain chantier (L2-ter), pas un
bloqueur de déploiement : l'alternative fautive n'est jamais livrée et la
Grille l'est toujours.

## 1. Mesures (images = HEAD `e4032d3`)

| Mesure | Lot 2 (P3 v1) | L2-bis (P3 v2, schéma compressé) | Cible |
|---|---|---|---|
| Compaction serveur **0,1**, chute dernière tôle (6 runs) | 520,7 · 520,7 · 471,6 · 603,5 · 520,7 · 587,1 | **520,7 · 605,9 · 609,5 · 608,9 · 520,7 · 520,7** (3 hautes / 3 basses ; implémenteur : 5/6 hautes) | médiane ± 5 mm de « avant » (600,6) |
| Compaction serveur **2**, chute dernière tôle (4 runs) | 479,2 ×4 | **rejetée** · 457,5 · 479,2 · 457,5 (implémenteur : 479,2 ×4, 457,5, 511) | ± 5 mm de « avant » (méd. 496) |
| Grille 0,1 / 2 | [587, 313] · 580,4 / [573, 327] · 544,1 | identiques, 10/10 | bit-identique |
| Job serveur T-A (création → fin) | 15-19 s | **19-29 s** (pytest docker en parallèle sur 8 runs ; implémenteur 17-46 s) | 15-25 s |
| Navigateur, calcul 0,1 / 2 | 9 s / 9 s | **30 s** / 9 s (charge concurrente) ; implémenteur 21-24 s | 8-12 s |
| Gel fin de calcul 0,1 / 2 | 0,26 / 0,31 s | **0,27 s** / 0,30 s | < 0,5 s |
| Compaction navigateur 0,1 | 603,7 (590/310) | 603,7 (590/310), physique OK | idem |
| Corpus | 11/11 | **11/11** (T-A [587, 313], T-F partiel attendu, T-J refus attendu) | 11/11 |
| cargo / lock (fixture 400) / vitest / pytest | — | 72 + 1 ign. / **SHA identiques, arrêt à 35 it. (P3 gouverne)** / 449 / 226 + 1 | vert |
| Alternatives écartées | 1 / 22 jobs (lot 2) | **1 / 10 bancs** (space 2), diagnostic enregistré | — |

Lecture d'AB1 : à 0,1 les résultats sont bimodaux (≈ 520 ou ≈ 605 mm)
avant comme après ; sur 12 runs P3 v2 cumulés (implémenteur + moi), 8 sont
dans le mode haut, contre 9/12 « avant ». À 2, la médiane cumulée v2 est
479 (9 runs) contre 496 « avant » (6 runs, dont un 293 et deux 519) :
dans le bruit. **Le critère est tenu**, la variance C8/Y6 reste ce qu'elle
est. Le temps a repris 5 à 10 s par rapport à P3 v1 (les walks vivent
jusqu'à ~200 itérations) : cible 15-25 s tenue de justesse.

Artefacts : `docs/qa/perf-audit-2026-09-05/l2bis-verif/`.

## 2. Constats

### 2.1 Vérifié conforme

- **AB1** : `sa_stop_k` / `sa_stop_floor` dans la config (0 = désactivé),
  passés par le worker via env, absents en prod ; schéma compressé à
  `max(200, plancher)` itérations seulement quand la règle est active,
  comportement historique sinon ; `libm::pow` conservé (déterminisme).
- **AB4** : fixture à 400 itérations, le lock s'arrête à 35 par la règle
  P3 et reste bit-identique natif/wasm.
- **AB3** : images = HEAD à mon arrivée ; méthode respectée.
- **AB2 (structure)** : quatre points d'écartage instrumentés, champ
  additif `discardedAlternatives`, `overlapping_pairs` (STRtree, même
  géométrie que `verify_layout`, `verify_layout` intact), WARN avec slug,
  `discardedCount` côté SSE et ligne repliée côté modal.

### 2.2 À corriger (L2-ter)

| Id | Sév. | Constat | Preuve |
|---|---|---|---|
| **AC1** | **M (diagnostic faux)** | `originStage` est **toujours « engine »** en cas de chevauchement : la « pré-vérification » est calculée sur `engine_alt["solution"]`, or le post-pass **mute cette solution en place** (`main.py:1572-1591` : `sol = engine_alt["solution"]` puis `sol["layouts"] = expand_meta(...)`, `apply_hole_fill(sol["layouts"])`, `fill_residual_bands(sol["layouts"])`). `preVerification` est donc identique à `verification` (même `holesFilled: 400`, mêmes chiffres) et n'attribue rien. | Diagnostic du job `bench-bpp2s-20-1788659118` : `verification` ≡ `preVerification`. |
| **AC2** | **M (diagnostic incomplet)** | Les **layouts** de l'alternative écartée ne sont pas conservés (le plan les demandait), ni la trace post-pass (`residualMoved`, `mergedReceivers`, `compactRollback`) de cette alternative : impossible de rejouer hors ligne. Les ids de paires sont des ids d'**item** (`a: 1, b: 1`), pas des index de pose : on sait que ce sont deux fans, pas lesquels ni dans quel trou. | même job. |
| **AC3** | **B (cause racine, prochain chantier)** | Le rejet se reproduit (1/10 chez moi ce tour, 1/22 au tour précédent ; 0/42 chez l'implémenteur — charge machine différente, variance Y6). Signature : **5 paires fan-fan** en chevauchement de 23 à 309 mm² (une fan = 615 mm²), `duplicatePoses 0`, `insideSheet true`, hôtes non concernés. Cinq paires ≈ les six paires des **quatre fans d'un même trou** : hypothèse n° 1 = expansion pinwheel d'un hôte pour une rotation/pose particulière (le docstring de `_validate_batch` note déjà des « jumeaux à distance 0 » des poses pinwheel à space > 0) ; n° 2 = passe résiduelle (fusion receveuses / compaction / retour) ; n° 3 = moteur (peu probable : le CDE ne produit pas 300 mm² de recouvrement). | diagnostic ci-dessus ; `residual.py:284-296`. |
| AC4 | m | `constructive.rs` : les appels de test patchés ont un formatage cassé (`None,            sa::DEFAULT_STOP_K,` sur la même ligne) — `cargo fmt` non passé. | diff `2da3e5a`. |
| AC5 | m | Le rapport L2-bis cite des hashes de commits qui n'existent plus (`74c4bc9`, `7d80f05` → `2da3e5a`, `048cf20` après réécriture) — à corriger pour la traçabilité. | `git log`. |
| AC6 | m (navigateur) | L'observabilité AB2 n'existe que côté serveur ; le chemin navigateur écarte aussi les alternatives invalides (garde par classe / physique) sans diagnostic. | `localJobPrivate.js`. |

## 3. Plan L2-ter (2 jours) — trouver et corriger la cause du rejet

1. **AC1** — snapshot réel : `copy.deepcopy(engine_alt["solution"]["layouts"])`
   **avant** `expand_meta` (après le remap des ids), gardé dans
   `engine_alt["_pre_layouts"]` ; `_record_discard` vérifie ce snapshot,
   puis vérifie aussi l'état **après expansion seule** (rejouer
   `expand_meta` sur le snapshot) : `originStage` ∈ {engine, expand,
   post_pass}. Test unitaire : une solution moteur propre + une expansion
   forcée en chevauchement → `originStage == "expand"`.
2. **AC2** — persister dans `discardedAlternatives[]` : `layouts` (poses
   compactes `[item_id, rot, tx, ty]` par tôle), `postPass` de cette
   alternative, et pour chaque paire fautive `{sheet, idxA, idxB, itemA,
   itemB, areaMm2, centroid}` ; plafond 20 paires. Écrire aussi les SVG de
   l'alternative écartée dans GridFS avec le suffixe `_discarded` (même
   purge 24 h).
3. **AC3** — reproduction et diagnostic : boucle de **30 bancs T-A à
   space 2** séquentiels sur images = HEAD (script fourni :
   `l2bis-verif/verify_l2bis.sh`, adapter les compteurs), en conservant
   les jobs ; pour chaque occurrence, rejouer hors ligne (comme
   `diag_merge_receivers.py`) : (a) vérifier le snapshot moteur ; (b)
   rejouer `expand_meta` seul et vérifier ; (c) rejouer le résiduel étape
   par étape. Identifier l'étape, l'hôte et la rotation en cause.
4. **Correctif** selon l'étape : si expansion, corriger la table de slots
   / la capacité pour la pose concernée **et** faire vérifier chaque
   expansion (`_validate_batch` sur les fans ajoutées par trou, repli
   « trou non rempli » plutôt que chevauchement) ; si passe résiduelle,
   l'invariant doit l'attraper (compléter la validation manquante) ; dans
   tous les cas ajouter un cas de corpus **T-L** qui reproduit la pose
   fautive de façon déterministe (seed et rotation fixés).
5. AC4 `cargo fmt` ; AC5 corriger les hashes ; AC6 : miroir minimal côté
   navigateur (compteur + raison dans `report.discarded`).

GO L2-ter : cause identifiée et démontrée par rejeu hors ligne ; 0 rejet
sur 30 runs après correctif ; T-L au corpus ; parité navigateur.

## 4. Suite

Déployer lot 2 + L2-bis (procédure habituelle, images publiées contrôlées),
lancer L2-ter, puis le lot 3 (UX 2.1.4-2.1.9, compte 3.1.3-3.1.6, kerf
explicite, benchmarks publics) selon le masterplan — T1.
