# Masterplan NestorCut — 2026-09-05

> Document de pilotage : où nous en sommes, ce qui fait de NestorCut le
> **n°1 du nesting « DXF entrant, DXF sortant » pour les petits ateliers**,
> et dans quel ordre. Il consolide le plan perf/UX en cours
> (`PLAN-PERF-UX-2026-09-05.md`), la réponse produit de l'auditeur sur les
> features différenciantes (§3), la stratégie `STRATEGY.md` (G-code hors
> produit, tiers 0/19/39 €) et `PLAN-coupe-commune.md`. Statuts datés —
> à mettre à jour à chaque lot livré.

## 0. Position

**Pas un CAM. Le meilleur DXF-in/DXF-out.** L'atelier cible possède déjà
son CAM ou son logiciel machine (LightBurn, SheetCam, logiciel
constructeur) ; ProNest/SigmaNEST/Lantek/Almacam vendent le couple
nesting+CAM aux grandes structures — notre terrain est différent. Gagner
ici = une **entrée** tolérante à tout et une **sortie** qui est la
meilleure entrée possible pour ces outils, avec des **chiffres de qualité
publics et vérifiables**.

## 1. Où nous en sommes (2026-09-05)

**Moteur & produit [prod]**
- Alternatives Grille/Compaction multi-tôles homogènes (grille
  bit-déterministe [587,313] space 0,1), chutes par tôle, trou-filling
  pinwheel, corpus de torture T-A..T-K 11/11.
- Pré-contrôle de faisabilité en millisecondes avec 3 leviers chiffrés +
  solutions partielles guidées (refus 4 mm détecté en 2,2 s, jamais facturé).
- Mode Local 100 % privé (import wasm, solve navigateur, IndexedDB),
  purge serveur 24 h, vault ZK tous plans.
- Rapport matière mesuré (« computed, never declared »), densité unifiée
  matière/Σ tôles sur toutes les options (L1-bis).

**Performance & UX (plan PERF-UX, 6 lots)**
- **L1 + L1-bis DÉPLOYÉS prod 05/09** (627b1ac) : gel navigateur
  5,7 s → 0,26-0,47 s, densité homogène, annulation qui rend la main,
  badges verdict, couleur d'erreur, rate-limit sur échecs. CPU décorateur
  serveur 0,5 s/51 s.
- **Lot 2 en cours** : journée de mesure P3 FAITE (224 walks × 3
  espacements — `MESURE-P3-2026-09-05.md`) : **aucun job ne perd rien à
  l'arrêt par itérations, même à k=1** ; recommandation k=3/plancher 15/
  ≥3 s. Instrumentation commitée (c2aaeaa, non poussée).
- Lots 3-6 cadrés (UX 2.1.4→2.3, compte 3.x, P4-P11) — non entamés.

**Business (réalité à intégrer)**
- 43 inscrits, **0 payant**, rétention S1 7 % (2026-08-28 — à re-mesurer).
- Site marketing à jour (faisabilité, 2 styles, FAQ, 2 articles) — publié.
- **⚠ URGENT : webhook Stripe LIVE** — endpoint corrigé transmis le
  31/08, confirmation jamais reçue, auto-coupure annoncée ~4-6 sept.
  **À vérifier AVANT toute autre action** (une session Stripe admin
  suffit ; sans webhook actif, aucun paiement récurrent ne survit).
- Campagne feedback FR rédigée non envoyée ; recommandation infra split
  (workers au homelab) en attente de décision.

## 2. Cette semaine (filet + décisions)

| # | Action | Type |
|---|---|---|
| 1 | **Vérifier le webhook Stripe live** (URL = `app.nestorcut.com`, secret mono-endpoint, un événement test livré) | Ops critique |
| 2 | **Décision k** : arrêt BPP par itérations — reco **k=3, plancher 15, ≥3 s** (mesure : 0 job perdu, même à k=1) | Décision owner |
| 3 | **Décision SAMPLE_CFG** (600/200/3 : +0,01 remnant pour +47 % de temps) — peut suivre P3 | Décision owner |
| 4 | Envoyer la campagne feedback FR (intérêt légitime, 0 promo, désinscription) | Growth |

## 3. Les features « n°1 » (analyse auditeur, ordre de valeur)

Position de l'auditeur (partagée) : **CAM non, CAM-ready oui.**

### 3.1 Sortie CAM-ready (le socle export)

À vérifier puis corriger — l'export Rust/ezdxf produit probablement des
**polylignes** (arcs/cercles discrétisés = dégradation laser) :

1. **Arcs et cercles conservés** à l'export (entités ARC/CIRCLE natives).
2. Contours fermés garantis, **un calque par nature** (extérieur, trou,
   marquage, chute, texte), identifiants de pièce, **un fichier par
   tôle**, unités explicites dans le header.
3. **Rapport de fabrication imprimable** (tôles, liste de pièces, matière,
   chutes) — le rapport matière existe, il manque la mise en page
   imprimable (candidat Pro).

Effort : export ~1-2 semaines (miroir Rust export + dxf_writer ezdxf,
déjà identifiés en dette), rapport imprimable ~0,5-1 semaine.

### 3.2 Robustesse d'import DXF — la priorité n°1

« C'est la première cause d'abandon d'un outil de nesting, avant la
qualité de l'algorithme. » Splines (déjà différées par l'audit 29/08),
contours ouverts à réparer, blocs/INSERT (R·S), textes, trous imbriqués,
unités douteuses (le piège ×1000 existe déjà côté UI) — avec un
**rapport de réparation lisible** par fichier (« 2 contours ouverts
refermés, 1 bloc aplati, unités mm détectées »).

Effort : ~2-3 semaines (dette connue et documentée). Débloque la
confiance de bout en bout.

### 3.3 Bibliothèque de chutes — l'argent direct

Sauvegarder la chute d'un job comme **nouvelle tôle avec son contour
réel**, et nester dedans. Pour un petit atelier c'est de la matière
économisée à chaque job ; peu de SaaS le font bien. Le moteur traite des
polygones quelconques → aucun changement d'algorithme, de la plomberie
(schéma « tôles utilisateur », sélecteur, pré-contrôle capacité sur
contour réel — le pré-contrôle actuel est déjà là).

Effort : ~1-2 semaines. Différenciateur marketing fort (« your offcuts
are sheets »).

### 3.4 Contraintes de tôle

Marge par bord (brides de serrage), **zones interdites** (rectangles
exclus), **sens du grain** (rotations 0/180 seulement — bois, inox
brossé), miroir autorisé ou non (matière à face). Le moteur gère déjà
les rotations par item et les rotations restreintes par classe —
extension naturelle des params + pré-contrôle.

Effort : ~1-2 semaines.

### 3.5 Réserve d'amorce + point de départ — le pont CAM

Le CAM ajoute une amorce de 3-6 mm hors contour ; si la voisine est à
2 mm, l'amorce perce dedans. Implémentation **locale** (pas d'anneau
complet qui tuerait la densité) :

- paramètre « réserve d'amorce » (longueur + règle de position par
  défaut : début de la plus longue arête droite, ou un coin) ;
- la pièce nestée = contour réel **+ petit appendice d'exclusion** au
  point de départ (polygone quelconque → l'algorithme ne change pas) ;
- l'export garde le contour réel et **marque le point de départ sur un
  calque dédié** (déterministe — bonus : le CAM peut le reprendre) ;
- pour les trous nichés : la capacité pinwheel réserve la zone.

Effort (auditeur) : géométrie simple, plomberie moyenne (miroirs
Python/Rust/JS + pré-contrôle capacité) — **1-2 semaines**.

### 3.6 Pièces de remplissage

Quantité minimale + **« autant que possible »** pour des pièces d'appoint
qui comblent les vides (les hélices/lattice actuels en sont l'esprit
automatique ; ici la version utilisateur). Extension du modèle de
quantités + logique de priorité dans le solve. ~1 semaine.

### 3.7 Coupe commune en grappes

Cadrée dans `PLAN-coupe-commune.md` : clusters de pièces identiques à
arêtes communes, nester la grappe comme super-pièce, exporter la
géométrie **fusionnée** sur calque distinct. Conditions : coller à la
distance exacte du kerf, fusionner les arêtes partagées à l'export (sinon
le CAM coupe deux fois), CAM acceptant les lignes partagées.
**Après 3.2 et 3.3**, pas avant. Prérequis transverse : le chantier B du
plan (sac `exportParams`, espacement vs kerf explicites) est déjà rédigé.

### 3.8 API & traitement par lot

Devenir **le moteur appelé par d'autres outils** plutôt que de se battre
contre les CAM : clé API, endpoints nest + résultats, webhooks, tarification
à l'usage. Ouvre un canal B2B (intégrateurs, ERP d'atelier). ~2-3 semaines
+ opérations (quota, abuse). Après la stabilisation perf (lots 2-4) —
une API lente ou gelée serait un échec public.

### 3.9 Preuve publique de qualité

Publier les **densités sur des instances de référence connues** (ESICUP,
corpus propres versionnés) avec méthode reproductible. Le corpus T-A..T-K
et les bancs existent déjà en interne — il s'agit de publier une page
« benchmarks » honnête (mêmes chiffres que le corpus, machine et
conditions datées). ~3-4 jours. Effet confiance majeur, coût dérisoire.

### 3.10 Transverse : espacement ≠ kerf

Aujourd'hui « espacement » porte seul la sécurité. Rendre **kerf et
sécurité explicites** dans les réglages, avec la règle affichée
« espacement = kerf + 2 × tolérance » (clarifie l'usage, prépare l'amorce
et la coupe commune). C'est le chantier B.4 déjà rédigé du plan
coupe-commune. ~2-3 jours.

## 4. Séquenciation proposée

Principe : **finir la perf d'abord** (lots 2-4 : un produit lent contredit
toute la promesse), en parallèle les **vérifications business critiques**
(Stripe, feedback), puis la vague « n°1 » par valeur.

| Horizon | Contenu | Livrable mesurable |
|---|---|---|
| **T0 (semaine en cours)** | Webhook Stripe vérifié ; décision k + SAMPLE_CFG ; campagne feedback ; envoi lot 2 (P3 arrêt par itérations + P7 threads) | Job standard 58 → 15-25 s ; paiements vivants |
| **T1 (+1 sem.)** | Lot 3 (UX 2.1.4-2.1.9 + compte 3.1.3-3.1.6) ; **3.10 kerf explicite** ; **3.9 benchmarks publics** | Parcours nesting sans bloquant ; page /benchmarks |
| **T2 (+2-3 sem.)** | Lot 4 (P4 worker finalisation, P5 plateau SPP, P6 zones //) ; **3.1 export CAM-ready** (arcs natifs, calques, rapport imprimable) | Mono-tôle 95-145 → 20-40 s ; export à zéro polyligne |
| **T3 (+4-6 sem.)** | Lot 5 (accessibilité, plan & quota, coffre) ; **3.2 robustesse import** ; **3.3 bibliothèque de chutes** | Rapport de réparation par fichier ; « your offcuts are sheets » |
| **T4 (+7-9 sem.)** | Lot 6 (profil cible, transverse, P8-P11) ; **3.4 contraintes tôle** ; **3.5 réserve d'amorce** | Grain/zones interdites ; lead-in marqué à l'export |
| **T5 (+10-12 sem.)** | **3.6 remplissage** ; **3.7 coupe commune** (selon son plan) ; décision **API/batch 3.8** (nouveau chantier + pricing) | Clusters à arêtes communes ; GO/NO-GO API |
| Continu | Infra : décision split workers homelab (avant T4 — la perf P3 réduit la pression) ; re-mesure business mensuelle (inscrits → payants, rétention) | — |

Dépendances clés : 3.7 après 3.2+3.3 (position de l'auditeur) ; 3.8 après
les lots 2-4 ; 3.5 après 3.1 (le point de départ n'a de sens qu'avec un
export propre) ; la coupe commune et l'amorce héritent du chantier B
(kerf explicite).

## 5. Registre des décisions owner (ouvertes)

| Décision | Reco | Statut |
|---|---|---|
| Constante d'arrêt BPP par itérations | k=3, plancher 15, ≥3 s | **En attente** (mesure faite) |
| SAMPLE_CFG (qualité vs temps) | Décider après P3 livré | En attente |
| Webhook Stripe live | Vérifier l'URL immédiatement | **Critique** |
| Infra split (workers homelab) | Reco du 30/08 ; la pression baisse après P3 | Ouverte |
| API/batch (3.8) | GO après lots 2-4, pricing à l'usage | Non tranchée |
| Turbo hybride Pro | Reporté (Phase 3 STRATEGY) | Dormante |

## 6. Non-goals (inchangés)

- **Pas de G-code** jusqu'à preuve de marché (surveiller Nestpact).
- **Pas de CAM** : pas de post-processeurs, pas de responsabilité machine.
  Nous rendons la sortie parfaite pour LES outils du client.
- Pas de dégradation moteur en Free (le luxe Pro est le temps, pas la
  qualité — règle gravée §5 STRATEGY).
- DXF simplifié/anonymisé : écarté (casserait le produit).

## 7. Métriques de succès

- **Technique** : job standard ≤ 25 s (post-P3) ; gel < 0,5 s (atteint) ;
  corpus 11/11 en continu ; physique 0 chevauchement.
- **Produit** : taux d'import sans réparation manuelle ≥ 95 % (post-3.2) ;
  jobs utilisant une chute sauvegardée (post-3.3) ; parts des exports
  contenant des arcs natifs = 100 % (post-3.1).
- **Business** : premier payant (le webhook vivant est le prérequis) ;
  rétention S1 > 25 % à 3 mois ; conversions Free→Unlimited après
  activation du 10e nesting réussi.
- **Confiance** : page benchmarks publiée, chiffres reproductibles,
  thread communauté actif.
