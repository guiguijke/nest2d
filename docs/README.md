# Documentation NestorCut — carte

Règle de rangement : la racine de `docs/` ne contient que les **documents
vivants** (référence ou pilotage en cours). Un cycle clos (audit → plan →
rapports → vérifications, une fois déployé) part dans
`archive/<année-mois-cycle>/` avec `git mv`, liens réécrits. Les captures
et sorties de QA restent dans `qa/<campagne>/`.

## Référence (vivante)

| Fichier | Contenu |
|---|---|
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | Topologie, flux, frontières, CI/CD, déploiement Hetzner + homelab |
| [`PIPELINE-MAP.md`](PIPELINE-MAP.md) | Cartographie du pipeline géométrique, parité natif/wasm |
| [`STRATEGY.md`](STRATEGY.md) | Tiers Free/Unlimited/Pro, privacy, roadmap, marqueurs `[prod]`/`[spéc]` |
| [`THREAT-MODEL.md`](THREAT-MODEL.md) | Promesses privacy exactes (interne, ne pas publier) |
| [`CYBERSECURITY.md`](CYBERSECURITY.md) | Posture sécurité / pentest (interne) |
| [`stripe-go-live.md`](stripe-go-live.md) | Passage Stripe en production |
| [`dwg-license.md`](dwg-license.md) | Licence et périmètre DWG |
| `cam-validation/` | Fiche de test CAM + DXF de validation |
| `upstream-wasm-proposal/` | Patches proposés en amont (jagua-rs, sparrow) |

## Pilotage (en cours)

| Fichier | Contenu |
|---|---|
| [`MASTERPLAN-2026-09-05.md`](MASTERPLAN-2026-09-05.md) | **Boussole** : la référence du nesting dans le navigateur (§0), séquenciation T0-T5, registre des décisions, forme des instructions à l'implémenteur (§8) |
| [`PLAN-PERF-UX-2026-09-05.md`](PLAN-PERF-UX-2026-09-05.md) | Plan perf/UX en 6 lots (lots 1-3 livrés, 4 en cours, 5-6 cadrés) |
| [`FICHE-LOT4-T2-2026-09-06.md`](FICHE-LOT4-T2-2026-09-06.md) | Lot 4 (T2) : verrous par chantier, décision Rust/Python, contrôles intermédiaires, recentrage navigateur |
| [`JALON-UTILISATEURS-T1-2026-09-06.md`](JALON-UTILISATEURS-T1-2026-09-06.md) | Guide d'entretiens et grille de décision du jalon utilisateurs |
| [`PLAN-coupe-commune.md`](PLAN-coupe-commune.md) | Coupe commune en grappes : dette d'abord (kerf explicite livré), lignes communes ensuite |

## Archives (cycles clos)

| Dossier | Cycle | Issue |
|---|---|---|
| `archive/2026-08-audits/` | Audits du 29 et 31 août, plans A / P-Q, poids wasm PR2, Mode Local PR5 | Correctifs livrés (voir `AGENTS.md` §5) |
| `archive/2026-09-bpp/` | BPP : bandes résiduelles, poches, livraisons des 1er et 2 septembre | Déployé |
| `archive/2026-09-multitoles/` | Audit multi-tôles du 3 septembre, plans correctifs 1-4, infaisable & alternatives | Déployé |
| `archive/2026-09-perf-ux/` | Mesure P3, lots 1 → 3 (rapports, vérifications L1 → L3-bis), proposition du lot 4 | Déployé en prod le 06/09 (T1 clos) |

Convention de nommage : `AUDIT-`, `PLAN-`, `RAPPORT-` (implémenteur),
`PLAN-CORRECTIF-` (vérification + plan correctif du vérificateur),
`FICHE-`, `JALON-`, suffixe date `AAAA-MM-JJ`.
