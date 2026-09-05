# Rapport d'implémentation — Lot 1 (L1) — 2026-09-05

Rapport constat-par-constat pour vérification, plan `docs/PLAN-PERF-UX-2026-09-05.md`
(§1 P1-P2, §2.1.1-2.1.3, §3.1.1-3.1.2). Implémenté sur `b3a06eb` par étapes
(6 commits). **Non déployé** — attend la vérification.

## P1 — Pré-filtre bbox JS + index grille (`residualClient.js`)

**Fait.** Quatre changements dans `app/composables/residualClient.js` :

1. `pairViolates` court-circuité par un pré-filtre bbox EXACT : les anneaux
   étant inclus dans leurs bbox, `ringDist(A,B) ≥ écart(bboxA,bboxB)`. Si
   l'écart bbox ≥ `space − ε` (resp. > 1e-9 à `space ≤ ε`), le test
   d'espacement est acquis sans le O(n·m), et la branche prise est
   exactement celle que `ringDist` aurait prise (`containedOverlap` W4) —
   **bit-identique par construction**, chaque branche démontrée.
2. `bbOf` : bbox mémoïsée par identité d'anneau (WeakMap) — les boucles
   chaudes réinterrogent les mêmes anneaux des centaines de fois.
3. `OccupancyIndex` : index grille uniforme (cellule 100 mm) de
   l'occupation, requêtes à `pad = space + 1`. Élagage exact : une paire à
   bbox disjointes ne peut JAMAIS violer (espacement, croisement,
   containment exigent tous proximité ou inclusion des bbox) — les paires
   élaguées auraient toutes renvoyé false.
4. Branché dans `validateBatch` (index des anneaux du layout, exemption
   trous §2.2b conservée) et `fillOneBatch` (index de l'occupancy, les
   poses commitées s'y ajoutent au fil de l'eau).

`validateReturn` garde le pré-filtre seul (listes courtes, pas d'index) ;
`ringDist` inchangé (sert au test d'audit). Python non touché (P8 STRtree
= L6) — parité préservée par les tests.

**Preuves.** `replayUserBpp.test.js` : replay pipeline 1 099 pièces,
0 chevauchement / hors tôle / doublon à chaque étape, **deux exécutions
bit-identiques**, parité D9 conservée (moved JS 509 = Python 509). Suite
vitest complète **439/439**. Micro-bench dédié : 400 000 paires lointaines
ringDist **193 s → pairViolates pré-filtré 0,42 s (×462)** ; paires
proches payent le chemin exact (requis). Corpus T-A : grille
**[587, 313] bit-identique à la référence** space 0,1.

**Notes honnêtes.** (a) Le gel résiduel cible « < 0,3 s » est mesuré
indirectement : micro-bench 0,42 s pour 400 000 paires LOINTAINES (le scénario
du gel), et e2e navigateur : fin de calcul → modal ouvert en ~2-4 s (dont
reveal 1,2 s + délais du script) contre 5,7 s de gel avant. Le scénario
exact « rollback front » n'a pas été rejoué séparément en navigateur.
(b) Mon micro-bench ringDist est plus lent que les 13 µs/paire de l'audit
(anneaux à 95 sommets ici) — le RAPPORT de gain reste représentatif.
(c) Les temps de calcul navigateur (44-64 s e2e) sont inchangés — normal,
L1 ne touche que le gel de finalisation ; le temps de solve est P3/P4.

## P2 — Mémoïsation holefill + décoration live 1 Hz (`holefill.py`, `main.py`)

**Fait.**

1. `pinwheel_capacity` mémoïsée : `lru_cache(maxsize=4096)` sur
   `_pinwheel_capacity_cached((trou, filler, space, rotations))` — clés
   hashables par coordonnées float ; la fonction publique renvoie une
   copie `list(...)` (l'API et l'égalité list==list des tests sont
   préservées). `hole_capacity` passe par elle (couvert d'office). Les
   hôtes d'une même classe partagent l'entrée (validité invariante par
   transform, cf. docstring).
2. `report_live_layout` : throttle 0,35 s → **1,0 s** (transitions de
   phase toujours passantes), et toute la décoration
   (`decorate_live_items` → `apply_hole_fill`) + l'écriture Mongo sorties
   du thread lecteur de stdout : thread décorateur dédié + file
   coalescente (maxsize 1, drop-stale — seule la DERNIÈRE frame déposée
   est traitée). Arrêt propre sur tous les chemins (sentinel + join 5 s
   dans un `finally` du bloc `run_engine` : succès, annulation, erreur).

**Preuves.** pytest holefill + holefill_bpp **18/18** ; suite workers
docker **215 passed, 1 skipped** (image dev reconstruite) ; corpus 11/11
avec T-A [587, 313] (le remplissage des trous produit des poses
identiques — garantie plus forte que le compte `holesFilled`).

**Notes honnêtes.** (a) Le gain CPU « −17 s / 40 s de solve » n'a pas été
mesuré directement dans cette passe (pas d'instrumentation CPU du worker
pendant le corpus) — la structure est en place (1 Hz au lieu de ~2,9 Hz,
hors thread, capacité mémoïsée) ; je propose de le chiffrer pendant la
journée de mesure P3. (b) Les frames intermédiaires sont abandonnées
(coalescing) : la vue live passe de ~2,9 à 1 Hz — assumé par le plan
(« décorer au plus 1×/s »), sans effet sur le résultat final.

## UX 2.1.1 (C01) — Annuler un calcul navigateur

**Fait.** `statusType.awaitingLocal` ajouté (constants) ;
`UserResultItem.isResultNexting` le reconnaît (carte « en cours » :
loader + bouton Annuler, plus d'état fantôme) ; bouton
`[data-testid="live-cancel"]` sous la vue live de la page projet
(`cancellableLiveSlug` = job `awaiting_local` du projet OU job serveur
streamé ; même chemin `cancelJob` du registre R-3 : POST /cancel + pools
par préfixe + retrait de file ; visible même avant la première frame).
Style discret (bordure secondaire, rouge au survol).

**Preuves.** Script dédié `scripts/qa-c01-cancel-live.mjs` : bouton
visible pendant le calcul navigateur (label « Cancel »), clic → scène
libérée (statut disparu, bouton disparu), bouton Nest réutilisable, aucun
pageerror. **C01 OK.**

## UX 2.1.2 (C02/C22) — Un seul indicateur de qualité

**Fait** (`ResultModal.vue` + i18n EN/FR) :

- Onglet par option : `Option n · {n} tôles · X,X% matière · chute
  W×H` (`altQualityLine`) — remplace `55% used` (emprise lue à l'envers).
- Headline : `Grille · Densité matière X,X% · Chute réutilisable : W×H`.
- Les DEUX barres (« Sheet utilization » sommaire + rapport) rebasées sur
  la **densité matière** (plus = mieux) ; masquées quand `density` est
  absent (jobs antérieurs) au lieu d'afficher un chiffre faux.
- Ligne rang 0 : « Proposée en premier — plus grande chute propre »
  (uniquement si ≥ 2 options).
- Sous-titre méthode : `alts.explain.grid` / `alts.explain.compact`
  (masqué pour stratégie inconnue).

**Preuves.** `scripts/qa-c02c03-modal.mjs` sur un calcul navigateur réel :
onglet actif « GRID · Option 1 · 2 sheets · 55.4% material · offcut
580.4 mm × 1000 mm » (vs Option 2 62,3% — le sens de lecture est
maintenant correct, l'option 1 est JUSTIFIÉE par sa chute), « Sheet
utilization » absent du modal, ligne pourquoi présente rang 0 / absente
rang 1, sous-titre Grille rendu.

**Note honnête.** La clé `report.utilization` et le champ
`usedSheetShare` restent présents mais inutilisés — le dédoublonnage
i18n et le nettoyage données sont le lot 3 (2.1.5).

## UX 2.1.3 (C03/C12) — Badges = verdict

**Fait.**

- Badge post-pass SUPPRIMÉ de `reportBadges` ; le post-pass (rollback et
  erreurs compris) vit dans un `<details data-testid="report-tech">`
  « Détails techniques » fermé par défaut (ligne moteur + lignes
  post-pass). Un résultat découpable n'affiche plus jamais de rouge
  « Post-pass … rollback ».
- Ligne moteur : seed MASQUÉ si absent (plus de « seed — ») ;
  itérations/cœurs au singulier au n=1 (`report.iterationsOne`,
  `report.coresOne`) ; « {n} combinations tested » → « {n} iterations ».
- Vue live : compteur « n combinaisons » RETIRÉ (C12) — itérations de
  recuit BPP et évaluations separator SPP n'y étaient pas comparables ;
  computeds associés supprimés.

**Preuves.** Même script : badges de l'option 1 = 4 verdicts (✓
Overlap-free, ✓ Inside sheet, ✓ Gap ≥ 0.1 mm, ✓ All 900 parts placed),
aucun badge KO, aucun « Post-pass » (options 1 ET 2), détails fermés par
défaut, ligne moteur « nest-engine · 1 core » (seed/itérations absents
MASQUÉS pour la Grille — générée, pas moteur), plus de « combinations
tested ».

## Compte 3.1.1 (A1/X4) — Couleur d'erreur opaque

**Fait.** Token `--error-text` : clair `rgb(200, 0, 48)`, sombre
`rgb(255, 110, 140)` (main.css, les deux thèmes). Les **17** usages de
`--error-border` COMME COULEUR DE TEXTE remplacés par `--error-text` :
DeleteAccount ×4, MainSettings, PromoCodeSettings, ResultModal (badge
--ko : fond teinté conservé, texte opaque), TurboMenuButton,
VaultMenuButton, VaultSettings ×3, VaultUnlock, UserProjectItem,
auth/local, auth/forgot-password, auth/reset-password. Les usages
`border-color:` restent à `--error-border` (rôle correct).

## Compte 3.1.2 (A2) — Rate-limit sur les échecs seulement

**Fait.** `ratelimit.js` : `rateLimitPeek` (teste sans consommer, renvoie
`retryAfterMs` réel), `rateLimitReset` ; `denyRateLimit` porte
`data.code='rate_limited'` + `retryAfterSec` (délai réel quand connu,
chute sur `windowMs` pour les appelants existants — forgot-password et
middleware inchangés). `login.post.js` : peek AVANT bcrypt, incrément
UNIQUEMENT sur `!user || !ok`, `rateLimitReset` au succès. Client
(`auth/local.vue`) : `rate_limited` → message traduit avec les minutes
(`auth.rateLimited` EN/FR).

**Preuves.** `server/tests/ratelimit.test.js` **8/8** (3 nouveaux : peek
ne consomme pas / reset / charge du 429 avec code + délai).

## Verrous du lot — tous verts

| Verrou | Résultat |
|---|---|
| vitest complet | **439/439** (37 fichiers) |
| pytest workers (docker, image reconstruite) | **215 passed, 1 skipped** |
| pytest holefill + holefill_bpp | **18/18** |
| corpus T-A..T-K (workers P2) | **11/11 OK** — T-A [587,313] bit-identique, T-F PARTIEL attendu, T-J REFUS attendu, T-K 1000/1000 |
| e2e navigateur space 0,1 | exit 0 — done 44 s, 2 alternatives, onglets qualité OK |
| e2e navigateur space 2 | exit 0 — done 46 s |
| e2e refus 4 mm (QA_EXPECT=refusal) | **GO** — leviers + actions, détecté 2,3 s |
| C01 annulation vue live | **OK** (`scripts/qa-c01-cancel-live.mjs`) |
| C02/C03 modal | **15 assertions OK** (`scripts/qa-c02c03-modal.mjs`) |
| `determinism_lock.py` | **Non requis** — L1 ne touche pas le moteur Rust (aucun rebuild wasm) |

## Non-GO / hors périmètre honnêtes

1. Gain CPU P2 non chiffré directement (voir note P2) — à mesurer pendant
   la journée de mesure P3.
2. Le scénario navigateur exact du gel (rollback front) vérifié via
   micro-bench + e2e, pas rejoué isolément.
3. `usedSheetShare` / `report.utilization` conservés mais inutilisés
   (dédup = L3).
4. Déploiement NON fait — attend validation. (Procédure habituelle :
   build images + `assert_images_head.sh`, corpus vert sur les images
   publiées.)
