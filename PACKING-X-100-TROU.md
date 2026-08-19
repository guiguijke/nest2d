# Packing –X : 100 `Piece_Trou` + 400 `Piece_Fillx4`

Mémo du cran qui revient à chaque nesting. Pas une spec produit —
c’est l’état des lieux pour ne pas retenter les mêmes fausses pistes.

> **RÉSOLU le 2026-08-19.** Cause racine : verrou latéral sub-mm — les
> gaps réels du solve tombent à 1,998 mm → shapes inflatées (±1 mm)
> chevauchées de 0,002 mm → toute sonde verticale à x fixe collisionne
> (tighten/gravité no-op) ; fenêtres x valides parfois disjointes
> (chicane). Fix (`column_fill.rs`) : sondes à fenêtre latérale calculée
> (`settle_with_lateral_window`), `realign_column_lanes`,
> `consolidate_leftover_right`, gardes granulaires par sous-passe,
> restack exige des colonnes compactes. Validé e2e docker : 6 colonnes
> au pas 102, gaps 2,00 mm, zéro trou ni inversion, bande 612,017 mm,
> holesFilled 400/400, natif≡wasm (determinism_lock). Détails :
> `specs/90-decisions.md` (2026-08-19, verrou latéral sub-mm).
> Les §3–5 ci-dessous décrivent l’état AVANT le fix (conservés pour
> l’historique des fausses pistes).

Capture de référence (prod, 2026-08-19) : modal **Color preview**,
`↑ –X · 81.4 %`, fichier
`nested-piece_fillx4_400-piece_trou_100-*.dxf`.

---

## 1. Le job

| | |
|---|---|
| Pièces | 100 hôtes `Piece_Trou` (carré 100 mm, trou r = 35) + 400 `Piece_Fillx4` |
| Tôle | 1000 × 2000 mm |
| Espacement | 2 mm |
| Sens | **–X seulement** (SPP, minimise la largeur de bande) |
| Pre-pass | D-MOT-16 : les 400 fillers sont déjà dans les trous. Le moteur ne voit **que 100 carrés pleins 100 mm**. |

Les croix roses dans les carrés bleus = 4 fillers déjà nichés. Ce n’est
pas 500 pièces à placer.

En vue DXF / Color preview : **X vers le bas**, **Y vers la droite**.
–X = on tasse vers le haut de l’écran (origine), on remplit le long de Y
(la grande dimension 2000 mm).

---

## 2. Ce qu’on voit (le problème)

Six rangées le long de X (vers le bas) :

1. Rangée 1 — pleine (~19 pièces), alignée.
2. Rangée 2 — pleine, alignée.
3. Rangée 3 — **deux pièces décalées** vers le bas, vers le milieu-droite.
   Un cran d’une cellule : le bord n’est plus droit, un trou d’air apparaît
   entre la rangée 3 et la 4.
4. Rangée 4 — pleine.
5. Rangée 5 — pleine (ou presque).
6. Rangée 6 — **5 pièces seulement**, collées à gauche. Escalier en L :
   tout le reste de la tôle sous les rangées 1–5 est vide à droite de
   ces 5 pièces.

Densité affichée **81,4 %**. C’est le même chiffre que le banc natif
(`workers/nesting/bench/out_trou100`) : bande **614,03 mm**, plancher
géométrique 610 mm (6 × 100 + 5 × 2) + 2 + 2 mm de marge tôle.

Deux défauts distincts, à ne pas mélanger :

| Défaut | Est-ce un vrai trou ? | Peut-on le faire disparaître ? |
|---|---|---|
| **L de 5 pièces** en dernière rangée | Non : 19 pièces/rangée max (20 × 100 + 19 × 2 = 2038 > 2000). 5 × 19 = 95, il reste 5 pièces → 6ᵉ rangée obligatoire. | Non, sans violer l’écartement ou la tôle. |
| **Deux pièces décalées** au milieu de la rangée 3 | Oui : gap inter-pièces > 2 mm, bord irrégulier. | Oui — c’est ça qu’il faut combler, **sans élargir la bande –X**. |

Le cahier des charges utilisateur, tranché le 2026-08-19 :

> Maintenir l’optimisation –X tout en comblant **au maximum** les gaps
> inter-pièces.

Donc : ne pas « faire un rectangle » en volant des pièces à la bande
compacte pour remplir le L. Le L de 5 est le reste –X. Les décalages
internes, eux, doivent partir.

---

## 3. Pourquoi c’est tenace

Après le pre-pass, le solve SPP + gravité `Left, Down, Left` sort déjà
très près du plancher (614 mm, gaps internes ~2,00 mm au banc). Les
défauts restants sont **locaux** (une ou deux pièces d’un cran).

Le post-pass `column_fill.rs` (J-092) est censé les rattraper. Trois
pièges le rendent souvent **no-op** (restore du snapshot → **pixel
identical** au layout d’avant) :

1. **Métrique en bandes de 100 mm.** Un carré 100 mm + space 2 mm
   chevauche deux bandes. Un cran d’une cellule est invisible pour
   `band_stair` → restack / notch-fill ne se déclenchent pas.
2. **Plafond `floor(used_w / 100) * 100`.** Grille 100+2 : used_w = 510
   → cap = 500 → la dernière colonne est refusée → restack restore.
3. **Donneurs « à gauche » pour gonfler la colonne courte.** Ça annule
   le –X (on raccourcit la bande compacte). Et avec l’inflation jagua
   (±1 mm), les sondes CDE ratent souvent → encore un restore.

Résultat vécu en prod : **exactement le même DXF** après plusieurs
déplois. Ce n’était pas un cache UI — le post-pass n’avait rien changé.

---

## 4. Tout ce qui a déjà été tenté

Ordre chronologique. Code : `workers/nesting/engine/crates/nest-engine/src/column_fill.rs`.
Wasm : `public/engine/nest_wasm_bg.wasm`. Prod = app.nestorcut.com.

### 4.1 Gravité directionnelle (J-086 / J-088) — en prod

`Left, Down, Left` après le solve. Tasse vers –X puis vers le bas.
Ne **remonte jamais** une pièce. Incapable de combler un cran dont la
pièce-clé est déjà plus bas ailleurs. Nécessaire, pas suffisant.

### 4.2 `notch_fill` par bandes 100 mm (J-092) — en prod, inefficace ici

Cherche une bande plus basse que `max_top` de plus de 20 mm (ou 25 %
de la hauteur médiane), y pose une pièce prise **à droite**.

**Échec** sur cette grille : le cran 100+2 est invisible (chevauchement
de bandes).

### 4.3 `restack_columns` (J-092) — en prod, souvent restore

Reconstruit les colonnes en posant chaque pièce sur la plus basse.
Accepté seulement si `band_stair` baisse.

**Échec** sur 100+2 : métrique aveugle, puis plafond 100 mm qui coupe
la dernière colonne. Sur 100 pièces / 5 colonnes : 20 pièces/colonne
ne tiennent pas en 2000 mm → `failed` → restore. Layout inchangé.

### 4.4 `fill_column_notches` + clustering `x_min` (2026-08-18, `305ce63`)

Seuil = demi-largeur médiane. Pose la pièce la plus haute **à droite**
sur une colonne plus courte. Test
`one_cell_notch_on_regular_grid_is_filled` vert (sans inflation).

**Échec en prod** : le cran court **est** la dernière colonne → zéro
donneur à droite. Capture utilisateur identique.

### 4.5 Donneurs = toutes les colonnes plus hautes (`803f12c`)

On vole le sommet des colonnes gauches pour gonfler la courte.

**Échec** : (a) ça casse le –X ; (b) inflation 2 mm → sondes CDE
refusées → restore. L’utilisateur : « c’est EXACTEMENT le même
résultat ».

### 4.6 `collapse_rightmost`

Vide la colonne droite sur le sommet des gauches **s’il reste de la
tête** (réduit la largeur = vrai gain –X).

**Échec ici** : 19 × 100 + 18 × 2 = 1936 mm, reste 64 mm < 100 mm.
Aucune pièce de plus ne rentre sur les rangées pleines.

### 4.7 `tighten_loose_gaps`

Tasse un gap interne > 8 mm dans une colonne.

**Échec initial** : abort global dès qu’**une** pièce est « protégée »
(filler dans un hôte). Sur une instance déjà réduite (100 carrés) ça
ne devrait pas jouer ; sur un layout encore mixte, tout le tassement
était mort. Ensuite filtré pièce par pièce — les gaps de 2,00 mm du
banc ne passent pas le seuil 8 mm. Les deux pièces **décalées** de la
rangée 3 ne sont pas un gap interne d’une même colonne, c’est un
décalage de grille : tighten ne les voit pas.

### 4.8 Rework « –X d’abord, pas d’égalisation » (`5f5bd91`, 2026-08-19)

- Restack **interdit** si le corps est déjà une bande –X (colonnes
  gauches alignées + reste à droite).
- Donneurs des crans = **droite seulement**.
- `level_protrusions` : la pièce qui dépasse en haut du corps va sur
  le tas de reste, pas l’inverse.
- Collapse seulement si la largeur **baisse**.
- Gravité Left / Down / Left à la fin.
- Garde : largeur utilisée ≤ largeur d’entrée.

Déployé app + wasm + worker (app.nestorcut.com). Tests
`left_pack_keeps_width_and_levels_protrusion` + la suite J-092 : 10/10.

**Toujours pas le layout propre.** La capture 81,4 % ci-dessus est
celle d’après ce déploiement : le L de 5 est toujours là (normal, §2)
**et** les deux pièces du milieu sont toujours décalées (le vrai
bug restant).

### 4.9 Ce qu’on n’a **pas** fait (volontairement)

- Élargir la bande pour « faire un joli rectangle » (interdit : –X).
- Recaser les 5 pièces du L dans les 5 premières rangées (impossible
  géométriquement, §2).
- Baisser l’écartement sous 2 mm.
- Tourner des hôtes pour gagner un cran (rotations déjà 0/90/180/270
  au pre-pass ; le moteur voit des carrés).

---

## 5bis. RÉSOLU (2026-08-19/20, trois vagues)

Le défaut est fermé en trois couches, toutes dans `column_fill.rs` :

1. **Trou interne d'une cellule** (pièce décalée de la rangée 3) :
   verrou latéral sub-mm — les gaps réels tombent à ~1,998 mm, les formes
   inflatées se chevauchent et toute sonde à x fixe collisionne. Fix :
   téléportation sondée via la **fenêtre latérale exacte** du span de
   destination (`settle_with_lateral_window`) + gardes **granulaires** par
   sous-passe (plus de restore global qui jetait le tassement réussi) +
   restack exigeant des colonnes compactes (ses métriques de sommets sont
   aveugles aux trous internes) + `realign_column_lanes` pour les pièces
   hors-lane. Piège #14d.
2. **Contact exact 2,0000 mm par dérive µm des lanes** (seed
   1000000000000000010) : la cellule cible est verrouillée par 4 voisines
   (fenêtre utile 0,25×0,49 µm). Fix : **snap des lanes** sur la grille
   canonique (atomique, CDE-validé), en **dernier recours** seulement
   (défaut résiduel après tighten+consolidate), sans élargir si le pitch
   moyen respire déjà. Piège #14f.
3. **Moignon [19×5+5]** : à largeur égale le SPP est indifférent à la
   forme — l'équilibre est un post-pass, `balance_lane_tops` : grille
   uniforme détectée, écart > 1 cellule → appends au sommet des couloirs
   courts (piles J-085 complètes, même delta → holesFilled intact) jusqu'à
   la cible canonique [17,17,17,17,16,16]. Piège #14e.
4. **Frames live en convention interne jagua** (panne 100+800 mode local,
   2026-08-20) : `emit_layout` sérialisait la transform INTERNE (ancrage
   centroïde) — toute pièce non centrée à l'origine (Piece_Fillx4,
   centroïde +17,66 mm) reconstruite depuis une frame était décalée de
   R(θ)·(−centroïde) → amas de fillers chevauchant hors tôle. Fix :
   frames en convention EXTERNE (`int_to_ext_transformation`, comme
   l'export final), map-back phase 2 vérifié sur pièce asymétrique.
   Piège #14g.

Banc : 50/50 seeds mono-walk clean ET équilibrés [17×4,16×2] ; 12/12
prod-like PERFECT ; E2E docker trou100 PASS (610,017 mm, 400/400 fillers,
gaps 2,00) ; determinism_lock natif≡wasm bit-identique.

---

## 5. Ce qui reste à trouver — § HISTORIQUE (résolu, voir §5bis)

Cible unique, mesurable :

- **Largeur de bande ≤ 614,03 mm** (ne pas régresser le –X).
- **Zéro décalage de grille** : toutes les pièces d’une même rangée
  ont le même `x` (vue) / le même `y` moteur, à ±0,1 mm.
- Gaps inter-pièces = **2,00 mm** partout (déjà vrai au banc sur les
  colonnes propres ; faux sur les deux pièces décalées de la rangée 3).
- Le L de 5 pièces en dernière rangée **reste**. Ce n’est pas un
  échec.

Piste la plus probable (pas encore implémentée) :

Les deux pièces décalées sont un **stair d’une cellule au milieu
d’une rangée**, pas une colonne plus courte. Ni `tighten` (gap
intra-colonne), ni `fill_column_notches` (colonne entière plus
basse), ni `level_protrusions` (sommet du corps vs médiane) ne
modélisent « pièce i de la rangée k décalée de 100 mm par rapport
à ses voisines de rangée ». Il faut un passage qui reclasse par
**rangée** (clustering sur l’axe **Y moteur** / X écran) et
ré-aligne chaque pièce sur le `x` majoritaire de sa rangée, CDE
validé, sans augmenter `used_width`.

---

## 6. Fichiers utiles

| Fichier | Rôle |
|---|---|
| `workers/nesting/engine/crates/nest-engine/src/column_fill.rs` | Post-pass left / balanced |
| `workers/nesting/engine/crates/nest-engine/src/gravity.rs` | Gravité Left/Down |
| `workers/nesting/bench/out_trou100/` | Banc 100 carrés, 614,03 mm, 81,43 % |
| `workers/nesting/bench/out_trou100/analyze.py` | Gaps par colonne |
| `public/engine/nest_wasm_bg.wasm` | Même moteur côté navigateur |
| `specs/20-moteur-nesting.md` D-MOT-12 / D-MOT-16 | Décisions gravité + pre-pass trous |
| `specs/90-decisions.md` (2026-08-18 / 19) | Journal des amendements post-pass |

Relancer un nesting **après** Ctrl+F5 : un résultat déjà calculé ne
se réécrit pas tout seul.
