# Rapport LOT 4 — phase A (dette) — 2026-09-07

Implémenteur : ZCode. Destinataire : vérificateur. Base : fiche
`FICHE-LOT4-T2-2026-09-06.md` §3 (verrous phase A) + §5/§7 (contrôles
intermédiaires P8 et A2/A3). Commits : `381d2b8` (P8), `54b16a6` (cache),
`0756c95` (A2+A3), `b36d9b2` (ménage), `3a01af7` (AH1-AH5), `93bff50`
(e2e WIP) + le commit de ce rapport. Un **NON-GO chiffré** est énoncé en
§E (verrou job ≤ 15 s) — rien n'est masqué.

## A. P8 — post-pass Python (verrou : CPU ≤ 3 s, ventilation, okRelayed, STRtree 1×/tôle)

- **Mesure d'abord** (profilage sur fixtures réelles T-A, image rebuild) :
  `_placed_poly` appelé 75 799 fois pour ~1 100 poses uniques ≈ 6 s de
  constructions shapely — la moitié du job serveur.
- **Mémoïsation par pose** (clé id(item) + garde-fou anti-collision) :
  `fill_residual_bands` 4 526 → ~1 500 ms ; **total post-pass+
  finalisation mesuré à vide : 2,07 s à 0,1 et 2,36 s à 2** (verrou ≤ 3 s
  ✓ ; les 2,5-3,2 s vus au contrôle intermédiaire l'étaient avec pytest
  en parallèle). Non-régression PROUVÉE : comptes [590, 509], verify,
  et SVG bytes [320960, 238303] **identiques** avant/après.
- **Cache vidé PAR JOB** (contrôle §5) : `finally` de `nesting_process`
  à côté du cache DXF ; plafond 20 000 (défense résiduelle).
- **Diagnostic cascade** : résolu en différé, **UNE occupancy par tôle**
  (STRtree une fois par tôle — verrou) ; `okRelayed` écrit APRÈS
  l'incrément (il valait toujours 0) et le diagnostic survit au rollback.
- **Ventilation par passe** (la mesure qui tranche le lot 5) :
  `postPass.perPass` {expand, holeFill, merge, compact : moved, frontX
  par tôle, rolledBack} — déterministe (stats sans horloge) ; temps par
  passe en monotonic → `postPassTimingsMs` au niveau du JOB (jamais dans
  stats : verrou bit-identique) ; `eval_corpus.py` affiche perPass.
  Le contrôle intermédiaire en a déjà tiré l'information clé : à 2 mm la
  compaction de la dernière tôle est acceptée (front 636/577 → 521,
  200+ pièces) — le gain post-pass sur la chute y est réel.

## B. A2 + AH1 — gardes par classe, référence avant post-pass (les deux langues)

- **JS** : `art.engineCounts` capturé DANS `buildAlternativeArtifacts`
  **juste après l'expansion, avant hole-fill/résiduel** (fans d'expansion
  attendues comprises — l'expansion RESTITUE l'état moteur) ; repli
  capture pré-expansion, puis demandé. Test vitest : passes RÉELLES,
  containers via `layoutTransforms`, perte de l'hôte INJECTÉE dans
  l'état final — détectée par la nouvelle référence, l'ancienne
  (recalculée après) reste muette ; pas de faux positif sans perte.
- **Python (AH1)** : la référence X2 était tautologique (calculée à la
  finalisation sur une solution mutée en place). `_engine_counts`
  capturé dans main.py juste après `expand_packs`/`expand_meta`, avant
  `apply_hole_fill` ; le X2 la lit avec repli défensif. Pytest miroir
  (`tests/test_guard_ah1.py`) : passes réelles + perte injectée.
- Verrou harnais 4 mm deux configurations : voir §E.

## C. A3 + AH2/AH3/AH5/AH6 — orphelins awaiting_local

- `takenAt` posé au GET `local-payload` (un job PRIS n'est jamais expiré).
- `server/utils/expireOrphanAwaitingLocal.js` : TTL 10 min
  (`runtimeConfig.awaitingLocalTtlMin`, AH5) ; **transition atomique
  conditionnée d'abord** (status + sans takenAt + non remboursé),
  remboursement seulement si `matchedCount === 1` (AH3 — test à deux
  appels concurrents : un seul −1).
- Appelé au POST nest **et à l'ouverture du flux SSE des résultats**
  (AH2) — carte « Non pris en charge par cet appareil — annulée et
  remboursée après 10 minutes » (FR/EN).
- **E2E** `qa-l4-orphan.mjs` (conforme AH6) : lecture projet 200 du
  contexte 1 AVANT sauvegarde de session ; assertion 200 dans le
  contexte 2 avant navigation (jamais de faux négatif silencieux) ;
  ouverture du flux du projet ; job relu PAR SON SLUG. **VERT** :
  fermeture avant prise (route abort du GET payload) → awaiting_local
  sans takenAt → createdAt vieilli de 11 min en base (TTL réel) →
  réouverture : **cancelled + awaiting_local_expired + refunded en 1 s**,
  carte visible sur la page du projet, **POST suivant 200 accepté**.
- AH4 (job pris puis abandonné pendant le solve) : **non-fait déclaré**
  — heartbeat navigateur hors périmètre du lot 4 (instruction fiche).
- L'expiration **écrit en base depuis un GET** (assumé, documenté dans
  l'utilitaire) : le GET SSE est le seul moment où le serveur sait que
  l'utilisateur regarde ; l'écriture est conditionnée et idempotente.

## D. Suites

- **vitest : 485/485** (43 fichiers) — dont +3 tests A2 (perte injectée),
  +2 serveur (idempotence orphelins), +6 i18n (lot 3), +1 garde C31.
- **pytest image nesting** : **227 passed, 2 skipped, 3 errors**
  (`test_integration_holes` — préexistantes, le module
  `core.geometry` du worker fileprocessing n'est pas empaqueté dans
  l'image nesting ; vérifié identique sur l'image PUBLIÉE fb5e184 au
  lot 3). **Commande exacte** (image locale rebuild = HEAD au moment de
  la mesure, `3a01af7`+) :
  ```
  docker run --rm -i --network nestorcut_nest2d -w /app \
    -e PYTHONPATH=/tmp/pylibs:/opt/common:/app \
    nest2d-nesting-worker:dev bash -c \
    "pip install --target /tmp/pylibs -q pytest; python -m pytest tests/ -q"
  ```
  L'écart avec le compte du contrôle P8 (233+1) : mon compte ne collecte
  que `tests/` depuis `/app` ; le contrôle incluant d'autres chemins de
  collecte comptait 6 tests de plus. Le nombre retenu est celui de la
  commande ci-dessus, image et HEAD datés.
- **fileprocessing** : 35/35 (inchangé).

## E. Verrous d'ensemble — mesure et verdicts

| Verrou fiche §3 | Mesure | Verdict |
|---|---|---|
| Post-pass T-A à 0,1 et 2 : CPU ≤ 3 s | **2,07 s / 2,36 s** à vide (run timings, sans cProfile ni charge) | ✓ |
| Grille bit-identique [587,313]/[573,327] | harnais @0,1 **[587,313]**, @2 **[573,327]** ; 6 runs T-A **[587,313]** ×6 | ✓ |
| Ventilation par passe dans postPass + eval_corpus | perPass + postPassTimingsMs (job doc) + affichage eval_corpus | ✓ |
| okRelayed correct | écrit après incrément ; survit au rollback | ✓ |
| STRtree une fois par tôle (diagnostic cascade) | diagnostic différé, 1 occupancy par tôle | ✓ |
| Garde : perte injectée réelle (pas de conteneurs fabriqués) | vitest 3 tests + pytest 3 tests, passes réelles | ✓ |
| Harnais 4 mm deux configs : partiels 892±6/900 avec leviers | **894/900** (6 non posées) ×2 configs, 3 leviers, physique propre | ✓ |
| Orphelins : e2e fermer/rouvrir, sans effet sur job pris | VERT (§C) ; job pris protégé par takenAt (test unitaire) | ✓ |
| Job serveur T-A création→fin ≤ 15 s sur 6 runs séquentiels | **14,7 ; 18,1 ; 18,1 ; 18,1 ; 18,1 ; 17,0 s** (moy. 17,3) — séquentiels, grille identique ×6 | **NON-GO — énoncé** |
| Corpus 11/11 | (chiffres du run final — §F) | (à la lecture) |
| Images = HEAD avant chaque mesure | assert_images_head OK 2026-09-06T21:48:24Z (fiche commitée + workers compose recréés) | ✓ |

**Décomposition du NON-GO 15 s** : le job = pickup worker (boucle
`idle_sleep=5,0` → ~2,5 s en moyenne) + moteur (~10-11 s, P3 déjà
appliqué, SAMPLE_CFG verrouillé par décision owner) + post-pass 2,1 s
(avant P8 : 5,1-9,4 s) + écritures. Atteindre 15 s exigerait soit le
budget moteur (SAMPLE_CFG — décision owner), soit la latence de pickup
(réduire `idle_sleep` : ~16 s encore), soit P4 (worker de finalisation,
phase B). Je n'ai pas bricolé le poll un soir de livraison pour coller
un chiffre : c'est un arbitrage du vérificateur.

## F. Corpus + benchmarks régénérés

- **Corpus 11/11 sur bits HEAD** (re-seed complet, séquentiel) : T-A
  **[587, 313]** 900/900 bit-identique, T-J REFUS attendu, T-F PARTIEL
  attendu, physique propre partout, 0 erreur post-pass ; FUSION 1/11 aux
  espacements par cas (le verrou FUSION ≥ 4/8 porte sur T-A@2, hors
  corpus standard — inchangé). La ventilation perPass apparaît dans la
  sortie eval_corpus (ex. T-G : merge/compact moved 0, frontX par tôle).
- **Benchmarks régénérés** (AGENTS.md §6, P8 touche workers/) :
  densités mesurées **IDENTIQUES** à la référence fb5e184 (55,4 / 84,4 /
  60,0 / 76,5 / 61,5 / 89,0 / 60,1 / 64,0 / 58,5 %) — preuve aval que
  P8 ne modifie aucun layout ; `data/benchmarks.js` : date 2026-09-07,
  version = commit de ce rapport, note « valeurs inchangées ».

## G. Non-faits énoncés (récapitulatif)

1. Verrou job ≤ 15 s : NON-GO chiffré (§E), arbitrage demandé.
2. AH4 : job pris puis abandonné pendant le solve — jamais expiré
   (heartbeat navigateur hors lot 4, instruction fiche).
3. L'expiration écrit en base depuis un GET — assumé, documenté.
4. La ventilation perPass n'a PAS de miroir JS (mesure serveur pour la
   décision lot 5 ; le test de parité replayUserBpp ne compare pas
   postPass complet Python/JS).
5. 3 errors pytest integration_holes — préexistantes, hors image.
