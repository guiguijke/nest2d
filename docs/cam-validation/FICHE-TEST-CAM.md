# Fiche de validation CAM — DXF Rust (mission v2 PR4, Phase 4)

Pack préparé par l'agent, **exécuté par Guillaume**. Les 4 DXF ci-dessous sont
générés par le chemin Rust (`nest-export`, AC1027, calques BIN_BOUNDARY=5 /
OUT_SHAPE=1 / CUT). Le round-trip ezdxf + `dxf_parser` de l'app est déjà exigé
en CI (PR3) ; cette validation **humaine** sur table plasma est le complément
indispensable, pas un substitut.

## Protocole SheetCam
Pour chaque fichier :
1. **Import** — le fichier s'ouvre sans erreur ni entité manquante.
2. **Calques/couleurs** — `CUT` (pièces), `BIN_BOUNDARY` (bleu, contour tôle),
   `OUT_SHAPE` (rouge, bbox ± space) reconnus et séparables en règles d'outils.
3. **Géométrie fidèle** — les contours suivent les arcs/congés (pas de
   facettisation visible) ; les trous des pièces à trous sont présents.
4. **Génération G-code** — parcours généré sans auto-intersection ni alarme.

## Protocole FluidNC (table plasma)
5. Charger le G-code ; **unités correctes** : le fichier mm usiné en mm, et
   `cam_4_…_inch` doit produire les mêmes cotes physiques en pouces (G20).

## Fichiers et attendus
| Fichier | Attendu |
|---|---|
| `cam_1_piece_simple.dxf` | rect + congé (bulge) lisse, 1 contour fermé |
| `cam_2_piece_trous.dxf` | plaque + 2 trous ; canaux absents du DXF de coupe (le canal n'existe que dans la géométrie de collision, pas dans l'export) |
| `cam_3_multi_rotations_mm.dxf` | 3 pièces à 0°/90°/37°, positions exactes, mm |
| `cam_4_multi_rotations_inch.dxf` | idem en pouces ($INSUNITS=1, $MEASUREMENT=0) |

## Critères de succès
- Aucune entité perdue vs le source (`_src_*.dxf`).
- Calques reconnus, couleurs préservées.
- Unités mm/pouce cohérentes (mesurer une cote connue : 80 mm / 3.1496 in).
- G-code FluidNC exécutant la même trajectoire dans les deux unités.

Toute divergence ⇒ entrée J + correctif dans `nest-export` avant activation du
flag en prod.
