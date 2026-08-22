# Threat model & promesses privacy — NestorCut

> **Document interne au repo — ne pas publier sur le site.** Cadre des
> promesses **exactement vraies**. Une formulation trop forte (ex. « nous
> ne pouvons pas vous lire » en mode serveur) est un mensonge commercial
> et un risque juridique.
>
> **État au 2026-08-22** (prod `app.nestorcut.com`, commit `c9b15c9`).
> Contrôles techniques (auth, isolation, workers, pentest) :
> `docs/CYBERSECURITY.md`. Stratégie produit : `docs/STRATEGY.md`.
> Décisions détaillées : `specs/60-vie-privee.md` (local).

## 1. Spectre privacy — 3 modes (livrés)

| Mode | Où va le fichier | Qui peut lire le clair | Statut |
|---|---|---|---|
| **Cet appareil** (projet `local`) | Parsé dans le navigateur (wasm). Bytes + géométrie + résultats dans IndexedDB. Le serveur ne voit que slug/métadonnées de projet + scalaires de quota. **Pas le nom de fichier.** | Personne côté NestorCut. Quiconque ouvre **ce** navigateur. | [prod] défaut à la création (flags `LOCAL_IMPORT` + `LOCAL_COMPUTE` ON) |
| **Nos serveurs, sans coffre** | Upload GridFS **en clair**. Traitement en RAM. **Purge 24 h** des blobs (sources + résultats). Rapports = scalaires. | Le serveur (disque 24 h + RAM pendant le job). Un admin ou une base lue voit le DXF jusqu'à la purge. | [prod] |
| **Nos serveurs, coffre ZK** | Upload : le serveur chiffre à l'écriture (AES-256-GCM) avec la DEK que l'utilisateur a déverrouillée en RAM. Au repos : illisible sans le fichier-clé. | Pendant une session déverrouillée (~2 h) : le serveur en RAM (app + worker le temps du job). Au repos / backup / Mongo dump : personne. | [prod] opt-in **tous plans** |

**Écarté** : DXF simplifié/anonymisé — la densité exige la géométrie exacte
et le contour de la pièce EST le secret.

**Pas un 4ᵉ mode** : le turbo hybride (course client + serveur) est
`[spéc]`, non codé. DWG ⇒ toujours nos serveurs (LibreDWG dans le worker).

## 2. Promesses exactes par mode

### Cet appareil (projet 100 % privé)

Autorisé (vérifié prod 2026-08-12, UI 2026-08-21/22) :

- « Tes pièces restent ici. » Parsing wasm, IndexedDB, solve navigateur.
- « Rien n'a été envoyé chez nous » pour la **géométrie** et le **nom de
  fichier**. Le serveur reçoit : création `{ local: true }`, puis quota
  (compteurs). Slug de fichier opaque `f-{16 hex}{ext}`.
- « Les résultats restent dans ce navigateur. »

Interdit :

- « Full offline / aucune requête réseau » — login, quota, liste des
  projets (métadonnées) passent par le serveur.
- « Multi-appareils » — un autre navigateur / un IndexedDB vidé = pièces
  absentes. L'UI le dit. Reprise = re-déposer les DXF, ou passer par le
  cloud / le coffre.

Limites assumées :

- Quiconque a le poste déverrouillé lit IndexedDB.
- Pas de télémétrie géométrique (Clarity éventuel = usage, pas DXF). Le
  cookie `nest2d_session_id` est un UUID de funnel, pas un nom de pièce.

### Nos serveurs, sans coffre

Autorisé :

- TLS en transit.
- « En clair chez nous, effacé 24 h après » (sources, copies, résultats ;
  scalaires de rapport conservés). L'UI affiche « expiré ».
- Suppression de projet / de compte en libre-service.

Interdit :

- « Nous ne pouvons pas vous lire. »
- « Chiffré avec votre clé » — c'est le coffre, pas ce mode.
- « Jamais écrit sur disque » — GridFS est du disque, 24 h.

### Coffre ZK

Autorisé (CGV / FAQ / pastille `Cloud · coffre`) :

- « Chiffré avec une clé que tu seuls détiens (fichier-clé). »
- « Sans ce fichier, illisible — y compris pour nous, y compris sur un
  dump de base. Perte du fichier = données perdues. »
- « Au repos illisible ; en session, déchiffré en mémoire le temps du
  job. »

Interdit :

- « Nous ne pouvons pas vous lire **pendant** que le coffre est ouvert »
  — la DEK est en RAM app (TTL 2 h) et livrée au worker le temps du nest.
- « Chiffré de bout en bout dans le navigateur avant l'upload » — la DEK
  naît côté client, mais le **blob** est chiffré **à l'écriture serveur**
  (`uploadToBucket` + DEK de session). Le clair traverse TLS jusqu'à
  l'app, une fois par upload, session ouverte.

## 3. Binaire WASM

Le moteur `/engine/*` est téléchargé par le navigateur → **récupérable
par nature**. Décision (2026-08-05, inchangée) : **pas de licence check
réseau** (patchable, et casse le Mode Local).

Mitigations en place : build strippé, licence d'usage, déterminisme
natif ≡ wasm (SHA-256, tolérance 0). Moat = produit, pas l'opacité d'un
blob.

Menaces restantes (assumées, pas « à fixer avant ship ») :

- réutilisation du binaire hors produit ;
- re-hosting ;
- binaire modifié servi à nos users (intégrité CDN / image Docker —
  pas de SRI aujourd'hui).

## 4. Vault — état livré (D-PRV-7, plus un design)

- DEK 256 bits générée dans le navigateur, fichier-clé
  `nestorcut-vault-<keyId>.key.json`.
- Serveur ne persiste que `{ enabled, keyId, fingerprint, createdAt }`.
- Session : Map RAM process-local, TTL 2 h glissant, wipe `fill(0)`,
  drop de l'ancienne collection `session_keys` au boot. Mono-instance
  assumée (réplicas app ⇒ sticky sessions, non fait).
- Worker : ECDH P-256 éphémère par job → `POST /api/security/vault/job-dek`
  → parcel AES-GCM, DEK wipée en fin de job.
- Format GridFS : frames AES-256-GCM, AAD `fileId|ownerId|frameIndex`.
- `NUXT_ENCRYPTION_MASTER_KEY` n'a plus de rôle.

## 5. Ce document n'est pas

- Un audit formel ni le pentest (voir `docs/CYBERSECURITY.md`).
- Une autorisation à publier un claim : toute phrase publique = feature
  **vérifiée en prod** (flag) avant publication (`docs/STRATEGY.md` §5).
