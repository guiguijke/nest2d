# Rapport d'implémentation — Lot 2 (P3 arrêt par itérations + P7 threads) — 2026-09-05

Décisions propriétaire appliquées (message du 05/09 soir) : **k = 3,
plancher 30 itérations, SANS plancher de temps** (le plancher horloge
aurait cassé le verrou natif ≡ wasm) ; **SAMPLE_CFG inchangé**. Non
déployé — attend la vérification.

## P3 — Arrêt BPP par itérations (`sa.rs`)

**Fait.** Règle au sommet de boucle : le walk s'arrête quand
`iterations − it_dernière_amélioration ≥ max(30, 3 × it_dernière_amélioration)`.
Aucune horloge dans la règle → **le wasm (~1,5× plus lent) s'arrête à la
MÊME itération** (c'est le gain de déterminisme recherché). La patience
temps existante (plafond) et le deadline (ceinture) restent inchangés.
Compteur `last_improvement_iter` posé à 0 (amélioration initiale) et à
chaque amélioration.

Tests moteur : nouveau `iteration_patience_stops_deterministically`
(deux runs du même seed → même itération d'arrêt, entre 30 et 60) ; le
test V2 « classe unique doit battre 1 s » est MIS À JOUR — le walk
convergé finit vers l'itération 30 AVANT la première seconde : le spin
muet que V2 corrigeait n'existe plus (le heartbeat n'a plus à battre,
le walk se termine). 72/72 + 2 doc-tests.

## P7 — Comptabilité threads (`sparrow/optimizer/separator.rs`)

**Fait.** Le pool local du separator SPP est borné à
`min(n_workers, RAYON_NUM_THREADS)` (l'env posé par le worker selon le
tier 1/4/8) ; à budget 1 il tourne inline (comme le wasm). Sans cette
borne, un job à budget 1 spawnait quand même 3 threads separator — les
jetons compute étaient fictifs. En prod, standard (4) et Pro (8) restent
à 3 (inchangé) ; le chemin Free serveur devient honnête. Vérifié sur les
cas SPP du corpus (T-E, T-G verts).

## Mesures avant/après (verrous ajoutés par le vérificateur)

**Chute de la dernière tôle (compaction), 3 runs chacun** —
tolérances 3 pièces / 5 mm :

| Cas | AVANT (comptes · chute dernière) | APRÈS | Écart max |
|---|---|---|---|
| T-A @2 | [555,345]·479,18 / [557,343]·479,13 / [527,373]·516,88 | [555,345]·479,19 / [572,328]·479,19 / [526,374]·513,63 | chute ≤ 3,3 mm ✓ ; comptes : dispersion 527↔572 = **variance Y6 préexistante** (AVANT lui-même 527↔557) |
| C @1 | [33,27] / [31,29] / [32,28] | [31,29] / [32,28] / [29,31] | 3 pièces (à la tolérance) ✓ |
| F @1 | [29,60] / [28,61] / [28,61] | identiques | 0 ✓ |

(brutes : `.qa-pw/p3dump/offcut-AVANT.txt` / `offcut-APRES.txt`,
outil committé `bench/measure_offcut.py`.)

**Temps (cible du plan : standard 60-115 → 15-25 s)** :

| Mesure | Avant | Après P3 |
|---|---|---|
| Job serveur T-A (0,1), sans file | 62-65 s | **21-22 s** |
| Job navigateur Free 8 walks (e2e 0,1) | 42-46 s | **22 s** (15 s sur le harnais freeze) |
| Job navigateur space 2 | ~45 s | **21 s** |

Le **post-pass (~11 s CPU, P8 promu au lot courant/courant+2)** est
désormais le premier coût du job — exactement la prédiction AA8.

## Verrous — tous verts

| Verrou | Résultat |
|---|---|
| `determinism_lock.py` natif ≡ wasm (après retrait du plancher temps) | **OK — SHA-256 identiques** |
| Tests moteur (cargo, --release) | **72 + 2 doc, 0 échec** |
| Corpus T-A..T-K | **11/11 OK** — T-A **[587, 313]** bit-identique, T-K [533, 467], T-J REFUS, T-F PARTIEL attendus |
| Banc 0,1 / 2 navigateur (e2e) | exit 0 — grille 55,4 % · chute 580,4 / compaction 603,7 (inchangés) |
| Refus 4 mm | **GO**, 2,2 s |
| Gel fin de calcul (qa-e2e-freeze) | **348 ms** (< 0,5 s maintenu) |
| vitest complet | **449/449** |
| Chute dernière tôle avant/après | dans les tolérances (tableau ci-dessus) |
| wasm | rebuildé + commité (build-wasm.sh, wasm-opt -O3) |

## Notes honnêtes

1. La cible « navigateur 8-12 s » n'est pas atteinte (22 s) : le moteur
   est désormais rapide, le restant est post-pass + reveal — le
   chantier est P4 (worker de finalisation) et P8 (STRtree, promu) :
   cohérent avec le masterplan (T2).
2. La comparaison de comptes par tôle sur T-A@2 est limitée par la
   variance de charge Y6 (±25 pièces entre runs AVANT eux-mêmes) ; la
   métrique chute (celle que le vérificateur a désignée) est stable à
   3,3 mm près.
3. La mesure de temps « avant » propre = premier job de chaque vague
   (sans attente de file) ; les jobs en file portaient jusqu'à 273 s
   d'attente, écartés.
4. SAMPLE_CFG : inchangé par décision — aucun changement de code.
