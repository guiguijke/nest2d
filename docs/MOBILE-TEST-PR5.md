# Fiche de test mobile — Mode Local (PR5, Phase 6)

**Bloquant avant toute promesse publique** (règle des flags). À exécuter par
Guillaume sur matériel physique. Le flag reste OFF en prod tant que cette
fiche n'est pas passée.

## Matériel
- iPhone (Safari, iOS récent) ; Android (Chrome récent).
- Compte Free (local forcé) + compte Unlimited (toggle, défaut serveur).

## Scénario (job démo 304 pièces + petit job)
Pour chaque appareil × compte :
1. **Toggle** : Free ⇒ pas de toggle, message `localMode.freeForced` ;
   Unlimited ⇒ toggle visible, défaut « Sur nos serveurs ».
2. **Solve** : lancer le job démo ; vérifier temps acceptable (< ~30 s) et
   temps écoulé affiché (budget 10–15 s) ; pas de crash d'onglet (mémoire).
3. **Téléchargements** : DXF + SVG + ZIP se téléchargent et s'ouvrent.
4. **Erreurs propres** : provoquer un échec (gros job / mémoire) ⇒ message
   i18n EN+FR proposant le mode serveur, jamais d'échec silencieux ; le quota
   est remboursé (vérifier le compteur Free inchangé après échec).
5. **Hors-ligne partiel** : après `local-payload`, couper le réseau ⇒ solve +
   téléchargements OK (rien ne dépend du serveur).

## Critères de succès
- Aucun crash onglet (Safari mémoire WASM contrainte) sur le job démo.
- Toggle conforme au plan ; défaut serveur pour les payants.
- Téléchargements lisibles (SheetCam/CAO) sur au moins un appareil.
- Erreurs i18n visibles et actionnables EN+FR.

Toute défaillance ⇒ entrée J + correctif avant rollout staging→prod.
