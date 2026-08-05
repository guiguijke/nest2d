# Stripe — passage en production (NestorCut)

Checklist de bascule test → live et de conformité de facturation.
Entreprise vérifiée via annuaire-entreprises : **Guillaume Jerke EI (APlasma)**,
SIREN 942 877 028 · SIRET siège 94287702800012 · APE 25.50B · créée le
03/04/2025 · Saint-Martin-Lalande (11400) · **franchise en base de TVA
(art. 293 B du CGI)**. Un n° de TVA intracommunautaire existe : il sert pour
l'autoliquidation des achats étrangers, le B2B UE et la DES — il ne remet
PAS en cause la franchise tant qu'aucune TVA n'est facturée. Décision
(2026-08) : **rester en franchise sur l'ensemble de l'activité APlasma**
(découpe plasma + SaaS) — donc Stripe Tax OFF.

## 1. Fiches d'abonnement

Créées par `scripts/create-live-products.mjs` (idempotent). Sous Windows,
passer par le wrapper PowerShell (saisie de la clé masquée, hors historique) :

```powershell
powershell -ExecutionPolicy Bypass -File scripts\create-live-products.ps1
```

(Équivalent bash : `STRIPE_SECRET_KEY=sk_live_xxx node scripts/create-live-products.mjs`)

| Produit | metadata | Prix par défaut |
|---|---|---|
| NestorCut Standard | `type=subscription`, `tier=standard` | 19 €/mois + option 19 $ |
| NestorCut Confidentialité+ | `type=subscription`, `tier=privacy` | 39 €/mois + option 39 $ |

Le serveur les synchronise au boot (`6_subscription_plan_sync.ts`) — **aucun
changement de code après création**. Essai de 7 jours appliqué au checkout
(côté serveur, `TRIAL_DAYS`). Les visiteurs hors zone euro voient l'USD
(mapping `server/utils/currency.ts`).

## 2. Variables d'environnement (`.env` du serveur)

```bash
NUXT_STRIPE_SECRET_KEY=sk_live_...        # remplace la clé test / valeur vide
NUXT_STRIPE_WEBHOOK_SECRET=whsec_...      # secret LIVE de l'endpoint (§3) — remplace le secret test actuel
NUXT_ABBY_API_KEY=suk_...                 # compta Abby (§6) — clé RÉGÉNÉRÉE, jamais celle partagée en conversation
```

`env_file: .env` dans docker-compose injecte tout dans le container `app` (et
`admin`). Redémarrer : `docker compose up -d app admin`.

## 3. Webhook live

Dashboard (mode live) → Développeurs → Webhooks → **Ajouter un endpoint** :

- **URL** : `https://<domaine public de l'app>/api/stripe/webhook`
- **Événements** (5) : `checkout.session.completed`,
  `customer.subscription.created`, `customer.subscription.updated`,
  `customer.subscription.deleted`, **`invoice.payment_succeeded`**
  (sans ce dernier, la remontée comptable Abby ne se déclenche jamais)

Copier le « secret de signature » (`whsec_...`) dans
`NUXT_STRIPE_WEBHOOK_SECRET`. Sans lui l'endpoint répond 503 (la vérification
de signature refuse de tourner non configurée — voulu).

## 4. Paramètres du compte Stripe (Dashboard, mode live)

**Business / Paramètres publics**
- Nom public : `NestorCut (APlasma)`
- **Descripteur de relevé bancaire** : `NESTORCUT` (≤ 22 caractères)
- Adresse professionnelle = siège réel (reprise sur les factures)

**Facturation → Factures et reçus**
- **Pied de facture personnalisé** (mentions obligatoires) :
  > APlasma — Guillaume Jerke EI · SIREN 942 877 028 · 11400
  > Saint-Martin-Lalande, France · TVA non applicable, art. 293 B du CGI ·
  > N° TVA intracommunautaire : FRxx942877028 (remplacer xx par la clé)
- **NE PAS activer Stripe Tax** : en franchise en base, aucune TVA n'est
  collectée. (Si dépassement de seuil un jour : configurer Stripe Tax AVANT
  de toucher aux prix.)
- E-mails : activer reçus de paiement réussi + factures d'abonnement.

**Portail client** (Paramètres → Facturation → Portail client)
- Activer : annulation d'abonnement (à échéance), mise à jour du moyen de
  paiement, historique des factures. Cohérent avec l'obligation française de
  résiliation en ligne en quelques clics (l'app a aussi son propre bouton
  d'annulation, `subscription/cancel.post.js`).

**Checkout**
- Activer la **collecte de l'adresse de facturation** (nom + adresse client :
  mentions obligatoires sur facture).

**Branding** : logo + couleurs pour Checkout, factures et e-mails.

## 5. Conformité facturation (franchise en base)

- ✅ Mention « TVA non applicable, art. 293 B du CGI » : obligatoire sur
  **toutes** les factures → pied de facture Stripe (§4). Déjà présente dans
  les mentions légales du site (`legal.astro`).
- ✅ Numérotation des factures : Stripe émet une séquence continue — ne pas
  modifier le format en cours de route.
- ✅ Mentions légales du site : SIREN, forme (EI), adresse — conformes.
- ⚠️ **Seuils 2025 (prestations de services)** : franchise tant que le CA
  annuel ≤ 37 500 € (conservée jusqu'à 41 250 €) — compteurs **communs à
  toute l'activité APlasma** (découpe plasma + SaaS, même SIREN). Au-delà :
  TVA à collecter, factures avec TVA. À surveiller et confirmer avec le SIE /
  un comptable.
- 🌍 **Clients hors France** (franchise conservée, Stripe Tax OFF) :
  - UE B2C : pas de TVA tant que les ventes B2C intra-UE de services
    électroniques < 10 000 €/an ; au-delà → TVA du pays du client via OSS
    (franchise non opposable à l'étranger).
  - UE B2B : autoliquidation chez le client — facture HT avec les deux n° de
    TVA ; **DES à déposer** dès la première vente.
  - Hors UE : hors champ TVA française ; seuils locaux lointains (sales tax
    US ~100 k$/État).
  - Les commissions Stripe (Stripe Payments Europe) et tout service acheté à
    l'étranger sont à **autoliquider** même en franchise (annexe 3310-A-SD),
    TVA non récupérable.
- 📁 Conservation : factures à garder 10 ans — Stripe les conserve, prévoir un
  export périodique (Dashboard → Factures, ou Sigma/API).

## 6. Abby — livre des recettes (URSSAF)

Chaque encaissement Stripe (`invoice.payment_succeeded`, montant > 0 € — les
factures d'essai à 0 € sont ignorées) est poussé automatiquement dans le
livre des recettes Abby : catégorie **BIC services**, moyen de paiement
**Stripe**, référence = n° de facture Stripe. Stripe reste le seul système de
facturation → pas de double numérotation ; les déclarations URSSAF Abby se
préremplissent avec ces recettes.

- **Clé** : `NUXT_ABBY_API_KEY` (`suk_...`, app.abby.fr → Paramètres →
  Intégrations). ⚠️ Révoquer la clé partagée en conversation le 03/08/2026 et
  coller une clé **régénérée** dans `.env`. Vide = intégration désactivée
  (les encaissements sont marqués `skipped_no_key`).
- **Test de la clé** (PowerShell) :
  ```powershell
  $env:ABBY_API_KEY="suk_xxx"; node scripts\test-abby-income.mjs; Remove-Item Env:ABBY_API_KEY
  ```
  Crée puis supprime une recette de 19,19 € ; `--keep` pour la voir dans
  l'app avant suppression.
- **Dédup** : collection Mongo `accounting_entries` (index unique
  `uniq.stripeInvoiceId`, posé par mongo-init) — Abby n'a **pas** de
  `GET /incomeBook`, la dédup est donc trackée chez nous. Statuts :
  `sent` / `failed` (champ `error`) / `skipped_no_key`. Pour rejouer une
  entrée `failed` : supprimer le document, puis Dashboard Stripe →
  Developers → Webhooks → renvoyer l'événement.
- **Devises** : EUR tel quel ; autre devise → montant réellement encaissé en
  EUR (balance transaction du charge Stripe).
- **Remboursements** : non automatisés (rares) — correction manuelle dans
  Abby (suppression de la recette).

## 7. Bascule : nettoyage des données de test + vérification

**Nettoyer les traces Stripe de test en Mongo** (au moment de la bascule —
les `cus_` / `sub_` de test sont inconnus du mode live ; `refreshSubscription`
les gère sans crash mais les utilisateurs test garderaient un état trompeur).
Quoting compatible PowerShell (string simple quote, `$` littéraux) :

```powershell
docker compose exec mongo mongosh nest2d --quiet --eval 'db.users.updateMany({ stripeCustomerId: { $exists: true } }, { $unset: { stripeCustomerId: "", subscription: "" } }); db.subscription_checkouts.deleteMany({});'
```

**Redémarrage et vérifications** (PowerShell) :

```powershell
docker compose up -d app admin

# 1. Plan sync au boot : les deux lignes doivent apparaître
docker compose logs app --tail 100 | Select-String "subscription-plan-sync"

# 2. Catalogue public : standard/privacy available=true, montants 19 / 39
Invoke-RestMethod http://localhost:7100/api/payment/plans | ConvertTo-Json -Depth 5
```

(Inutile de toucher `subscription_plan` : le sync live écrase les documents
`subscription` / `subscription:privacy` au prochain boot.)

**Parcours d'achat réel** avec une vraie carte :
1. checkout Stripe s'affiche avec le bon produit, l'essai 7 j et le logo ;
2. webhook livré (Dashboard → Webhooks → tentatives = 200) ;
3. en base : `users.subscription.status = trialing` ;
4. facture/reçu Stripe porte le pied 293 B et le SIREN ;
5. e-mail de reçu reçu ;
6. **Abby** : la recette apparaît dans le livre des recettes (BIC services,
   Stripe, réf. = n° de facture) et `accounting_entries` contient le document
   avec `status: 'sent'`.

Puis annuler l'abonnement depuis l'app (`cancel.post.js` →
`cancel_at_period_end`) et se **rembourser** le paiement dans le Dashboard
pour ne pas payer son propre abonnement.

## 8. Retour arrière

Remettre les anciennes clés **test** dans `.env` et redémarrer — les produits
live restent sans effet côté mode test (comptes cloisonnés).
