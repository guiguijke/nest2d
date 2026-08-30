# Déploiement production — Hetzner (2026-08-19, maj accès admin 2026-08-28)

Serveur de production NestorCut, migré depuis le serveur maison (panne carte mère).
Ce fichier est le runbook pour tout agent/humain qui doit intervenir sur le serveur.

## Accès SSH

- **Hôte** : `<IP-SERVEUR-FRONTAL>` (Hetzner Cloud CX23 — 2 vCPU / 4 Go RAM / Debian 13)
- **User** : `root`
- **Clé privée** : `C:\Users\guiguijke\OneDrive\Wallet\hetzner\id_ed25519`
  (la publique est à côté, `.pub`)
- Auth par **clé uniquement** (PasswordAuthentication off, fail2ban actif).

Exemple :
```bash
ssh -i "/c/Users/guiguijke/OneDrive/Wallet/hetzner/id_ed25519" root@<IP-SERVEUR-FRONTAL>
```

## Ce qui tourne sur le serveur

| Composant | Détail |
|---|---|
| Stack NestorCut | `/opt/nestorcut` — `docker-compose.yml` + `docker-compose.override.yml` + `.env` |
| Reverse proxy | conteneur `caddy` (network host, 80/443), config `/opt/nestorcut/Caddyfile`, TLS Let's Encrypt auto |
| App | conteneur `nestorcut-app-1`, bind `127.0.0.1:7100` uniquement → Caddy |
| Admin | conteneur `nestorcut-admin-1`, bind `<IP-VPN>:7200` (IP WireGuard) uniquement — **jamais exposé publiquement**, `NUXT_ADMIN_LAN_OPEN=true` (aucun password, confiance réseau VPN uniquement) |
| Mongo | conteneur `nestorcut-mongo-1`, interne au réseau docker, volume `nestorcut_mongo-data` |
| Workers | `nestorcut-nesting-worker-1` (1 réplica), `user-file-processing`, `strip-file-processing`, `strip-nesting` |
| WireGuard | `wg0` (ListenPort **51820/udp**), serveur = peer `<IP-VPN>` du VPN maison (endpoint <IP-MAISON>:51800). Peer dédié `<IP-VPN>` = **LXC `nestorcut-bridge`** (`<IP-PONT-ADMIN>`) sur le Proxmox maison (`<IP-PROXMOX>`), qui forward `7200` vers l'admin |

Pare-feu `ufw` : 22/tcp, 80/tcp, 443/tcp + **51820/udp** (WireGuard uniquement). Swap 2 Go. Mises à jour sécu auto (unattended-upgrades).

## Commandes courantes

```bash
cd /opt/nestorcut
docker compose ps                              # état (admin n'apparaît pas : profil)
docker compose --profile admin ps              # état complet
docker compose logs -f app                     # logs app en direct
docker compose pull && docker compose up -d    # mise à jour après build CI
docker compose --profile admin up -d --force-recreate app admin   # après modif du .env
```

⚠ `--force-recreate` est **obligatoire** après toute modif du `.env` (env_file n'est pas rechargé sinon).
⚠ Après un push, attendre le workflow **« Build and publish Docker images »** (≈ 10 min) avant de
`pull` : le workflow `app-ci` porte le même titre de commit mais ne publie aucune image —
vérifier avec `gh run list` (colonne workflow name) et déployer seulement quand
« Build and publish Docker images » est `completed`.

## Accès admin

L'admin n'est PAS sur Internet. `NUXT_ADMIN_LAN_OPEN=true` : **aucun login**, la confiance
est déléguée au réseau (VPN WireGuard uniquement — tout peer wg0 est traité comme admin).

**Depuis le réseau maison (chemin normal)** : le pont est un **LXC dédié** `nestorcut-bridge`
(VMID **102**, `<IP-PONT-ADMIN>`, unprivileged + `nesting=1,keyctl=1`, onboot) sur le Proxmox
maison (`<IP-PROXMOX>`, PVE 9.1.11 x86_64, toujours allumé). Il monte le tunnel WireGuard
(`<IP-VPN>` ↔ `<IP-VPN>`) et forward le port 7200 :

```
http://<IP-PONT-ADMIN>:7200        # depuis n'importe quel appareil du LAN maison
```

Services dans le LXC : `wg-quick@wg0` (tunnel) + `nestorcut-admin-forward.service`
(socat TCP-LISTEN:7200 → <IP-VPN>:7200). Maintenance depuis l'hôte Proxmox : `pct enter 102`.
SSH hôte Proxmox depuis le PC : clé `C:\Users\guiguijke\.nestorcut-vpn\proxmox-key`.
Script d'installation complet (hôte Proxmox, auto-nettoyant) : `C:\Users\guiguijke\.nestorcut-vpn\setup-bridge-lxc.sh`.
⚠ Réserver/exclure `<IP-PONT-ADMIN>` du pool DHCP de la box.
⚠ Piège template : filtrer l'arch de l'hôte (`_amd64.`) — un template `_arm64` sur hôte x86
fait `Failed to spawn container` sans explication claire (corrigé dans le script).

**Fallback (n'importe où)** — tunnel SSH via le wg0 du serveur :

```
ssh -L 7200:<IP-VPN>:7200 root@<IP-SERVEUR-FRONTAL>    # ou MobaXterm > Tools > MobaSSHTunnel
```
puis http://localhost:7200 — sans password (LAN_OPEN actif).

## DNS / TLS

- `app.nestorcut.com` → Cloudflare (proxied) → A `<IP-SERVEUR-FRONTAL>` → Caddy → app.
- SSL Cloudflare : **Full (strict)**. Caddy émet/renouvelle le certificat origine seul.
- Pas d'enregistrement `admin.*` (admin non exposé).

## Pièges spécifiques à ce serveur (en plus d'AGENTS.md)

1. **Docker bypass ufw** : ne jamais publier de port sur `0.0.0.0`. L'override bind
   `127.0.0.1` (app) et `<IP-VPN>` (admin). Le tag YAML **`!override`** est obligatoire
   dans l'override compose pour REMPLACER la liste `ports:` du compose de base —
   sinon fusion = double bind 0.0.0.0+127.0.0.1 → « address already in use » au démarrage.
2. **Admin en profil** : `profiles: ["admin"]` — un `docker compose up -d` nu ne
   touche pas l'admin ; toujours `--profile admin` pour l'admin.
3. **Docker démarre après WireGuard** : drop-in systemd
   `/etc/systemd/system/docker.service.d/after-wireguard.conf` (le bind `<IP-VPN>`
   exige wg0). Ne pas supprimer.
4. **2 vCPU seulement** : `NEST_WORKER_REPLICAS=1`, `NEST_COMPUTE_TOKENS=4` dans le
   `.env` serveur. Ne pas augmenter sans upgrade du VPS.
5. **Clés dépréciées retirées** : `NUXT_ENCRYPTION_MASTER_KEY` / `ENCRYPTION_MASTER_KEY`
   ne doivent PAS revenir dans le `.env` (D-PRV-7, warnings au boot).
6. **Grant admin** : `grantedUntil` + `grantedTier` dans la collection `users`
   (voir AGENTS.md #37) — ex. :
   ```bash
   docker exec nestorcut-mongo-1 mongosh --quiet nest2d --eval \
     'db.users.updateOne({email:"..."},{$set:{grantedUntil:new Date(Date.now()+31*864e5),grantedTier:"standard"}})'
   ```
7. **Images GHCR privées** : `docker login ghcr.io` déjà fait sur le serveur
   (`/root/.docker/config.json`). Si le token est révoqué, le refaire avant un `pull`.

## Dépendances externes à maintenir en cas de changement de domaine/IP

- Stripe : webhook `https://app.nestorcut.com/api/stripe/webhook`
  (`NUXT_STRIPE_SECRET_KEY` + `NUXT_STRIPE_WEBHOOK_SECRET` dans le `.env`).
  ⚠ Si le webhook est recréé dans Stripe, réactiver les **11 événements**, dont
  `checkout.session.completed`, `checkout.session.expired` (tentatives abandonnées)
  et `invoice.payment_failed` (échecs de débit → collection `payment_failures`).
- Google OAuth : redirect `https://app.nestorcut.com/auth/google/callback`.
- Resend (emails) : `NUXT_RESEND_TOKEN` / `NUXT_RESEND_FROM`.
- Notifications signup admin : `NUXT_ADMIN_NOTIFY_EMAIL`.

## Débordement homelab (2026-08-30) — workers nesting « overflow »

Quand la prod est chargée, des workers tournant sur le homelab (jail
jailmaker TrueNAS, `<IP-HOMELAB>`, 48 threads) consomment la MÊME file
`nesting_jobs` que la prod, via un tunnel WireGuard **entièrement
Docker** (rien n'est installé sur l'hôte du homelab).

| Côté | Quoi |
|---|---|
| Homelab | `/containers/nestorcut-overflow/docker-compose.yml` — conteneur `linuxserver/wireguard` (pair `<IP-VPN>`, endpoint `<IP-SERVEUR-FRONTAL>:51820`, AllowedIPs `<IP-VPN>/32` seulement, keepalive 25 s) + **3 workers nesting** (`network_mode: service:wireguard`, bornés à 6 CPU / 2 Go chacun), `MONGO_URI=mongodb://<IP-VPN>:27018/nest2d`. Gestion : `docker compose -f /containers/nestorcut-overflow/docker-compose.yml {up -d,logs -f,down}`. Accès SSH : clé `~/.ssh/nestorcut-homelab` (depuis le PC). |
| Hetzner | Peer `<IP-VPN>` dans `/etc/wireguard/wg0.conf` (appliqué par `wg syncconf`, sans coupure du pont admin) ; service `mongo-wg` (socat) dans l'override compose qui expose Mongo sur **`<IP-VPN>:27018` uniquement** (jamais 0.0.0.0 — piège #1) ; `NEST_COMPUTE_TOKENS=28` **des deux côtés** (le total du pool est écrit en base au démarrage des workers — les deux envs doivent rester identiques). |

- GHCR : `/root/.docker/config.json` copié de Hetzner vers le homelab.
- Capacité : 3 workers × 8 vcores max ≈ 24 tokens, + 4 de marge = pool 28.
  Agrandir le débordement = dupliquer un bloc `overflow-worker-N` (et
  réaligner `NEST_COMPUTE_TOKENS` des deux côtés).
- Si le homelab est éteint : la prod fonctionne comme avant (Hetzner
  traite ses jobs ; le pool « sur-déclare » la capacité, sans effet
  opérationnel — le worker Hetzner reste 1 job à la fois).
- Validé 2026-08-30 : worker Hetzner stoppé, job 5+20 pièces queue →
  `overflow-worker-2` du homelab l'a traité de bout en bout (`done`
  25/25), worker Hetzner relancé, pont admin <IP-VPN> intact.
