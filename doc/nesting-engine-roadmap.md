# Nesting Engine Roadmap — Hole Support Strategy

> **Mise à jour (2026-07-28) — la stratégie a changé.** Après étude de
> l'upstream, le support des trous est livré **sans patcher le moteur de
> collision** :
>
> 1. **jagua-rs upgradé 0.6.4 → 0.7.1** — récupère le fix #73/#74
>    (`narrow_concavities` qui scellait les trous) + 11 mois d'améliorations.
>    ⚠️ Breaking changes absorbés : lbf est passé d'une interface stdin/stdout
>    JSON à une CLI fichier (`-i/-s/-c/-p`), et les rotations de sortie sont
>    en **degrés** (étaient en radians).
> 2. **Conversion canal ε** (`workers/nesting/core/holed_polygons.py`) —
>    approche officiellement recommandée par le mainteneur (issue #5) : chaque
>    trou est ouvert vers l'extérieur par un canal de 0,01 mm, transformant la
>    pièce en polygone simple. Le solve principal niche nativement dans les
>    trous ; le canal n'existe que dans la géométrie de collision (le DXF de
>    sortie est reconstruit depuis les entités d'origine).
> 3. **Post-pass `hole_relocation` conservé** comme filet de sécurité.
>
> Le patch natif ci-dessous reste la voie « propre » à long terme — le
> mainteneur de jagua-rs s'est dit ouvert à une PR bien implémentée
> (sparrow issue #61). Il devient un **différenciateur commercial potentiel
> (contribution upstream)** plutôt qu'un prérequis.
>
> Alternative évaluée : `fontanf/packingsolver` (C++/MIT) — seul moteur open
> source avec trous natifs + bin packing, mais changement de moteur complet.
> sparrow-BPP (bin packing par l'auteur de sparrow) est closed source,
> licence perpétuelle commerciale.

---

# Spec originale — Native Holed-Item Support in jagua-rs

Status: **spécification (non implémenté)** — la v1 livrée utilise le post-pass
Python `hole_relocation`. Ce document est le plan d'implémentation du support
natif des items à trous dans le moteur de collision jagua-rs (la « v2 cutting
edge »).

## Contexte

`jagua-rs` ne supporte pas les items à trous :

- `io/import.rs:62-65` — `ExtShape::Polygon` sur un item : les anneaux internes
  sont **silencieusement ignorés** (`warn!`), seul `outer` est importé.
- Toute la pile géométrique (`SPolygon`, quadtree, surrogate, fail-fast) ne
  connaît que des polygones simples sans trous.
- Les **conteneurs** supportent déjà les trous : ils sont fusionnés dans la
  quality zone 0 (`import.rs:128-140,168-169`) et deviennent des hazards
  `HazardEntity::Hole { idx }` (`entities/container.rs:121-131`).

Conséquence actuelle : la région d'un trou est traitée comme de la matière
pleine — espace perdu et densité rapportée gonflée (l'aire de l'item compte le
trou, `entities/item.rs:50-52` → `shape_orig.area()`).

La v1 contourne le problème avec un post-pass qui reloge des pièces entières
dans les trous après le solve (`workers/nesting/core/hole_relocation.py`).
Limites de la v1 : tout-ou-rien par tôle, pas d'imbrication partielle, pas de
nesting dans les trous *pendant* la recherche principale.

## Objectif v2

Permettre au solveur principal de placer des items **à l'intérieur des trous**
d'items déjà placés, pendant la recherche LBF, avec détection de collision
exacte et séparation (`min_item_separation`) respectée.

## Design proposé

### 1. Représentation géométrique

Étendre `SPolygon` (ou introduire `HPolygon`) avec des anneaux internes :

```rust
pub struct SPolygon {
    pub vertices: Vec<Point>,          // anneau extérieur (existant)
    pub holes: Vec<Vec<Point>>,        // NOUVEAU : anneaux internes (vide = comportement actuel)
    // bbox, area, diameter, poi : inchangés dans l'esprit,
    // area = aire extérieure - aire des trous
}
```

- `SPolygon::new` accepte `holes: Vec<Vec<Point>>` (défaut vide → rétro-compat
  totale du code existant et des benchmarks).
- `area` devient l'aire nette → corrige automatiquement la densité rapportée.
- Winding : extérieur CCW (existant), trous CW (normaliser à l'import).

### 2. Détection de collision (le cœur du chantier)

Cas à couvrir entre deux items A (placé, avec trous) et B (candidat) :

1. **B chevauche l'extérieur de A** → collision (logique existante).
2. **B entièrement contenu dans un trou de A** → **pas de collision** (c'est le
   nesting dans les trous), à condition que B ne touche ni l'anneau du trou ni
   un autre item déjà dans le trou.
3. **B à cheval sur l'anneau d'un trou** → collision.

Implémentation dans la quadtree (`collision_detection/quadtree`) :

- Enregistrer les **arêtes des trous** d'un item placé comme hazards de type
  `HazardEntity::PlacedItemHole { item, hole_idx }` (nouveau variant, symétrique
  du `Hole` des conteneurs).
- Le test item-vs-item devient :
  - edges extérieures vs B (existant) ;
  - edges de trous vs B : collision si une arête de B intersecte l'anneau ;
  - containment : si B est entièrement dans le trou et ne touche pas l'anneau
    → valide. Le point de référence (poi) de B testé contre chaque anneau
    (point-in-polygon) résout le cas 2 vs 3.
- `HazardFilter` : aucun changement de trait, les nouveaux hazards suivent les
  mêmes règles de filtrage que `PlacedItem`.

### 3. Fail-fast (surrogate, poles, piers)

`geometry/fail_fast/pole.rs` calcule les pôles inscrits dans le SPolygon. Avec
des trous, un pôle peut tomber dans un trou → faux négatifs de collision.
Options :

- **Pragmatique (recommandée en v2.0)** : désactiver poles/piers pour les items
  à trous (`n_ff_poles: 0` côté surrogate config pour ces items), le surrogate
  reste l'enveloppe extérieure (conservateur, correct).
- **Complet (v2.1)** : calculer les pôles sur la région matérielle réelle
  (polygone à trous) via une triangulation contrainte.

### 4. Simplification & offset

- `shape_modification.rs::offset_shape` utilise déjà un buffer qui gère les
  anneaux internes (`geo_buffer` les supporte) — vérifier que `Inflate` (items)
  **rétrécit** les trous et `Deflate` (conteneurs) les agrandit, pour que
  `min_item_separation` reste exact autour des anneaux.
- `close_narrow_concavities` : appliquer aussi aux anneaux internes.
- Un trou qui disparaît sous l'offset (< séparation) doit être droppé proprement.

### 5. Import / IO

- `import.rs` : importer `ExtShape::Polygon` sur les items **avec** `inner`
  (supprimer le `warn!`). `MultiPolygon` reste une erreur.
- Export SVG (`io/svg`) : dessiner les trous des items placés (`fill-rule:
  evenodd`) — indispensable pour le debug visuel.
- Densité : vérifier `placed_item_area` (aire nette) et `container.area()`
  (déjà nette) → densité exacte.

### 6. Solveur LBF

Aucun changement algorithmique : le sampling, la perte `LBFLoss` et la
recherche locale sont agnostiques — la CDE accepte simplement des placements
aujourd'hui rejetés. Effet attendu : le local search « découvre » les trous
tout seul dès qu'un sample y tombe.

## Plan de validation

1. **Tests unitaires Rust** (`lbf/tests/tests.rs`) :
   - disque dans trou annulaire accepté ; chevauchement d'anneau rejeté ;
   - deux items dans le même trou sans contact acceptés, avec contact rejetés.
2. **Fixtures Nest2D** : `Piece_Trou` + `Piece_Fillx4` (4 secteurs dans un
   trou r=35) — la solution optimale (1 tôle) doit être trouvée **par le solve
   principal**, sans post-pass.
3. **Benchmarks** : rejouer les instances `jagua-rs/assets/*.json` (suite de
   référence) — aucune régression de densité ni de temps sur les instances
   sans trous (holes vide = chemin de code actuel).
4. **Garde-fou densité** : la densité rapportée sur les instances à trous doit
   refléter l'aire nette (comparer avec le calcul shapely de référence).

## Effort estimé

| Composant | Complexité | Risque |
|---|---|---|
| SPolygon.holes + import/export | Moyenne | Faible |
| Hazards d'anneaux + règles de collision quadtree | **Élevée** | Moyen (faux positifs/négatifs de collision) |
| Fail-fast mode pragmatique | Faible | Faible |
| Offsets/simplification avec anneaux | Moyenne | Moyen (trous dégénérés) |
| Validation & benchmarks | Moyenne | — |

Total : ~1 à 2 semaines de Rust expert, benchmarks compris. Le point le plus
délicat est la quadtree : les invariants actuels supposent que « tout hazard
est de la matière » ; les anneaux introduisent des frontières « inversées »
(valide à l'intérieur du trou, matière à l'extérieur).

## Alternative intermédiaire (si le patch complet tarde)

Étendre le post-pass v1 :
- relocation **partielle** acceptée quand elle libère une tôle moins chère
  (coûts hétérogènes) ;
- relocation récursive (trous des pièces relogées offerts au round suivant) ;
- offrir les **concavités** des pièces en bord de tôle comme quasi-bins.
