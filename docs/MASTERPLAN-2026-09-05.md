# Masterplan NestorCut — 2026-09-05

> Document de pilotage : où nous en sommes, ce qui fait de NestorCut
> **la référence du nesting dans le navigateur** (DXF entrant, DXF
> sortant, rien ne quitte la machine), et dans quel ordre. **Recentré le
> 06/09** : §0 donne la boussole et la règle de tri de tout chantier. Il consolide le plan perf/UX en cours
> (`PLAN-PERF-UX-2026-09-05.md`), la réponse produit de l'auditeur sur les
> features différenciantes (§3), la stratégie `STRATEGY.md` (G-code hors
> produit, tiers 0/19/39 €) et `PLAN-coupe-commune.md`. Statuts datés —
> à mettre à jour à chaque lot livré.

## 0. Position (recentrée le 06/09)

**La référence du nesting dans le navigateur.** Un onglet, un DXF déposé,
un résultat vérifiable en quelques secondes, et le fichier ne quitte
jamais la machine. Aucun ProNest/SigmaNEST/Lantek ne le fera ; les outils
web concurrents le font à moitié (upload serveur, file d'attente, aucune
preuve publique). « Pas un CAM, le meilleur DXF-in/DXF-out » reste le
périmètre ; le navigateur est le terrain où l'on gagne. L'atelier cible
possède déjà son CAM ou son logiciel machine (LightBurn, SheetCam,
constructeur) : notre sortie doit être la meilleure entrée possible pour
ces outils.

**Règle de tri de tout chantier** (à appliquer avant d'ouvrir un lot) :

1. **Le chemin navigateur est le chemin principal, pas un mode.** Free y
   est déjà forcé, un nouveau projet est « 100 % privé » par défaut. Le
   serveur sert le débordement (DWG, gros jobs Pro, multi-appareils), il
   n'est pas la référence.
2. **Toute fonction se livre d'abord sur le chemin navigateur** (import
   wasm, solve wasm, post-pass, export Rust/wasm) ; le serveur suit ou
   partage le code. Une fonction disponible seulement côté serveur n'est
   pas considérée livrée.
3. **Un seul code partout où c'est possible.** Le moteur l'est déjà (natif
   ≡ wasm, verrou SHA-256). Le post-pass est dupliqué (Python ~4 000 lignes,
   JS ~4 000 lignes) : c'est l'obstacle n° 1 à la parité navigateur/serveur.
   Il se résorbe en **déplaçant vers le moteur** (ou en retirant), jamais en
   ajoutant une troisième copie.
4. **Preuve publique navigateur** : /benchmarks doit montrer les chiffres
   obtenus dans le navigateur (densité identique par construction, temps
   mesurés sur une machine datée).
5. Ce que le navigateur ne fait pas encore (DWG, threads wasm, gros jobs
   Pro) est un **choix documenté** avec sa raison, pas un oubli.

**État du chemin navigateur au 06/09** (ce qui est acquis / ce qui manque) :

| Étape | Acquis [prod] | Manque |
|---|---|---|
| Import | wasm DXF/SVG 100 % client, claim « never leaves your machine » vérifié | DWG = serveur seulement ; robustesse jamais mesurée sur l'importeur wasm (phase C du lot 4) |
| Solve | même recherche pour tous (8 walks, `QUALITY_WALKS`), pool de Web Workers de concurrence 1/4/8 par tier, déterministe (jamais `hardwareConcurrency`), ~36 Mo/worker, partiels livrés avec leviers | mono-tôle 300 pièces 95-145 s (P5) ; zones de grille séquentielles (P6) ; threads wasm écartés (COOP/COEP) |
| Post-pass | miroir JS de residual/structure/holefill, ceinture exacte, garde par classe | code dupliqué Python/JS ; garde calculée après mutation (AG1 → lot 4 A) |
| Finalisation | gel 5,7 s → 0,26-0,47 s (L1) | encore sur le thread principal (P4) |
| Export | écrivain Rust natif + wasm, arcs/cercles/splines natifs | calques par nature + identifiants (3.1) ; chemin ezdxf encore en double |
| Temps job T-A | **6-9 s navigateur** contre 19-29 s serveur (file + post-pass Python) | — le navigateur bat déjà le serveur sur le cas standard |
| Preuve | /benchmarks publié (chiffres images publiées) | pas de colonne navigateur |

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
  espacements — `MESURE-P3-2026-09-05.md`) : **aucun job ne perd ni tôle
  ni pièce à l'arrêt par itérations, même à k=1**. Réserve du vérificateur :
  la chute de la dernière tôle n'était pas dans les évènements mesurés —
  la validation finale se fait sur le banc de compaction à space 2 lors de
  l'implémentation. Reco vérificateur : **k=3, plancher 30 itérations, sans
  plancher de temps** (un plancher en secondes casserait le déterminisme
  natif/wasm que P3 apporte). Instrumentation commitée (c2aaeaa).
- Post-pass Python après le moteur : 5,8-9,4 s CPU mesurés (P8 promu au
  lot 2 ou 4 — deviendra un tiers du job après P3).
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
| 1bis | **Mettre à jour les 3 workers overflow du homelab** (image du 31/08 : sans `residual.py` ni `capacity.py`, moteur pré-P3 — ils traitent des jobs de prod chaque jour) : `docker compose pull && up -d --force-recreate` dans `/containers/nestorcut-overflow`, puis `assert_overflow_head.py` ; règle gravée : chaque déploiement worker se termine sur le homelab (`AGENTS.md` §6bis) | Ops critique |
| 2 | **Décision k** : arrêt BPP par itérations — reco vérificateur **k=3, plancher 30 itérations, pas de plancher de temps** (mesure : 0 job perdu en tôles/pièces, même à k=1 ; chute à valider au banc space 2) | Décision owner |
| 3 | **Décision SAMPLE_CFG** — reco vérificateur : **inchangé** (600/200/3 : +0,01 remnant pour +47 % de temps ; 150/50/3 : −0,006 pour −23 %) ; à rouvrir seulement si les cibles de temps sont manquées après P3 | Décision owner |
| 4 | Envoyer la campagne feedback FR (intérêt légitime, 0 promo, désinscription) | Growth |

## 3. Les features « n°1 » (analyse auditeur, ordre de valeur)

Position de l'auditeur (partagée) : **CAM non, CAM-ready oui.**

### 3.1 Sortie CAM-ready (le socle export)

**Vérifié le 05/09 (vérificateur)** : les arcs, cercles et splines sont
**déjà conservés** aux deux exports — côté serveur `build_part` copie les
entités d'origine par handle et les transforme (ezdxf), côté Rust
`nest-export/dxf_writer.rs` écrit des entités ARC/CIRCLE/SPLINE natives.
Il n'y a pas de discrétisation à corriger. Reste à faire :

1. **Un calque par nature** (extérieur, trou, marquage, chute, texte) —
   aujourd'hui : calques d'origine + `BIN_BOUNDARY` + `OUT_SHAPE` ;
   identifiants de pièce (texte ou attribut) ; unités explicites dans le
   header ; contour de la chute réutilisable sur son calque.
2. **Rapport de fabrication imprimable** (tôles, liste de pièces, matière,
   chutes) — le rapport matière existe, il manque la mise en page
   imprimable (candidat Pro).
3. Test d'export « golden » par entité (arc, cercle, spline, polyligne à
   bulges) sur les deux chemins, pour que 1 ne casse pas l'acquis.

Effort : calques + identifiants ~1 semaine, rapport imprimable ~0,5-1
semaine. **Recentrage 06/09** : les calques se font dans l'écrivain Rust
(natif + wasm, c'est celui du navigateur) et le chemin ezdxf est retiré
au même chantier — un seul écrivain, testé golden par entité sur les deux
cibles.

### 3.2 Robustesse d'import DXF — la priorité n°1

« C'est la première cause d'abandon d'un outil de nesting, avant la
qualité de l'algorithme. » Splines (déjà différées par l'audit 29/08),
contours ouverts à réparer, blocs/INSERT (R·S), textes, trous imbriqués,
unités douteuses (le piège ×1000 existe déjà côté UI) — avec un
**rapport de réparation lisible** par fichier (« 2 contours ouverts
refermés, 1 bloc aplati, unités mm détectées »).

Effort : ~2-3 semaines (dette connue et documentée). Débloque la
confiance de bout en bout. **Recentrage 06/09** : la robustesse se mesure
et se corrige **d'abord sur l'importeur wasm** (c'est le seul que voit
Free et le défaut « 100 % privé ») ; ezdxf suit. Le rapport de réparation
est produit côté client.

### 3.3 Bibliothèque de chutes — l'argent direct

Sauvegarder la chute d'un job comme **nouvelle tôle** et nester dedans.
Pour un petit atelier c'est de la matière économisée à chaque job ; peu de
SaaS le font bien. En deux temps :

- **v1 : chute rectangulaire** — le produit calcule déjà la « chute
  réutilisable W × H » de chaque tôle ; un bouton « enregistrer comme
  tôle » + une bibliothèque de formats utilisateur suffisent. Aucun
  changement moteur ni post-pass. ~1 semaine.
- **v2 : contour réel (polygone)** — le moteur (jagua-rs) accepte des
  conteneurs polygonaux, mais **tout le reste suppose une tôle
  rectangulaire** : pré-contrôle de capacité `(W−s)(H−s)`, grille
  structurelle, compaction de la dernière tôle, métriques de chute,
  vue live, wasm. C'est un chantier de 3-4 semaines, à ne lancer qu'après
  retour utilisateurs sur la v1.

Différenciateur marketing fort (« your offcuts are sheets »).

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
qui comblent les vides. Le moteur (BPP/SPP) ne connaît pas les pièces
optionnelles : les traiter dans le solve serait un changement d'objectif
(sac à dos), 2-3 semaines. Voie courte : nester les pièces obligatoires,
puis **remplir les bandes résiduelles avec les pièces d'appoint via la
passe résiduelle existante** (`fill_residual_bands` place déjà des
lattices) — ~1 semaine, résultat borné par la qualité de cette passe.

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
une API lente ou gelée serait un échec public. C'est le seul chantier
purement serveur du plan : il vient **après** la référence navigateur
établie (parité post-pass, benchmarks navigateur), pas avant.

### 3.9 Preuve publique de qualité

Publier les **densités sur des instances de référence connues** (ESICUP,
corpus propres versionnés) avec méthode reproductible. Le corpus T-A..T-K
et les bancs existent déjà en interne — il s'agit de publier une page
« benchmarks » honnête (mêmes chiffres que le corpus, machine et
conditions datées). ~3-4 jours. Effet confiance majeur, coût dérisoire.
**Livré au lot 3** (chiffres serveur). Reste, recentrage 06/09 : la
**colonne navigateur** (même densité par déterminisme, temps mesurés par
le harnais navigateur sur une machine datée, aux tiers Free et standard)
— 0,5 j, au lot 4 phase B.

### 3.10 Transverse : espacement ≠ kerf

Aujourd'hui « espacement » porte seul la sécurité. Rendre **kerf et
sécurité explicites** dans les réglages, avec la règle affichée
« espacement = kerf + 2 × tolérance » (clarifie l'usage, prépare l'amorce
et la coupe commune). C'est le chantier B.4 déjà rédigé du plan
coupe-commune. ~2-3 jours.

## 4. Séquenciation proposée

Principe : **finir la perf d'abord, mesurée dans le navigateur** (lots
2-4 : un produit lent contredit toute la promesse), en parallèle les
**vérifications business critiques** (Stripe, feedback), puis la vague
« référence navigateur » par valeur : parité post-pass (un seul code),
import wasm robuste, export Rust unique, benchmarks navigateur.

| Horizon | Contenu | Livrable mesurable |
|---|---|---|
| **T0 (semaine en cours)** | ~~décision k + SAMPLE_CFG~~ **FAIT 05/09** (k=3/plancher 30/sans plancher temps ; SAMPLE_CFG inchangé) ; ~~lot 2 (P3 + P7)~~ LIVRÉ, corrigé L2-bis et **DÉPLOYÉ prod 06/09 ~04h30 UTC** (743aa1d — GO du vérificateur ; images publiées assert OK, corpus 11/11 sur bits publiés, md5 moteur prod=publié ; job standard 19-29 s, navigateur 6-9 s, gel < 0,3 s). **L2-ter LIVRÉ 06/09 (non déployé)** : cause = pass résiduel (l'expansion pinwheel est ÉCARTÉE par l'attribution à étages AC1 ; snapshots moteur/expansion propres) — correctif = ceinture exacte différentielle intra-tôle dans fill_residual_bands (Python+JS) : **30 bancs → 0 écartée, 1 ceinturée** (récidive convertie en alternative valide). Puis L2-quater v2 (cascade + re-relay batch) **validé et DÉPLOYÉ prod 06/09 11h35 UTC** (fb5e184 — FUSION 5/8→6/8 chez le vérificateur, 0 écartée 0 ceinturée, gel 339-372 ms ; résidus diag → P8) (`RAPPORT-PERF-UX-L2-QUATER-2026-09-06.md`). **Prochaine étape : lot 3 en T1** (UX 2.1.4-2.1.9, compte 3.1.3-3.1.6, kerf explicite, benchmarks publics) — jalon utilisateurs (user gate) à la fin de T1 ; webhook Stripe **TOUJOURS À VÉRIFIER** ; campagne feedback à envoyer | Job standard ≤ 25 s ✓ ; paiements vivants ⏳ |
| **T1 (TERMINÉ 06/09)** | ~~Lot 3 + L3-bis~~ **LIVRÉS ET DÉPLOYÉS prod 06/09** (c47b2d2 puis 87b8bae — GO du vérificateur à chaque étape ; vitest 480/480, corpus 11/11 bits publiés, grilles bit-identiques, partiels navigateur livrés avec leviers) : UX 2.1.4-2.1.9 (refus capacité panneau unique ancré sous Nest + levier masqué < 0,5 mm + zéro carte fantôme ; « pièces · fichiers » ; glossaire tôle/vouvoiement + Intl.NumberFormat + test d'unicité i18n — doublons réels corrigés ; état « autre appareil » ; ligne d'état de calcul complète + cœurs locaux corrigés ; sens par bord + défaut 2 mm ; vue live ≡ option 1 avec poussée stage final), compte 3.1.3-3.1.6 (codes d'erreur stables + validation client + œil + CGU ; DialogWrapper a11y role/focus trap/restitution ; bannière e-mail non vérifié + badge ; middleware auth-optional /plans+changelog ; auth_error Google), **3.10 kerf explicite** (deux champs kerf/sécurité, règle affichée, migration sans changement, défaut usine 2 mm, zéro diff runtime), **3.9 benchmarks publics** (/benchmarks, chiffres du run images publiées fb5e184, méthode + honnêteté). Vitest 476/476, pytest 224+2 (3 errors préexistantes image publiée), e2e 7/7 (`RAPPORT-PERF-UX-L3-2026-09-06.md` + captures l3-verif). Verif L3 : GO avec L3-bis obligatoire → **L3-bis livré puis DÉPLOYÉ 87b8bae** (partiels navigateur 892/900 + leviers, message de refus unique, harnais bit-identique ; résidu garde-avant-post-pass → lot 4 — `RAPPORT-PERF-UX-L3-BIS-2026-09-06.md`). **Prochaine étape : JALON UTILISATEURS fin T1** (5 entretiens d'atelier + dépouillement campagne — livrable propriétaire) ; webhook Stripe **TOUJOURS À VÉRIFIER** ; campagne feedback à envoyer | Parcours nesting sans bloquant ✓ ; page /benchmarks ✓ ; jalon utilisateurs ⏳ |
| **Porte utilisateurs (fin T1)** | Campagne feedback dépouillée + 5 entretiens d'atelier (import, export, chutes, amorce) — **avant d'engager T3-T5** : l'ordre 3.2 → 3.7 est une hypothèse de l'auditeur, pas une donnée | Liste des 3 irritants réels ; ordre T3-T5 confirmé ou corrigé |
| **T2 / lot 4 (VALIDÉ — fiche `FICHE-LOT4-T2-2026-09-06.md`, phase par phase)** | Chantiers SANS REGRET, jalon utilisateurs en parallèle : **A. dette ~1/3** — P8 post-pass Python (STRtree + mesure par étape, il pèse la moitié du job serveur), garde par classe AVANT post-pass (résidu L3-bis), expiration des `awaiting_local` orphelins (10 min → cancelled + carte) ; **B. perf** — P4 worker finalisation navigateur, P5 plateau SPP calibré, P6 zones grille // ; **C. robustesse import DIAGNOSTIC SEUL** (corpus ~30 DXF réels, échecs classés, spécif du rapport de réparation — aucun changement produit avant le jalon). **Rust/Python TRANCHÉ (fiche validée)** : pas de réécriture au lot 4 (option c) — le lot 4 PRODUIT LA MESURE (gain/temps/taux de rollback par passe et par cas, corpus × 3 espacements) ; le **lot 5 retire les passes sans gain (> 80 % de runs annulés) dans les deux langues à la fois** et intègre la fusion inter-tôles au MOTEUR (constructif BPP) ; export DXF en Rust (écrivain natif+wasm existant) au chantier calques si le jalon le retient. Calques+identifiants, chutes, amorce, contraintes tôle, coupe commune → **attendent le verdict du jalon** (grille du guide). **Recentrage 06/09 (s'impose aux phases B et C)** : la phase B se mesure **dans le navigateur** (harnais `scripts/qa-e2e-local-2sheets.mjs` deux configurations + observateur long tasks), le banc serveur n'est qu'un contrôle de non-régression — P4 long task max < 100 ms après solve ; P5 mono 300 pièces en wasm, mesuré au tier du harnais (standard, concurrence 4) **et** au tier Free (concurrence 1, 8 walks en série) : 20-40 s au tier standard, largeur ± 0,5 mm, temps Free rapporté ; P6 zones réparties sur le **pool du tier** (jamais `hardwareConcurrency`), résultat bit-identique quelle que soit la taille du pool, donc Free (1 walk) reste séquentiel et identique ; **colonne navigateur sur /benchmarks** (0,5 j) ; phase C classe les échecs **sur l'importeur wasm d'abord**, ezdxf en second, écarts entre les deux listés | Navigateur : T-A ≤ 10 s, mono-tôle 300 pièces 95-145 → 20-40 s (±0,5 mm), long task < 100 ms ; serveur T-A < 15 s ; corpus import (wasm + ezdxf) + échecs classés ; plus d'orphelins |
| **T3 (+4-6 sem.)** | **Lot 5-moteur « un seul post-pass »** (le chantier n° 1 du recentrage) : à partir de la mesure P8 par passe, retrait des passes sans gain dans les deux langues à la fois, fusion inter-tôles puis compaction de la dernière tôle **dans le moteur** (constructif BPP, donc natif ≡ wasm) — critère : résultat navigateur ≡ serveur **bit-identique** sur le corpus × 3 espacements (vrai aujourd'hui pour la grille seulement) ; Lot 5 (accessibilité, plan & quota, coffre) ; **3.2 robustesse import (fin, importeur wasm d'abord)** ; **3.3 bibliothèque de chutes v1 (rectangulaire)** ; rapport imprimable ; **AF3 (vérif L3-bis, au plus tard)** : découchage de la tôle portrait à l'affichage (2.1.8 — l'ambiguïté « Bord bas pointe à gauche » est aujourd'hui levée par les axes + flèches, le rendu reste couché) | Import sans réparation manuelle ≥ 95 % ; « your offcuts are sheets » |
| **T4 (+7-9 sem.)** | Lot 6 (profil cible, transverse, P8-P11) ; **3.4 contraintes tôle** ; **3.5 réserve d'amorce** | Grain/zones interdites ; lead-in marqué à l'export |
| **T5 (+10-12 sem.)** | **3.6 remplissage** ; **3.7 coupe commune** (selon son plan) ; décision **API/batch 3.8** (nouveau chantier + pricing) | Clusters à arêtes communes ; GO/NO-GO API |
| Continu | Infra : **homelab overflow = même image que Hetzner à chaque déploiement worker** (contrôle `assert_overflow_head.py`) ; décision split workers homelab (avant T4 — la perf P3 réduit la pression) ; re-mesure business mensuelle (inscrits → payants, rétention) | — |

Dépendances clés : 3.7 après 3.2+3.3 (position de l'auditeur) ; 3.8 après
les lots 2-4 ; 3.5 après 3.1 (le point de départ n'a de sens qu'avec des
calques propres) ; la coupe commune et l'amorce héritent du chantier B
(kerf explicite) ; 3.3 v2 (polygonale) après retour utilisateurs sur la v1 ;
**toute nouvelle passe géométrique (3.5 amorce, 3.6 remplissage, 3.7 coupe
commune) s'écrit dans le moteur, pas dans le post-pass** — le lot 5-moteur
précède donc T4-T5.
Charge : T0-T5 représentent ~12 semaines d'implémentation pour un seul
agent + vérification ; toute semaine passée sur le business (Stripe,
entretiens, premier payant) décale d'autant — c'est voulu, le jalon
utilisateurs prime.

## 5. Registre des décisions owner (ouvertes)

| Décision | Reco | Statut |
|---|---|---|
| Constante d'arrêt BPP par itérations | k=3, plancher 30 itérations, sans plancher de temps (vérificateur) ; chute validée au banc space 2 | **En attente** (mesure faite) |
| SAMPLE_CFG (qualité vs temps) | Inchangé ; rouvrir si cibles de temps manquées après P3 | **En attente** (peut être tranchée maintenant) |
| Webhook Stripe live | Vérifier l'URL immédiatement | **Critique** |
| Infra split (workers homelab) | Reco du 30/08 ; la pression baisse après P3 | Ouverte |
| **Overflow homelab périmé** | Mettre à jour maintenant ; `assert_overflow_head.py` à chaque déploiement worker | **Critique** |
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

- **Navigateur (référence)** : T-A ≤ 10 s au tier standard (mesuré 6-9 s),
  temps Free mesuré et publié ; mono-tôle 300 pièces ≤ 40 s au tier standard ; long task max < 100 ms ; parité navigateur/serveur
  bit-identique (grille aujourd'hui, post-pass après le lot 5-moteur) ;
  import wasm sans réparation manuelle ≥ 95 % ; /benchmarks avec colonne
  navigateur.
- **Technique (serveur, débordement)** : job standard ≤ 25 s (post-P3) ;
  gel < 0,5 s (atteint) ; corpus 11/11 en continu ; physique
  0 chevauchement ; homelab = image Hetzner.
- **Produit** : taux d'import sans réparation manuelle ≥ 95 % (post-3.2) ;
  jobs utilisant une chute sauvegardée (post-3.3) ; export : golden par
  entité vert sur les deux chemins (arcs déjà natifs), calques par nature
  présents (post-3.1).
- **Business** : premier payant (le webhook vivant est le prérequis) ;
  rétention S1 > 25 % à 3 mois ; conversions Free→Unlimited après
  activation du 10e nesting réussi.
- **Confiance** : page benchmarks publiée, chiffres reproductibles,
  thread communauté actif.

## 8. Forme des instructions à l'implémenteur (GLM 5.3 Max)

Le vérificateur rédige, l'implémenteur exécute ; le modèle implémenteur
travaille bien sur des consignes fermées et mal sur des questions
ouvertes. Chaque chantier lui est donc remis sous cette forme, sans
exception :

1. **Périmètre fermé** : fichiers et fonctions nommés, ce qui change et
   ce qui **ne doit pas changer** (invariants : déterminisme natif ≡ wasm,
   pool par tier, `space` clé API, comptes par classe, physique).
2. **Verrou chiffré + commande** : la cible, la commande exacte qui la
   mesure (harnais navigateur d'abord, banc serveur ensuite), la
   configuration (deux champs kerf/sécurité, deux configurations du
   harnais), et le nombre de runs.
3. **Ordre imposé** : `assert_images_head.sh` OK avant toute mesure ;
   tests (cargo, vitest, pytest, `determinism_lock.py`) ; mesures ; rapport ;
   déploiement seulement après GO ; déploiement worker terminé sur le
   homelab avec `assert_overflow_head.py` OK.
4. **Rapport constat par constat** : pour chaque verrou, la valeur mesurée
   et la commande ; les non-faits énoncés ; hashes de commits réels ;
   aucune interprétation (« variance », « tolérance ») à la place d'une
   mesure.
5. **Pas de décision ouverte** : quand un choix se présente, l'implémenteur
   propose **une** option chiffrée et attend ; il n'arbitre pas lui-même
   entre variantes, ne crée pas de troisième copie du post-pass et
   n'ajoute pas de chantier au lot.

