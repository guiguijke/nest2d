# ARCHITECTURE — NestorCut (état au 2026-08-30)

Référence de l'architecture **déployée** : topologie, composants, flux de
données, frontières de sécurité. Le « pourquoi » des décisions vit dans
`specs/` ; les pièges techniques dans `AGENTS.md` ; le runbook d'exploitation
dans `docs/DEPLOY-HETZNER.md` ; la cartographie fine du pipeline géométrique
dans `docs/PIPELINE-MAP.md`.

---

## 1. Vue d'ensemble

```
                    Internet (app.nestorcut.com, Cloudflare proxied)
                                        │
                                        ▼
        ┌───────────────────────── Hetzner CX23 (2 vCPU) ─────────────────────────┐
        │  Caddy (80/443, TLS) ──► app Nuxt (127.0.0.1:7100)                      │
        │                             │                                          │
        │                             ▼                                          │
        │  MongoDB (réseau docker interne) ◄──── workers :                        │
        │        ▲                       │   · nesting-worker ×1 (natif Rust)     │
        │        │ socat <IP-VPN>:27018 │   · file-processing (DXF→polygonParts)  │
        │        │ (mongo-wg)           │   · strip-file-processing               │
        │        │                       │   · strip-nesting (spyrrow)             │
        │        │                       ▼                                          │
        │  admin (<IP-VPN>:7200, profil docker, JAMAIS public)                     │
        └─────────┬───────────────────────▲──────────────────────────────────────┘
         wg0 (51820/udp)                  │ WireGuard
                  │                       │
   <IP-VPN> pont admin   <IP-VPN> DÉBORDEMENT (tunnel dédié, 100 % Docker)
   (mini-pc maison,     ┌───────────────── Homelab (jail jailmaker TrueNAS,
    forward 7200)       │                  <IP-HOMELAB>, 48 threads) ──────────┐
                        │                  │  linuxserver/wireguard (client)     │
                        └──────────────────┤  overflow-worker ×3 (6 CPU/2 Go,    │
                                           │   MONGO_URI <IP-VPN>:27018)         │
                                           └─────────────────────────────────────┘

   Navigateur utilisateur : mode « THIS DEVICE » = moteur wasm in-browser
   (import 100 % client optionnel, solve en web workers, IndexedDB)
```

## 2. Composants

### Front (Hetzner)

| Composant | Rôle | Détails |
|---|---|---|
| **Caddy** | reverse proxy public | réseau host, 80/443, TLS Let's Encrypt ; seul point d'entrée Internet |
| **app** (Nuxt 4) | UI + API Nitro | bind `127.0.0.1:7100` uniquement ; SSE pour la vue live ; entitlement/quotas/paiements côté serveur (jamais le client) |
| **admin** (Nuxt) | back-office | bind `<IP-VPN>:7200` (IP WireGuard), profil docker `admin`, `NUXT_ADMIN_LAN_OPEN=true` (confiance réseau VPN, pas de login) |
| **MongoDB** | stockage unique | fichiers GridFS + collections métier ; interne au réseau docker |

### Workers (Hetzner) — 1 job à la fois par processus

| Worker | Rôle |
|---|---|
| **file-processing** | upload → copie canonique mm (`validDxf`) → `polygonParts` (shapely) + SVG aperçu ; détecte DXF/SVG/DWG par magic bytes ; signature → reroute `1k_entity_count` |
| **nesting** | orchestrateur Python → moteur Rust **nest-engine** (natif) → DXF/SVG résultats, alternatives, rapport matière, vue live (frames en Mongo `liveLayout`, lues par l'app en SSE) |
| **strip-file-processing / strip-nesting** | variante « bande » (spyrrow PyPI pour le solve) — pipeline distinct, fichiers `stripUserDxf`/`stripNestDxf` |

### Débordement (homelab, 2026-08-30)

3 workers **nesting** identiques à ceux de la prod, qui consomment la MÊME
collection `nesting_jobs`. Répartition naturelle : le premier worker libre
(Hetzner ou homelab) claim le job (`find_one_and_update` atomique). Le
homelab n'héberge **aucune donnée** : il lit/écrit dans le Mongo de la prod
à travers le tunnel. Éteint, la prod fonctionne comme avant. Voir
`docs/DEPLOY-HETZNER.md` § Débordement.

### Moteur (Rust, workspace `workers/nesting/engine`)

- **nest-engine** : modes **SPP** (bande, minimise la largeur — sparrow) et
  **BPP** (multi-tôles — recuit simulé maison + constructif `HoleFillEvaluator`) ;
  post-pass déterministes (`column_fill`), export alternatives classées par
  classe de biais. Pile : jagua-rs 0.7.2 **vendored** (patch wasm
  mono-thread + libm pour le déterminisme cross-device).
- **Compilation** : natif (workers, via image Docker) ET
  `wasm32-unknown-unknown` (navigateur, artefact committé
  `public/engine/nest_wasm_bg.wasm`, rechargé avec `cache:'reload'`).
- **Déterminisme** : transcendantales via crate `libm` des deux côtés ; verrou
  `workers/nesting/bench/determinism_lock.py` (natif vs wasm, bit-identical).

### Workspace géométrie (Rust, `workers/geometry`)

Répliques dual-target (natif + wasm) de l'import/export géométrique Python
(import DXF canonique, canaux capillaires, export DXF/SVG, métriques) pour le
chemin 100 % navigateur (J-090) et la parité bit-exacte — voir
`docs/PIPELINE-MAP.md`.

## 3. Flux de données

### Nesting serveur (« Nos serveurs »)

1. Upload → `file-processing` → `polygonParts` (mm canonique) en base +
   copie normalisée `validDxf` (GridFS).
2. `POST /api/project/[slug]/nest` : le serveur écrit `params.vcores` selon
   le tier (jamais le client), crée le job `pending`.
3. Un worker (Hetzner **ou** homelab) claim atomiquement, acquiert des
   jetons dans le pool `compute_pool`, solve, écrit alternatives + rapport +
   `liveLayout` (frames 2 Hz) en base, libère les jetons.
4. L'app pousse les frames en SSE à la vue live ; le modal final sert les
   DXF/SVG depuis GridFS.

### Nesting local (« THIS DEVICE »)

Le worker ne fait que **préparer** le payload (coût pool : 1 jeton) ; le
navigateur télécharge le payload, solve avec le moteur **wasm** en web
workers (pool multi-walks, registre global survivant à la navigation,
cloisonnement des réglages par projet), puis POST le résultat ; fichiers
résultats en IndexedDB (le serveur ne reçoit que la comptabilité). Import
100 % client optionnel (workspace géométrie wasm, J-090).

### Vue live (conventions)

Frames en **repère EXTERNE** (`int_to_ext`) des deux côtés (SPP `emit_layout`,
BPP `layout_event` — verrou Rust `bpp_live_frame_matches_final_export…`) ;
le flip Y SVG `translate(x, H−y) scale(1,−1) rotate(θ)` est obligatoire
(pièges #14g/20b/46).

## 4. Calcul réparti — pool de jetons

- Tier ⇒ vcores : free 1 / standard 4 / privacy(Pro) 8 — écrit serveur dans
  `params.vcores` ; `NEST_COMPUTE_TOKENS` (**28**, identique Hetzner et
  homelab — le total est réécrit en base au démarrage des workers) borne la
  concurrence globale via `compute_pool` (acquire atomique `$expr`, leases
  heartbeat 10 s, reaper 60 s, coût clampé au total).
- Un job local-prep coûte 1 jeton ; un job de calcul coûte son tier
  (clampé) ; 1 worker = 1 job en cours, le parallélisme vient des réplicas
  (1 en prod, 3 en débordement).

## 5. Réseau & sécurité

| Frontière | Règle |
|---|---|
| Internet → app | Cloudflare (proxied, Full strict) → Caddy 80/443 uniquement |
| Internet → admin | **Aucune route** ; admin bindé `<IP-VPN>:7200` (wg0), atteignable via le pont maison (`<IP-PONT-ADMIN>:7200`, LAN) ou tunnel SSH |
| wg0 Hetzner (51820/udp) | peers : VPN maison (<IP-VPN>/24), pont admin `<IP-VPN>`, débordement `<IP-VPN>` (AllowedIPs `<IP-VPN>/32` — le homelab ne route QUE l'IP du serveur) |
| Mongo | interne au docker network ; exposition unique `<IP-VPN>:27018` (socat `mongo-wg`) pour les workers overflow — jamais `0.0.0.0` (docker bypass ufw, piège runbook #1) |
| Workers → Mongo | Hetzner : réseau docker ; homelab : `mongodb://<IP-VPN>:27018` dans le netns du conteneur wireguard |
| Fichiers (`/api/files/**`) | slugs opaques + ownership ; anti-brute-force 30 req/min, budget authentifié séparé 180/min pour `project/{geometry,dxf,svg}` (consommation massive légitime par la page et le mode local) |
| Vault (option, ZK) | DEK par job, ECDH P-256 + HKDF, AAD contextuel — voir `docs/THREAT-MODEL.md` |

## 6. CI/CD & déploiement

- Push `main` → GitHub Actions « Build and publish Docker images » : tests
  (cargo + pytest avec le vrai moteur) puis build/push des **6 images** sur
  `ghcr.io/guiguijke/*` (`:latest` + `:<sha>`).
- Prod : `docker compose pull && docker compose up -d` sur Hetzner
  (`/opt/nestorcut`) ; débordement : idem dans `/containers/nestorcut-overflow`
  sur le homelab. Le runbook détaille les pièges (`--force-recreate` après
  `.env`, workflow à attendre avant pull, caches wasm même nom de fichier).
- Le wasm navigateur est un **artefact committé** (`public/engine/`) :
  toute modification du moteur ⇒ rebuild dans la même PR
  (`workers/nesting/engine/build-wasm.sh`) + `determinism_lock.py`.

## 7. Personas / comptes

- Comptes Google OAuth ou e-mail local (email vérifié requis pour nester).
- Le **projet démo** (owner virtuel `demo`, lecture seule) est nichable par
  tous avec son propre quota ; sélecteur de puissance Free/Unlimited/Pro
  (le solve a lieu dans le navigateur).
- QA : comptes dédiés (ex. `qa.audit@…`), grants admin via
  `grantedUntil`/`grantedTier` (mongosh, runbook §6).
