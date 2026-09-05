# Plan d'implémentation — performance du nesting, UX/UI nesting, UX/UI compte — 2026-09-05

Plan destiné à un agent d'implémentation, issu de trois inspections menées
le 05/09 sur HEAD (`b3a06eb`) : performance du pipeline (mesures
reproductibles dans `docs/qa/perf-audit-2026-09-05/`), UX/UI du parcours
nesting (35 constats, captures desktop/mobile/sombre/FR dans
`docs/qa/ux-audit-2026-09-05/nesting/`), UX/UI compte-profil-réglages
(40 constats, captures dans `docs/qa/ux-audit-2026-09-05/profil/`). Règles
inchangées : une PR par étape, miroir Python ↔ JS, `assert_images_head.sh`
avant tout banc, physique bloquante, corpus T-A..T-K rejoué, i18n FR/EN
(piège #20), `determinism_lock.py` après tout changement moteur.

## 0. Ce que les mesures disent

- **Le temps de nesting est du temps d'attente, pas du calcul utile.** Sur le
  cas de référence (699 items moteur), un walk BPP trouve son meilleur
  résultat à **t = 0,4 s** (2 améliorations sur 342 itérations en 60 s), puis
  attend le plateau (28 s). Job standard ≈ 58 s = 2 vagues de 4 walks × 29 s
  d'attente ; Free = 8 walks séquentiels ≈ 232 s (à 8 s du timeout Python).
  Mono SPP 300 pièces : meilleure largeur à t = 1 s, 33 s d'attente de
  plateau ×2 phases ; les 60-100 s restants du job mono = sous-solves de
  zones de la grille structurelle, séquentiels après le solve.
- **Une itération coûte 200 ms** = 640 000 évaluations de collision (0,3 µs
  chacune) : c'est le volume d'échantillonnage, pas le CDE. Réduire les
  échantillons dégrade la qualité ; augmenter à 600/200/3 la gagne (+0,01
  remnant) pour +47 % de temps.
- **Navigateur : 5,7 s de gel** en fin de calcul = `pairViolates` sans
  pré-filtre bbox (400 000 paires × 13 µs) sur le thread principal, pour un
  post-pass finalement annulé (`rollback front`).
- **Serveur : la décoration des frames live** relance `apply_hole_fill` 3 fois
  par seconde : 17 s CPU pour 40 s de solve, un demi-cœur volé aux walks.
- **UX : deux bloquants** — impossible d'annuler un calcul navigateur (statut
  `awaiting_local` non reconnu comme « en cours »), et le score « xx % used »
  (emprise / tôle, moins = mieux) affiché comme une utilisation (plus =
  mieux) : l'option Grille classée première paraît moins bonne que la
  Compaction. Côté compte : tous les textes d'erreur utilisent une couleur à
  30-40 % d'opacité (contraste 1,3-1,7:1), le rate-limit de connexion compte
  les succès (5 par 15 min, bloque un utilisateur à 3 appareils), et le
  quota Free n'est visible ni sur l'accueil ni dans le profil.

## 1. Performance — ordre d'exécution

| Étape | Contenu | Gain mesuré/estimé | Dev | Verrou |
|---|---|---|---|---|
| **P1** | `residualClient.js` / `structureClient.js` : pré-filtre bbox exact dans `pairViolates`/`ringDist` (écart bbox ≥ space ⇒ pas de violation) + index grille de l'occupation | gel navigateur 5,5 s → < 0,3 s, résultat bit-identique | 0,5 j | `replayUserBpp.test.js` (bit-identique), vitest |
| **P2** | `holefill.py` : mémoïser `pinwheel_capacity`/`hole_capacity` par (hôte, filler, space, rotations) ; `main.py:1053-1080` : décorer les frames live au plus 1×/s et sortir la décoration du thread lecteur de stdout | −17 s CPU / 40 s de solve serveur ; post-pass −0,25 s | 0,5 j | pytest holefill, `holesFilled` identiques au banc |
| **P3** | **Arrêt BPP par itérations** (`sa.rs:243-279`, `config.rs`) : un walk s'arrête après `max(15, 3 × it_dernière_amélioration)` itérations sans amélioration ET ≥ 3 s ; `plateau_patience_sec` devient un plafond, le budget la ceinture. **Précédé d'une journée de mesure** : logger l'itération de chaque amélioration sur T-A..T-K aux 3 espacements, choisir la constante. | serveur standard 58 → 8-10 s ; Pro 30 → 5 s ; Free 232 → ~35 s ; navigateur 30-50 → 8-12 s. Déterminisme amélioré (plus d'horloge) | 1 j + 1 j mesure | banc 0/0,1/2 (grille bit-identique, compaction 555 ± 3 à space 2), corpus, `determinism_lock.py`, rebuild wasm |
| **P4** | Web Worker de finalisation navigateur (post-pass, grille multi-tôles, rapport, SVG) ; état « Finalisation… » dans la vue | gel résiduel 0 | 1-2 j | e2e 0,1/2, parité serveur ± 3 |
| **P5** | SPP : plateau par phase calibré sur la dynamique observée (`progress.rs` `PlateauTerminator`, `main.py:133`) : patience effective = `max(2 s, 4 × délai 1ʳᵉ→dernière amélioration)`, plafonnée par la formule actuelle ; démarrer la phase 2 au plateau de la phase 1 plutôt qu'à `phase1_ratio` 0,6 fixe | mono 300 : 34 → ~10 s ; 900 pièces : gain de largeur à budget égal | 1 j | banc mono (600,1 ± 0,5 mm, holes 150/200), `retry_overshoot` |
| **P6** | Grille structurelle SPP : sous-solves de zones en parallèle du solve principal, ou patience zone 4 → 2 s et tentatives 5 → 3 (`structure.py:37-45, 306-345`) | job mono −30 à −80 s (hypothèse) | 1-2 j | banc mono grid used 0,597, holes 150 |
| **P7** | Comptabilité threads : borner le pool separator SPP à `min(3, RAYON_NUM_THREADS)` (`separator.rs:55-62`) ; vérifier un job Free BPP réel avant/après P3 (timeout `budget + 120 s`) | jetons justes, plus de timeout Free | 0,2 j | `determinism_lock.py`, banc SPP |
| P8 | `residual.py` : STRtree pour `new_entries`, dry-run de capacité lattice avant déplacement (court-circuit si le compte ne peut pas monter) | post-pass 1,3 → 0,4 s | 1 j | test_residual, parité |
| P9 | Constructif : cache « tôle saturée par classe » (`constructive.rs:287-321`) | −15-20 % par itération | 0,5 j | tests constructive, banc |
| P10 | **AB5 (vérif L2)** : le schéma de température reste calibré sur le budget temps alors qu'un walk vit désormais 30-1000 itérations — PREMIER levier qualité à instrumenter (même journée de mesure que P3, en traçant l'itération de la dernière amélioration DE REMNANT). `SAMPLE_CFG` à qualité mesurée (600/200/3 gagne +0,01 remnant ; 150/50/3 perd 0,006 pour −23 %) — décision après P3 | ± | 0,5 j | banc 3 espacements |
| P11 | Reveal : `sleep(1.2)` → 0,5 s ou ack vue ; rendu live `v-memo`/`shallowRef` | −1 à −2 s ; fluidité | 0,3 j | e2e |

À ne pas faire (mesuré ou raisonné) : constructif incrémental (le recuit est
inerte, gain ≤ 33 % d'une boucle qui ne produit rien), mémoïsation des
séquences (jamais revisitées), parallélisme intra-walk (granularité 0,3 µs),
threads wasm/SharedArrayBuffer (les walks sont déjà un Web Worker chacun),
réduction des échantillons « pour itérer plus », retrait de
`column_fill`/`gravity` pour le temps (< 1 s), hausse des jetons avant P7.

Cible cumulée : BPP serveur standard 60-115 s → 15-25 s ; navigateur
50 s + 5,7 s de gel → ~15 s sans gel ; mono SPP 95-145 s → 20-40 s.

## 2. UX/UI nesting — ordre d'exécution

### 2.1 Bloquants et majeurs (≈ 3 jours)

1. **Annuler un calcul navigateur** (C01) : traiter `awaiting_local` comme
   « en cours » dans `UserResultItem.isResultNexting` (ou normaliser dans
   `localHydrate`) ; bouton Annuler aussi sous la vue live.
2. **Un seul indicateur de qualité** (C02, C22) : par option « Grille /
   Compaction −X · 2 tôles · densité matière 55 % · chute réutilisable
   496×1000 mm » ; supprimer la barre « Sheet utilization » (ou la baser sur
   la densité) ; une ligne « proposée en premier car plus grande chute
   propre » ; sous-titre explicatif des deux méthodes.
3. **Badges = verdict, pas jargon** (C03, C12) : plus jamais de rouge
   « Post-pass … rollback » sur un résultat découpable (reléguer aux détails
   techniques repliables) ; masquer seed/cores absents ; pluriels ; retirer
   « combinations tested » ou le rendre crédible.
4. **Refus capacité** (C04, C09) : levier espacement masqué sous 0,5 mm
   (« même sans espacement, ça ne tient pas »), un seul panneau, ancré sous le
   bouton Nest ou `scrollIntoView`, pas de carte « Nesting failed » fantôme ;
   carte d'échec avec un seul titre + cause.
5. **Vocabulaire** (C06, C20, C21) : « 900 pièces · 2 fichiers », bouton
   « Imbriquer 900 pièces » ; glossaire FR : tôle (jamais plaque), pièce,
   imbrication, chute, espacement, largeur de coupe (kerf) ; vouvoiement
   partout ; `Intl.NumberFormat(locale)` pour % et mm² ; dédoublonner les clés
   i18n et ajouter un test d'unicité.
6. **État « autre appareil »** (C05) : « Calculé sur un autre appareil —
   résultats non disponibles ici » à la place de « 0 sheets + Download All » ;
   sur la page projet, afficher `localImport.emptyBrowser` au lieu de
   rediriger.
7. **Feedback de calcul** (C10, C28) : une ligne d'état « Recherche · 22 s ·
   meilleur 55,4 % · 4 recherches en parallèle · arrêt automatique dès
   stagnation » ; corriger `runningCores` pour les jobs locaux ; bandeau
   « calcul en cours avec les réglages précédents ».
8. **Sens d'optimisation** (C07, C08) : libellés par bord de tôle (« vers le
   bord gauche (X = 0) / vers le bord bas (Y = 0) / équilibré ») avec flèches
   sur l'aperçu de tôle, aide en popover cliquable ; ne plus coucher la tôle
   portrait ; espacement par défaut 2 mm (ou dernier utilisé), alerte kerf
   sous 0,5 mm avec explication.
9. **Vue live ≡ option 1** (C31) : après le post-pass, pousser la frame de
   l'alternative rang 0 dans la vue live (ou légender « aperçu moteur »).

### 2.2 Accessibilité et design system (≈ 2 jours)

10. `<html lang>` par locale, `role="dialog" aria-modal aria-labelledby` +
    focus initial/piège/restitution sur `DialogWrapper`, `aria-label` des
    compteurs de quantité, boutons d'aide et de suppression focusables (C13).
11. Contrastes : `--label-tertiary` ≥ 0,62 d'opacité, accent des boutons
    `rgb(0,105,217)` sous texte blanc, libellés de bouton ≥ 12 px, badges
    verts sombres (C14) ; cibles tactiles ≥ 44 px (C18).
12. Modal résultat : police sans-serif (`tabular-nums` sur les chiffres),
    barre d'actions collante, tableau → cartes par tôle sous 700 px, en-tête
    live `flex-wrap` mobile (C15, C25, C26, C16).
13. Header mobile : unités/langue/thème/coffre dans le menu avatar, tiroirs
    en barre d'onglets basse (C17).

### 2.3 Finitions (≈ 1 jour)

14. « Try again » → « Modifier les réglages » câblé ; copie du slug ; hint
    sous le bouton Nest grisé (C19) ; tooltip `[object Object]` (`unref`)
    (C11) ; chutes < 50 mm masquées, « ≥ » au lieu de « (at least) » (C23) ;
    noms de fichiers `<projet>_option1_tole1.dxf` + mention unité (C24) ;
    « Rotations autorisées : 4 (0°, 90°, 180°, 270°) » en select, « Quantité
    2 tôles » (C27) ; titre de projet éditable (C29) ; tuile « DXF files »
    (C30) ; bouton Nest désactivé quand le quota Free est épuisé (C34).

À préserver : cartes de confidentialité, vue live multi-tôles, aperçu des
angles et alerte kerf, presets de formats, panneau capacité à leviers,
rapport matière avec badges mesurés, aperçu couleur ↔ DXF, thème sombre
cohérent, mobile sans débordement.

## 3. UX/UI compte, profil, réglages — ordre d'exécution

### 3.1 Correctifs rapides à fort impact (≈ 1,5 jour)

1. **Token `--error-text` opaque** (clair `rgb(200,0,48)`, sombre
   `rgb(255,110,140)`) partout où `--error-border` sert de couleur de texte
   (auth, promo, coffre, suppression) (A1, X4).
2. **Rate-limit login** : compter les échecs seulement, remise à zéro au
   succès, message traduit avec délai (A2).
3. **Codes d'erreur stables** côté auth (`invalid_email`, `password_too_short`,
   `email_taken`, `invalid_credentials`, `reset_link_invalid`) + mapping i18n
   ; validation client (`required`, `minlength`, `autocomplete`, `id`,
   `name`, `aria-invalid`) ; erreur ciblée sur le champ ; œil mot de passe ;
   état de chargement ; mention CGU/confidentialité à l'inscription (A3, A4,
   A5).
4. **`DialogWrapper`** : retirer `font-family/font-size` mono, `role="dialog"
   aria-modal aria-labelledby`, focus initial + piège + restitution (M1 —
   partagé avec le nesting).
5. **E-mail non vérifié** : exposer `emailVerified`, bannière persistante
   `/home` et `/profile` avec renvoi, badge « Vérifié » (A6, A7).
6. **Middleware « auth-optional »** pour `/plans`, landing, changelog (P3) ;
   `auth_error` Google affiché (A8).

### 3.2 Plan, quota, accueil (≈ 2 jours)

7. **Carte « Plan & quota » indépendante de Stripe**, sur `/profile` et
   `/home` : nom du plan, jauge n/10, date+heure de reset, promo active,
   historique 3 mois ; remplace la tuile « Ce mois-ci » (P1, P9, P10).
8. **`/plans`** : lignes manquantes du Free (2 tôles par tâche, calcul
   navigateur, 1 nesting à la fois) ; prix localisés « 19 € / mois » ;
   tableau mobile en accordéon ou colonne figée avec ombre ; lexique Free /
   Unlimited / Pro partout (P2, P4, P5, P6, P7).
9. **Colonne « Tous les résultats » de l'accueil** : nom du projet + date +
   pastille privacy, pas de bouton de téléchargement non hydraté, pas de
   double « Échec » (H1) — ou « Activité récente ».

### 3.3 Coffre et sécurité (≈ 1,5 jour)

10. `VaultSettings` découplé du flag Strip (V1) ; confirmation avant
    rotation de clé (V2) ; onboarding en 3 étapes (explication →
    téléchargement → confirmation) et écran « coffre actif » (V3) ; modale
    de déverrouillage une fois par session puis bannière (V4) ; libellé
    d'état lisible sur le bouton coffre (H3).
11. Suppression de compte : re-authentification Google, modale à la place
    de `window.confirm`, phrase de rétention, export des données avant (S1).

### 3.4 Architecture d'information cible du profil (≈ 3 jours, après 3.1-3.3)

Page à sections ancrées (navigation latérale desktop, accordéon mobile) :

1. En-tête : avatar, nom, e-mail, fournisseur, badge vérifié, pastille plan,
   déconnexion.
2. Plan & quota (carte 3.2.7, actions d'abonnement en modale, code
   partenaire replié en Free).
3. Facturation : portail Stripe (`billingPortal.sessions.create`), factures,
   moyen de paiement (nouveau, aucune route aujourd'hui).
4. Confidentialité & coffre (rappel des 3 modes, copy `THREAT-MODEL.md`).
5. Préférences persistées en base : langue, unités, thème, **nesting par
   défaut** (espacement, tôle favorite, sens, mode privacy à la création),
   notifications.
6. Sécurité : nom, e-mail (re-vérification), mot de passe, sessions actives
   et « déconnecter partout », connexions liées (P8, S2).
7. Données & compte : export JSON/ZIP, suppression, liens légaux localisés.

Header = raccourcis d'état ; accueil = salutation, jauge de quota, création,
projets récents, activité récente nommée. Sur mobile, un seul menu avatar.

### 3.5 Transverse (≈ 1 jour)

12. `MainTitle` en vrai heading, `<html lang>` et `<title>` par page,
    labels de champs, options de langue focusables, `aria-label` traduits
    (X1, X2) ; `--label-tertiary` 0,62 en clair, pastilles d'état doublées
    d'un texte (X3) ; tokens `--surface-inverse`/`--on-inverse` à la place de
    `background-secondary` (X4) ; newsletter : erreur visible, état daté
    (N1) ; code promo replié en payant (N2) ; vouvoiement, « imbrication »,
    apostrophes typographiques et espaces insécables via lint i18n (I1-I3) ;
    footer et chat traduits, envoi sur Entrée, badge non-lu (I4) ;
    mismatches d'hydratation `/home` `/profile` (T1).

## 4. Ordre global et estimation

| Lot | Contenu | Dev | Banc/QA |
|---|---|---|---|
| L1 | P1 + P2 + UX 2.1.1-2.1.3 + compte 3.1.1-3.1.2 | 2,5 j | 0,5 j |
| L2 | P3 (mesure puis arrêt par itérations) + P7 | 2,5 j | 1 j |
| L3 | UX 2.1.4-2.1.9 + compte 3.1.3-3.1.6 | 3 j | 0,5 j |
| L4 | P4 + P5 + P6 | 3,5 j | 1 j |
| L5 | UX 2.2 + compte 3.2 + 3.3 | 5 j | 1 j |
| L6 | Profil 3.4 + transverse 3.5 + finitions 2.3 + P8-P11 | 6 j | 1 j |

Chaque lot se déploie séparément (images publiées contrôlées par
`assert_images_head.sh`, corpus complet vert, e2e navigateur 0,1/2 + cas
4 mm). Décisions propriétaire avant L2 : constante d'arrêt par itérations
(après la journée de mesure) et `SAMPLE_CFG` (qualité vs temps) ; avant L5 :
portail Stripe (facturation) et politique d'export des données.

## Addendum 2026-09-05 (soir) — d'après la vérification du lot 1 (AA8)

**P8 (STRtree `new_entries`, dry-run capacité lattice) est PROMU du lot 6
au lot 2 ou 4.** Mesure de référence posée par la vérification L1
(`docs/qa/perf-audit-2026-09-05/l1-verif/threads-w1.log`, t = 60-71 s) :
le post-pass Python consomme **9,4 s CPU (11 s mur)** sur le main thread
après le moteur — expand + hole-fill + résiduel + vérification + métriques.
Une fois P3 livré (moteur ≈ 20 s), ce post-pass deviendrait un tiers du
job. La journée de mesure P3 ajoutera le suivi AA4 (CPU décorateur) et
AA8 (CPU post-pass), déjà outillé par `sample_threads.sh` (fourni dans
`l1-verif/`).
