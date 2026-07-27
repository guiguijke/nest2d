# Spec — Tier « Confidentialité+ » : chiffrement des fichiers utilisateurs

> **Statut** : spécification pour implémentation (worker agent)
> **Contexte** : tier premium à 39 €/mois (2× l'Atelier à 19 €) vendant une
> garantie de confidentialité des DXF/plans clients. Étude de marché :
> l'objection n°3 au SaaS de nesting est « uploading proprietary designs to a
> third-party server » — c'est le différenciateur à monétiser.

---

## 1. Modèle de menace (à assumer honnêtement)

| Menace | Couverte ? |
|---|---|
| Dump/vol de la base Mongo ou des backups | ✅ oui (fichiers chiffrés au repos) |
| Vol d'un snapshot disque du serveur | ✅ oui |
| Admin/opérateur qui fouille les fichiers | ✅ en mode zero-knowledge, ⚠️ partiellement en mode standard |
| Serveur compromis à chaud (runtime) | ❌ non — le serveur doit déchiffrer pour nester |
| Interception réseau | ✅ TLS (déjà en place via reverse proxy) |

**Le marketing ne doit jamais promettre « impossible à lire même pour nous » en
mode standard.** En mode standard on promet : « chiffré au repos, suppression
définitive garantie par destruction de clé ». Le « même nous ne pouvons pas
lire » est réservé au mode zero-knowledge.

**Limite physique** : le nesting exige la géométrie en clair. Le vrai E2E
(chiffrement côté navigateur, nesting sans déchiffrement serveur) est
impossible sans porter le nesting dans le navigateur. Piste long terme :
jagua-rs compile en WASM (`workers/nesting/jagua-rs` a déjà un workflow
`wasm.yml`) → nesting client-side = E2E réel. Hors scope v1.

## 2. Architecture : chiffrement enveloppe par utilisateur

```
Utilisateur premium
  └── DEK (Data Encryption Key) : 256 bits aléatoire, unique par utilisateur
        ├── chiffre tous les fichiers (AES-256-GCM)
        └── wrappée par une KEK :
              ├── mode standard : KEK = clé maître serveur (env NUXT_ENCRYPTION_MASTER_KEY)
              └── mode zero-knowledge : KEK = Argon2id(passphrase utilisateur, sel)
```

### 2.1 Format de fichier chiffré (GridFS)

Les fichiers transitent par GridFS en **chunks de 255 Ko**. On chiffre **par
chunk** pour rester compatible avec le streaming existant :

```
chunk[i] = nonce_i (12 o) || ciphertext_i || tag GCM (16 o)
nonce_i  = aléatoire 96 bits par chunk
AAD      = fileId || ownerId || chunkIndex   (anti-substitution de chunks)
```

Métadonnées sur le document fichier (`user_dxf_files`, `fs.files`) :

```json
"enc": { "v": 1, "algo": "aes-256-gcm", "mode": "standard" | "zk" }
```

Un fichier sans champ `enc` est un fichier legacy en clair → le reader le
sert tel quel (rétro-compatibilité totale, pas de migration obligatoire).

### 2.2 Hiérarchie de clés — document utilisateur

```json
"encryption": {
  "mode": "standard" | "zk",
  "wrappedDek": "<base64>",           // DEK wrappée par la KEK
  "wrapAlgo": "aes-256-gcm",
  "kdf": { "algo": "argon2id", "salt": "<base64>", "m": 65536, "t": 3, "p": 4 },  // mode zk seulement
  "createdAt": "..."
}
```

- **Mode standard** : KEK dérivée de `NUXT_ENCRYPTION_MASTER_KEY` (env, 32 o
  hex). Rotation possible en re-wrappant les DEK.
- **Mode zero-knowledge** : KEK = Argon2id(passphrase). La DEK n'existe en
  clair qu'en mémoire, jamais persistée en clair.

### 2.3 Distribution de la DEK aux workers (le point délicat)

Les workers Python sont des processus séparés : ils ne partagent pas la
mémoire Node. Solution : collection Mongo `session_keys` à **TTL court** :

```json
{ "userId": "...", "dek": "<DEK chiffrée avec la clé maître serveur>",
  "expiresAt": "<Date>" }   // index TTL expireAfterSeconds=0 sur expiresAt
```

- Écrite/rafraîchie par l'app à l'upload ou à l'enqueue d'un nesting (TTL 2h
  glissant).
- Les workers la lisent, déchiffrent la DEK avec la clé maître (env partagée),
  traitent, oublient.
- En mode zk : l'entrée n'existe que si l'utilisateur a « déverrouillé » sa
  session. Sans unlock → l'API refuse l'upload/nesting premium (403
  `vault_locked`).
- En mode standard : l'entrée est écrite automatiquement (transparent).

> ⚠️ En mode zk, pendant la fenêtre TTL, un dump Mongo contient la DEK
> wrappée par la clé maître — la promesse zk vaut donc « hors session active
> ». C'est le compromis standard du secteur (Bitwarden fait pareil en mémoire).

## 3. Points d'intervention dans le code

### 3.1 Serveur Nuxt

| Fichier | Changement |
|---|---|
| `server/utils/crypto.js` (nouveau) | `encryptChunk/decryptChunk` (AES-256-GCM, AAD), `wrapDek/unwrapDek`, `deriveKek` (argon2 — paquet `argon2`), lecture `NUXT_ENCRYPTION_MASTER_KEY` |
| `server/db/mongo.js` | Factory de buckets : wrapper `openUploadStream`/`openDownloadStream` qui chiffre/déchiffre à la volée si `user.encryption` actif |
| Upload DXF (`server/api/files/...` upload handlers) | Passage par le wrapper chiffrant + flag `enc` sur le doc |
| `server/api/files/**/*.get.js` (download, svg, dxf, zip) | Déchiffrement transparent à la lecture |
| `server/api/security/unlock.post.js` (nouveau) | Vérifie la passphrase (unwrap DEK), crée l'entrée `session_keys` |
| `server/api/security/status.get.js` (nouveau) | État du vault (verrouillé/déverrouillé, mode) |
| `nest.post.js` ×2 | Refresh TTL `session_keys` à l'enqueue ; 403 `vault_locked` si zk verrouillé |
| `server/api/user/index.get.js` | Exposer `encryptionMode` + `vaultLocked` au client |

### 3.2 Workers Python (×4 : fileprocessing, nesting, stripfileprocessing, stripnesting)

| Fichier | Changement |
|---|---|
| `utils/crypto.py` (nouveau, identique ×4) | AESGCM (`cryptography`), lecture `session_keys`, unwrap via clé maître (env `ENCRYPTION_MASTER_KEY`) |
| `utils/mongo.py` | Helper `read_file(bucket, file_id)` qui déchiffre si `enc` présent ; `write_file` qui chiffre si l'owner est premium |
| Workers nesting | Écrire les **résultats** chiffrés aussi (sinon le DXF nesté fuit en clair) |

### 3.3 Frontend

| Fichier | Changement |
|---|---|
| Page Settings/Sécurité | Activation premium, choix du mode, saisie passphrase (zk), **clé de récupération affichée une fois** (mode zk) |
| Composant `VaultUnlock.vue` | Modale de déverrouillage quand `vaultLocked` |
| Page pricing | Tier « Confidentialité+ » 39 €/mois avec la promesse exacte du §1 |

## 4. Gating commercial

1. **Stripe** : produit « Confidentialité+ » prix récurrent 39 €/mois,
   `metadata: { type: 'subscription', tier: 'privacy' }`.
2. **Blocage actuel** : `server/plugins/6_subscription_plan_sync.ts` ne gère
   qu'UN plan (prend le 1er candidat). À étendre : sync de plusieurs plans
   dans `subscription_plan` (doc par tier) et `mapSubscription` doit stocker
   le `priceId` → mapping priceId → tier (déjà persisté : `subscription.priceId`).
3. `entitlement.js` : `assertCanNest` reste inchangé (illimité pour tout abo
   actif) ; le tier ne débloque que le chiffrement (`user.encryption` activé
   quand `subscription.priceId ∈ PRICES_PRIVACY`).
4. **Downgrade** (privacy → atelier) : re-wrap des DEK zk → standard pour que
   les fichiers restent lisibles ; proposer l'option « tout supprimer »
   (crypto-shredding).

## 5. Crypto-shredding (argument de vente n°2)

Suppression de compte ou « purge » manuelle : `UNSET encryption.wrappedDek` +
purge `session_keys` → **tous les fichiers deviennent définitivement
illisibles**, y compris dans les backups à venir. Bien plus fort qu'un
`delete` dont les données persistent dans les backups. À exposer dans l'UI :
« Suppression définitive garantie par destruction de clé ».

## 6. Rétro-compatibilité et migration

- Fichiers legacy en clair : servis normalement, **jamais re-chiffrés en
  masse** (coûteux) ; re-chiffrement paresseux à la prochaine réécriture.
- Option « chiffrer mes fichiers existants » : job batch par utilisateur qui
  relit + réécrit chaque fichier (à faire worker-side, par user, à la demande).

## 7. Hors scope v1 (à noter pour plus tard)

- E2E réel via nesting WASM dans le navigateur (jagua-rs a un build wasm)
- KMS externe (Vault, AWS KMS) pour la clé maître
- Audit log d'accès aux fichiers (bel argument B2B, facile : log dans
  les download handlers)
- Partage de fichiers entre utilisateurs (re-wrap par fichier)

## 8. Checklist implémentation

1. [ ] `NUXT_ENCRYPTION_MASTER_KEY` + `ENCRYPTION_MASTER_KEY` (workers) dans
      `.env.example` et docker-compose (générer : `openssl rand -hex 32`)
2. [ ] `server/utils/crypto.js` + tests unitaires round-trip
3. [ ] Wrapper buckets GridFS + flag `enc`
4. [ ] `utils/crypto.py` workers (round-trip compatible JS ↔ Python : mêmes
      tailles nonce/tag, même AAD — **tester l'interop sur un vecteur fixe**)
5. [ ] Endpoints unlock/status + TTL index `session_keys`
6. [ ] Gating upload/nesting (403 `vault_locked`)
7. [ ] Multi-plans Stripe (sync + gating tier)
8. [ ] UI : page sécurité, modale unlock, pricing 39 €, récupération
9. [ ] Crypto-shredding (purge compte)
10. [ ] Page marketing : promesses calquées sur le §1, rien de plus
