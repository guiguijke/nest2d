# Cybersécurité — état de l'application (NestorCut)

> **Interne.** Ne pas republier tel quel (chemins, défauts, backlog).
> Promesses privacy utilisateur : `docs/THREAT-MODEL.md`.
> Décisions produit : `docs/STRATEGY.md` + `specs/` (local).
>
> **Photo au 2026-08-22**, prod `app.nestorcut.com` derrière Cloudflare →
> Caddy → Nuxt, commit `c9b15c9`. Pentest white-box + black-box
> 2026-08-21/22, verrous livrés le 22.

## 1. Périmètre

| Surface | Rôle |
|---|---|
| `app.nestorcut.com` | App Nuxt 4 / Nitro, Node 24 |
| Admin `:7200` | App séparée, **non exposée** Internet (WireGuard / bind interne) |
| Mongo 7 | Réseau docker interne, **sans auth** (voir §7) |
| Workers Python + `nest-engine` (Rust) | 1 job / process ; fileprocessing lance `dwgread` |
| Navigateur | Import wasm, solve wasm, IndexedDB `nestorcut-local` |

Hors périmètre ici : le site marketing `nestorcut.com`, Stripe (HMAC
webhook), Resend, listmonk.

## 2. Frontières de confiance

```
Navigateur ──TLS──► Cloudflare ──► Caddy ──► app (Nuxt)
                                              │
                         ECDH job-dek (HTTP docker) ──► workers
                                              │
                                              └── Mongo (docker net, no auth)
```

- Le client n'est pas une autorité : `params.vcores` / quota / tier sont
  écrits **serveur**.
- Un projet `local` : la géométrie ne franchit pas la frontière TLS
  (sauf métadonnées). Un projet cloud : le DXF franchit TLS puis GridFS.
- Vault ouvert : le clair existe en RAM app et, le temps d'un job, en RAM
  worker.

## 3. Authentification & sessions

- Cookie `sessionId` httpOnly, `secure` en production, SameSite Lax.
- Login local : bcrypt coût 10, comparaison contre un hash factice si
  l'email n'existe pas (anti-énumération).
- Rate-limit (in-mémoire, process unique) :
  - login : 5 / 15 min par email, 20 / 15 min par IP ;
  - register : 5 / h par IP ;
  - forgot : 3 / h par email ;
  - `/api/files/**` : 30 / min par session (IP en secours).
- IP : **`CF-Connecting-IP`**, sinon **dernier** hop `X-Forwarded-For`
  (le premier hop est spoofable — confirmé en prod avant correctif).
- Google OAuth : Authorization Code + PKCE S256 + paramètre `state`.
- Compte local : `emailVerified` exigé avant nest (anti-fake).
- Admin : collection `admins` séparée ; `NUXT_ADMIN_LAN_OPEN` défaut
  **false**. En prod l'admin n'écoute pas le public.

## 4. Isolation entre utilisateurs

| Contrôle | État |
|---|---|
| Requêtes Mongo filtrées `ownerId` | Solide |
| Projet étranger (`bin` comme `strip`) | **404** (plus de fuite du nom) |
| Téléchargement GridFS | Lookup + owner ; non-owner = **404** (pas 401/500) |
| Slug fichier | Opaque `f-{16 hex}{ext}` (**64 bits**), plus `nom-6hex` |
| Cache download | `private, no-store` |
| Vault AAD GCM | `fileId\|ownerId\|frameIndex` — mauvaise DEK / mauvais owner = tag invalide |
| Démo | `ownerId` technique, lecture auth, jamais vault |

Un slug deviné n'est plus un jeton de 24 bits. Le brute-force est borné
par le rate-limit + l'entropie.

## 5. Fichiers uploadés (RCE / DoS)

- Détection par **signature** (`<svg`, `AC10`, sinon DXF), jamais
  l'extension seule.
- Taille : **5 Mo / fichier**, 20 fichiers, `nitro.maxRequestSize` 101 Mo.
- SVG : rejet `<!ENTITY` avant svgelements (pas d'XXE externe —
  ElementTree ; billion laughs bloqué).
- DXF : profondeur INSERT ≤ 32, explode ≤ 4000 entités, **puis**
  `MAX_ENTITY_LIMIT` 999.
- DWG : `dwgread` (LibreDWG 0.13.3, forme liste, timeout 60 s) — surface
  C restante. **Mitigation** : process **non-root** (`USER appuser`),
  `cap_drop: ALL`, `no-new-privileges`, `mem_limit: 2g`, `pids_limit: 512`.
- Pas de `pickle` / `eval` / `shell=True` / `lxml` sur le chemin workers.
- Moteur Rust : JSON via serde — bas risque mémoire.

## 6. Headers & front

Présents en prod HTTPS : HSTS, CSP (wasm-unsafe-eval + unsafe-inline
Nuxt ; `connect-src` inclut `blob:` pour le fetch dxf-viewer des DXF
locaux), `X-Frame-Options: SAMEORIGIN`, `nosniff`, Referrer-Policy.
`x-powered-by` retiré.
Cookie tracking `nest2d_session_id` : `secure` (prod) + `sameSite=lax`,
lisible JS (funnel). Noms de fichiers affichés via templates Vue
échappés (`v-html` = drapeaux de langue uniquement).

## 7. Résidus (connus, non « oubliés »)

| Risque | Sévérité | Pourquoi ce n'est pas flippé |
|---|---|---|
| **Mongo sans auth** sur le net docker | Haute si worker/app RCE | Migration volume ; recette dans `.env.example` |
| Rate-limit in-mémoire | Moyenne | 1 instance app ; reset au restart |
| DEK en RAM 2 h (vault ouvert) | Inhérent au design | Documenté ; sticky sessions si réplicas |
| Parser C `dwgread` | RCE conditionnel | Non-root + caps + mem_limit ; sandbox par job = plus tard |
| Pas de SRI sur le WASM | Basse | Image Docker + HTTPS ; SRI casse les updates `/engine` |
| Emails « fin de nesting » | Produit | Chaîne morte (`AGENTS.md` #38) — **claim à ne plus marquer [prod]** |

## 8. Vérifs rapides (prod)

```bash
curl -sI https://app.nestorcut.com | grep -iE 'strict-transport|content-security|x-frame|x-content|x-powered'
curl -s https://app.nestorcut.com/api/service   # pas de commitSha anonyme
# authentifié : GET /api/files/project/dxf/f-<16 hex>.dxf d'autrui → 404
```

Worker fichier : `docker inspect … --format '{{.Config.User}}'` → `appuser`.

## 9. Journal pentest → code (2026-08-22)

C-1 slugs + rate-limit files + 404 uniforme ; C-2 USER + cap_drop ;
H-2/H-3 auth + IP ; H-4 taille / ENTITY / INSERT ; M-1 headers ; M-2
cookie ; M-4 `rejectForeignProject` ; M-5 service ; M-6 OAuth `state` ;
M-7 admin LAN false ; M-8 devtools hors prod. Détail : `specs/90-decisions.md`
(entrée 2026-08-22).
