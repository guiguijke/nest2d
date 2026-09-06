# Vérification du lot 3 (T1 du masterplan) + correctifs L3-bis — 2026-09-06, 14 h

Vérification indépendante des commits `7400426..c47b2d2` (rapport
[`RAPPORT-PERF-UX-L3-2026-09-06.md`](RAPPORT-PERF-UX-L3-2026-09-06.md),
verrous transmis avec le feu vert). Méthode : image app reconstruite
depuis HEAD, `assert_images_head.sh` OK contre `c47b2d2` ; `git diff`
sous `workers/` et `public/engine` = un seul script de bench ajouté
(aucun changement runtime moteur ou worker : corpus et grille non
rejoués côté serveur, la référence du 06/09 09:32 reste valable) ;
vitest ; relecture des diffs (`spacingParams.js`, `files.js`,
`capacityPanel.js`, `localHydrate.js`, `localSolverRegistry.js`,
`localJobPrivate.js`, `resultcontroller.js`, `data/benchmarks.js`,
tests) ; **harnais e2e adapté aux deux champs** (kerf 0, sécurité =
espacement / 2) rejoué à 0,1, 2 et en refus 4 mm ; les sept scripts du
lot rejoués ; captures relues. Identifiants **AF** = constats de ce tour.

## 0. Verdict

**GO déploiement du lot 3, avec L3-bis obligatoire dans la foulée.**
Le kerf explicite ne change rien aux résultats (grille et compaction
navigateur bit-identiques aux valeurs d'avant le lot avec kerf 0 +
sécurité = espacement / 2), les verrous transmis sont tenus sauf deux
(le refus affiche encore deux messages, le harnais principal n'a pas
été mis à jour), et la vérification a mis au jour un défaut
**préexistant** mais sérieux du mode navigateur : une solution partielle
est écartée au lieu d'être livrée avec ses leviers (AF6). Le lot 3
n'aggrave pas ce défaut en lui-même, mais son défaut d'espacement à 2 mm
rapproche davantage de jobs de la limite de capacité : la correction
passe en tête de L3-bis, avant le lot 4.

## 1. Mesures

| Mesure | Avant lot 3 | Lot 3 | Cible |
|---|---|---|---|
| Espacement effectif transmis (kerf 0 + sécurité s/2) | `space` | **identique** : grille navigateur [587, 313] · 580,4 à 0,1 et [573, 327] · 543,9 à 2, compaction 590/310 · 603,7 et 555/345 · 482,3 (mêmes valeurs qu'avant le lot) | bit-identique |
| Physique navigateur 0,1 / 2 | OK | OK / OK (0 chevauchement, 1 800 pièces ×2) | OK |
| Gel fin de calcul 0,1 / 2 | 0,25-0,37 s | **0,33 s / 0,36 s** | < 0,5 s |
| Calcul navigateur 0,1 / 2 | 6-9 s | 6 s / 9 s | 8-12 s |
| Refus 4 mm, cas 1 × 1000×2000 (`qa-l3-refus-4mm`) | GO | **GO** : panneau ancré, levier 2,12 mm → sécurité 1,06, kerf intact, pas de carte fantôme | GO |
| Refus 0,3 mm (`qa-l3-refus-0.3mm`) | — | **GO** : levier masqué, phrase plancher | GO |
| Cas 2 × 1000×1000 à 4 mm (harnais de référence en mode refus) | refusé ? (jamais mesuré dans cette configuration) | **109 s puis échec générique** (AF6) : ratio 0,8785 < 0,88, partiel écarté | partiel livré avec leviers |
| Scripts du lot (live-final, other-device, smoke-kerf, verify-banner, captures-fr) | — | **5/5 verts** rejoués | verts |
| vitest | 452 | **476/476** | vert |
| pytest / corpus / lock | — | non rejoués : aucun changement runtime `workers/`, `engine/`, `public/engine` (vérifié par `git diff`) | — |

Artefacts : `docs/qa/perf-audit-2026-09-05/l3-verif/` (mes runs : `verify_l3.log`, `e2e-l3-*`, `cap_from_svg.py`, `old_vs_new.log`).

## 2. Constats

### 2.1 Vérifié conforme

- **Kerf explicite (B.4)** : `space = kerf + 2 × sécurité` arrondi à
  4 décimales, chemin d'écriture unique `updateKerfSafety`, migration
  `withKerfDefaults` (kerf 0, sécurité = space / 2) appliquée à la
  restauration de snapshot et au changement d'unité avec recalcul de
  `space` ; `space` reste la clé de contrat, aucun changement de schéma
  ni de moteur. Défaut usine 2 mm seulement pour un projet sans
  snapshot. Le levier capacité réduit la sécurité et disparaît si la
  cible ne dépasse pas le kerf. Tests unitaires pertinents.
- **Refus capacité (C04/C09)** : panneau dans l'aside sous le bouton
  Nest, plancher 0,5 mm, phrase « même sans espacement », cartes de refus
  étiquetées « Ne tient pas » — voir AF1 pour le bandeau restant.
- **Vocabulaire (C06/C20/C21)** : garde du dictionnaire (unicité, clés FR
  ⊆ EN, placeholders, mots interdits) qui a révélé des doublons réels ;
  nombres via `Intl.NumberFormat`.
- **C05** : `localOnly` côté SSE, `localElsewhere` à l'hydratation, carte
  « autre appareil » sans téléchargement vide.
- **C31** : frame `stage: 'final'` de l'alternative rang 0 poussée après
  le post-pass, garde du registre qui l'accepte toujours.
- **Compte (3.1.3-3.1.6)** : codes d'erreur stables et testés, dialogue
  accessible, bannière e-mail, page des offres avec session.
- **Benchmarks (3.9)** : chiffres identiques à ceux de mon corpus
  (densités 55,4 / 84,4 / 60,0 / 76,5 / 61,5 / 89,0 / 60,1 / 64,0 /
  58,5 %, T-I non publié et expliqué), fiche machine, date et commit,
  section honnêteté.

### 2.2 À corriger

| Id | Sév. | Constat | Preuve |
|---|---|---|---|
| **AF1** | M (UX) | Le refus capacité affiche **deux** messages : le panneau ancré dans l'aside **et** l'ancien bandeau rouge `content__error` sous la scène (« These parts do not fit … The nesting was refunded »). Le verrou disait « un seul panneau ». Le bandeau doit disparaître quand le panneau est affiché (garder son texte de remboursement dans le panneau). | Capture `l3-refus-4mm-panel.png` ; `[slug].vue:170` (`nestRequestError`). |
| AF2 | m (méthode) | Le harnais e2e principal (`scripts/qa-e2e-local-2sheets.mjs`) remplit encore un champ « Spacing » qui n'existe plus : il n'a pas été rejoué par l'implémenteur et échouerait tel quel. Les sept scripts du lot ne couvrent pas le banc 0,1 / 2 de bout en bout avec les nouveaux champs. À mettre à jour dans le dépôt (kerf 0 + sécurité = espacement / 2) **et** à rejouer dans ses deux configurations documentées : 2 × 1000×1000 (référence) et 1 × 1000×2000 (`QA_SHEET_H=2000 QA_SHEET_COUNT=1`, cas de refus). | `scripts/qa-e2e-local-2sheets.mjs:122`. |
| AF3 | m (UX, déjà déclaré) | Tôle portrait affichée couchée : « Bord bas » y pointe vers la **gauche** et « Bord gauche » vers le **haut** (cohérent avec les axes affichés, mais c'est l'ambiguïté que l'audit dénonçait). Les captures sont en outre nommées à l'envers (`paysage` = 1000×2000, `portrait` = 600×300). Le découchage (2.1.8) reste à planifier, lot 5 au plus tard. | Captures `l3-settings-fr-paysage.png` / `-portrait.png`. |
| AF4 | m | `data/benchmarks.js` est daté du run `fb5e184` ; la page dit « produit par l'image déployée en production à la date indiquée ». À chaque livraison moteur, le fichier doit être régénéré par `densities_corpus.py` sur les images publiées et la version affichée mise à jour — à inscrire dans la checklist de déploiement (`AGENTS.md`). | `data/benchmarks.js:19`. |
| **AF6** | **B (produit, préexistant)** | **Le navigateur ne sait pas livrer une solution partielle.** Cas 2 × 1000×1000, 900 pièces, espacement effectif 4 mm : le pré-contrôle laisse passer par construction (ratio 0,8785 pour un seuil de 0,88, recalculé avec les anneaux réels), le moteur calcule 109 s et ne place pas tout, puis la garde par classe (`perClassCountsMatch`, placé == **demandé**) écarte l'alternative partielle → « Every layout option was rejected by physical validation … retry in server mode », remboursement, aucun levier. Le serveur, lui, livre un partiel propre avec `unplaced` et leviers depuis X2/Y3 ; le code Z3 des leviers partiels existe côté navigateur mais n'est jamais atteint. Le conseil « retry in server mode » est faux pour un projet « cet appareil ». Préexistant (la garde date d'A4) — établi par le code : `perClassCountsMatch` (`localBridge.js`) et `capacityClient.js` sont inchangés par le lot 3 (`git diff fb5e184..c47b2d2` vide sur ces fichiers), la garde date d'A4 et le pré-contrôle de la partie 1 ; les refus 4 mm « GO » des tours précédents portaient sur la configuration 1 × 1000×2000 (`QA_SHEET_H=2000 QA_SHEET_COUNT=1`), jamais sur celle-ci. Le défaut 2 mm du lot 3 rapproche davantage de jobs de la limite : à corriger en priorité. | `e2e-l3-refusal/run.log`, console `[local] alternative per-class count mismatch, discarding {strategy: left}` ; `localJobPrivate.js:655-662`, `localBridge.js:681` ; recalcul `cap_from_svg.py`. |
| AF7 | m (méthode) | Les sept scripts du lot écrivent leurs captures **dans le dossier suivi** `docs/qa/perf-audit-2026-09-05/l3-verif/` : les rejouer modifie des fichiers commités et fait échouer `assert_images_head.sh` (règle Y1 : répertoire de travail ≠ HEAD). Les scripts doivent écrire dans un dossier de sortie non suivi (`QA_OUT`, défaut `.qa-pw/`), les captures de référence restant commitées à part. | Rejeu de ce tour : 6 PNG modifiés, assert en ÉCHEC jusqu'à `git checkout`. |
| AF5 | m | Job `awaiting_local` orphelin (409 jusqu'à annulation manuelle), découvert en QA et préexistant : à traiter dans le lot 4 avec un délai d'expiration serveur (par exemple 10 minutes sans prise en charge → `cancelled`, carte « non pris en charge par cet appareil »). | Rapport §J.7. |

## 3. Correctifs L3-bis (1 jour)

1. **AF6** : dans `localJobPrivate`, la référence de la garde par classe
   doit être **ce que le moteur déclare avoir posé** (miroir de
   `engine_placed_by_id` côté Python : comptes par classe de la solution
   moteur avant post-pass), pas le demandé ; une alternative partielle est
   conservée, `report.unplaced` calculé, et le bloc Z3 (`partialUnfit`,
   leviers) s'applique. Le message « retry in server mode » disparaît des
   projets « cet appareil ». Verrou : harnais e2e en 2 × 1000×1000 à
   espacement 4 → job `done` partiel avec badge « n pièces non placées »
   et leviers, physique propre ; test vitest de la garde avec une solution
   partielle.
2. AF1 : masquer `nestRequestError` quand `capacityPanel` est affiché,
   déplacer la mention « le nesting n'a pas été facturé » dans le
   panneau ; verrou : `qa-l3-refus-4mm.mjs` assert `content__error` absent.
3. AF2 : mettre à jour `scripts/qa-e2e-local-2sheets.mjs` (kerf 0 +
   sécurité = `QA_SPACE / 2`) et le rejouer à 0,1, 2 et refus 4 mm ;
   ajouter au rapport la grille bit-identique navigateur.
4. AF4 : ligne de checklist de déploiement + script `densities_corpus.py`
   documenté dans `AGENTS.md`.
5. AF7 : sortie des scripts vers `QA_OUT` non suivi.
6. AF3 et AF5 : inscrire au masterplan (lot 4 pour AF5, lot 5 pour le
   découchage).

## 4. Suite

Déployer le lot 3 (procédure habituelle : images publiées, `assert_images_head.sh`,
corpus, e2e 0,1 / 2 / refus dans les **deux** configurations, sept scripts du
lot), puis L3-bis (AF6, AF1, AF2, AF4 — 1 jour), puis la porte utilisateurs
de fin de T1 (livrable propriétaire) avant le lot 4.

## 5. Vérification de L3-bis (commits `2736946..87b8bae`) — 2026-09-06, 15 h 30

Contrôles : image app reconstruite depuis HEAD, `assert_images_head.sh` OK
contre `87b8bae` ; aucun changement runtime `workers/` ni moteur ; vitest
**480/480** ; relecture des diffs (`localBridge.enginePlacedById`, garde de
`localJobPrivate`, bandeaux `[slug].vue`, messages `useLocalMode`,
harnais `scripts/qa-e2e-local-2sheets.mjs`, scripts QA → `QA_OUT`,
checklist `AGENTS.md` §6bis) ; harnais du dépôt rejoué à 0,1 et 2 ;
cas 4 mm rejoué dans les deux configurations avec contrôle physique ;
`qa-l3-refus-4mm`, `qa-l3-refus-0.3mm`, `qa-l3bis-partial` rejoués ;
vérification qu'aucun fichier suivi n'est modifié après les rejeux.

| Mesure | L3 | **L3-bis** | Cible |
|---|---|---|---|
| Harnais du dépôt 0,1 / 2 (grille) | — (non rejouable) | **[587, 313] · [573, 327]**, compaction 590/310 et 555/345 : bit-identiques | idem |
| Cas 4 mm, 2 × 1000×1000 | 109 s puis échec générique | **`done` en 102 s, 894/900, badge « 6 parts not placed », leviers (2 tôles, 871 pièces max, 3,21 mm)**, aucun remboursement | partiel livré |
| Cas 4 mm, 1 × 1000×2000 | refus (pré-contrôle) ou échec | **`done` en 87 s, 894/900, 6 non posées** | partiel livré |
| Physique des partiels (space 4) | — | 0 chevauchement, 0 hors tôle, min-dist 3.9987 (résidu de simplification moteur connu) | OK |
| Refus 4 mm (`qa-l3-refus-4mm`) | 2 messages | **un seul message**, `content__error` absent, levier → sécurité 1,06, kerf intact | 1 message |
| `qa-l3bis-partial` / `qa-l3-refus-0.3mm` | — | **OK / OK** | OK |
| Fichiers suivis modifiés après les rejeux | 6 PNG | **0** | 0 |
| vitest | 476 | **480/480** | vert |

### 5.1 Conforme

- **AF6** : la garde par classe compare au posé moteur (miroir de
  `engine_placed_by_id`), une solution partielle est conservée, livrée avec
  `unplaced` et les trois leviers Z3 ; les messages « cet appareil » ne
  renvoient plus vers un mode serveur inexistant.
- **AF1** : les bandeaux `content__error` se taisent quand le panneau est
  affiché, la mention de non-facturation vit dans le panneau.
- **AF2** : harnais du dépôt à deux champs, rejoué par l'implémenteur et par
  moi.
- **AF4/AF7** : checklist de régénération des benchmarks ; scripts QA en
  `QA_OUT` non suivi (rejeu complet : aucun fichier suivi modifié).
- AF3/AF5 inscrits au masterplan.

### 5.2 Résidu (non bloquant, à traiter avec P8 ou au lot 4)

| Id | Sév. | Constat | Preuve |
|---|---|---|---|
| AG1 | m (garde inerte) | `enginePlacedById(alt)` est calculé **après** `buildAlternativeArtifacts`, or le post-pass navigateur mute `alt.solution.layouts` **en place** (`normalizeLayouts` renvoie la référence, expansion et passes y écrivent) : la référence de la garde est donc l'état final lui-même, identique aux `containers` → la garde par classe ne peut plus détecter une perte du post-pass (le test vitest la fait détecter avec des `containers` construits à la main). Le produit reste protégé par l'invariant interne des passes et la vérification physique. Correctif : prendre les comptes par classe **avant** `buildAlternativeArtifacts` et y ajouter les fans attendus de l'expansion (miroir Python de `reference_by_id`), ou comparer à un snapshot profond. | `localBridge.js:855-880` (`normalizeLayouts` par référence), `localJobPrivate.js:626-662`. |

### 5.3 Verdict

**GO déploiement de L3-bis.** Le défaut sérieux du tour précédent est
corrigé et prouvé dans les deux configurations : le navigateur livre un
partiel propre avec ses leviers au lieu d'un échec générique ; le refus
n'a plus qu'un message ; le harnais du dépôt est à jour et les rejeux ne
touchent plus le dépôt. Le résidu AG1 (garde par classe devenue
tautologique) ne bloque pas : les passes gardent leur invariant et la
vérification physique reste le filet ; à corriger avec P8 ou au lot 4.
Ensuite : porte utilisateurs de fin de T1 (livrable propriétaire), qui
décide de l'ordre du lot 4.
