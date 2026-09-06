# Plan — d’abord la dette, ensuite les lignes de coupe communes

Date : 2026-08-30  
Statut : **cible**, pas `[prod]`. Chantiers A+B d’abord ; CLC (C) seulement après filet vert.  
Complète `docs/STRATEGY.md` (G-code hors produit) et `docs/archive/2026-08-audits/AUDIT-2026-08-29.md`. Une entrée dans `specs/90-decisions.md` au moment de coder C, pas avant.

---

## Verdict

**Aucune feature CLC tant que le socle n’est pas durci.** Le risque n’est pas « le calque magenta ». C’est d’empiler un algo géométrique dual Python/Rust/JS + de nouveaux params longueur + un post-pass de placement sur un export déjà forké (`build_part` ezdxf vs `build_part_dxf` Rust, `space` lu depuis `engineConfig` en local).

Ordre gravé :

1. **Stabiliser + refactor ciblé** (livrable autonome, goldens inchangés sauf défaut d’espacement documenté).
2. **CLC** seulement après, sur ce socle.

Cible produit CLC (pour ne pas la perdre) : `space` et `kerf` coexistent. Deux pièces qui *peuvent* partager un trait se collent au kerf ; une troisième qui ne partage rien reste à 5 mm du cluster. Contrat CAM v1 = cote finie + calques `NC_*`. Pas de « tout centre-ligne » sans offsetteur.

---

## Principe de séquence

```
[A] Stabiliser l’arbre actuel
      → [B] Refactor params / export (débloque CLC sans le coder)
            → [C] Common-line (snap packing + cluster DXF + calques)
                  → [D] Leads / start au milieu / packer plus fin
```

A et B **se shippent sans CLC**. Si B casse un golden, on s’arrête : on n’a pas encore touché au nesting.

---

# Chantier A — Stabiliser (avant tout refactor)

**Plan d’implémentation détaillé :** `docs/archive/2026-08-audits/PLAN-A-stabilisation.md`.

Objectif : navigation + live isolés par projet, filet vert, **avant** le refactor params (B).

Git 2026-08-30 : `main` propre (audit 29 août **déjà commité**). Le « 79 fichiers non commités » ci-dessous est périmé.

À livrer dans A (résumé) :

1. Filet de référence (vitest / pytest / Docker `compose up` — Desktop lancé).
2. **Isolation live** (bug actuel) : un nest sur A ne s’affiche pas sur B, A n’est pas reset, le wasm continue. Causes : `ensureJob` réécrit `projectSlug` ; la page B s’abonne au premier `awaiting_local` global. **Isoler, ne pas locker** la nav (lock = filet seulement si e2e encore rouge).
3. Pastille « calcul en cours » sur le projet A dans la liste.
4. Ne **pas** lancer B tant que A.4 (scénario A→B→A) n’est pas vert.

Hors A : auth Mongo, emails, G-code, `structure.py`/`structureClient.js`, kerf/CLC, défaut space 2 mm (c’est B.4).

---

# Chantier B — Refactor de dette qui protège CLC

Cinq fuites déjà identifiées. Chacune casserait CLC au premier paramètre ajouté. **Zéro ligne commune, zéro kerf dans l’UI.**

## B.1 — Un seul assemblage des params géométrie (`nest.post.js`)

`dbParams` est recopié 3 fois (demo / local / régulier, ~194–278). Un helper unique :

```js
geometryParamsFromClient(params, sheets)
// → { sheets | width,height,sheetCount, space, addOutShape, fillHoles, … }
```

Les branches ne font plus que : charge, compute, flags démo. Ajouter `kerf` plus tard = **une** ligne. Tests serveur : les 3 branches persistent les mêmes clés géométrie.

## B.2 — Sac `exportParams` (couper export ≠ moteur)

Aujourd’hui `localBridge.buildSheetDxf` / SVG / hole-fill lisent

`payload.engineConfig.min_item_separation`

comme si c’était l’espacement d’export. Dès que CLC voudra `kerf` sans changer le seed / l’inflation jagua, ce couplage ment.

Introduire, **sans changer les valeurs** :

```js
payload.exportParams = {
  space,           // mm, même chiffre que min_item_separation aujourd’hui
  addOutShape,
  outputUnit,
}
```

`engineConfig.min_item_separation` reste le contrat moteur. `buildSheetDxf`, overlays, `OUT_SHAPE` lisent **uniquement** `exportParams`.

Python : `nesting_process` passe déjà `space` à `build_part` — aligner le nommage (commentaire / kwargs) pour que le jumeau soit évident.

Tests : vitest localBridge (space lu depuis `exportParams`) ; un job kerf-absent = DXF/SVG identiques aux goldens.

## B.3 — Longueurs et unités : `LENGTH_PARAM_KEYS`

`files.js` `syncParamsToUnit` ne convertit que `space`. `kerf` / clearance en pouces seraient ×25,4 oubliés.

```js
const LENGTH_PARAM_KEYS = ['space'] // plus tard : 'kerf', 'sharedEndClearanceMm'
```

`toMm` au POST, validation `isValidNumber`, snapshots projet : boucle sur cette liste. Test : switch mm↔inch round-trip de `space` (déjà vrai) + un second champ factice si on veut figer l’API sans l’exposer.

## B.4 — Défaut d’espacement + vérité trous (produit, pas CLC)

- Factory `space`: **`'2'`** mm (plus `'0.1'`). 0,1 mm est irréaliste ; **5–8 mm en défaut casserait le nichage dans les trous** (`CHANNEL_MAX_WIDTH = 2.5` → `channels_usable` faux au-delà d’~2,4 mm, D-MOT-2).
- Hint UI si `space > 2.4` et fillHoles ON : *« Au-delà de 2,4 mm, le nichage dans les trous est désactivé (limite moteur). »*
- i18n FR/EN. Pas de case plasma/laser ici.

Les jobs déjà en base gardent leur `space` stocké. Seuls les **nouveaux** formulaires voient 2 mm.

`OUT_SHAPE` reste paddé de `space` (marge tôle). Ne pas « corriger » ça dans B sauf test de non-régression : on documente.

## B.5 — Frontière d’export extensible, un seul cœur futur

Pas de merge Python→Rust de tout `build_part` (Phase 6 trop large). Juste préparer le point d’extension :

- Rust : `DxfSheetSpec` / `build_part_dxf` restent à `space` + `add_out_shape` + bins + unit. Commentaire : tout nouveau paramètre d’export = champ `serde(default)` ici, **pas** dans `engineConfig`.
- Python : signature `build_part(..., space, add_out_shape, ...)` stable ; kwargs inconnus interdits (pas de `**kwargs` silencieux).
- `exports_check.py` : un cas DXF + un cas SVG **nommés** comme filet « B n’a pas changé l’export ». Si B.4 change le défaut UI seulement, ce filet ne bouge pas.

Interdit en B : `shared_cuts.rs`, calques `NC_*`, champ `kerf` persisté (sauf si on veut un default `'0'` mort dans `LENGTH_PARAM_KEYS` — **non**, ça fuit dans l’API ; attendre C).

## Fichiers chantier B

- `server/api/project/[slug]/nest.post.js` + tests
- `app/composables/localBridge.js` + `localPayloadBuilder.js` + tests
- `app/composables/files.js` + tests
- `app/components/MainSettings.vue` + `app/utils/i18n.js` (hint 2,4 mm)
- `workers/nesting/core/main.py` (commentaire / passage space, pas de kerf)
- éventuellement `local-payload.get.js` si `exportParams` doit transiter

## Critère de sortie B

- CLC OFF, pas de nouveau paramètre utilisateur autre que le défaut 2 mm et le hint.
- Goldens DXF/SVG/rapport inchangés (défaut UI ≠ jobs de test).
- vitest + pytest nesting + exports_check verts.
- Un nouveau paramètre longueur se rajoute en **une** liste + **un** helper + **un** champ `exportParams`.

---

# Cible produit CLC (chantier C, **après** A+B verts)

Ne pas coder maintenant. C’est le cahier des charges pour ne pas redébattre.

## C.1 — Espacement 5 mm **et** common-line : pas opposés

- **Entre A et B s’ils partagent un trait** : écart = **kerf** (collés).
- **Entre le cluster A|B et C** qui ne partage rien : écart = **`space`** (5 mm plasma pour le lead-in de C).
- On ne peut pas avoir 5 mm **et** une ligne commune **entre les mêmes deux pièces**. On peut avoir les deux **sur la même tôle**.

Ça change le placement. Invariant « moteur inchangé / densité inchangée » : **faux dès que CLC est ON**. CLC OFF : inchangé (A+B le garantissent).

### Comment (après B)

Le solveur continue d’utiliser `min_item_separation = space` (5 mm partout, faisable, lead-ins).

**Post-pass snap** (déterministe, collision-checked), pas un 2ᵉ solve :

1. Candidats : paires outer–outer, segments droits, overlap projeté ≥ 2 mm, gap actuel ≈ `space`, bande entre les deux = vide.
2. Trier par overlap décroissant (clé stable : id pièce, handle).
3. Translater l’une vers l’autre de `(gap − kerf)` selon la normale si : pas de collision, encore dans la tôle, fillers/trous non touchés.
4. Répéter (chaînes A|B|C).
5. C reste à 5 mm : jamais candidat.

Puis export cluster + calques sur **ce** layout snappé.

Miroir Python **et** local (`localBridge` / wasm). Cœur de détection/snap **une fois** en Rust (`nest-export` ou petit crate), vecteurs JSON, Python mince ou CLI. **Pas** de 3ᵉ copie JS de la géométrie.

## C.2 — Contrat CAM v1

Pas tout le DXF en coupe centrée (il faudrait un offsetteur polyline, absent du repo ; double kerf si SheetCam compense encore).

Cote finie + calques dont le **nom** est l’outil SheetCam :

| Calque | Outil |
|---|---|
| `NC_NO-OFFSET_SHARED` | no offset, **en premier** |
| `NC_NO-OFFSET_LEAD` | no offset (option, phase D) |
| `NC_INSIDE_HOLE` | inside |
| `NC_OUTSIDE_PART` | outside |
| `BIN_BOUNDARY` / `OUT_SHAPE` | ne pas couper |

Clusters = enveloppes **fermées** + médianes ouvertes. Pas de U ouverts (casse la compensation). Outer–outer only.

Lead-ins des fermés = SheetCam. Nestorcut : `sharedEndClearanceMm` sur les traits communs, éventuellement leads ouverts plus tard. Start des autres coupes au milieu d’une ligne commune = phase D (ordre de coupe, contours ouverts).

G-code hors produit (STRATEGY).

## C.3 — Découpage CLC une fois B livré

| Phase | Contenu |
|---|---|
| **C** | Snap packing + cluster fermé + calques `NC_*` + overlay SVG + rapport additif + clearance d’extrémité. Un ship. |
| **D** | `NC_NO-OFFSET_LEAD` ; start au milieu ; éventuellement intra-cluster dès le solveur (meta-pièces). Mode « tout centre-ligne » seulement avec offsetteur + bandeau rouge. |

Ne pas shipper « overlay SHARED sans cluster » : double coupe toujours là, feature morte.

UI C : case CLC, champ kerf (prérempli à space, convertible via `LENGTH_PARAM_KEYS`), clearance, hint *« Les pièces qui partagent un trait se collent au kerf ; les autres gardent l’espacement. »* `space < kerf` → refus.

Rebuild `workers/geometry/build-wasm.sh` dans la **même** PR C (piège #33b), `public/geometry/*`, pas le wasm moteur sauf si le snap y entre (il ne devrait pas : post-pass export/layout, pas jagua).

---

## Fichiers CLC (C, pas maintenant)

Cœur : `nest-export/src/shared_cuts.rs` + tests/goldens JSON ; `shared_cuts.py` mince ; `dxf_writer.rs` ; `main.py` ; `svg_colored.py` / `svg.rs` ; wasm `DxfSheetSpec` + op ; `geometry.worker.js` ; `geometryClient.js` ; CLI parité.

Client/API : `files.js` (clés longueur déjà prêtes) ; `MainSettings.vue` ; i18n ; `exportParams.kerf` ; `nest.post.js` helper déjà prêt ; `local-payload.get.js` ; `ResultModal` / CSV ; changelog ; fiche CAM + fixture 2+1 rectangles.

---

## Décisions à graver (quand on ouvrira C)

1. A+B d’abord ; CLC n’entre pas dans une PR de dette.
2. CLC OFF → sorties identiques au post-B.
3. CLC ON → snap : intra-pair = kerf, non-pairs = space. Densité **peut** monter.
4. Contrat DXF : cote finie + `NC_*`. Pas d’offset global v1.
5. Outer–outer only. Cœur unique + vecteurs JSON.
6. Défaut space 2 mm (fait en B) ; 5–8 mm = choix plasma utilisateur, compatible CLC grâce au snap.
7. Seed moteur inchangé (space + instance + budget). Kerf hors seed.

---

## Hors scope de A et B

- Unifier `structure.py` / `structureClient.js`
- Writer DXF unique pour tout le serveur
- Trous natifs jagua
- VERIFY_MAX_PARTS STRtree
- Auth Mongo, emails, marketing « kerf = space »
- Toute UI kerf / CLC / calques NC

---

## Questions ouvertes

1. **Défaut space en B : 2 mm** (recommandé, trous encore ouverts) ou on laisse 0,1 jusqu’à C ? Recommandation : **2 mm en B**, c’est de la dette produit, pas de la CLC.
2. Snap en C dans `nest-export` (layout in/out) vs worker nesting `structure.py` style : recommandation **nest-export / géométrie**, pour que local et serveur partagent le wasm/CLI, et que le moteur jagua ne bouge pas.
