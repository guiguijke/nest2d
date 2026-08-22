# Spec v2 — Coffre zero-knowledge (fichier-clé)

> **Statut 2026-08-22 : LIVRÉ** (opt-in tous plans, D-PRV-7 en prod).
> Référence crypto / cycle de vie. Promesses : `docs/THREAT-MODEL.md`.
> Posture sécu : `docs/CYBERSECURITY.md`. Le badge marketing Pro n'est
> plus « Confidentialité+ » mais **Compute+**.
>
> ⚠️ **Mise à jour 2026-08-05 — le §5 (gating commercial) est REMPLACÉ** :
> le vault ZK est **opt-in sur TOUS les plans** (la privacy n'est jamais
> une feature payante) ; le gate `hasPrivacyTier` est retiré [prod].
>
> ✅ **Mise à jour 2026-08-11 — D-PRV-7 LIVRÉ** : le mécanisme de session
> décrit historiquement au §2 (collection `session_keys`, DEK wrappée sous
> master key) est **remplacé** par : session DEK en **RAM process-local
> seule** (Map `{ userId → { dek, expiresAt } }`, TTL glissant 2 h, wipe
> explicite des buffers, zéro persistence — `session_keys` est droppée au
> boot) et **livraison aux workers par job via ECDH P-256 éphémère**
> (`POST /api/security/vault/job-dek`, parcel AES-256-GCM sous clé de
> transport HKDF — voir §2.2 et `docs/THREAT-MODEL.md` §4).
> `NUXT_ENCRYPTION_MASTER_KEY` / `ENCRYPTION_MASTER_KEY` n'ont plus aucun
> rôle (warning de deprecation au boot si encore définis). Le format de
> fichier chiffré (§3) est INCHANGÉ ; les verrous d'interop
> `scripts/crypto-interop/` couvrent désormais aussi le parcel job-dek
> (`verify_jobdek.mjs` / `verify_jobdek.py`, les deux directions).
>
> **Changement v2** : abandon du mode passphrase (Argon2id) au profit d'un
> **fichier-clé téléchargeable**. Le serveur ne stocke rien permettant de
> déchiffrer. Sans le fichier, les données sont illisibles ; si le fichier
> est perdu, les données sont perdues à jamais. Plus simple, plus fort,
> plus vendeur.

---

## 1. La promesse (marketing honnête)

> « Vos fichiers sont chiffrés avec une clé que **vous seul** détenez.
> Nous ne stockons aucune copie de cette clé : sans votre fichier-clé,
> vos données sont définitivement illisibles — même par nous, même avec
> accès à nos serveurs et à nos sauvegardes. Si vous perdez ce fichier,
> vos données sont perdues. »

Nuances à assumer en interne (et dans les CGV/FAQ en langage clair) :
- Pendant une session de travail déverrouillée, la clé vit en mémoire
  serveur (RAM process-local uniquement — jamais écrite sur disque ni en
  base, même chiffrée, depuis D-PRV-7) le temps de traiter les fichiers.
  « Rien de **persisté** » est la promesse exacte.
- TLS obligatoire sur tout le transport (déjà en place).

## 2. Architecture

```
Fichier-clé (détenu par l'utilisateur, généré dans SON navigateur)
  └── DEK : 256 bits aléatoires — chiffre tous ses fichiers (AES-256-GCM)

Serveur (ne persiste QUE) :
  users.encryption = { enabled: true, keyId, fingerprint, createdAt }
  Session DEK : Map RAM process-local { userId → { dek, expiresAt } }
    (TTL 2 h glissant, wipe des buffers — RIEN en base ; D-PRV-7)
```

- `keyId` : identifiant public court (8 hex) — affiché dans le nom du fichier.
- `fingerprint` : `SHA-256(DEK)` — sert uniquement à vérifier que le fichier
  présenté est le bon. Comparaison en temps constant. Un hash ne permet pas
  de remonter à la clé.
- La DEK elle-même n'est **jamais** persistée en clair : ni en base, ni en
  log, ni sur disque.

### 2.1 Format du fichier-clé

Nom : `nestorcut-vault-<keyId>.key.json` (rebrand 2026-08-05 — les anciens
types `aplasma-vault-key` et `nest2d-vault-key` restent acceptés à la
lecture, cf. `validTypes` dans `app/utils/vault.js`)

```json
{
  "type": "nestorcut-vault-key",
  "version": 1,
  "keyId": "a3f8c2e1",
  "key": "<base64 — 32 octets>",
  "createdAt": "2026-07-27T…"
}
```

### 2.2 Cycle de vie

**Activation (premium souscrit)** :
1. Le **navigateur** génère la DEK (WebCrypto `getRandomValues`) — la clé
   naît côté client.
2. Le navigateur construit le fichier-clé et force son téléchargement.
3. L'utilisateur confirme explicitement : ☐ « J'ai sauvegardé mon fichier-clé
   et je comprends que sa perte rend mes données irrécupérables. »
4. Le client envoie la clé une fois à `POST /api/security/vault/enable`
   (TLS) → le serveur calcule et stocke `keyId` + `fingerprint`, active
   `encryption.enabled`, ouvre la session RAM, puis **oublie** la clé.

**Déverrouillage (début de session de travail)** :
1. L'utilisateur glisse/sélectionne son `.key.json` (ou il est retrouvé dans
   le cache navigateur, cf. §2.3).
2. `POST /api/security/vault/unlock` → le serveur vérifie
   `SHA-256(clé) == fingerprint` → ouvre/rafraîchit la session RAM
   (TTL 2h glissant) → 200. Sinon 403 `wrong_key`.
3. Upload / nesting / téléchargement : OK tant que la session RAM est active.
   Expirée → 403 `vault_locked` → le front rouvre la modale de déverrouillage.

**Workers** (D-PRV-7) : la DEK ne transite plus JAMAIS par la base. Au claim
du job, le worker génère une paire ECDH P-256 éphémère (RAM seule) et écrit
la clé publique sur le doc (`workerKeyPub`), puis appelle
`POST {NEST_APP_URL}/api/security/vault/job-dek { jobSlug }`. Le serveur —
si une session RAM est active pour le propriétaire — répond `{ serverPub,
parcel }` : parcel = AES-256-GCM(clé de transport HKDF-SHA256(ECDH, info
"nest2d-job-dek-v1"), DEK, AAD = jobSlug). Le worker déwrappe en RAM,
déchiffre en mémoire, puis **wipe** en fin de job (succès ou échec) +
`$unset workerKeyPub`. Pas de session active → 409 `vault_locked` (le job
échoue proprement et est refundé). Rien d'exploitable n'est persisté : même
intercepté, le parcel est indéchiffrable sans les deux moitiés privées (RAM
des deux côtés — forward secrecy).

**Crypto-shredding gratuit** : suppression de compte, purge manuelle, ou
perte du fichier par l'utilisateur → les données sont mortes. La session RAM
s'évapore (wipe à l'expiration/au lock, perte au redémarrage) et les
fichiers chiffrés deviennent du bruit.

### 2.3 Confort UX (optionnel, côté client uniquement)

- ☐ « Mémoriser la clé dans ce navigateur » → la clé est stockée en
  **IndexedDB** (jamais envoyée au serveur sauf unlock explicite).
  Déverrouillage silencieux aux sessions suivantes. Avertissement : quiconque
  ouvre ce navigateur déverrouille le vault. Décochable à tout moment
  (« oublier ce navigateur »).
- Sans cette option : sélection du fichier à chaque session.

### 2.4 Perte de la clé

- **Aucune récupération possible** — c'est le produit. L'UI le répète à
  l'activation, dans les settings, et dans la FAQ.
- `POST /api/security/vault/disable` (après unlock) : propose
  (a) déchiffrer les fichiers et repasser en standard, ou
  (b) tout détruire (crypto-shredding).
- **Rotation** (suspicion de fuite) : après unlock, génération d'une nouvelle
  clé côté client → nouveau fichier-clé → job de re-chiffrement batch des
  fichiers existants → nouveau fingerprint. L'ancienne clé devient inutile.

## 3. Format de fichier chiffré (inchangé — GridFS par chunk)

```
chunk[i] = nonce_i (12 o) || ciphertext_i || tag GCM (16 o)
AAD      = fileId || ownerId || chunkIndex
```

Flag sur chaque document fichier : `enc: { v: 1, algo: "aes-256-gcm" }`.
Absence de flag = fichier legacy en clair, servi tel quel.

## 4. Points d'intervention dans le code

### 4.1 Serveur Nuxt

| Fichier | Changement |
|---|---|
| `server/utils/crypto.js` (nouveau) | `encryptChunk/decryptChunk` (AES-256-GCM + AAD), `fingerprint(dek)`. **Aucun KDF** (plus de passphrase). ~~wrap/unwrap master key~~ retiré par D-PRV-7 |
| `server/db/mongo.js` | Wrapper des buckets GridFS (upload/download chiffrant à la volée) |
| `server/api/security/vault/enable.post.js` (nouveau) | Enregistre fingerprint, active le vault, ouvre la session RAM |
| `server/api/security/vault/unlock.post.js` (nouveau) | Vérifie fingerprint (temps constant), refresh TTL. Rate-limit 10/min/IP |
| `server/api/security/vault/job-dek.post.js` (D-PRV-7) | Livraison DEK par job aux workers (ECDH P-256 éphémère + HKDF + parcel AES-GCM). 409 `vault_locked` hors session. Rate-limit 60/min |
| `server/plugins/vault-dprv7.js` (D-PRV-7) | Boot : warning si `NUXT_ENCRYPTION_MASTER_KEY` encore défini + drop idempotent de `session_keys` |
| `server/api/security/vault/status.get.js` (nouveau) | `{ enabled, locked, expiresAt }` |
| `server/api/security/vault/disable.post.js` (nouveau) | Déchiffrement complet ou destruction, au choix |
| Upload DXF + `server/api/files/**/*.get.js` | Chiffrement/déchiffrement transparent ; 403 `vault_locked` si premium verrouillé |
| `nest.post.js` ×2 | 403 `vault_locked` si verrouillé ; refresh TTL à l'enqueue |
| `server/api/user/index.get.js` | Expose `encryption: { enabled, locked }` |

### 4.2 Frontend

| Fichier | Changement |
|---|---|
| Activation (page Sécurité) | Génération clé WebCrypto, téléchargement forcé, checkbox de confirmation |
| `VaultUnlock.vue` (nouveau) | Drop-zone du fichier-clé, option « mémoriser dans ce navigateur » (IndexedDB) |
| Settings | Statut vault, rotation de clé, « oublier ce navigateur », disable |
| Pricing | Tier 39 € avec la promesse du §1 |

### 4.3 Workers Python (×4)

`worker_common/crypto.py` (AESGCM, `cryptography`) — D-PRV-7 : livraison de
la DEK **par job** via ECDH éphémère contre l'app (`NEST_APP_URL`, voir
§2.2) ; `prepare_job_dek` au claim (écrit `workerKeyPub`), `get_dek(db, doc)`
à la demande (cache RAM essuyable), `wipe_job_dek` en fin de job. Plus aucune
lecture `session_keys`, plus de master key. Chiffrement des **résultats**
aussi. **Test d'interop JS ↔ Python obligatoire** sur vecteur fixe (mêmes
tailles nonce/tag, même AAD) — frames ET parcel job-dek.

## 5. Gating commercial (inchangé)

Produit Stripe « Confidentialité+ » 39 €/mois récurrent,
`metadata: { type: "subscription", tier: "privacy" }`.
⚠️ Prérequis : étendre `6_subscription_plan_sync.ts` au multi-plans (il ne
prend aujourd'hui que le premier candidat) et mapper `subscription.priceId`
→ tier dans `entitlement.js`. Le tier ne débloque que le chiffrement ;
l'illimité nesting reste commun aux deux abos.

## 6. Hors scope v1

- E2E intégral (nesting WASM dans le navigateur — jagua-rs a un build wasm)
- KMS externe pour la clé maître
- Partage de fichiers entre utilisateurs
- Audit log d'accès (quick win B2B à caser si temps)

## 7. Checklist implémentation

1. [x] ~~`NUXT_ENCRYPTION_MASTER_KEY` (app) + `ENCRYPTION_MASTER_KEY`
      (workers)~~ **supprimés par D-PRV-7** (warnings de deprecation au boot
      si encore présents ; `NEST_APP_URL` ajouté aux workers)
2. [x] `server/utils/crypto.js` + tests round-trip + vecteur interop Python
3. [x] Wrapper buckets GridFS + flag `enc`
4. [x] Endpoints vault (enable/unlock/status/disable) + rate-limit +
      comparaison fingerprint temps constant + **aucun log de la clé**
5. [x] ~~Collection `session_keys` + index TTL~~ **remplacée par la session
      RAM process-local (D-PRV-7)** + livraison ECDH par job (`job-dek`)
6. [x] 403 `vault_locked` sur upload/nesting/download premium verrouillé
7. [x] Front : activation (génération + téléchargement + checkbox),
      `VaultUnlock.vue`, IndexedDB opt-in, settings
8. [x] `utils/crypto.py` ×4 workers + chiffrement des résultats
9. [x] Multi-plans Stripe (sync + mapping tier) — ⚠️ reste à créer le produit 39 € dans le dashboard Stripe (metadata: type=subscription, tier=privacy)
10. [x] Rotation de clé + re-chiffrement batch
11. [x] Page marketing + FAQ « clé perdue = données perdues »
