# Plan d'amélioration — BPP multi-tôles : remplissage des bandes résiduelles

**Statut : LIVRÉ le 2026-09-01 (option A, `docs/PLAN-bpp-impl.md`) — pass `fill_residual_bands` implémenté le 2026-08-31, puis 3 correctifs le 2026-09-01 (vue live multi-tôles, `apply_hole_fill` scopé par tôle, coquille tx/ty `layoutAabb` JS). Les « jumeaux expand_meta » du 31/08 sont RÉEXPLIQUÉS et CORRIGÉS : ils venaient du hole-fill poolé à travers des tôles aux coordonnées coïncidantes, pas d'expand_meta (`plan_hole_fills` retourne None à space 0,1 sur cette géométrie). Récit complet : `docs/LIVRAISON-BPP-2026-09-01.md`.**  
Constat user 2026-08-31 : « 2 tôles customs 1000×1000, 100 holes + 800
fillers : tôle 1 = hélices seules, tôle 2 = hélices restantes + tous les
fillers, alors qu'il aurait pu en mettre PLEIN sur la première tôle. »

Décisions tranchées (D1–D5) et corrections de design (inset `space`,
bandes clipées à l'AABB pas des L, pas de cap 50 %) : voir le plan d'impl.

---

## 1. Constat reproduit et chiffré (banc Docker local, 2026-08-31)

Job reproductible : `bench/seed_bpp_2sheets.py` (100 `Piece_Trou` +
800 `Piece_Fillx4`, tôles 1000×1000 ×2, fillHoles ON, −X). Analyse :
`bench/analyze_bpp_2sheets.py` (répartition par tôle depuis les SVG livrés).

| space | Tôle 1 | Tôle 2 | usedSheetShare |
|---|---|---|---|
| 2 mm | 81 carrés + 324 fans (= 81 hélices × 4) — **bande droite 81 mm VIDE sur 1000** + bande haute | 19 carrés + **476 fans étalés**, offcut 0,396 m² | 0,721 |
| 0,1 mm | 81 carrés + 324 fans — bande droite 98 mm vide | 19 carrés + 476 fans, offcut 0,454 m² | 0,679 |

Potentiel mesuré : la tôle 1 a ~0,16 m² libres (bandes droite + haute) ;
le lattice fan calibré (~60-67 % en bande étroite) y tient **~120-170
fans** → la tôle 2 garderait une chute propre et bien plus grande.

## 2. Cause racine (trois mécanismes en cascade)

1. **Pré-passe « trous d'abord » (D-MOT-16)** : 400 fans sont extraits des
   hôtes (4/trou) → le moteur résout **100 carrés pleins + 400 fans** sur
   2 bins. Correct et voulu (c'est ce qui fait les hélices).
2. **Constructif BPP** (`constructive.rs`) : chaque fan va où la perte est
   minimale = **croissance marginale de bbox + penalty directionnelle**.
   La tôle 2 (bbox ~200 mm) offre toujours une croissance plus faible que
   la tôle 1 (bbox ~919 mm, xr≈0,92) → **tous les fans s'empilent sur la
   tôle 2**. Aucun bug : c'est la fonction de perte qui veut ça.
3. **Recuit BPP** (`sa.rs`) : coût lexicographique `(placées, nb tôles,
   remnant MOYEN, Falkenauer)`. À 2 tôles le nb de tôles est déjà optimal
   → il ne reste que le remnant moyen. Déplacer UN fan vers la bande de
   la tôle 1 **baisse** le remnant de la tôle 1 et ne remonte (quasi) pas
   celui de la tôle 2 (le fan parti n'était pas au bord extrême) → coût
   non améliorant → mouvement rejeté. **Optimum local structurel** : le
   backfill exige ~100 déplacements individuellement non améliorants.

Le produit, lui, veut l'inverse du Falkenauer une fois le nb de tôles
optimal : **remplir les tôles précédentes, garder la DERNIÈRE comme
chute réutilisable propre** (comportement déjà vu sur la démo :
278 pièces tôle 1 + 26 tôle 2, chute 1197,9×3000).

## 3. Options comparées

| Option | Principe | Effort | Risques | Verdict |
|---|---|---|---|---|
| **A. Post-pass « remplissage résiduel »** (Python + miroir JS, **pas de moteur**) | Après hole-fill, avant finalisation : mesurer les bandes libres des tôles préc., y poser un lattice des petites pièces prises sur la dernière tôle, valider physiquement, répéter | ~2-3 j | Post-pass de plus (mais même famille que `apply_hole_fill`, gardes connues) | **RECOMMANDÉE (v1)** |
| B. Moteur : coût remnant max + move backfill (Rust + wasm) | Remnant du bin le moins rempli (pas la moyenne) + mouvement SA de backfill | ~1-2 sem | Rebuild wasm, determinism_lock, `remnant` exposé aux frames live (isBetter B.4), régression possible des 3 classes | Différé — si A insuffisant |
| C. Constructif « best-fit » (préférer la tôle la plus remplie à perte égale) | Facteur fill-ratio dans la perte | ~2 j Rust | Ne règle pas le SA (l'optimum local reste), demi-mesure | Rejeté |
| D. Capacité des trous > 4 (packer pinwheel 5-6/trou) | Aire trou 3848 mm² vs 4×615 posés | Recherche | Gain borné (≤ +200 fans répartis), ne remplit pas les bandes | Bonus ultérieur |

## 4. Option A — design détaillé (v1 : bandes latérales)

### 4.1 Quand s'active le pass

BPP **uniquement**, `layoutCount ≥ 2` utilisé, et : il existe sur une
tôle i < dernière un **bande libre** (ci-dessous) assez grande pour ≥ 2
bbox de la classe candidate. Sinon no-op (zéro coût pour les jobs qui
n'en ont pas besoin, SPP inclus).

### 4.2 Bandes libres mesurées (v1, positionnées)

Pour chaque tôle : bbox utilisée `[minx, miny, maxx, maxy]` des placements
(translation externe + bbox tournée, déjà le formalisme `layout_fits_sheet`)
→ 4 bandes latérales + 2 L : `(droite, haut, gauche, bas, L_droite_haut,
L_haut_droite)` en **rectangles positionnés**. C'est exactement la
géométrie du `layout_remnant` Rust (importée en Python/JS, ~30 lignes) ;
elle couvre le constat (bandes 81-98 mm). Les poches **intérieures**
(entre pièces) = v2 optionnelle (rectangles exacts du free-space, les
internes de `largest_empty_rectangle` savent déjà le faire).

### 4.3 Algorithme (par alternative moteur, déterministe)

```
pour chaque alternative BPP (toutes, pas seulement le rang 0) :
  bins_utilisés triés par remplissage décroissant ; last = le moins rempli
  répéter (max N_ITER = 4) :
    pour chaque bin i ≠ last (du plus rempli au moins rempli) :
      pour chaque bande du bin i (surface décroissante) :
        classes candidates = pièces « libres » du bin last,
          EXCLUES les pièces à trous (hôtes — jamais déplacer un hôte de
          sa hélice) et les pièces déjà dans un trou ;
        classe la plus nombreuse dont la bbox tient dans la bande ;
        placements = small_lattice(classe, space, bande)   ← déjà calibré
        si placements non vide :
          déplacer min(len, dispo) pièces du bin last vers la bande ;
          VALIDER (STRtree, distances ≥ space − ε, insideSheet P-4) ;
          si invalide → annuler CE batch et passer à la bande suivante ;
    jusqu'à ce qu'aucune tôle ne gagne de pièce
```

Gardes (expérience des passes précédentes) :
- **compte par item_id inchangé** (part-loss guard existant le vérifie
  déjà en finalisation) ;
- toute exception → alternative laissée **intacte** (même contrat que le
  pass grille : repli silencieux, jamais de layout illégal) ;
- pièces prises du bin last **par ordre anti-compacité** (les plus
  excentrées d'abord → la bbox du last se rétracte au fur et à mesure) ;
- déterminisme : pas d'aléa (lattice analytique + tri stables).

### 4.4 Fichiers

| Côté | Fichier | Nature |
|---|---|---|
| Python | `workers/nesting/core/residual.py` (nouveau) | `fill_residual_bands(alt, input_items, bin_dims, space)` |
| Python | `core/main.py` | appel après `apply_hole_fill` (~l. 1320), avant reveal |
| JS | `app/composables/localBridge.js` | miroir `fillResidualBands` (après `applyHoleFill` dans `buildAlternativeArtifacts`) |
| JS | `app/composables/structureClient.js` | rien (smallLattice déjà exporté) ; bandes = petite fonction partagée |
| Tests | `workers/nesting/tests/test_residual.py` + `app/tests/localBridge.test.js` | voir §5 |

Pas de moteur, **pas de rebuild wasm** (piège #33b non déclenché).

### 4.5 Ce qui change pour l'utilisateur

- Tôle 1 du constat : ~120-170 fans en plus dans les bandes (lattice
  entrelacé = même rendu que la grille SPP) ; tôle 2 : chute plus grande
  ET plus propre (rectangle quasi plein).
- Le rapport matière / offcut par tôle reflète le nouveau layout (le pass
  tourne avant la mesure — aucun double calcul).

## 5. Tests

**Unitaires (pytest + vitest, miroir)**
1. bande droite 81 mm + classe fan → ≥ 80 placements, 0 conflit, dans la bande.
2. déplacement : bin last perd exactement les pièces posées ; compte global intact.
3. hôte à trous JAMAIS déplacé ; pièce dans un trou jamais déplacée.
4. validation physique post-pass : STRtree ≥ space, insideSheet vrai
   (sinon batch annulé) — test avec une bande trop petite → no-op.
5. SPP mono-tôle et BPP 1 tôle : pass no-op (aucun appel de déplacement).

**Banc (docker, scripts déjà posés)**
- `seed_bpp_2sheets.py` space 2 et 0,1 → `analyze_bpp_2sheets.py` :
  tôle 1 ≥ 400 fans ; offcut tôle 2 nettement ↑ ; puis `check_physical.py`
  adapté 2 tôles (0 chevauchement / 0 hors tôle / min-dist ≥ space).
- Non-régression : banc SPP phare 100+800 (M1 du plan P/Q) — le pass est
  no-op en SPP, chiffres 73,67 % inchangés attendus.

**Manuel (après déploiement)**
- Le scénario user exact (THIS DEVICE + serveur) : captures avant/après.
- Démo 304 pièces : 2 tôles 278+26 → ne doit pas bouger (le pass y est
  no-op : la tôle 2 n'a pas de bandes exploitables vs pièces restantes).

## 6. Critères de succès

- [ ] Repro space 2 : tôle 1 passe de 324 à **≥ 420 fans** ; offcut tôle
      2 **≥ 0,5 m²** ; 0 chevauchement/hors tôle (validation exhaustive).
- [ ] Comptes pièces inchangés partout ; hôtes jamais déplacés.
- [ ] SPP strictement inchangé (banc phare 73,67 %, vitest 361 verts).
- [ ] THIS DEVICE ≡ serveur (même pass, miroir).
- [ ] Temps du pass < 1 s par alternative (lattice analytique, STRtree borné).

## 7. Décisions à valider (l'utilisateur tranche)

1. **D1 — Sens du remplissage** : « remplir les tôles préc., maximiser la
   chute de la dernière » (proposé, conforme atelier/démo) — ou équilibrage
   égalitaire des tôles ?
2. **D2 — Périmètre v1** : bandes latérales seulement (proposé) ou
   rectangles intérieurs exacts dès la v1 (+1 j, gain marginal sur ce
   corpus) ?
3. **D3 — Pièces déplacées** : uniquement les petites classes (bbox ≤ 50 %
   de la bande, proposé) ou toute pièce qui tient ?
4. **D4 — Alternative(s) ciblées** : toutes les alternatives BPP (proposé,
   cohérence du comparateur du modal) ou seulement le rang 0 ?
5. **D5 — Option D en bonus** (5-6 fans/trou) : à étudier après A, ou
   fermer ?

## 8. Hors-scope de ce chantier

- Moteur Rust / coût SA / wasm (option B) — chantier séparé si A insuffisant.
- CLC / coupe commune, grille SPP, quotas, UI §R/§W (livrés).
- Répartition multi-formats hétérogènes (le pass est générique mais les
  bancs de validation sont mono-format).
