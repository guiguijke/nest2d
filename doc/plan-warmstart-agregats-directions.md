# Plan : warm-start agrégats + alternatives directionnelles (BPP)

Statut : validé faisable, prêt à implémenter. Purement moteur (`workers/nesting`),
aucun changement frontend/backend sauf exposition optionnelle de la config.

Deux chantiers indépendants mais qui partagent la même plomberie per-worker :

- **A. Warm-start trou-conscient** : séquence initiale intercalée
  `[hôte, filler×k, hôte, filler×k, ...]` calculée côté Python (seul endroit
  où la géométrie des trous existe encore).
- **B. Alternatives directionnelles** : biais directionnel par worker dans
  l'évaluateur du constructif, pour que les 3 alternatives exportées soient
  réellement différentes (solution 1 = gauche, solution 2 = bas,
  solution 3 = mixte).

---

## Diagnostic (vérifié dans le code)

### Commun
- `run_bpp` (`bpp/mod.rs:97-173`) lance N workers rayon, tous **identiques** :
  même séquence initiale (diamètre décroissant, `sa.rs:126-142`), même
  évaluateur (`HoleFillEvaluator`), seul le seed RNG diffère. Ils convergent
  donc vers des solutions quasi identiques → les 3 alternatives se
  ressemblent, et le calcul « normal » vs « avancé » (qui ne diffère que par
  `timeBudgetSec`, `core/main.py:344`) donne le même résultat.
- Le seed est dérivé de `{instance, space, budget}` uniquement
  (`core/main.py:583-587`) : modifier `config.json` ne change **pas** le seed
  → les A/B à seed égal sont gratuits.
- Les ids d'items Python sont positionnels par construction
  (`convert_files_to_input_items` : `id = 0, 1, 2...`) → une séquence
  d'ids Python est directement consommable comme indices positionnels par
  `anneal`.

### A. Warm-start
- `anneal()` n'a aucun warm-start : `sa.rs:163` appelle
  `initial_sequence(instance)` en dur. C'est le **seul** point à modifier.
- Le warm-start par placements est hors de portée (`import_solution` BPP =
  `unimplemented!()` dans jagua 0.7.2, dép externe non forkée) → le niveau
  **séquence** est le bon niveau.
- La géométrie des trous n'existe que côté Python (`item['holes']` dans
  `core/main.py`, avant `open_holes_with_channels` ligne 437). Les items
  envoyés au moteur sont des `simple_polygon` ouverts par canal — le moteur
  ne peut pas retrouver les trous tout seul.
- Le constructif remplit déjà les trous indépendamment de l'ordre
  (`HoleFillEvaluator`, loss = `growth*10 + bottom_left` : un placement dans
  un trou a growth=0 et bat toujours un bord — prouvé par
  `scale_tests::diag_construct_160` qui passe avec l'ordre hôtes-d'abord).
  Le gain attendu du warm-start est donc principalement un **meilleur
  incumbent de départ pour le SA** + l'assignation gloutonne Python dans les
  cas réels complexes (trous variés, fillers hétérogènes en compétition).
  D'où l'étape de mesure obligatoire avant de garder.

### B. Alternatives directionnelles
- Le tie-break directionnel est dans `HoleFillEvaluator`
  (`bpp/constructive.rs:111-113`) :
  `bottom_left = BL_X*(poi.x + corner.x) + (poi.y + corner.y)` avec
  `BL_X = 10.0` → le poids x est 10× celui de y → tout pousse vers la
  **gauche** d'abord. Un seul endroit à paramétrer.
- L'export des alternatives (`bpp/mod.rs:195-220`) trie tous les runs par
  coût lexicographique puis déduplique par fingerprint. Pour garantir
  sol1=gauche / sol2=bas / sol3=mixte, il faut grouper par **classe de biais**
  et non seulement par coût.

---

## A. Warm-start trou-conscient

### A1. Python — `workers/nesting/core/nesting_input_builder.py` (+ `main.py`)
Nouvelle fonction `build_initial_sequence(input_items, space) -> list[int] | None` :

- Identifier hôtes (items avec `holes` non vides) et fillers (items sans
  trous, plus petits).
- Pour chaque (hôte, trou, filler), validation shapely sur la géométrie
  **originale** (avant ouverture par canal) :
  - éroder le trou de `space/2` (jagua gonfle chaque item de `space/2` —
    un filler validé « au contact » ne rentrera pas) ;
  - tester les `allowed_orientations` du filler (bbox rotationnée + rapport
    d'aire + containment au centroïde du trou) ;
  - capacité du trou ≈ `min(aire_trou / aire_filler, 4)` (borne basse :
    non contraignant, une surestimation est rattrapée par le constructif).
- Assignation gloutonne : plus gros trou × plus gros filler compatible
  d'abord, en respectant les demandes (`count`).
- Construire la séquence **intercalée, expansée par demande** :
  `[hôte, filler×k, hôte, filler×k, ...]`, fillers non assignés en fin de
  séquence (ordre diamètre décroissant pour ceux-là).
- Retourner `None` si aucun hôte/trou/filler compatible → comportement
  inchangé.
- Dans `main.py` : appeler avant `build_engine_config`, passer la séquence
  à `build_engine_config(..., initial_sequence=...)`, qui ajoute la clé
  `initial_sequence: [int, ...]` au config.json seulement si non `None`.

### A2. Rust — plomberie (~15 lignes)
- `config.rs` : `pub initial_sequence: Option<Vec<usize>>` avec
  `#[serde(default)]`. Contrat documenté : **indices positionnels dans le
  tableau `items` de l'instance, expansés par demande**.
- `bpp/sa.rs` : `anneal(..., initial_seq: Option<Vec<usize>>, ...)`.
  Au démarrage :
  ```rust
  let mut seq = initial_seq
      .filter(|s| s.len() == instance.total_item_qty())
      .unwrap_or_else(|| initial_sequence(instance));
  ```
  (fallback silencieux si la longueur ne matche pas — robustesse).
- `bpp/mod.rs` : lire `config.initial_sequence.clone()`, le passer à
  `anneal`. **Tous** les workers le reçoivent : la diversité du multi-start
  est assurée par le chantier B (biais directionnels), pas par des séquences
  de départ différentes.
- Aucune autre logique modifiée : le SA peut toujours permuter la séquence
  (non contraignant), la garantie d'incumbent est préservée.

### A3. Mesure A/B sur le cas 160 (obligatoire avant de garder)
Étendre `scale_tests` (`bpp/constructive.rs`) avec un harnais qui, à seed
égal, lance `anneal` avec et sans séquence intercalée (budget court fixe,
ex. 10 s) et compare :
- secteurs nichés dans les trous (compteur centroïde déjà écrit dans
  `diag_construct_160`) ;
- nombre de tôles, densité, coût `cmp_key` final ;
- temps/iterations.

Critère de conservation : **≥ +10 % de trous remplis**, ou à remplissage
égal une amélioration du coût lexicographique (tôles ou remnant). Sinon on
revert la partie Python et on garde seulement la plomberie (gratuite), ou
on bascule sur l'option C (boost de `SAMPLE_CFG.n_focussed_samples`, bouton
déjà existant à `constructive.rs:24-28`).

---

## B. Alternatives directionnelles

### B1. Rust — biais par worker
- `bpp/constructive.rs` : `pub enum DirBias { LeftFirst, BottomFirst, Balanced }`.
  `HoleFillEvaluator` prend un `DirBias` et calcule le tie-break selon :
  - `LeftFirst` (comportement actuel) : `10*(x) + 1*(y)` → pousse à gauche ;
  - `BottomFirst` : `1*(x) + 10*(y)` → pousse vers le bas ;
  - `Balanced` : `1*(x) + 1*(y)` → coin bas-gauche franc (mixte).
  Le poids `growth*10` reste dominant dans les trois cas (le remplissage des
  trous n'est jamais sacrifié au biais).
- `construct()` et `anneal()` propagent le biais.
- `bpp/mod.rs` : assignation déterministe `bias = DirBias::from(w % 3)` →
  couverture garantie des 3 classes dès `n_workers >= 3` (déjà le cas :
  `n_workers() >= n_alternatives`, `config.rs:80-87`).

### B2. Rust — export groupé par classe de biais
- `WorkerRun` gagne un champ `bias`.
- Au ranking (`bpp/mod.rs:176-220`) : grouper les runs faisables par classe
  de biais, prendre le meilleur de chaque classe, ordonner les classes par
  leur meilleur coût (cmp_key, tie-break seed) → export dans cet ordre :
  - rank 0 = meilleure solution de la meilleure classe (en pratique
    `LeftFirst`, l'optimum actuel) ;
  - rank 1 = meilleure `BottomFirst` ;
  - rank 2 = meilleure `Balanced`.
- Si une classe n'a aucun run faisable, compléter avec les meilleurs runs
  restants toutes classes (comportement dégradé = comportement actuel).
- Déduplication par fingerprint conservée à l'intérieur de chaque classe.
- Champ `"bias": "left"|"bottom"|"balanced"` ajouté à chaque alternative
  dans `alternatives.json` (utile au debug et potentiellement au frontend
  pour étiqueter les options).

### B3. Effet sur les tiers
Les tiers « normal » / « avancé » continuent de ne différer que par
`timeBudgetSec`, mais les 3 alternatives sont maintenant structurellement
distinctes même à petit budget — le problème « les 3 options sont
identiques » disparaît pour les deux tiers.

---

## Tests

- **Rust unitaire** : sur `tiny_instance`, vérifier que les 3 biais
  produisent des placements au tie-break attendu (pièce poussée à gauche /
  en bas / coin).
- **Rust intégration (cas 160)** :
  - A/B warm-start (A3) avec assertions de non-régression (0 unplaced,
    ≤ 2 tôles) ;
  - run multi-worker simulé : 3 alternatives exportées avec fingerprints
    distincts et classes de biais attendues.
- **Python** (`tests/test_input_builder.py`) : assignation gloutonne
  (capacités, demandes, fillers restants en fin de séquence), érosion
  `space/2` prise en compte, `None` quand pas de trous, clé absente du
  config.json dans ce cas.
- **Non-régression** : `pytest workers/nesting` + benchmarks ESICUP
  (`pytest benchmarks/test_benchmarks.py -m slow`, gates de densité
  inchangés).

## Risques

- **A** : gain marginal possible (le constructif remplit déjà les trous
  sans warm-start) → tranché par la mesure A3, coût d'exploration ~1 jour.
- **B** : une classe de biais peut converger vers un coût légèrement moins
  bon (ex. `BottomFirst` moins compact). Acceptable : le coût lexicographique
  reste le critère intra-classe, et rank 0 reste la meilleure solution
  globale. Si un écart de densité > 1-2 points apparaît sur les benchmarks,
  réduire le rapport de poids (10:1 → 4:1).
- **A+B** : surface de changement limitée à `bpp/` + `config.rs` +
  `nesting_input_builder.py`/`main.py`; le chemin SPP est totalement
  inchangé (le remplissage de trous SPP repose sur la compaction bi-axiale
  two-phase, hors scope).

## Ordre d'implémentation proposé

1. **B d'abord** (indépendant, gain utilisateur immédiat et visible : les 3
   alternatives diffèrent enfin) : B1 + B2 + tests Rust → commit.
2. **A2** (plomberie Rust, 15 lignes) → commit.
3. **A1** (détection Python) + A3 (mesure) → décision garder/revert → commit.
4. Non-régression complète + push + CI.
