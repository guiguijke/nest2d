# Threat model & promesses privacy — NestorCut

> **Document interne au repo — ne pas publier sur le site.** Squelette posé
> le 2026-08-05 (décisions stratégie, voir `docs/STRATEGY.md`) ; à étoffer
> avant chaque mise en prod des features concernées.
>
> Principe directeur : **chaque promesse publique doit être exactement
> vraie**. Une promesse trop forte (ex. « nous ne pouvons pas vous lire »
> en mode serveur) est un mensonge commercial et un risque juridique.

## 1. Spectre privacy — 3 modes

| Mode | Où va le fichier | Qui peut lire le clair | Statut |
|---|---|---|---|
| **Local** | Fichier source **uploadé et parsé côté serveur** (copie mm) ; solve WASM navigateur ; **les résultats ne quittent jamais le navigateur** (IndexedDB, quota = scalaires bornés) | Le serveur voit la géométrie d'entrée au parsing ; la géométrie résultat ne sort jamais | [prod — flag ON 2026-08-08] ; import 100 % client = [spéc] |
| **Serveur** | Serveur NestorCut, chiffré avec la clé utilisateur | Le serveur, en RAM volatile, uniquement pendant le job | [spéc] |
| **Vault ZK** | Serveur, chiffré au repos (AES-256-GCM, clé détenue par l'utilisateur) | Le serveur en RAM pendant une session déverrouillée ; personne au repos | [prod — gate tier retiré, Phase 1 livrée J-055] |

**Écarté** : DXF simplifié/anonymisé — la densité exige la géométrie exacte
et le contour de la pièce EST le secret.

## 2. Promesses exactes par mode

### Mode Local

Livré (flag ON 2026-08-08) :

- ✅ « Le calcul tourne sur votre appareil » (solve WASM navigateur,
  mono-walk).
- ✅ « Les résultats ne quittent jamais votre navigateur » (artefacts
  construits côté client, IndexedDB ; le serveur ne reçoit que des
  scalaires de quota bornés — verrou : docs/LOCAL-MODE-PR5.md, test
  d'acceptation « zéro géométrie sortante »).
- ❌ INTERDIT aujourd'hui : « files never leave your machine / vos fichiers
  ne quittent pas le navigateur » — les fichiers sources sont uploadés pour
  le parsing serveur. Autorisé seulement quand l'import 100 % client
  (nest-import wasm câblé dans l'upload) sera en prod ET vérifié (règle
  « flag vérifié en prod avant publication »).
- TODO : vérifier qu'aucune télémétrie ne fuit de géométrie en Mode Local.

### Mode Serveur

Promesses autorisées (une fois livré) :

- chiffré avec la clé de l'utilisateur ;
- RAM volatile uniquement pendant le job — le clair n'est jamais écrit sur
  disque ;
- purge automatique des blobs après le délai affiché (24 h) ;
- la clé n'est jamais stockée.

**Interdit** : « nous ne pouvons pas vous lire » — le serveur détient le
clair en RAM pendant le traitement ; un administrateur ou une machine
compromise pourrait y accéder. Le Vault ZK réduit cette exposition (au
repos) sans l'éliminer pendant le job : seul le Mode Local l'élimine.

**TODO (prérequis Phase 1, revue 2026-08-05)** : la purge 24 h est promise
mais n'a **pas de spec d'exécution** — sans elle la promesse reste
théorique. À rédiger avant tout code : mécanisme (cron ? lifecycle worker ?
TTL Mongo ?), où le délai est affiché à l'utilisateur, périmètre des blobs
purgés (sources, résultats, géométrie `polygonParts` ?), interaction avec
le vault (fichiers conservés chiffrés au repos vs purgés) et avec
l'historique des jobs/rapports.

### Vault ZK

- Promesse (spec `doc/encryption-premium.spec.md` §1) : chiffré avec une
  clé que vous seul détenez ; sans le fichier-clé, les données sont
  définitivement illisibles — même par nous, même avec accès aux serveurs
  et aux sauvegardes ; clé perdue = données perdues.
- Nuance obligatoire (CGV/FAQ) : pendant une session déverrouillée, la clé
  vit en mémoire serveur (cache TTL, jamais persistée en clair) le temps de
  traiter les fichiers. « Rien de **persisté** » est la promesse exacte.

## 3. Threat model — binaire WASM (Phase 2)

**Constat** : le binaire WASM est téléchargé par le navigateur — il est
**récupérable par nature**. Toute protection côté client est contournable.

**Décision (2026-08-05)** : **pas de licence check réseau** — patchable,
et casserait les promesses offline/privacy du Mode Local.

Menaces à évaluer avant Phase 2 :

- [ ] Réutilisation du binaire moteur hors produit (UI concurrente maison) ;
- [ ] Re-hosting du binaire sur un autre site ;
- [ ] Extraction/modification du binaire (symbols résiduels, stripping
      insuffisant) ;
- [ ] Contrefaçon : un binaire modifié servi à nos utilisateurs (supply
      chain — intégrité/SRI à considérer) ;
- [ ] Fuite de géométrie via la télémétrie en Mode Local.

Mitigations décidées :

- build **strippé + wasm-opt** (pas de noms de symboles, taille réduite) ;
- **licence d'usage explicite** (le binaire n'est pas un produit libre) ;
- **threat model honnête** : on documente ce qu'on ne peut pas empêcher ;
- le moat = **produit, vitesse de shipping, confiance** — pas l'opacité
  d'un blob téléchargeable.

## 4. Durcissement vault niveau 1 (Phase 1) — D-PRV-7, design arrêté 2026-08-10

Objectif : réduire la fenêtre d'exposition de la DEK côté serveur.

### 4.1 Session DEK en RAM seule

À l'unlock (inchangé côté client : la clé transite en TLS, l'empreinte est
vérifiée), le serveur garde la DEK dans une **Map process-local**
`{ userId → { dek, expiresAt } }` — TTL glissant 2 h, rafraîchi à chaque
activité vault, purge périodique avec **wipe explicite des buffers**
(`fill(0)`) à expiration/lock. Plus aucune persistence : la collection
`session_keys` est abandonnée (drop à la migration). Contrainte assumée :
mono-instance app (état actuel) ; de futures réplicas exigeront des sticky
sessions (hors scope).

### 4.2 Livraison ECDH éphémère par job (serveur → worker)

Le worker est un processus séparé : la DEK lui est livrée **par job**, sans
jamais toucher un stockage lisible :

1. Au claim du job, le worker génère une paire **ECDH P-256 éphémère** (RAM
   seule) et écrit la clé publique sur le job doc (`workerKeyPub`).
2. Le worker appelle `POST /api/security/vault/job-dek { jobSlug }`
   (route nouvelle, rate-limited).
3. Le serveur, si une session RAM est active pour le propriétaire du job :
   génère SA paire éphémère, `shared = ECDH(serverPriv, workerPub)`,
   clé de transport = `HKDF-SHA256(shared, info="nest2d-job-dek-v1")`,
   parcel = `AES-256-GCM(transportKey, DEK, AAD=jobSlug)`, répond
   `{ serverPub, parcel }`. Rien d'utile n'est persisté : même écrit, le
   parcel est indéchiffrable sans les deux moitiés privées (RAM des deux
   côtés — forward secrecy).
4. Le worker calcule `shared = ECDH(workerPriv, serverPub)`, déwrap la DEK
   en RAM, déchiffre en mémoire (comportement actuel), puis **wipe** en fin
   de job (succès ou échec).
5. Pas de session active → 409 `vault_locked` (le job échoue proprement et
   est refundé, comme aujourd'hui à l'expiration d'une session en file).

Le endpoint n'a pas besoin d'auth forte : un parcel n'est ouvrable que par
la clé privée éphémère du demandeur ; un tiers ne récupère rien
d'exploitable (rate-limit + validation de forme tout de même). Le worker
appelle l'app en HTTP — nouvelle dépendance : `NEST_APP_URL` côté workers.

### 4.3 Suppression du wrap master key

`wrapDek`/`unwrapDek`/`getMasterKey` sortent du chemin de session ;
`NUXT_ENCRYPTION_MASTER_KEY` perd son rôle (warning au boot si encore
défini, note de migration). Le format de fichier chiffré (frames AES-GCM,
AAD) est INCHANGÉ — les vecteurs d'interop `scripts/crypto-interop/`
restent le verrou, rejoués.

### 4.4 Invariants et non-changements

- La DEK naît côté client (enable/rotate inchangés) ; le transit client→
  serveur reste TLS (le durcissement porte sur le stockage serveur et la
  livraison worker, pas sur ce transit).
- UX : unlock une fois par session, comme aujourd'hui ; au déploiement,
  les sessions en cours sont perdues → re-unlock (la modale s'ouvre
  toute seule, comportement existant).
- Promesses publiques inchangées (le vault évite déjà « nous ne pouvons
  pas vous lire » côté mode serveur — §2).

### 4.5 Verrous à livrer avec le code

- Round-trip ECDH Node↔Python : vecteur partagé (même `workerPub` → même
  parcel déchiffrable côté worker), dans `scripts/crypto-interop/` ;
- vitest : session RAM (TTL glissant, wipe, 409 hors session) ;
- pytest worker : claim + unwrap + wipe (HTTP mocké) ;
- `server/tests/vault.test.js` adapté (session_keys retirée) ;
- QA stack : enable → nest vault → résultat lisible, puis expiration →
  job vault_locked refundé.
- `doc/encryption-premium.spec.md` mis à jour une fois codé.

## 5. Limites de ce document

- Ce n'est ni un audit formel ni un pentest : c'est le cadre honnête des
  promesses et des risques connus.
- Toute promesse nouvelle (marketing, FAQ, CGV) est validée contre ce
  document ET vérifiée en prod (feature flag) avant publication.
