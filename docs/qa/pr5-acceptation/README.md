# PR5 — Rapport d'acceptation Mode Local (2026-08-08)

Référence si un bug apparaît en prod. Chaque test : commande, résultat, artefact.
Les tests **automatisés** sont rejoués en CI ; les tests **navigateur/mobile**
sont manuels (Guillaume, ANNEXE B) car ils exigent un vrai navigateur + serveur.

## 1. Tests automatisés — VERTS
| Test | Commande | Résultat | Artefact |
|---|---|---|---|
| Unitaires server + bridge local (83 : local-quota/resolveLocalMode refund/scalaires/owner-only/flag-gate + normalisation SPP/BPP, deg→rad, forme rapport) | `npx vitest run` | ✔ 83/83 | `vitest.log` |
| Parité exports navigateur↔serveur (SVG byte-level, rapport 1e-6, import=golden, **DXF tôle combinée multi-sources**) | `python workers/geometry/parity/client_server_diff.py` | ✔ OK | `client-server-diff.log` |
| Déterminisme natif↔wasm (import 68/68, open_holes 17/17, tol. 0) | `node workers/geometry/parity/determinism_lock.mjs` | ✔ | `determinism.log` |
| Parité exports natifs (SVG byte-level, rapport, DXF sémantique) | `python workers/geometry/parity/exports_check.py` | ✔ OK | — |
| Unitaires worker nesting (payload enrichi `parts`/`outputUnit`/`addOutShape` inclus) | `PYTHONPATH=workers/common python -m pytest workers/nesting/tests -q` | ✔ 52/52 | — |
| Round-trip DXF Rust (ezdxf lit tous les exports, géométrie non corrompue) | `python workers/geometry/parity/gen_cam_pack.py` | ✔ 4 DXF | `docs/cam-validation/` |
| Build Nuxt | `npm run build` | ✔ | — |
| CI app (vitest + build Nuxt) | workflow `app-ci` (#28) | ✔ SUCCESS | GitHub Actions |
| CI géométrie (parité + diff client/serveur) | workflow `geometry-locks` | ✔ SUCCESS | GitHub Actions |

## 1b. Rendu client depuis IndexedDB (J-082) — ce qui a changé
J-080/J-081 : le solve navigateur tournait mais le modal/vue live/couleurs
restaient vides — l'UI lisait le job SERVEUR (alternatives/report/SVG/DXF
GridFS) que le chemin `local-quota` ne remplit pas, et les artefacts client
persistés en IndexedDB n'étaient ni produits correctement ni lus.

Corrigé par le **rendu 100 % client** (voir `specs/90-decisions.md` J-082) :
- le worker enrichit `localPayload` de `parts` (coords+holes propres, couleur,
  handles, file_slug) + `outputUnit`/`addOutShape` ;
- `localBridge.js` convertit la sortie moteur en SVG coloré / rapport mesuré /
  DXF combiné par tôle (`export_dxf_sheet`, jumeau de `build_part`) ;
- le record IndexedDB v2 porte les artefacts finis (relecture + téléchargement
  hors-ligne) ; `localHydrate.js` fusionne la liste SSE avec ces records.

**Test navigateur (à rejouer, flag ON, compte Free)** : upload 2 DXF →
nesting local ⇒ le modal montre l'aperçu coloré, le rapport et les
téléchargements DXF/SVG/ZIP fonctionnent ; couper le réseau après
`local-payload` ⇒ affichage + téléchargements restent OK ; capturer le
réseau ⇒ zéro requête sortante contenant la géométrie ; rejouer un job
serveur (flag OFF) ⇒ aucune régression.

## 2. Test navigateur J-082 — rejoué en LOCAL (docker + Playwright) — PASSÉ
Rejoué sur cette machine le 2026-08-08 avec les images docker (app + workers
buildés depuis les sources, flag ON, compte Free `qa-local@example.com`) :
- **Résultat hydraté** : carte avec aperçu coloré (data-URI depuis IndexedDB)
  + badge « Computed locally » + boutons Nesting report / Download
  (`qa-j082-local-hydrated.png`).
- **Modal** : onglet « Color preview » rendu, rapport complet (utilization,
  offcut réutilisable, table par tôle) et badges verts
  `✓ Overlap-free · ✓ Inside sheet · ✓ Gap ≥ 0.1 mm · ✓ All 5 parts placed`
  (`qa-j082-modal.png`). 4/4 fillers nichés dans le trou (holesFilled).
- **DXF view** : onglet rendu depuis le DXF généré côté client (blob URL)
  (`qa-j082-dxfview.png`).
- **Téléchargement** : DXF `{slug}_alt0_part_1.dxf` (nommage serveur), relu
  par ezdxf : 19 entités, `INSUNITS=4/MEASUREMENT=1`.
- **Hors-ligne** : réseau coupé ⇒ le téléchargement DXF continue de partir
  d'IndexedDB (aucune requête serveur).
- **Zéro géométrie sortante** : audit réseau ⇒ seuls `local-payload`
  (entrante), `local-quota` (scalaires `{placed,layoutCount,density}`) et les
  bytes sources pré-fetchés (entrée) transitent ; aucun POST de géométrie.
- **Régression serveur** (flag OFF) : le même job repasse par le worker
  (60 s), la carte affiche l'aperçu GridFS (`/api/files/result/svg`), aucun
  badge local — chemin serveur intact.

### 2.1 Adaptive patience + mono-walk (J-083) — mesuré
« 14 s pour 4 pièces » corrigé : patience du plateau stop adaptative
(`adaptive_plateau_patience_sec`, plancher 2 s, prime trous proportionnelle)
+ profil navigateur mono-walk (`n_workers=1`, `separator_workers=1`, cf.
#14c — le multi-start était séquentiel en wasm). Même job 5 pièces/1 tôle :
- Navigateur : 32,8 s → **5,7 s** (solve + artefacts), qualité identique
  (4/4 trous remplis, overlap-free, 5/5).
- Serveur : 60 s → **6 s** (engine elapsed), job done 5/5.

Note §3 : le serveur Nuxt **docker** (image buildée) démarre et tourne
correctement sur cette machine ; seule l'exécution `nuxt dev`/build `.output`
en natif Windows restait instable. Les captures ci-dessus proviennent donc de
cette stack docker locale.

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
