# Jalon utilisateurs de fin de T1 — guide d'entretien et grille de décision du lot 4

> Retouche implémenteur sur demande du propriétaire : « porte utilisateurs » (calque de
> l'anglais *user gate*) remplacé partout par « jalon utilisateurs ». Contenu inchangé.


Objet : décider l'ordre des chantiers du lot 4 sur des faits d'atelier,
pas sur l'ordre proposé par l'auditeur (masterplan §3, qui reste une
hypothèse). Livrable propriétaire, une semaine, cinq entretiens de
30 minutes plus le dépouillement de la campagne feedback.

## 1. Qui interroger

- Cinq personnes qui **découpent réellement** : laser fibre ou CO2, plasma,
  jet d'eau, fraiseuse, au moins deux matériaux différents (tôle, bois ou
  panneau). Priorité aux inscrits qui ont fait au moins un nesting, puis à
  ceux qui ont abandonné après l'import (ce sont eux qui savent pourquoi).
- Recrutement : les répondants de la campagne feedback d'abord ; sinon les
  43 inscrits par e-mail personnel, en proposant trois créneaux et un
  appel de 30 minutes en visio avec partage d'écran.
- Ne pas interroger : amis, autres éditeurs, personnes qui ne coupent pas.

## 2. Déroulé (30 minutes, partage d'écran demandé)

Règle : faire faire, pas faire dire. Aucune démonstration du produit avant
la minute 20. Noter les verbatims, pas les interprétations.

1. **Contexte (3 min)** : machine, logiciel de découpe ou CAM utilisé,
   d'où viennent les DXF (CAO, client, dessin main), volume par semaine,
   qui fait le nesting aujourd'hui et avec quoi.
2. **Import à l'aveugle (7 min)** : leur demander d'importer **leurs**
   fichiers du jour dans NestorCut. Observer sans aider. Noter : nombre de
   fichiers, ce qui casse (splines, contours ouverts, blocs, unités,
   textes, calques), ce qu'ils font quand ça casse (réparent, abandonnent,
   changent d'outil).
3. **Réglages (4 min)** : les laisser régler tôle, kerf, sécurité, sens.
   Noter s'ils comprennent kerf contre sécurité, ce qu'ils mettent, et
   quelle valeur ils utilisent en vrai sur leur machine.
4. **Résultat et sortie (6 min)** : lancer un nesting, ouvrir le résultat,
   télécharger, **ouvrir le DXF dans leur logiciel de découpe** en partage
   d'écran. Noter : ce qui manque pour couper tel quel (calques, ordre,
   amorces, points de départ, repère, unités), ce qu'ils retouchent à la
   main, combien de temps ça leur prend d'habitude.
5. **Chutes (3 min)** : que font-ils des chutes aujourd'hui, comment les
   retrouvent-ils, en réutilisent-ils, sous quelle forme (rectangle noté,
   photo, rien).
6. **Amorce et coupe commune (3 min)** : leur CAM ajoute-t-il une amorce,
   de quelle longueur, ont-ils déjà eu une amorce qui mord la voisine, ont
   -ils déjà fait de la coupe commune, avec quel outil.
7. **Valeur (4 min)** : « si NestorCut faisait X demain, changeriez-vous
   quelque chose à votre façon de travailler ? » pour les trois X qu'ils
   ont eux-mêmes cités. Puis : combien coûte aujourd'hui leur outil de
   nesting ou le temps passé, et ce qu'ils accepteraient de payer.

Ne pas demander « aimeriez-vous la fonctionnalité Y ? » : tout le monde dit
oui.

## 3. Grille de notation (à remplir juste après chaque entretien)

Pour chaque candidat du lot 4, noter 0, 1 ou 2 par entretien :
0 = jamais évoqué ; 1 = évoqué quand on l'a suggéré ; 2 = **vécu et
montré** pendant l'entretien (un fichier qui casse, un DXF retouché, une
chute perdue).

| Candidat du lot 4 | Ce qui compte comme preuve « 2 » |
|---|---|
| Robustesse d'import (3.2) | un de leurs fichiers a cassé ou a été mal lu devant nous |
| Calques et identifiants à l'export (3.1) | ils ont retouché le DXF exporté avant de couper |
| Bibliothèque de chutes v1 (3.3) | ils tiennent un inventaire de chutes, même sur papier |
| Réserve d'amorce et point de départ (3.5) | ils ont déjà eu une amorce qui mord, ou déplacent des points de départ à la main |
| Contraintes de tôle : grain, marges, zones (3.4) | ils coupent une matière à sens, ou évitent des zones de la tôle |
| Coupe commune (3.7) | ils la pratiquent déjà ou leur CAM la propose |
| Vitesse et confort : P4, P5, P6 | ils ont attendu en soupirant, ou relancé pendant le calcul |
| Expiration des jobs locaux orphelins, garde par classe (dette) | pas un sujet d'entretien : à planifier de toute façon avec P8 |

Score d'un candidat = somme sur les cinq entretiens, plus 1 point par
mention spontanée dans la campagne feedback (plafond 5).

## 4. Règle de décision

- Score ≥ 6 : chantier du lot 4, dans l'ordre des scores.
- Score 3 à 5 : lot 5, sauf si un payant potentiel l'a posé comme
  condition.
- Score ≤ 2 : reste en réserve, quelle que soit sa place dans le
  masterplan.
- La dette technique planifiée (P8, garde par classe, orphelins) entre
  dans le lot 4 quoi qu'il arrive, à hauteur d'un tiers du lot.

Si les cinq entretiens ne peuvent pas être tenus en une semaine, tenir
le jalon avec trois entretiens et le dépouillement, mais ne pas le
sauter : c'est la seule donnée de marché du plan.

## 5. Deux préalables déjà connus

- **Webhook Stripe live** : à vérifier avant tout, une session admin
  Stripe suffit ; sans lui aucun paiement récurrent ne survit.
- **Campagne feedback FR** : à envoyer en début de semaine, c'est elle qui
  alimente le dépouillement et le recrutement des entretiens.

## 6. Sortie attendue

Une page dans `docs/` : les cinq fiches d'entretien (contexte, verbatims,
grille), le dépouillement de la campagne, le tableau des scores et
l'ordre retenu du lot 4. Le masterplan §4 est alors mis à jour, et
l'implémenteur reçoit le lot 4 avec ses verrous.
