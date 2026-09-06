# Rapport L3-bis (correctifs de la vérification du lot 3) — 2026-09-06

Implémenteur : ZCode. Destinataire : vérificateur. Plan appliqué à la
lettre : `PLAN-CORRECTIF-PERF-UX-L3-2026-09-06.md` §3 (AF6, AF1, AF2,
AF4, AF7, AF3/AF5). Constats cités « AFn » = ceux du plan.

## 0. Déploiement du lot 3 (préalable, GO du vérificateur)

Exécuté AVANT L3-bis comme demandé :

- Workflow « Build and publish Docker images » sur c47b2d2 : succès ;
  images publiées tirées, retaggées dev/local, `assert_images_head.sh`
  **OK (2026-09-06T11:46:53Z)**.
- **Corpus sur bits publiés : 11/11** (T-A [587, 313] bit-identique, T-J
  REFUS attendu, T-F PARTIEL attendu, physique propre partout) ; FUSION
  1/11 à espacements par cas (le verrou FUSION ≥ 4/8 porte sur T-A@2,
  hors corpus standard — inchangé).
- Harnais du vérificateur (qa-e2e-l3.mjs, deux champs) rejoué :
  @0,1 **[587, 313]** 900/900, @2 **[573, 327]** 900/900 ; la
  configuration « refus » (1 × 1000×2000 @ 4 mm) a reproduit AF6 sur les
  bits publiés — documenté, corrigé ci-dessous.
- Scripts du lot rejoués : refus-4mm ✓, refus-0.3mm ✓, live-final ✓
  (captures de référence restaurées par git checkout, voir AF7).
- **Hetzner** : df 22 Go libres AVANT pull ; `pull && up -d` ; md5
  prod == HEAD sur i18n.js, files.js, capacityPanel.js, data/benchmarks.js ;
  `/`, `/auth/local`, `/benchmarks` **200** (le 403 vu depuis le serveur
  lui-même est le blocage bot Cloudflare des curl nus — 200 confirmé
  depuis un client réel) ; logs app/worker propres (0 erreur).

## 1. AF6 — le navigateur livre une solution partielle (priorité)

**Constat** : la garde par classe comparait au DEMANDÉ → une alternative
partielle (moteur n'a pas tout placé) était écartée →
« all_alternatives_invalid », refund, aucun levier, conseil « retry in
server mode » faux pour un projet « cet appareil ».

**Livré** :
- `localBridge.js` : nouveau `enginePlacedById(alt)` (miroir exact de
  `engine_placed_by_id`, main.py X2) — comptes par classe de la solution
  MOTEUR avant post-pass. `localJobPrivate.js` : la référence de la garde
  par classe est désormais `enginePlacedById(alt)` avec repli sur le
  demandé quand la solution moteur est vide — miroir de la ligne Python
  `reference_by_id = engine_placed_by_id if … else requested_by_id`.
  Le reste de la chaîne existait déjà et s'active maintenant :
  `report.unplaced` (Y3) et le bloc Z3 (`partialUnfit` + leviers).
- `useLocalMode.mapError(err, { localOnly })` : variantes locales sans
  « mode serveur » pour les projets « cet appareil » — nouvelle clé
  `localMode.allInvalidLocal` (« réessayez avec une tâche plus petite »),
  les variantes crash/memory/entityLimit locales réutilisées.
- La garde reste AVEUGLANTE pour les vraies pertes : un post-pass qui
  perd une pièce posée par le moteur est toujours détecté (test dédié).

**Verrous (rejoués, image rebuild HEAD L3-bis)** :
- vitest : 4 tests nouveaux dans `localBridge.test.js` (comptes moteur,
  partiel 4/5 conservé qui échouait contre le demandé, repli sur solution
  vide, perte post-pass toujours détectée) — 480/480 au total.
- e2e `qa-l3bis-partial.mjs` (2 × 1000×1000, 100+800, effectif 4 mm) :
  **job done en ~116 s, 892/900 posés**, record
  `unfit = {reason:'partial', unplaced:8, ratio:0.8768, sheetsNeeded:2,
  maxPartsAtSpacing:871, maxSpacingForFitMm:3.21}` ; modal : badge
  « 8 parts not placed » + bandeau partiel avec les TROIS leviers
  chiffrés ; physique propre (overlapFree/insideSheet true) ; AUCUN
  « rejected / retry in server mode » ; pas de remboursement (décision
  propriétaire Z3, miroir serveur).
- Harnais principal en configuration 1 × 1000×2000 @ 4 mm : done partiel
  892/900 (les DEUX configurations documentées livrent le partiel).

## 2. AF1 — un seul message de refus

**Livré** : `nestRequestError` et le bandeau `localComputeError` sont
masqués quand `capacityPanel` est affiché ; la mention de remboursement
vit DANS le panneau (`nest.capacity.refunded`, ligne discrète sous le
titre). **Verrou** : `qa-l3-refus-4mm.mjs` asserte `content__error`
ABSENT (mesuré : 0 bandeau rouge) + mention « The nesting was not
charged. » présente + tous les asserts du lot 3 intacts (panneau dans
l'aside, levier, kerf intact, 0 carte fantôme).

## 3. AF2 — harnais principal mis à jour et rejoué

`scripts/qa-e2e-local-2sheets.mjs` : le champ « Spacing » remplacé par
kerf 0 + sécurité = `QA_SPACE / 2` (effectif exact QA_SPACE), log
`kerf/safety set`. Rejeu :
- @0,1 : **grille [587, 313]**, 900/900 — bit-identique à la référence ;
- @2 : **grille [573, 327]**, 900/900 — bit-identique ;
- @4 (2 × 1000×1000) et @4 (1 × 1000×2000) : partiels 892/900 livrés
  (verrous AF6 ci-dessus).
La grille bit-identique navigateur avec les correctifs L3-bis est dans
le run.log du harnais (STRUCT MULTI DIAG perSheet [587,313] / [573,327]).

## 4. AF4 — benchmarks rafraîchis à chaque livraison moteur

`AGENTS.md` nouvelle section « Checklist de déploiement » : toute
livraison touchant le moteur régénère `data/benchmarks.js` via
`densities_corpus.py` sur les images publiées (commande incluse) ;
livraison UI seule = chiffres inchangés, vérifié par
`git diff -- workers/ public/engine` (cas du lot 3).

## 5. AF7 — sorties de scripts hors dossier suivi

Les sept scripts du lot + le nouveau `qa-l3bis-partial.mjs` écrivent
captures et échecs dans `QA_OUT` (défaut `.qa-pw/l3-verif`, non suivi) ;
les captures de référence restent les PNG commités du lot 3. Preuve :
rejeu complet des 8 scripts → `git status docs/` ne montre AUCUN PNG
modifié (uniquement les .mjs de ce correctif).

## 6. AF3 / AF5 — inscrits au masterplan

AF5 (expiration serveur des jobs `awaiting_local` orphelins, ~10 min →
`cancelled` + carte dédiée) : ligne **T2/lot 4**. AF3 (découchage de la
tôle portrait, 2.1.8) : ligne **T3/lot 5** avec la note que l'ambiguïté
est aujourd'hui levée par les axes + flèches + libellés par bord.

## 7. Suites

- vitest : **480/480** (42 fichiers ; +4 AF6).
- pytest image nesting : inchangé par L3-bis (aucun diff sous `workers/`
  — le correctif est 100 % app) ; les 3 errors `test_integration_holes`
  préexistantes demeurent (§J.5 du rapport L3).
- e2e : 8 scripts verts (7 du lot regradés + qa-l3bis-partial).
- Corpus : inchangé par construction (zéro diff runtime).

## 8. Ce qui n'est PAS fait (énoncé)

- Le badge de la carte résultat (hors modal) n'affiche pas le compte non
  posé pour un job local partiel — le titre de carte reste
  « densité · tôles » ; le badge vit dans le modal et la liste sert au
  statut. Si le vérificateur veut la pastille sur la carte, c'est un
  ajout de surface (UserResultItem lit déjà `unfit.unplaced` via le
  record hydraté) — non exigé par le plan, non fait.
- Le renvoi d'e-mail de vérification reste muet en local (mailer
  absent) — inchangé.


## 9. Déploiement (GO du vérificateur, 2026-09-06 ~17h50 UTC)

- Workflow images 87b8bae : succès ; images publiées tirées, retaggées,
  `assert_images_head.sh` **OK (2026-09-06T17:47:27Z)**.
- Zéro diff `workers/`/`public/engine` entre c47b2d2 et 87b8bae (correctif
  100 % app) : le corpus reste couvert par le run bits publiés du lot 3.
- Verrous rejoués sur les bits publiés : partiel 892/900 + 3 leviers +
  physique propre (`qa-l3bis-partial`), refus à message unique
  (`qa-l3-refus-4mm`), harnais @0,1 grille **[587, 313]**.
- Hetzner : df 22 Go AVANT pull ; `pull && up -d` ; md5 prod == HEAD
  (localBridge.js, localJobPrivate.js, useLocalMode.js) ; `/` et
  `/benchmarks` 200 ; logs app 0 erreur.
- Résidu du vérificateur (§5 de son plan) — garde par classe calculée
  après le post-pass qui mute la solution moteur en place : la référence
  compare l'état final à lui-même ; le test vitest de détection construit
  ses conteneurs à la main. Inscrit au **lot 4** du masterplan (comptes à
  prendre AVANT le post-pass, avec P8).
