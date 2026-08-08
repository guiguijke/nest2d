# PR5 — Rapport d'acceptation Mode Local (2026-08-08)

Référence si un bug apparaît en prod. Chaque test : commande, résultat, artefact.
Les tests **automatisés** sont rejoués en CI ; les tests **navigateur** sont
manuels (Guillaume, ANNEXE B) ou scriptés ici (Playwright, instance docker).

## 1. Tests automatisés — VERTS
| Test | Commande | Résultat | Artefact |
|---|---|---|---|
| Unitaires server (73, dont local-quota/resolveLocalMode) | `npx vitest run` | ✔ 73/73 | `vitest.log` |
| Parité exports navigateur↔serveur (SVG byte-level, rapport 1e-6, import=golden) | `python workers/geometry/parity/client_server_diff.py` | ✔ OK | `client-server-diff.log` |
| Déterminisme natif↔wasm (import 68/68, open_holes 17/17, tol. 0) | `node workers/geometry/parity/determinism_lock.mjs` | ✔ | `determinism.log` |
| Round-trip DXF Rust (ezdxf lit tous les exports) | `python workers/geometry/parity/gen_cam_pack.py` | ✔ 4 DXF | `docs/cam-validation/` |
| CI app (vitest + build) / CI géométrie | workflows `app-ci` / `geometry-locks` | ✔ SUCCESS | GitHub Actions |

## 2. Test navigateur LOCAL (docker, Playwright) — 2026-08-08
Compte Free créé + vérifié ; upload Piece_Trou + Piece_Fillx4 ; nesting lancé.
- **Flag ON (chemin local)** : le solve navigateur tourne et rapporte le bon
  compte (« All parts are placed », quota décrémenté, refund OK sur échec),
  **mais le modal reste gris** : pas d'aperçu coloré, pas de « Nesting report »,
  pas de lien DXF. Cause : le chemin local (`local-quota`) ne génère PAS les
  artefacts serveur (SVG coloré / DXF / report) que le modal affiche ; le rendu
  client depuis IndexedDB (PR5 `localDownloads`/`localResultsStore`) n'est pas
  branché sur le modal. **Mode Local NON prêt pour l'affichage public.**
  Capture : `qa-pr5-modal.png` (gris).
- **Flag OFF (chemin serveur)** : résultat COMPLET — aperçu coloré, onglet
  « DXF view », « Nesting report », lien DXF, « All parts are placed ».
  Capture : `qa-server-result.png` (OK).

**Directive : garder `NUXT_PUBLIC_LOCAL_COMPUTE_ENABLED=false` en prod** tant que
le rendu client n'est pas branché. Le chemin serveur est le chemin public.

## 3. Test zéro-géométrie-sortante — garanti par construction + à rejouer
- Construction : `runLocalJobPrivate` ne POSTE que `local-quota`/`local-fail`
  (audit `docs/LOCAL-MODE-PR5.md`) ; test unitaire : corps avec géométrie ⇒
  ignoré, jamais stocké.
- À rejouer en staging (devtools Network) : aucune requête sortante ne contient
  le contenu du fichier ni des placements.

## 4. Restant pour Guillaume (humain)
1. Test mobile physique (ANNEXE B) iPhone Safari + Android Chrome.
2. Case Settings → « Automatically delete head branches ».
3. Rollout : flag OFF maintenant ; le Mode Local ne sera réactivé qu'après le
   rendu client (travail futur) + test mobile.

## 5. Déploiement + rollback
- Déployer : homelab `docker compose pull && docker compose up -d`.
- Activer le Mode Local : `NUXT_PUBLIC_LOCAL_COMPUTE_ENABLED=true` dans le `.env`
  (staging d'abord) — **pas avant** le rendu client.
- **Rollback** : `NUXT_PUBLIC_LOCAL_COMPUTE_ENABLED=false` + `docker compose up -d app`.
