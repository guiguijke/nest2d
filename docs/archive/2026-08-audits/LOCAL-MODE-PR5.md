# Mode Local productisé — audit des endpoints + test d'acceptation (PR5)

Décision centrale (J-077) : **en Mode Local, la géométrie ne quitte JAMAIS le
navigateur.** Ce document audit chaque endpoint du flux local et donne le test
d'acceptation « zéro géométrie sortante », rejouable manuellement et en CI.

## Contrat quota (tranché, J-077)
Nouvel endpoint dédié **`POST /api/results/[slug]/local-quota`** (comptabilité
seule) ; l'ancien `local-result` (qui transporte les alternatives) reste
disponible UNIQUEMENT pour le flux QA flag-gaté et n'est PAS appelé par le
chemin productisé (`runLocalJobPrivate`). Échec ⇒ `local-fail` (refund),
jamais de quota consommé.

## Audit des endpoints du flux local (productisé)
| Endpoint | Direction | Transporte de la géométrie ? |
|---|---|---|
| `local-payload.get` | serveur→client | **entrante** (instance préparée) — acceptable : le claim porte sur le sortant |
| `local-quota.post` | client→serveur | **NON** — scalaires bornés (placed/layoutCount/density), corps ignoré sinon |
| `local-fail.post` | client→serveur | **NON** — message d'erreur (≤ 400 car.) uniquement |
| `local-mode.get` | serveur→client | NON — {mode, canToggle, reason} |
| Téléchargements (DXF/SVG/ZIP) | aucun réseau | générés 100 % navigateur (geometryClient + fflate) |
| `local-result.post` (QA) | client→serveur | OUI (alternatives) — **non appelé** en productisé |

Conclusion : en chemin productisé, aucune requête **sortante** ne contient le
contenu des fichiers ni la géométrie — seulement auth/quota/statut.

## Test d'acceptation ultime (manuel)
1. Flag ON (staging), compte Free, devtools → onglet Network ouverts.
2. Upload DXF → nesting → téléchargement DXF, tout en Mode Local.
3. Inspecter chaque requête **sortante** : aucune ne contient le contenu du
   fichier ni des placements/anneaux ; seules auth/quota/statut apparaissent
   (`local-quota`, `local-fail` le cas échéant, auth).
4. Couper le réseau après `local-payload` : le solve + les téléchargements
   continuent de fonctionner (preuve que rien ne dépend du serveur).

## Rebranchement des harnais PR4 sur ce chemin
`client_server_diff.py` (SVG byte-level, rapport 1e-6, import=golden) est
rejoué en CI sur les artefacts produits par `geometryClient` (même bundle que
le navigateur) — les exports téléchargés sont donc identiques au chemin
serveur.


## Amendement 2026-08-29 — orchestration locale, grille canonique, BPP

Référence complète des correctifs : `docs/archive/2026-08-audits/AUDIT-2026-08-29.md`. Points qui
modifient le CONTRAT ci-dessus ou ajoutent des composants au flux local :

- **Registre de solves** (`app/composables/localSolverRegistry.js`) : le
  job local appartient à un singleton module (isolation par projet,
  `ensureJob` idempotent — navigation entre projets et refresh ne lancent
  JAMAIS deux fois le même solve). La progression remonte par
  `progressFor(projectSlug)` consommé par la page.
- **Pass structurel navigateur** (`structureClient.js`, miroir de
  `core/structure.py`) : alternative `grid` construite sur la vue
  ORIGINALE (la pré-passe trous peut avoir vidé l'instance réduite),
  zones remplies par mini-pools wasm `${jobSlug}-zone…` (tués par
  préfixe au cancel), lattice analytique déterministe pour les petites
  pièces compatibles. L'alternative est AUTO-SUFFISANTE (ids d'origine,
  trous remplis par le pass) : `buildAlternativeArtifacts` saute pour
  elle remap idMap + expansion meta + applyHoleFill — SANS précaution,
  `applyHoleFill` téléporte les fillers des zones vers les trous vides.
- **Champion SPP-only** : la préférence d'une frame live convergée sur le
  merge (`preferChampion`/`settleFromChampion` dans localPool) est
  désormais gardée `pool.isSpp` — en BPP le merge moteur est la seule
  source de résultat.
- **`is_spp` = aire ENVELOPPE** (main.py + localPayloadBuilder.js) : le
  test « tout tient sur une tôle » sur l'aire nette forçait le mode bande
  sur les projets multi-tôles à pièces trouées (bug démo).
- **Vue live BPP** : le moteur émet le snapshot de l'incumbent au
  heartbeat 1 Hz (wasm rebuildé — vider le cache navigateur, le fichier
  garde le même nom) ; la vue compare le `remnant` et alterne les
  incumbents à égalité.
