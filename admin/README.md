# NestorCut — Panneau d'administration

Panneau d'administration autonome (Nuxt 4) pour la plateforme NestorCut.
Il partage la **même base MongoDB** que l'application principale mais possède sa
propre authentification (collection `admins`), son propre process et son propre
port — non exposé au public par défaut.

## Démarrage rapide (développement)

```bash
cd admin
cp ../.env .env          # réutilise les variables du projet (NUXT_MONGO_URI, etc.)
npm install
npm run dev              # http://localhost:7200
```

### Créer le premier compte administrateur

La création du premier admin se fait **dans le conteneur**, via une page de
configuration intégrée au panneau. Elle n'est disponible que tant qu'aucun
admin n'existe, et est protégée par un jeton à usage unique.

```bash
# 1. Démarrez le panneau (dev : npm run dev, prod : docker compose up -d admin)

# 2. Récupérez le jeton de configuration affiché dans les logs au boot
#    (uniquement tant qu'aucun admin n'existe) :
docker compose logs admin | grep -A12 "FIRST-TIME SETUP"

# 3. Ouvrez la page de configuration et collez le jeton :
#    http://localhost:7200/setup
#    → renseignez email, nom, mot de passe → le compte est créé.

#    Ou en CLI :
curl -X POST http://localhost:7200/api/setup/first-admin \
  -H "Content-Type: application/json" \
  -H "X-Setup-Token: <le-jeton-des-logs>" \
  -d '{"email":"you@example.com","name":"Admin","password":"un-mot-de-passe-fort"}'
```

Une fois le premier admin créé, la page `/setup` est verrouillée et le jeton
devient inutile. Connectez-vous ensuite normalement à `/login`.

## Fonctionnalités

| Page | Description |
|------|-------------|
| **Tableau de bord** (`/`) | KPIs temps réel (utilisateurs, jobs, activité) via SSE |
| **Utilisateurs** (`/users`) | Liste paginée, recherche, filtres (statut, provider, pays) |
| **Fiche utilisateur** (`/users/[id]`) | Profil, activité, abonnement, actions (bannir, crédits, mois gratuit, déconnexion) |
| **Jobs** (`/jobs`) | File d'attente + traitement (nesting + strip), rafraîchi automatiquement |
| **Géographie** (`/geo`) | Répartition des clients par pays (cf-ipcountry) |
| **Logs** (`/logs`) | Requêtes HTTP + événements de tracking |
| **Support** (`/support`) | Messagerie avec tous les utilisateurs |
| **Paiements** (`/payments`) | Transactions crédits + résumé des abonnements |

## Mois gratuit (hybride)

L'action « Offrir un mois » depuis une fiche utilisateur :

- **Abonné Stripe actif** → applique un coupon Stripe `aplasma_free_month`
  (100 % sur un cycle), visible dans le dashboard Stripe.
- **Compte sans abonnement** (local / Google sans paiement) → positionne
  `grantedUntil = aujourd'hui + 30 j` sur le document utilisateur. L'application
  principale honore ce champ (`server/utils/entitlement.js` → accès illimité
  jusqu'à la date).

## Notifications email

- **Inscription** : l'application principale envoie immédiatement un email à
  `NUXT_ADMIN_NOTIFY_EMAIL` à chaque inscription (locale ou Google).
- **File de sécurité** : le panneau envoie toutes les 5 min un **digest** des
  inscriptions non déjà signalées (au cas où l'email instantané ait échoué).
  Un curseur (`admins.digestCursor`) garantit qu'un même utilisateur n'est
  signalé qu'une fois.

## Modération

- **Bannir** : positionne `banned: true` et déconnecte l'utilisateur partout.
  Les connexions ultérieures (locale + Google) sont refusées ; les sessions
  existantes ne se résolvent plus.
- **Crédits** : ajustement direct du solde (`balance`).
- **Déconnexion** : vide le tableau `sessions` du compte.

## Sécurité / exposition réseau

Le panneau écoute par défaut **uniquement sur localhost** :

- En dev : `127.0.0.1:7200`.
- En Docker : `127.0.0.1:7200:3000` dans `docker-compose.yml`.

Il n'est **jamais** exposé via l'ingress public. Pour y accéder à distance,
ajoutez une règle reverse-proxy / VPN / Tailscale, à votre convenance.

## Déploiement (Docker)

Le service `admin` est défini dans le `docker-compose.yml` racine. Il rejoint
le réseau interne `nest2d` et atteint `mongo` en interne.

```bash
# Construire/publier l'image se fait via la CI (.github/workflows/build-images.yml)
docker compose pull admin
docker compose up -d admin

# Créer le compte admin dans le conteneur :
docker compose run --rm admin node scripts/bootstrap-admin.js
```

## Variables d'environnement

| Variable | Rôle |
|----------|------|
| `NUXT_ADMIN_MONGO_URI` | URI Mongo (défaut : `NUXT_MONGO_URI`) |
| `NUXT_ADMIN_SESSION_SECRET` | Secret de signature des cookies admin (32 octets hex) |
| `NUXT_ADMIN_NOTIFY_EMAIL` | Destinataire des notifs/digest |
| `NUXT_ADMIN_BASE_URL` | URL publique du panneau (liens dans les emails) |
| `NUXT_STRIPE_SECRET_KEY` | Clé Stripe (mois gratuit via coupon) |
| `NUXT_RESEND_TOKEN` / `NUXT_RESEND_FROM` | Envoi des emails (digest support) |

## Architecture

```
admin/
  app/                 # UI Nuxt (pages, layouts, composants, composables)
    pages/             # login, index(dashboard), users, jobs, geo, logs, support, payments
    middleware/admin-auth.ts
  server/
    db/mongo.ts        # connexion partagée (mêmes collections que l'app principale)
    middleware/1_auth.ts
    api/               # auth, stats, users, jobs, geo, logs, support, payments
    utils/             # sessions, auth, stripe, stats
    plugins/1_signupDigest.ts
  scripts/bootstrap-admin.js
```

L'application principale a été **débarrassée de son rôle admin** (page
`/admin/support`, routes `server/api/support/admin/*`, flag `isAdmin`,
`scripts/promote-admin.js` supprimés). Toute l'administration passe désormais
par ce panneau.
