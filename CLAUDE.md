# NestorCut — point d'entrée des agents

@AGENTS.md

## Démarrage rapide

- **Boussole produit** : `docs/MASTERPLAN-2026-09-05.md` §0 — la référence
  du nesting dans le navigateur. Tout chantier passe la règle de tri du §0
  avant d'être ouvert ; les instructions à l'implémenteur suivent le §8.
- **Carte des documents** : `docs/README.md` (vivants à la racine, cycles
  clos dans `docs/archive/`, QA dans `docs/qa/`).
- **Pièges techniques** : `AGENTS.md` §2, à lire avant de toucher au moteur,
  au worker Python, au miroir JS du post-pass ou au visualizer.
- **Discipline de mesure** : `assert_images_head.sh` OK avant tout banc ;
  harnais navigateur `scripts/qa-e2e-local-2sheets.mjs` dans ses deux
  configurations ; rapport constat par constat, non-faits énoncés.
- **Déploiement** : `AGENTS.md` §6 — un déploiement worker ou moteur se
  termine sur le homelab (`assert_overflow_head.py` OK) et régénère les
  benchmarks publics si le moteur a changé.
- **Rôles** : le propriétaire décide ; l'implémenteur (GLM 5.3 Max) livre
  un rapport par lot ; le vérificateur rejoue, écrit `PLAN-CORRECTIF-*` ou
  `FICHE-*`, donne GO / NO-GO ; on déploie après le GO seulement.
