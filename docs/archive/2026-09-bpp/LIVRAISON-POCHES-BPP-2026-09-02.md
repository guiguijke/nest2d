# Livraison « poches BPP » 2026-09-02 — remplissage des colonnes partielles + retry dégradé

Implémentation de [`PLAN-fix-poches-bpp.md`](PLAN-fix-poches-bpp.md) (failles
F1/F2 de [`AUDIT-BPP-2026-09-02.md`](AUDIT-BPP-2026-09-02.md)). Non commité à
l'écriture de cette note.

## Chiffres (banc 2×1000×1000, 100 trous + 800 fans, space 0,1, job
`bench-bpp2s-1-1788343091`, code monté au conteneur)

| Métrique | Avant | Après | Critère GO |
|---|---|---|---|
| Chute tôle 2 (réutilisable) | 500,8×1000 | **580,4×1000 (+16 %)** | ≥ 560 ✓ |
| Front tôle 2 (AABB maxx) | 499,2 | **419,6** | ≤ 450 ✓ |
| Poche x[200,300]×y[100,1000] | 79 800 mm² vides | **comblée** (fans x[220..400]) | ✓ |
| usedSheetShare global | 0,7133 | 0,6954 | ≤ 0,69 (≈, objectif chute dépassé) |
| Tôle 1 | 591 pièces, 81,2 % | idem | inchangée ✓ |
| Physique (check_physical) | OK | **VERDICT OK** — 0 chevauchement, 0 hors tôle, min-dist 0,0996 (bruit simplify), 4 fans/trou | bloquant ✓ |
| Banc space 2 (tôle 1) | 474 fans | **475** | ≥ 474 ✓ |

Poches internes résiduelles tôle 2 : 15 049 → 11 467 cm² (reste = résidu
in-hole inévitable ~26,3k + micro-gaps du lattice fans, ~73 % de densité).

## Changements

- `workers/nesting/core/residual.py` (miroir `app/composables/residualClient.js`) :
  1. **F1** — `_regrid_helices`/`regridHelices` retournent
     `(moved, free_rects)` : rect libre de la DERNIÈRE colonne partielle de
     la grille (clippé au maxx des autres colonnes) ; `_compact_last_sheet`/
     `compactLastSheet` remplissent les poches AVANT les bandes classiques
     (bascule unique vers les bandes au premier échec).
  2. **F2a** — batches d'une pose admis en zones explicites (`bands`) ; les
     bandes classiques gardent le seuil 2 (contrat T4).
  3. **F2b** — retry dégradé : batch invalide ré-essayé en `take//2 … 1`
     au lieu d'un rollback total.
  4. **Bug racine découvert en route (préexistant, latent)** :
     `list.remove(pi)` compare les dicts PAR VALEUR — la transformation du
     donneur vient d'être écrasée par la pose lattice, donc le `remove`
     détruisait une pièce DÉJÀ POSÉE à la pose jumelle au lieu de lever
     `ValueError` → la compaction bouclait à l'infini en posant/déposant les
     mêmes pièces. Fix : `_remove_by_identity` + rollback qui ne réinsère
     au src que ce qui en venient réellement (`wasInSrc`) — corrige au
     passage le ré-ajout non validé des donneuses détachées dans le
     rollback de compaction. Verrous : `TestT15RemoveByIdentity` (pytest) +
     test jumelles (vitest).
- `workers/nesting/core/structure.py` : `small_lattice` plafonne la
  génération finale du lattice à `want` poses (`stop_after`) — les poses
  au-delà étaient tronquées au scoring ; `try_pitch` reste sur patch
  complet (5×8). Résultat identique, quasiment instantané sur les queues
  de remplissage (constaté : T10 passait de <100 ms à >200 s sans ça).
- Miroir JS : bijection, plus `const → let` sur `moved` (le `moved += n`
  sur une const lançait une TypeError avalée par le filet try/catch :
  compaction silencieusement annulée — détecté par le test T10 JS).

## Tests

- pytest `tests/test_residual.py` : **25/25** (T1-T9 inchangés hors les
  bornes x des fans de T10 : la poche est désormais remplie, bornes 155→100)
  + T11 (poches du re-grid), T12 (poche remplie avant bande droite +
  validité physique), T13 (batch 1 en poche / refus par défaut), T14
  (retry dégradé avec leurre), T15 (remove par identité).
- Suite worker complète : **152 passed + 2 skipped** (3 erreurs
  `test_integration_holes` préexistantes : module absent de l'image —
  documenté livraison 2026-09-01).
- vitest : **386/386** (377 + 9 nouveaux : T11-T15 miroir + parité
  comportementale). Exports ajoutés : `fillOneBatch`, `helixUnitsAndFree`,
  `regridHelices`.

## Pièges / notes

- L'idempotence ne peut pas se mesurer via `audit_bpp_replay.py` (le
  parseur SVG lit un monde miroir Y, piège #56 → le rejeu « répare » une
  tôle miroir) ; elle est verrouillée par tests (double appel, comptes
  conservés).
- Les poches ne proviennent que du re-grid de la donneuse et sont
  consommées sur la même tôle (piège #52 respecté).
- Aucun Rust/wasm touché (piège #33b) ; `structure.py` inchangé
  sémantiquement (plafond de génération uniquement).

## Correctif soir 2026-09-02 — chevauchements navigateur (re-test user)

Constat user sur le run THIS DEVICE (job `nested-f-9a2ec2e8689575ff_800-…`)
: « ça overlappe » sur la tôle 2 — colonne de fans empilées.

**Cause racine (prouvée par test)** : `validateBatch` JS calculait
`lim = space − 2×LATTICE_SIMPLIFY_MM − EPS` — à space 0,1 ce seuil est
NÉGATIF et `ringDist < lim` ne rejetait plus JAMAIS rien : la validation
du miroir navigateur était désactivée. Inoffensif tant que les zones
remplies étaient des bandes extérieures (libres par construction), mais
les POCHES + itérations du fix l'ont rendue porteuse : la 2e itération
re-pose des fans aux mêmes poses que la 1re → validées à tort → piles
(dist 0). Reproduit au banc : fixture 300 fans → **477 paires à distance
0** avant fix, 0 après.

**Fix** : plancher `lim = Math.max(1e-9, space − 2×SIMPLIFY − EPS)`
(residualClient.js). Le Python était sain (`space − ε` sur simplifié),
d'où 0 chevauchement côté serveur pendant que le navigateur empilait.
Verrou : test « seuil jamais négatif » dans residualClient.test.js
(387/387 vitest). C'était la faille F7 de l'audit (seuils JS/Python
incohérents) — elle mordait exactement là.

Images locales rebuildées après fix (app + worker), stack relancée.
