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
- Cap **2 tôles par job** (identiques ou différentes) [spéc].
- Phase 2 : calcul **navigateur uniquement** [conditionnel].

### Unlimited — 19 €/mois

- Nestings illimités, tôles illimitées [prod].
- Calcul serveur [prod] ; Phase 2 : serveur **ou navigateur, au choix**
  [conditionnel].
- Notifications email de fin de nesting [prod].

### Pro — 39 €/mois

- **Budget moteur maximal + file prioritaire** : le luxe Pro est le temps
  de calcul (vcores, budget mur, priorité de file), jamais la qualité de
  base — le moteur n'est dégradé pour personne (§5, règle 1). Profil
  compute du tier code `privacy` : 8 vcores / 180 s / priority 10 [prod] ;
  repositionnement marketing « Pro = compute max », le vault ZK est sorti
  de l'exclusivité Pro (§2) [prod, PR#17].
- Phase 2 : **turbo hybride** client + serveur [conditionnel].

## 2. Privacy — spectre à 3 modes

La privacy n'est **jamais une feature payante** : le vault ZK est opt-in
sur TOUS les plans (gate `hasPrivacyTier` retiré, Phase 1) [prod, PR#17]. Chaque promesse publique doit être **exactement vraie** — détail
des promesses et threat model dans `docs/THREAT-MODEL.md`.

- **Mode Local** [conditionnel — Phase 2 WASM] : « files never leave your
  machine ». Vrai par construction, aucune nuance.
- **Mode Serveur** [spéc] : chiffré avec la clé de l'utilisateur ; RAM
  volatile uniquement pendant le job ; le clair n'est jamais écrit sur
  disque ; purge automatique des blobs après le délai affiché (24 h) ; la
  clé n'est jamais stockée. **Jamais** de « nous ne pouvons pas vous lire »
  en mode serveur (le serveur voit le clair en RAM pendant le job).
- **Vault ZK** [prod, opt-in tous plans] : chiffrement au repos
  avec une clé détenue par l'utilisateur seul (fichier-clé) — spec
  d'implémentation : `doc/encryption-premium.spec.md`.

**DXF simplifié/anonymisé : ÉCARTÉ.** La densité exige la géométrie exacte
et le contour de la pièce EST le secret : un DXF dégradé casserait le
produit sans protéger l'utilisateur.

## 3. Rapport matière

- **Contenu complet visible dans TOUS les plans** : métriques par tôle,
  ft², offcut (réutilisable ou ferraille), densité [prod].
- **Exports CSV / PDF / presse-papier = Unlimited+** [spéc] — les exports
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

1. **Moteur jamais dégradé en free** — le budget temps est le luxe Pro,
   pas la qualité de base (arrêt sur plateau pour tous, AGENTS §1).
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
   `hasPrivacyTier`) [spéc]. À la mise en prod : mettre à jour la copy qui
   présente le ZK comme exclusivité Pro (app : `plans.pro.f2/desc` ; site :
   `pricing.pro.f2/description`) — la copy suit la prod, jamais l'inverse.
2. **Durcissement vault niveau 1** : DEK en RAM seule, livraison ECDH
   éphémère, suppression du wrap master key — TODO détaillé dans
   `docs/THREAT-MODEL.md` §4. **Design à arrêter avant tout code**
   (D-PRV-7) [spéc].
3. **Purge 24 h du Mode Serveur** : la promesse (§2) n'est pas codée —
   prérequis : rédiger la spec d'exécution (mécanisme, délai affiché où,
   interaction vault) — voir `docs/THREAT-MODEL.md` §2 [spéc].
4. **Cap 2 tôles/job en free** [spéc].

Déjà livrés : codes promo partenaires [prod], rapport matière [prod].

### Phase 2 — [conditionnelle]

Hybride WASM navigateur/serveur (Free = navigateur seul, Unlimited = choix
navigateur/serveur, Pro = turbo hybride client+serveur). **Conditionnée au
verdict du spike WASM** : GO/NO-GO documenté dans `spike/VERDICT.md` —
aucun travail Phase 2 avant un GO écrit.

Scope attendu du spike (revue 2026-08-05) : le verdict sera plutôt
« GO, périmètre X » qu'un oui/non sec. Commencer par une **cartographie
moteur/pipeline** : le cœur (recuit BPP, constructif `HoleFillEvaluator`,
jagua/sparrow) est **Rust** — compilable WASM ; le pipeline **Python**
(parse DXF/SVG/DWG, canaux capillaires `holed_polygons.py`, métriques du
rapport) n'embarque pas et devra être porté ou réimplémenté côté client
en mode navigateur. La logique trous doit donc vivre côté client — à
chiffrer dans le verdict.

## Hors scope de ce document

- La copy publique (site marketing, page `/plans`, README) : elle suit la
  mise en prod réelle des features.
- Tout changement de code : ce fichier est une spécification, pas un plan
  d'implémentation.
