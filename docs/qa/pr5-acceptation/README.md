# PR5 — Rapport d'acceptation Mode Local (2026-08-08)

Référence si un bug apparaît en prod. Chaque test : commande, résultat, artefact.
Les tests **automatisés** sont rejoués en CI ; les tests **navigateur/mobile**
sont manuels (Guillaume, ANNEXE B) car ils exigent un vrai navigateur + serveur.

## 1. Tests automatisés — VERTS
| Test | Commande | Résultat | Artefact |
|---|---|---|---|
| Unitaires server (73, dont local-quota/resolveLocalMode : refund échec, succès non remboursé, scalaires bornés, owner-only, flag-gate) | `npx vitest run` | ✔ 73/73 | `vitest.log` |
| Parité exports navigateur↔serveur (SVG byte-level, rapport 1e-6, import=golden) | `python workers/geometry/parity/client_server_diff.py` | ✔ OK | `client-server-diff.log` |
| Déterminisme natif↔wasm (import 68/68, open_holes 17/17, tol. 0) | `node workers/geometry/parity/determinism_lock.mjs` | ✔ | `determinism.log` |
| Round-trip DXF Rust (ezdxf lit tous les exports, géométrie non corrompue) | `python workers/geometry/parity/gen_cam_pack.py` | ✔ 4 DXF | `docs/cam-validation/` |
| CI app (vitest + build Nuxt) | workflow `app-ci` (#28) | ✔ SUCCESS | GitHub Actions |
| CI géométrie (parité + diff client/serveur) | workflow `geometry-locks` | ✔ SUCCESS | GitHub Actions |

## 2. Test zéro-géométrie-sortante — garanti par construction + à rejouer en navigateur
- **Construction** : le chemin productisé (`runLocalJobPrivate`) ne POSTE que
  `local-quota` (scalaires bornés) ou `local-fail` ; `local-result` (qui
  transporte les alternatives) n'est PAS appelé (audit : `docs/LOCAL-MODE-PR5.md`).
  Test unitaire : corps avec géométrie ⇒ ignoré, jamais stocké (`localCompute.test.js`).
- **À rejouer en navigateur** (devtools Network, flag ON, compte Free) : aucune
  requête sortante ne contient le contenu du fichier ni des placements ; couper le
  réseau après `local-payload` ⇒ solve + téléchargements continuent.

## 3. Limite d'environnement rencontrée (factuel, non bloquant pour la CI)
Sur cette machine Windows de dev, le serveur Nuxt local ne démarre pas de façon
fiable (alias `~~` résolu incorrectement en `nuxt dev` ; crash node en build
`.output`). **Ce n'est pas un défaut du code** : `npm run build` passe, la CI
`app-ci`/`geometry-locks` est verte, et les tests server/parité tournent hors
serveur. Les tests navigateur E2E sont donc exécutés sur une instance déployée
(staging/homelab) par Guillaume, pas sur cette machine.

## 4. Restant pour Guillaume (humain)
1. **Test mobile physique** (ANNEXE B) : iPhone Safari + Android Chrome, comptes
   Free (local forcé) et Unlimited (toggle, défaut serveur) — bloquant avant
   promesse publique.
2. **Rejouer le test zéro-géométrie-sortante** en staging (devtools Network).
3. Settings → General → cocher **« Automatically delete head branches »**.
4. **Rollout prod** : voir procédure ci-dessous.

## 5. Déploiement + rollback
- Déployer : sur l'homelab, `docker compose pull && docker compose up -d`
  (les images `:latest`/`:<sha>` sont publiées par `build-images.yml` sur main).
- Activer le Mode Local : `NUXT_PUBLIC_LOCAL_COMPUTE_ENABLED=true` dans le `.env`
  de l'environnement (staging d'abord), puis `docker compose up -d app`.
- **Rollback** : remettre `NUXT_PUBLIC_LOCAL_COMPUTE_ENABLED=false` +
  `docker compose up -d app`. Le code reste déployé mais inerte (flag OFF) —
  aucun changement pour les utilisateurs tant que le flag est OFF.
