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

## 4. Durcissement vault niveau 1 (Phase 1) — TODO

Objectif : réduire la fenêtre d'exposition de la DEK côté serveur.

- [ ] **DEK en RAM seule** : plus aucune persistence, même chiffrée
      (aujourd'hui : collection `session_keys`, DEK wrappée sous la master
      key de déploiement, TTL glissant ~2 h) ;
- [ ] **Livraison ECDH éphémère** : la DEK transite via une clé de session
      négociée (ECDH) entre navigateur et serveur/worker, jamais stockée ;
- [ ] **Suppression du wrap master key** : retirer
      `NUXT_ENCRYPTION_MASTER_KEY` / `ENCRYPTION_MASTER_KEY` du chemin de
      session (la master key ne sert aujourd'hui qu'à protéger le cache
      `session_keys` — sans cache persisté, elle perd son rôle) ;
- [ ] Spécifier l'impact workers (Python ×4) : réception de la DEK par job,
      durée de vie, purge mémoire ;
- [ ] Mettre à jour `doc/encryption-premium.spec.md` une fois le design
      arrêté (le mécanisme actuel — wrap master key + TTL — y est décrit ;
      voir la note de supersession en tête de ce fichier).

## 5. Limites de ce document

- Ce n'est ni un audit formel ni un pentest : c'est le cadre honnête des
  promesses et des risques connus.
- Toute promesse nouvelle (marketing, FAQ, CGV) est validée contre ce
  document ET vérifiée en prod (feature flag) avant publication.
