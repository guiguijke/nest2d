# Stratégie produit & tiers — NestorCut

> **Document de référence commité** pour la stratégie produit (décisions du
> 2026-08-05, analyse marché + arbitrages du propriétaire). Il complète
> `AGENTS.md` (pièges techniques) et le dossier `specs/` (local, gitignored
> — mémoire détaillée des décisions et journal chronologique
> `specs/90-decisions.md`). Tout travail produit (humain ou agent) part
> d'ici.
>
> **Marqueurs de statut** (obligatoires — anti-divergence doc/code) :
>
> - `[prod]` — livré et vérifiable en production aujourd'hui ;
> - `[spéc]` — décidé, non codé ;
> - `[conditionnel]` — dépend du verdict du spike WASM (Phase 2, §6).
>
> **Ne jamais écrire `[prod]` sur du non-livré.** La copy publique (site
> marketing, page `/plans`, README) suit la mise en prod réelle des
> features — jamais l'inverse (§5, règle 4).

## 1. Tiers

Prix inchangés : **0 / 19 / 39 €**, garantie 30 jours, essai 7 jours
(`FREE_NESTING_LIMIT`, `TRIAL_DAYS`, labels dans
`shared/constants/payment.constants.js`) [prod].

Correspondance des noms (le code n'est pas renommé à ce stade) :

| Marketing | Tier code (`COMPUTE_TIERS`, `entitlement.js`) |
|---|---|
| Free | `free` |
| Unlimited | `standard` |
| Pro | `privacy` (repositionné — voir ci-dessous) |

> Note ops : les CTA payants peuvent être masqués temporairement via
> `NUXT_PUBLIC_PAID_PLANS_DISABLED` (« Coming soon ») — les mécaniques
> d'abonnement restent livrées côté code, l'ouverture commerciale est un
> flag.

### Free — 0 €

- 10 nestings **réussis** / mois calendaire UTC — un job échoué ne consomme
  pas de quota (charge refundée par le worker, `worker_common/refund.py`)
  [prod].
- Cap **2 tôles par job** (somme des counts, identiques ou différentes) [prod, PR#18].
- Calcul **navigateur uniquement** (Mode Local forcé : solve WASM
  mono-walk, résultats 100 % navigateur, refund à l'échec) [prod, PR#33-38 —
  flag ON 2026-08-08].

### Unlimited — 19 €/mois

- Nestings illimités, tôles illimitées [prod].
- Calcul serveur [prod] **ou navigateur, au choix** (toggle « Lieu de
  calcul », défaut serveur — un payant ne voit rien changer) [prod, flag ON
  2026-08-08]. DWG ⇒ serveur dans tous les cas (local = DXF+SVG).
- Notifications email de fin de nesting [prod].

### Pro — 39 €/mois

- **Budget moteur maximal + file prioritaire** : le luxe Pro est le temps
  de calcul (vcores, budget mur, priorité de file), jamais la qualité de
  base — le moteur n'est dégradé pour personne (§5, règle 1). Profil
  compute du tier code `privacy` : 8 vcores / 180 s / priority 10 [prod] ;
  repositionnement marketing « Pro = compute max », le vault ZK est sorti
  de l'exclusivité Pro (§2) [prod, PR#17].
- **Turbo hybride** client + serveur (pool navigateur + budget serveur
  max, course au premier résultat) [spéc — non codé, voir plan §6].

## 2. Privacy — spectre à 3 modes

La privacy n'est **jamais une feature payante** : le vault ZK est opt-in
sur TOUS les plans (gate `hasPrivacyTier` retiré, Phase 1) [prod, PR#17]. Chaque promesse publique doit être **exactement vraie** — détail
des promesses et threat model dans `docs/THREAT-MODEL.md`.

- **Mode Local** [prod, import 100 % client vérifié en prod 2026-08-12,
  J-090 + défaut « 100 % privé » PR#50] : par défaut, un nouveau projet est
  **100 % privé** — le fichier source est parsé dans le navigateur (wasm)
  et **ne quitte jamais la machine** ; le solve tourne dans le navigateur
  (pool multi-walks par tier, J-093) et les résultats restent dans
  IndexedDB ; le serveur ne voit que métadonnées + compteurs de quota
  (vérifié onglet réseau : 16 o à la création, scalaires au nesting).
  Opt-out cloud possible à la création (import DWG, multi-appareils) : les
  sources sont alors uploadées puis purgées 24 h ; les résultats d'un
  calcul local restent dans le navigateur dans tous les cas.
- **Mode Serveur** [prod, purge active vérifiée 2026-08-12] : TLS en
  transit ; traitement en RAM pendant le job ; au repos le fichier est
  stocké **en clair** dans la base jusqu'à la **purge automatique 24 h**
  (sources + résultats ; les rapports ne gardent que des scalaires) ;
  suppression de projet en libre-service (J-095). **Jamais** de « nous ne
  pouvons pas vous lire » en mode serveur (le serveur voit le clair en RAM
  pendant le job).
- **Vault ZK** [prod, opt-in tous plans] : chiffrement au repos
  avec une clé détenue par l'utilisateur seul (fichier-clé) — spec
  d'implémentation : `doc/encryption-premium.spec.md`.

**DXF simplifié/anonymisé : ÉCARTÉ.** La densité exige la géométrie exacte
et le contour de la pièce EST le secret : un DXF dégradé casserait le
produit sans protéger l'utilisateur.

## 3. Rapport matière

- **Contenu complet visible dans TOUS les plans** : métriques par tôle,
  ft², offcut (réutilisable ou ferraille), densité [prod].
- **Exports CSV / PDF / presse-papier = Unlimited+** [prod, PR#19] — les exports
  client existants (CSV, copie presse-papier, aujourd'hui libres) passent
  derrière un état verrouillé propre en free ; l'export PDF n'existe pas
  encore. L'état verrouillé est un **message explicite** (du type
  « L'export fait désormais partie d'Unlimited » + CTA) — jamais un bouton
  qui disparaît : la frustration devient argument d'upgrade.
- **Historique des rapports** et **coût matière** (prix/tôle → coût job) :
  candidats Pro futurs [spéc].
- Rappel canonique : la densité du rapport est **mesurée** sur les
  polygones placés (aires vraies, trous soustraits) — « computed, never
  declared » (AGENTS #19b). Les champs de rapport restent ADDITIFS.

## 4. Codes promo

[prod] Majoration du quota free (ex. JD20 → 20 nestings/mois) :

- snapshot au redeem (`users.promo` figé : limite + fin de campagne) ;
- un seul code **actif** par user ; promo expiré → re-redeem possible ;
- expiration et `maxRedemptions` ne bloquent que les **nouveaux** redeems
  — jamais rétroactif ; la reconduction admin propage la nouvelle date à
  tous les bénéficiaires ;
- pas de remise €, pas de coupon Stripe, pas de code Pro temporaire
  (`grantedUntil` couvre l'accès offert).

Références : `specs/55-promo-codes.md` (local), AGENTS #34, verrous
`server/tests/promo.test.js` + `server/tests/entitlement.test.js`
(`npx vitest run`).

## 5. Règles gravées

1. **Moteur jamais dégradé en free** — le budget temps / la concurrence
   est le luxe Pro, pas la qualité de base (arrêt sur plateau pour tous,
   `QUALITY_WALKS=8` partout, AGENTS §1, D-PAY-12).
2. **Prix inchangés** : 0 / 19 / 39 €, garantie 30 jours, essai 7 jours.
3. **G-code : hors produit** jusqu'à preuve de marché (surveiller Nestpact,
   24 $/mo avec G-code).
4. **Toute revendication publique = feature flag vérifié en prod** avant
   publication.
5. **Binaire WASM récupérable par nature** : pas de licence check réseau
   (patchable, et casse les promesses offline/privacy). Mitigations : build
   strippé + wasm-opt, licence d'usage explicite, threat model honnête
   (`docs/THREAT-MODEL.md`). Le moat = produit, vitesse de shipping,
   confiance.

## 6. Roadmap

### Phase 1

Quatre chantiers **indépendants, à traiter en PR séparées** :

1. **Vault ZK opt-in sur tous les plans** (retrait du gate
   `hasPrivacyTier`) [prod, PR#17].
2. **Durcissement vault niveau 1** (D-PRV-7) [prod, PR#46 — QA E2E 27/27,
   `scripts/validate_vault_dprv7_e2e.sh`] : session DEK en RAM
   process-local seule (plus de `session_keys`), livraison ECDH P-256
   éphémère par job aux workers, wrap master key supprimé.
3. **Purge 24 h du Mode Serveur** (D-PRV-10) [prod, PR#41 — sweeper
   actif vérifié en prod 2026-08-12, log `purge: {...}` au boot] : blobs
   sources + résultats supprimés par bucket (jamais de TTL seul — chunks
   orphelins), vault et démo exemptés, scalaires de rapport conservés.
4. **Cap 2 tôles/job en free** [prod, PR#18] (démo exemptée, D-DEM-11).

Déjà livrés : codes promo partenaires [prod], rapport matière [prod],
admin mobile + tracking + métriques file mesurée [prod, PR#47-#49, #52],
rework directionnel left/bottom/balanced [prod, PR#51 + #56, J-092].

### Phase 2 — Mode Local [prod, flag ON 2026-08-08]

**Verdict spike = GO** (spike/VERDICT.md : ratio 1,5-1,7×, bit-exact
natif/wasm via libm des deux côtés, .wasm 349 Ko gz, mémoire < 36 Mo).
**Livré en prod** (PR#20 → PR#39, J-058 → J-089) : moteur wasm32 (jagua
vendored mono-thread, libm, `nest-wasm`, artefact `/engine/*`), verrou
déterminisme SHA-256 (natif ≡ wasm, tolérance 0), `computeLocation` écrit
serveur (free/démo ⇒ local forcé ; paid ⇒ choix, défaut serveur ; DWG ⇒
serveur), Web Worker, profil browser 13 s mono-walk, refund à l'échec,
**rendu 100 % client** (SVG/rapport/DXF via crate géométrie dual-cible,
parité verrouillée par diff client/serveur bloquant), résultats IndexedDB,
vue live du solve navigateur (EventSink 2 Hz), trou-filling meta-pièces
sécurisé (J-089).

**Claim « files never leave your machine » = COMPLET** [prod, vérifié en
prod 2026-08-12] : import 100 % client câblé dans le flux d'upload (J-090,
PR#42), création « 100 % privé » par défaut (PR#50), pool multi-walks
1/4/8 par tier (J-093, PR#43), métriques rapport client (J-082), QA prod
zéro-upload au filet (POST create = `{"local":true}` 16 o, quota =
3 scalaires). **Turbo hybride Pro** [spéc] : course client/serveur à
l'enqueue (Chantier B du plan dédié, specs/80 — reporté 2026-08-12 au feu
du propriétaire ; prérequis pool client livré, J-093).

### Phase 3 — pistes (non engagées)

- **Turbo hybride Pro** : course client/serveur à l'enqueue (Chantier B du
  plan dédié — seul chantier restant du plan 2026-08-10, reporté).
- **Threads wasm natifs** (rayon + SharedArrayBuffer) : écartés au profit
  du pool de Web Workers (J-093, option A2) — exigerait COOP/COEP
  cross-origin isolation, incompatible avec les intégrations tiers
  actuelles ; à revisiter seulement si le pool montre ses limites (gros
  jobs BPP).
- **Classes BPP directionnelles** : investigation non menée (hors scope du
  rework J-092, qui ne couvrait que le SPP).
- **G-code** : hors produit jusqu'à preuve de marché (§5, règle J-053).

## Hors scope de ce document

- La copy publique (site marketing, page `/plans`, README) : elle suit la
  mise en prod réelle des features.
- Tout changement de code : ce fichier est une spécification, pas un plan
  d'implémentation.
