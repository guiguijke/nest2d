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
