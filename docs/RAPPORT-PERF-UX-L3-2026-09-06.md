# Rapport L3 (lot 3 / T1 du masterplan) — constat par constat

Implémenteur : ZCode. Destinataire : vérificateur (Fable). Verrous tels que
transmis avec le feu vert (message du propriétaire) ; chaque constat cite
le verrou, ce qui est livré, où, et comment le rejouer. NON-GO et limites
sont énoncés en §J — rien n'est masqué.

## A. Kerf explicite (B.4 / masterplan 3.10) — LIVRÉ SEUL EN PREMIER

**Verrou** : deux champs, kerf et sécurité, règle affichée « espacement
égal kerf plus deux fois la tolérance », migration sans changement de
résultat pour les projets existants. Verrou : corpus et grille
bit-identique, un projet ancien rouvert donne le même espacement effectif.

**Livré** (commit isolé `feat(kerf)` — autonome et cohérent seul) :

- `app/utils/spacingParams.js` (nouveau, pur, testé) :
  `spacingFromKerfSafety` (règle, arrondi 4 décimales — 0.15×2 → 0.3,
  pas 0.30000000000000004), `withKerfDefaults` (migration : kerf = 0,
  sécurité = space/2), `safetyPatchForTargetMm` (levier : réduit la
  sécurité, jamais le kerf).
- `app/composables/files.js` : défauts d'usine `kerf '0'` +
  `sécurité '1'` = **espacement effectif 2 mm** (B.4 : 0,1 mm était
  irréaliste) ; `space` reste LA clé envoyée à l'API et aux deux moteurs
  **inchangée** ; chemin d'écriture unique `updateKerfSafety` maintient
  `space = kerf + 2 × sécurité` ; `syncParamsToUnit` convertit kerf et
  sécurité avec une résolution fine dédiée (0,01 mm / 0,0001") puis
  RECALCULE space — la règle reste exacte après un switch d'unité ;
  migration `withKerfDefaults` appliquée à la restauration de snapshot.
- `app/components/MainSettings.vue` : deux champs « Kerf (largeur de
  coupe) » et « Sécurité (marge par pièce) », ligne de règle
  « Espacement entre pièces = kerf + 2 × sécurité = {v} {unit} »,
  hint B.4 « au-delà de 2,4 mm, l'imbrication dans les trous est
  désactivée (limite moteur) » ; l'avertissement W10 (< 0,05 mm) porte
  sur l'effectif.
- La démo règle kerf 0 + sécurité DEMO_SPACE_MM/2 (2 mm reconstitué).

**Non-régression** :
- `git diff` sous `workers/` et moteur Rust : **zéro modification
  runtime** (seul ajout : `bench/densities_corpus.py`, script
  d'extraction). Corpus et grille sont bit-identiques PAR CONSTRUCTION ;
  la référence reste le run GO du 06/09 09:32 UTC (11/11) sur les images
  publiées fb5e184, inchangées côté worker.
- Projet ancien rouvert : testé unitairement — pour space ∈
  {0.1, 2, 2.4, 0, 1.5}, la migration rend un espacement effectif
  IDENTIQUE (`spacingParams.test.js`, 8/8). Structurellement,
  `factoryParams` (2 mm) ne s'applique qu'à la première visite d'un
  projet sans snapshot — les projets existants (snapshot session, jobs en
  base, `local-payload.get.js` qui sert le `p.space` stocké) ne voient
  aucune différence.
- Limite énoncée : un aller-retour d'unités mm→inch→mm peut dériver les
  valeurs d'un dizaine de millième (l'ancien champ `space` seul dérivait
  pareillement, l'arrondi d'affichage est inchangé).

## B. Refus capacité (C04, C09)

**Verrou** : un seul panneau, ancré sous le bouton Nest ou amené à
l'écran, levier espacement masqué sous 0,5 mm avec la phrase « même sans
espacement, ça ne tient pas », plus aucune carte « Nesting failed »
fantôme. Verrou : script de refus 4 mm étendu, plus un cas à 0,3 mm qui
doit masquer le levier.

**Livré** :
- Le panneau vit DANS l'aside, immédiatement sous le bouton Nest
  (`[slug].vue`), unique, + `scrollIntoView` à l'apparition (petit
  viewport).
- `capacityPanel.js` : `reduceSpacingToMm` masqué si espacement courant
  ≤ 0,5 mm OU si la cible ne dépasse pas le kerf (on ne réduit jamais la
  largeur de coupe de l'outil) ; `noSpacingGain` pilote la phrase
  « Même sans espacement, ces pièces ne tiennent pas — ajoutez une tôle
  ou retirez des pièces ». Le levier chiffré (maxSpacing) reste affiché
  (information).
- Carte d'échec (C09) : un job failed portant `unfit.reason=capacity`
  étiquette « Ne tient pas — non découpable » avec la cause en title —
  plus jamais « Nesting failed » générique sur un refus capacité.
- Tests : `capacityPanel.test.js` 9/9 (plancher, kerf bloquant, cas
  nominaux inchangés).
- E2E rejouables : `docs/qa/perf-audit-2026-09-05/l3-verif/
  qa-l3-refus-4mm.mjs` (VERT : panneau dans l'aside, levier 2,12 mm,
  clic → sécurité 1,06, kerf intact 0, effectif 2,12, zéro carte
  « Nesting failed ») et `qa-l3-refus-0.3mm.mjs` (VERT : levier absent,
  phrase plancher affichée). Captures `l3-refus-4mm-panel.png`,
  `l3-refus-0.3mm-panel.png`.

## C. Vocabulaire et glossaire (C06, C20, C21)

**Verrou** : « 900 pièces · 2 fichiers », « tôle » partout, jamais
« plaque », vouvoiement, nombres formatés selon la locale. Verrou : test
d'unicité des clés i18n, et un script qui grep les captures FR de
l'audit pour les mots interdits.

**Livré** :
- Compteur de zone fichiers : « {parts} pièces · {files} fichiers »
  (`project.partsFiles`) ; bouton « Imbriquer {n} pièces »
  (`settings.nestFiles` compte les pièces, pas les fichiers).
- « plaque » éradiqué du dictionnaire FR (settings.sheet/addSheet/
  removeSheet, plans ×3, project.minSheet, result.sheet/downloadSheet,
  result.noSolution, progress.stage.bpp-search, live.sheets) + le
  commentaire de `localPayloadBuilder.js`.
- Vouvoiement : privacy.device/cloud.body, vaultOff (« votre clé »),
  privacy.status.cloud, localImport.missingGeometry/emptyBrowser,
  auth.demoHint réécrits en vous.
- `formatNumber`/`formatPercent` via `Intl.NumberFormat` (fr-FR/en-US),
  exposés par `useLocale()` (`fmtPercent`, `fmtNumber`) et appliqués aux
  densités de ResultModal (barres, tableau, rapport texte), UserResultItem
  et LiveNestingView. FR affiche « 55,4 % », EN « 55.4% ».
- Test d'unicité : `app/tests/i18nDict.test.js` (6/6) — parse le SOURCE
  (un doublon littéral serait sinon écrasé silencieusement) : unicité EN,
  unicité FR, clés FR ⊆ EN, placeholders {x} identiques EN/FR, glossaire
  FR (plaque, tutoiements interdits). Ce passage a CORRIGÉ des doublons
  réels préexistants : `results.unfit` (valeur FR vivant dans le bloc
  EN !), `localMode.allInvalid`, `localMode.capacityExceeded`,
  `report.unplaced`, `report.duplicates`, `report.postPass` (dédoublonnés
  des deux blocs).
- Le grep « mots interdits » est livré sous forme de garde vitest du
  dictionnaire (les captures sont des PNG : un grep textuel y est
  impossible) ; les captures FR ci-dessous permettent le contrôle visuel.

## D. État « autre appareil » (C05)

**Verrou** : message explicite à la place de « 0 sheets + Download All ».
Verrou : e2e avec un second contexte navigateur qui ouvre le résultat
d'un calcul local.

**Livré** : `resultcontroller.js` expose `localOnly` (additif) ;
`localHydrate.hydrateLocalItems` marque `localElsewhere` un job localOnly
sans record IndexedDB sur CET appareil ; la carte affiche le placeholder
« Autre appareil » + titre « Calculé sur un autre appareil — résultats
non disponibles ici » (hint : la géométrie n'a jamais quitté cet
appareil), et le bouton de téléchargement serveur est masqué pour ces
jobs (l'ancien « Download All » avec href vide). La page projet affiche
déjà `localImport.emptyBrowser` (inchangé). E2E VERT :
`qa-l3-other-device.mjs` (calcul navigateur A, ouverture contexte B :
message présent, « 0 tôles » absent, 0 bouton download, placeholder
présent). Capture `l3-other-device-card.png`.

## E. Feedback de calcul (C10, C28)

**Verrou** : ligne d'état avec temps écoulé, meilleur score, nombre de
recherches, et la mention que le remplissage des trous apparaît au
résultat final. Verrou : capture pendant le calcul, cœurs corrects pour
un job local.

**Livré** : pendant un calcul local, une ligne d'état unique —
`live.statusLine` : « Recherche · {time} · meilleur {score} · {n}
recherche(s) en parallèle · arrêt automatique dès stagnation » (+ variante
sans score avant la première frame), préfixée par la phase zones ou l'
attente de slot ; mention « le remplissage des trous apparaît au résultat
final » quand « Imbriquer dans les trous » est actif (la vue live ne le
montre plus depuis AA4). `runningCores` corrigé : un job local (sans
`compute` SSE) affiche désormais le pool de walks réel au lieu du clamp
à 1. Capture pendant calcul : `l3-status-line-live.png` — texte exact
mesuré : « Searching · 1 s · best 54.5% · 4 search(es) in parallel ·
auto-stops at stagnation · parts nested inside cutouts appear in the
final result ».

## F. Sens d'optimisation (C07, C08)

**Verrou** : libellés par bord de tôle, cohérents sur tôle portrait,
espacement par défaut 2 mm. Verrou : captures portrait et paysage, et un
banc qui confirme que le défaut 2 mm ne change rien aux projets
existants.

**Livré** : libellés « Bord gauche / Bord bas / Équilibré » (FR) et
« Left edge / Bottom edge / Balanced » (EN), hints « vers le bord gauche
de la tôle (X = 0), dans le repère du dessin — suivez la flèche » ;
l'aide d'en-tête explique le repère. Les flèches adaptatives à
l'orientation (existantes, `displayDirectionArrow`) sont vérifiées par
e2e : sur tôle portrait couchée, « Bord gauche » porte ↑, « Bord bas » ←
— cohérent avec les axes origine affichés. Captures
`l3-settings-fr-paysage.png` / `l3-settings-fr-portrait.png`. Défaut
2 mm : §A (tests + raisonnement : `factoryParams` en première visite
seulement). NON-GO partiel : le découchage de la tôle portrait
(§2.1.8 du plan initial) n'est pas livré — voir §J.

## G. Vue live ≡ option 1 (C31)

**Verrou** : la frame finale de la vue live doit être le layout de
l'option affichée en premier. Verrou : e2e qui compare les poses de la
dernière frame live à l'alternative 0.

**Livré** : après le post-pass, `localJobPrivate` POUSSE la frame de
l'alternative rang 0 (celle du tri d'affichage, §2.2c) via le
`liveHandler` (remap idMap + décoration) ; le garde champion du registre
accepte toujours `stage === 'final'` (une frame finale est la conclusion,
pas une candidate). Test unitaire `localSolverRegistry.test.js`
(stage final remplace un champion mieux classé). E2E VERT
`qa-l3-live-final.mjs` : record IndexedDB `liveLayout.stage === 'final'`,
140/140 poses (= placées), option 1 = grille ; captures
`l3-live-final.png` (vue live finale) et `l3-modal-option1.png` (option 1
du modal) montrant le MÊME agencement. Limite énoncée : la comparaison
formelle poses-live vs poses-alt0 passe par le record, dont les
alternatives stockées sont allégées (pas de poses) — l'égalité est donc
prouvée par la structure (frame construite DEPUIS alternatives[idx[0]],
code relu) + le garde testé + le contrôle visuel.

## H. Compte (3.1.3 à 3.1.6)

**Verrou** : codes d'erreur stables côté API avec validation côté client,
dialogue accessible au clavier et au lecteur d'écran, bannière e-mail non
vérifié, page des offres qui reconnaît la session. Verrou : tests serveur
des codes, audit clavier sur le dialogue, e2e connecté sur la page des
offres.

**Livré** :
- 3.1.3 : `data.code` stables sur login/register (`invalid_email`,
  `password_too_short`, `name_required`, `email_taken`,
  `invalid_credentials`, `account_suspended`, `fields_required`,
  `auth_disabled`, `rate_limited` existant) + `field` ciblé. Client :
  `SERVER_ERROR_KEYS` → clés i18n FR/EN, erreurs SOUS le champ
  (aria-describedby + aria-invalid), validation client avant soumission,
  œil mot de passe (aria-label), mention CGU/confidentialité à
  l'inscription (liens), `autocomplete` name/email/current|new-password,
  `id`/`name` sur les inputs (descendus sur l'input par
  `InputField` `v-bind="$attrs"` + `inheritAttrs:false`). Tests serveur :
  `server/tests/authErrorCodes.test.js` 6/6.
- 3.1.4 : `DialogWrapper` — `role="dialog"`, `aria-modal`, focus initial
  sur le premier focusable, piège Tab/Shift+Tab, restitution au
  déclencheur à la fermeture, police mono retirée.
- 3.1.5 : `/api/user` expose `emailVerified` (locaux ; Google vérifié
  d'office) ; bannière persistante `VerifyEmailBanner` sur /home et
  /profile avec bouton de renvoi (best-effort) ; badge « Vérifié ✓ » sur
  le profil. E2E VERT `qa-l3-verify-banner.mjs` : compte neuf → check-email
  → « plus tard » → bannière avec l'e-mail affiché, renvoi cliquable sans
  erreur, PAS de badge sur le profil non vérifié.
- 3.1.6 : middleware `auth-optional` (setUser sans redirection) sur
  /plans et /changelog ; e2e : /plans connecté affiche « Gérer dans le
  profil » (3 CTA) ; échec Google affiché sur / (A8) via
  `?auth_error=…` → messages i18n.

## I. Benchmarks publics (3.9)

**Verrou** : page avec méthode reproductible, chiffres issus des images
publiées, machine et date, mêmes valeurs que le corpus. Verrou : le
vérificateur rejoue les cas publiés et compare.

**Livré** : `/benchmarks` (publique, footer, layout doc, SEO), bilingue.
Chiffres = extraction du **run GO du 2026-09-06 09:32 UTC sur les images
Docker publiées fb5e184** (celui de la vérification L2-quater v2),
via `workers/nesting/bench/densities_corpus.py` (nouveau, filtre
`CORPUS_SINCE`). Fiche : run fb5e184, 2026-09-06, worker Docker AMD
Ryzen 9 9900X, 4 vcores/job, budget 90 s. Tableau T-A..T-K : géométrie
décrite, tôles, espacement, pièces posées/demandées, densité matière
mesurée (55,4 / 84,4 / 60,0 / 76,5 / 61,5 / 89,0 / 60,1 / 64,0 / 58,5 %),
physique (vérifiée / partielle / refus honnête < 1 s). Méthode complète
(job standard produit, 1 sens, fillHoles, densité = aire posée / aire
tôles utilisées, validation physique), section robustesse (ESICUP shirts
+ rotations 30° : unités normalisées, densité non comparable, dites
comme telles), section honnêteté (pas une certification tierce, chiffres
re-vérifiés à chaque livraison moteur). Captures FR/EN
(`l3-benchmarks-fr.png`, `l3-benchmarks-en.png`). Rejeu : les valeurs
doivent rester identiques après publication des nouvelles images
(aucun diff runtime).

## J. NON-GO et limites (énoncés)

1. **Découchage de la tôle portrait** (§2.1.8 du plan initial) NON
   livré : les tôles portrait restent affichées couchées (choix de rendu
   global touchant vue live, aperçus et modal). L'ambiguïté dénoncée par
   l'audit est levée par le repère origine + axes + flèches adaptatives +
   libellés par bord dans le repère du dessin. Les verrous transmis
   (libellés par bord, cohérence portrait/paysage, défaut 2 mm) sont
   couverts.
2. **Popover cliquable** des sens d'optimisation : livré en `title`
   au survol ET au focus (boutons focusables) — pas un popover riche.
3. **Renvoi d'e-mail** : la confirmation « renvoyé ✓ » dépend du mailer ;
   en local sans SMTP le clic reste muet (best-effort assumé, aucun
   crash). À vérifier en prod.
4. **Comparaison formelle poses live/alt0 (C31)** : par structure + garde
   testé + contrôle visuel (le record ne stocke pas les poses des
   alternatives) — voir §G.
5. **`tests/test_integration_holes.py` (3 errors)** : PRÉEXISTANTES —
   vérifié à l'identique sur l'image publiée fb5e184 ; le module
   `core.geometry` du worker fileprocessing n'est pas empaqueté dans
   l'image nesting. Hors lot (aucun diff runtime Python).
6. **Benchmarks** : chiffres datés du run fb5e184 — à re-vérifier après
   publication des images de CE lot (identiques attendus : zéro diff
   runtime).
7. **Job awaiting_local orphelin** (découvert en QA) : si l'appareil qui
   doit résoudre un job local ferme avant de le prendre, le job reste
   awaiting_local et bloque les POST suivants (409) jusqu'à annulation
   manuelle depuis la carte ou le nettoyage. Comportement préexistant,
   hors périmètre du lot — signalé pour P8.

## K. Suites et vérifications exécutées (machine locale, images rebuilt)

- **vitest** : 476/476 (42 fichiers) — dont 24 nouveaux tests du lot
  (spacingParams 8, capacityPanel +3, i18nDict 6, registre C31 +1,
  authErrorCodes serveur 6).
- **pytest image nesting** (dev = HEAD) : 224 passed, 2 skipped,
  3 errors préexistantes (§J.5). **fileprocessing** : 35/35.
- **Corpus/grille** : zéro diff runtime `workers/` + moteur → les
  références du run GO (corpus 11/11 + FUSION 6/8, grille bit-identique
  [587,313]@0,1 / [573,327]@2) restent LA preuve ; à re-confirmer sur
  les images publiées de ce lot.
- **E2E navigateur (7 scripts, tous VERTS)** dans
  `docs/qa/perf-audit-2026-09-05/l3-verif/` : smoke-kerf, refus-4mm,
  refus-0.3mm, other-device, live-final, captures-fr, verify-banner
  (+ capture EN benchmarks). App locale sur images rebuilt
  `nest2d-app:local` (build HEAD).
- Captures livrées : réglages kerf (EN+FR paysage/portrait), ligne d'état
  pendant calcul, refus 4 mm + 0,3 mm, carte autre appareil, vue live
  finale vs option 1, plans FR connecté, benchmarks FR/EN, auth FR
  validation + CGU, bannière vérification, profil sans badge.

## L. Décisions d'implémentation notables

- Le levier « réduire l'espacement » réduit la SÉCURITÉ et ne touche
  jamais au kerf (l'outil physique), et disparaît si la cible ne dépasse
  pas le kerf.
- Le champ unique « Espacement » a disparu de l'UI au profit des deux
  causes ; `space` reste la clé de contrat (API + moteurs + jobs en
  base) — aucun changement de schéma.
- La carte « autre appareil » est un état discret (fond neutre), pas une
  erreur : c'est la conséquence attendue du mode privé.
- La page benchmarks refuse de publier la densité de T-I (instance
  ESICUP en unités normalisées) : publiée en section robustesse avec
  l'explication.
