# Vérification du lot 2 (P3 arrêt par itérations + P7 threads) + plan L2-bis — 2026-09-05, 21 h 30

Vérification indépendante des commits `65c9006` + `8380d43` (rapport
[`RAPPORT-PERF-UX-L2-2026-09-05.md`](RAPPORT-PERF-UX-L2-2026-09-05.md),
décisions propriétaire : k = 3, plancher 30, sans plancher de temps,
SAMPLE_CFG inchangé). Méthode : **images reconstruites depuis HEAD**
(`assert_images_head.sh` était en ÉCHEC à mon arrivée : l'app servait
encore l'ancien wasm — les mesures navigateur du rapport L2 ont donc été
faites sur un wasm antérieur au dernier rebuild ; les miennes ci-dessous
font foi) ; cargo test 72 + 1 ignoré ; `determinism_lock.py` natif ≡ wasm
OK (SHA identiques) ; vitest 449/449 ; **10 bancs serveur T-A séquentiels
chronométrés** (6 à space 0,1 ; 4 à space 2) ; corpus T-A..T-K rejoué
**deux fois** (22 jobs) ; e2e navigateur 0,1 et 2 instrumentés (long
tasks) ; physique des SVG ; relecture des diffs `sa.rs`, `separator.rs`,
tests. Identifiants **AB** = constats de ce tour.

## 0. Verdict

**Temps : objectif atteint et au-delà. Qualité : GO conditionnel — une
vérification d'une journée avant déploiement.**

- Job serveur T-A : **15-19 s** (avant : 62-67 s), dont moteur 7-10 s et
  post-pass 7-9 s. Navigateur : **calcul 9 s** aux deux espacements
  (avant 45-51 s), gel 0,26-0,31 s. Déterminisme : aucune horloge dans la
  règle, lock natif ≡ wasm vert. P7 conforme.
- **Réserve bloquante AB1** : la chute de la dernière tôle de l'option
  Compaction à **space 0,1** est plus petite dans 4 runs sur 6 après P3
  (471-521 mm) qu'avant (≈ 600 mm dans 5 runs sur 6 sur les tours
  précédents). Space 2 est stable (479 mm avant et après). La grille,
  proposée en premier, est bit-identique. L'implémenteur a mesuré la
  chute avant/après à space 2 et sur C/F, comme demandé — pas à 0,1 ; le
  signal est nouveau, petit échantillon, à trancher par un A/B sur le
  même binaire.
- **Réserve AB2** : sur un banc à space 2, l'alternative Compaction a été
  **rejetée au filet final** (« alternative physically invalid, overlap ») et
  seule la Grille a été livrée ; ses fichiers ne sont pas conservés, la
  cause n'est donc pas diagnosticable a posteriori. 1 cas sur 22 jobs ;
  jamais observé sur ~10 bancs à space 2 des tours précédents.

## 1. Mesures (images = HEAD `8380d43`, reconstruites)

| Mesure | Avant P3 (tours précédents) | Lot 2 (ce tour) | Cible |
|---|---|---|---|
| Job serveur T-A 0,1 (création → fin, sans file) | 62-67 s | **15,1 / 15,5 / 16,7 / 16,7 / 16,8 / 18,0 s** | 15-25 s |
| Job serveur T-A 2 | ~62 s | **15,8 / 17,2 / 18,7 / 19,4 s** | 15-25 s |
| dont moteur (log `engine finished`) | 51-52 s | 7-10 s | — |
| dont post-pass Python | 9-11 s | 7-9 s | (P8) |
| Navigateur, calcul (e2e `compute outcome`) 0,1 / 2 | 45-51 s | **9 s / 9 s** | 8-12 s |
| Gel fin de calcul (long task max) 0,1 / 2 | 0,26-0,47 s | **0,26 s / 0,31 s** | < 0,5 s |
| Grille serveur 0,1 / 2 | [587, 313] · 580,4 / [573, 327] · 544,1 | identiques, 10/10 runs | bit-identique |
| Compaction serveur **2**, chute dernière tôle | 479,2 ×2, 516,9 (implémenteur) | **479,2 ×4** ([555, 345] ×3, [557, 343]) + 1 run **rejetée** | ± 5 mm |
| Compaction serveur **0,1**, chute dernière tôle | 600,3 · 603,7 · 600,3 · 600,3 · 599,6 · 520,7 | **520,7 · 520,7 · 471,6 · 603,5 · 520,7 · 587,1** | ± 5 mm |
| Compaction navigateur 0,1 / 2 | 603,7 (590/310) / 478,8 (555/345) | 603,7 (590/310) / 478,8 (555/345) — identiques | idem |
| Physique navigateur 0,1 / 2 | OK | OK (0 chevauchement, 1 800 pièces ×2) | OK |
| Corpus T-A..T-K | 11/11 | **11/11 ×2** (T-F 88/90 puis 89/90, partiel attendu) | 11/11 |
| cargo / lock / vitest | — | 72 + 1 ign. / SHA identiques / 449 | vert |

Artefacts : `docs/qa/perf-audit-2026-09-05/l2-verif/` (verify_l2.log,
longtasks e2e 0,1 et 2, run.log).

## 2. Constats

### 2.1 Vérifié conforme

- **P3 (code)** : règle `iterations − it_dernière ≥ max(30, 3 × it_dernière)`
  en tête de boucle, sans horloge ; `last_improvement_iter` posé à
  l'amélioration initiale et à chaque amélioration ; patience temps et
  deadline conservés en plafond et ceinture. Test
  `iteration_patience_stops_deterministically` pertinent. La mise à jour
  du test V2 est justifiée (le spin muet n'existe plus).
- **P7** : pool separator borné à `min(n_workers, RAYON_NUM_THREADS)`,
  inline à 1 ; l'env est bien posé par `engine.py` selon le tier.
- **Temps** : cibles serveur et navigateur atteintes (tableau).
- **Déterminisme** : lock vert ; e2e navigateur bit-identique au tour
  précédent aux deux espacements.

### 2.2 À traiter

| Id | Sév. | Constat | Preuve |
|---|---|---|---|
| **AB1** | **B (qualité, à confirmer)** | Compaction à space 0,1 : chute dernière tôle 471-521 mm dans 4/6 runs après P3, contre ≈ 600 mm dans 5/6 runs avant. Hypothèse : les améliorations de **remnant** (front de la dernière tôle) arrivent plus tard que celles de (unplaced, bins) mesurées par MESURE-P3 — c'était la réserve écrite sur cette mesure — et/ou le walk s'arrête **chaud** : la température géométrique est étalée sur le budget d'itérations estimé à partir du temps (`sa.rs:328`), donc à l'itération 30-100 le recuit n'a pas commencé à exploiter. | Tableau §1 ; runs `bench-bpp2s-1-17886355{52,72}`, `-17886359{53,72}`, `-17886361{23,42}`. |
| **AB2** | **M (produit, observabilité)** | Une alternative moteur rejetée au filet final n'est ni conservée ni diagnostiquée : le job livre une seule option sans le dire ; impossible de savoir si le chevauchement vient du moteur, de l'expansion ou de la passe fusionnée, ni s'il est lié à P3. | `bench-bpp2s-20-1788635591` : log worker-2 19:13:27 « alternative physically invalid (overlap/duplicates), discarding — strategy left, overlapFree false, duplicatePoses 0 » ; doc Mongo : 1 alternative, aucun champ `rejected`. |
| AB3 | m (méthode) | Le rapport L2 annonce des mesures navigateur (22 s, 348 ms) faites alors que l'image app servait un wasm antérieur au dernier rebuild (`assert_images_head.sh` en ÉCHEC avant mon rebuild). Les chiffres réels sont meilleurs (9 s), mais la règle « images = HEAD avant tout banc » n'a pas été appliquée au dernier build. | Sortie du script à 21 h 05. |
| AB4 | m (verrou) | `determinism_lock.py` : la fixture est bornée à `sa_max_iterations = 25` < plancher 30 — la règle P3 **n'y est jamais exercée** ; le lock prouve le déterminisme du reste, pas celui de P3 (seul le test unitaire le fait). | `fixtures/b_demo/config_det.json:14`. |
| AB5 | m (modèle) | Le schéma de température reste calibré sur le budget temps (`iter_budget` estimé), alors que la durée réelle d'un walk est désormais 30-1 000 itérations : le recuit est de fait un multi-start constructif + marche chaude. Ce n'est pas faux (la mesure montre que le constructif fait l'essentiel), mais c'est le premier levier si AB1 se confirme. | `sa.rs:328`. |

## 3. Plan L2-bis (1 jour, avant déploiement)

1. **AB1 — A/B sur le même binaire.** Rendre `STOP_K` / `STOP_FLOOR`
   pilotables par la config moteur (défaut 3 / 30 ; `0` = règle
   désactivée), sans rebuild entre les deux bras. Protocole : T-A à
   space 0,1 **et** 2, 6 runs par bras, séquentiels, images = HEAD,
   métriques = chute de la dernière tôle **et** front de la tôle 2 de
   l'option Compaction (`measure_offcut.py` suffit), plus comptes par
   tôle. Critère : médiane de la chute à ± 5 mm ou mieux → GO tel quel ;
   sinon corriger avant de déployer, dans cet ordre de préférence :
   (a) **compresser le schéma de température** sur la fenêtre d'arrêt
   attendue (refroidir de T0 à T_END sur `max(30, 3 × it_dernière)`
   itérations glissantes, ou sur un budget fixe court, ex. 200
   itérations) pour que le walk exploite avant de s'arrêter ;
   (b) à défaut, plancher 60 ou k = 5 à space ≤ 0,5 ; re-mesurer.
   Livrable : tableau A/B dans le rapport, décision chiffrée.
2. **AB2 — ne jamais perdre une alternative en silence.** Quand le filet
   final rejette une alternative : conserver ses layouts et son
   `verification` dans `report.discarded[]` (stratégie, paires en
   chevauchement avec aire et ids, min-dist, étape d'origine : moteur /
   expansion / fusion / compaction — en re-vérifiant l'état `pre`), badge
   « 1 option écartée (détails techniques) » côté UI, et log WARN avec le
   slug. Puis 10 runs à space 2 avec P3 activé et 10 désactivé pour
   dater l'apparition ; si le chevauchement vient du moteur, ouvrir un
   constat moteur ; s'il vient d'une passe, l'invariant doit l'attraper.
3. **AB4** — fixture du lock à `sa_max_iterations = 400` (P3 gouverne
   l'arrêt, le lock l'exerce) ; vérifier que les SHA restent identiques.
4. **AB3** — ajouter `assert_images_head.sh` **après** le dernier build et
   avant le rapport, à la checklist du rapport (une ligne « images = HEAD
   à HH:MM »).
5. AB5 — noter dans le plan P10 que le schéma de température est le
   prochain levier qualité, à instrumenter avec la même journée de
   mesure (itération de la dernière amélioration **de remnant**).

GO déploiement : après 1 (résultat A/B positif ou correction validée) et
2 (observabilité) ; 3-5 peuvent suivre dans le même lot.

## 4. Ce que ce tour confirme sur le plan

- La prédiction AA8 se vérifie : le post-pass Python est désormais la
  moitié du job serveur (7-9 s sur 15-19 s). P8 est bien la prochaine
  étape performance côté serveur.
- Côté navigateur, le calcul est à 9 s et le gel sous 0,5 s : P4 (worker
  de finalisation) devient un confort, pas une urgence.
