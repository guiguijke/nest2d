# Proposition de plan d'attaque — lot 4 (T2 du masterplan) — 2026-09-06

Implémenteur : ZCode. Destinataire : vérificateur (Fable) pour
revalidation et rédaction de la fiche avec verrous. Commanditaire :
propriétaire (« livrer le meilleur outil de nesting » ; question
Rust/Python ci-dessous §4). Base : le découpage proposé par le
vérificateur en clôture de T1, ici structuré pour exécution.

Principe directeur (du vérificateur) : le lot 4 ne contient QUE des
chantiers **sans regret** — ceux que le jalon utilisateurs (ex-« porte
utilisateurs », user gate) ne peut pas invalider. Les chantiers produits
(calques/identifiants, bibliothèque de chutes, amorce, contraintes de
tôle, coupe commune) attendent le verdict de la grille
(`JALON-UTILISATEURS-T1-2026-09-06.md`). Le jalon se déroule EN
PARALLÈLE (livrable propriétaire : Stripe, campagne, cinq entretiens).

## 1. Phase A — dette planifiée (~1/3 du lot)

1. **P8 — post-pass Python** (`core/residual.py` + apparentés) : il pèse
   désormais la moitié du job serveur. STRtree pour les requêtes
   spatiales, mesure du coût par étape (la récente reconstruction
   d'index par fan en échec coûtait 1-3 s), compteur `okRelayed` corrigé.
2. **Garde par classe avant post-pass** (résidu L3-bis du vérificateur) :
   `enginePlacedById` lit une solution moteur mutée en place par le
   post-pass — prendre les comptes AVANT, sur une capture profonde (le
   `_pre_layouts` existant est le point d'ancrage naturel), miroir exact
   du `engine_placed_by_id` Python qui lit l'état pre.
3. **Expiration serveur des jobs `awaiting_local` orphelins** (~10 min
   sans prise en charge → `cancelled`, refund, carte « non pris en
   charge par cet appareil ») — un orphelin bloque l'utilisateur en 409
   jusqu'à annulation manuelle (AF5).

**Verrous proposés** : job serveur T-A sous 15 s avec grille
bit-identique ; test vitest de la garde sur une vraie perte injectée
dans le post-pass (plus de conteneurs construits à la main) ; e2e qui
ferme l'onglet pendant `awaiting_local` et vérifie le déblocage
(annulation + carte explicite + POST libéré).

## 2. Phase B — performance (P4, P5, P6)

1. **P4 — worker de finalisation navigateur** : la construction des
   artefacts (SVG/DXF/rapport) quitte le thread principal.
2. **P5 — plateau SPP calibré** : arrêt du mono-tôle sur stagnation
   réelle de la largeur, calibré au banc.
3. **P6 — zones de la grille en parallèle** : le remplissage par zones
   du pass structurel utilise plusieurs workers.

**Verrous proposés** (du vérificateur) : gel zéro mesuré par le harnais
long tasks ; mono-tôle 300 pièces de 95-145 s vers 20-40 s avec largeur
à ± 0,5 mm de la référence ; banc holes 150 et 200 inchangé ;
`determinism_lock.py` vert (natif ≡ wasm bit-identique) ; wasm rebuildé
ET commité.

## 3. Phase C — robustesse d'import : DIAGNOSTIC SEULEMENT

Priorité n° 1 déclarée du masterplan ; les entretiens diront quels
fichiers cassent. Livrables : corpus d'une trentaine de DXF réels et
variés (versionné), liste des échecs classés (parse, unités, entités,
géométrie ouverte…), spécification lisible du futur rapport de
réparation par fichier. **Aucun changement produit avant le jalon.**
Peut courir en parallèle de la phase B (travail de collecte et de
classification, pas de code moteur).

## 4. Question au vérificateur — plus de Rust, moins de Python ?

Posée par le propriétaire ; je la formule avec ce que je vois dans le
code, la décision lui revient avec le vérificateur.

**Le fait structurant** : les passes de post-pass existent en TROIS
implémentations — Python serveur (`core/residual.py`), miroir JS
navigateur (`composables/residualClient.js`), et le moteur Rust
(`engine/`, natif + wasm). Une grande partie des bugs des tours
L2-ter/L2-quater venait de ce dédoublement : ceinture JS aveugle au
motif du défaut (AE1), divergences de comportement entre miroirs,
correctifs à écrire deux fois, tests de parité à maintenir. Chaque
nouvelle passe (compaction, fusion, future coupe commune) doublera ce
coût si rien ne change.

**Options** :
- **(a) Statu quo ordonné** : P8 optimise le Python (phase A), P4
  déplace la finalisation navigateur sans changer de langage. Risque :
  la dette des miroirs continue de croître à chaque passe produit.
- **(b) Migration ciblée au lot 4** : fusionner P8+P4 en UNE réécriture
  Rust du post-pass (une seule implémentation, compilée natif pour le
  worker et wasm pour le navigateur — le moteur prouve déjà la parité
  natif/wasm bit-identique via `determinism_lock`). Coût : le lot 4
  grossit et regroupe le risque sur un post-pass récemment stabilisé
  (L2-quater v2) ; bénéfice : suppression définitive des miroirs, P8 et
  P4 ne font plus qu'un chantier au lieu de deux réécritures.
- **(c) Pallier** : P8 en Python au lot 4 (rapide), migration Rust
  planifiée au lot 5 en préparation de la coupe commune (qui exige de
  toute façon un cœur géométrique partagé strict).

**Deuxième candidat Rust** : l'export DXF (`main.py build_part` /
ezdxf) — le moteur a déjà `build_part_dxf` (natif) ; l'audit du
2026-08-29 avait différé `dxf_writer`. Même logique : une seule
implémentation d'export au lieu de Python + JS.

**Ce que « plus de Rust » ne changerait pas** : le worker Python reste
l'orchestrateur (Mongo, quota, SSE) — le déplacement concerne les cœurs
de calcul géométrique. Et la directive du 04/09 demeure : les post-pass
sont une dette calibrée à RETIRER à terme ; la question est quand et
dans quel ordre, pas si.

## 5. Conditions de méthode (les deux du vérificateur, + baseline)

1. Le kerf explicite étant en prod : **tout banc passe par le harnais à
   deux champs** (`scripts/qa-e2e-local-2sheets.mjs`), dans ses deux
   configurations documentées (2 × 1000×1000 et 1 × 1000×2000).
2. Tout chantier qui touche le moteur **régénère la page des benchmarks**
   sur les images publiées (`AGENTS.md` §6bis, `densities_corpus.py`).
3. Baseline T1 posée ce jour : vitest 480/480, corpus 11/11 bits publiés
   (T-A [587,313] bit-identique), grilles navigateur [587,313]@0,1 /
   [573,327]@2, partiels livrés 892/900 avec leviers.

## 6. Ce qui attend le jalon utilisateurs

Calques + identifiants à l'export, bibliothèque de chutes v1, réserve
d'amorce, contraintes de tôle, coupe commune. La grille du guide les
départage ; les lancer avant construirait sur l'hypothèse de l'auditeur
plutôt que sur les ateliers.

## 7. Séquencement proposé (à trancher par le vérificateur)

A (dette) puis B (perf) puis C en parallèle de B ; ou A, C, B si le
diagnostic d'import doit nourrir le jalon au plus tôt. Si l'option (b)
Rust est retenue, A et B fusionnent en un seul chantier P8/P4-Rust et
le lot se réordonne autour.
