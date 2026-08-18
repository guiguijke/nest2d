//! Post-pass de remplissage 2D (J-092), appliqué APRÈS la gravité.
//!
//! La gravité (gravity.rs) est monotone par axe : elle ne remonte jamais une
//! pièce. Deux symptômes restent donc irréparables par elle :
//!   - classe « left » : encoches en haut des colonnes de gauche (la pièce
//!     qui aurait comblé le trou est posée plus bas ailleurs) ;
//!   - classe « balanced » : |free_top − free_right| élevé — le corridor de
//!     la phase 2 est une borne max, rien ne force la largeur dedans.
//!
//! Ce module déplace des pièces individuelles, chaque candidat étant validé
//! par la CDE exacte du layout (même pattern que `gravity::pull_axis` :
//! retrait → sonde → re-placement). Garanties :
//!   - jamais de collision (toute position acceptée est sondée) ;
//!   - jamais de dépassement de la tôle (piège #6 fitsSheet) — la classe
//!     « balanced » peut élargir au-delà de la largeur incumbent (c'est son
//!     objet : rééquilibrer les chutes), mais jamais au-delà de la tôle ;
//!   - jamais de régression : si la métrique finale ne s'améliore pas (ou si
//!     la densité recule pour la classe « left »), le snapshot d'entrée est
//!     restauré.
//!   - déterminisme strict : tris total_cmp + tie-break (item_id, PItemKey),
//!     aucune transcendantale (piège #14b), séquentiel pur (piège #14c).

use jagua_rs::collision_detection::hazards::filter::NoFilter;
use jagua_rs::entities::{Instance, Item, PItemKey};
use jagua_rs::geometry::geo_traits::TransformableFrom;
use jagua_rs::geometry::primitives::SPolygon;
use jagua_rs::geometry::{DTransformation, Transformation};
use jagua_rs::probs::spp::entities::{SPPlacement, SPProblem};

/// Largeur des bandes verticales de la métrique d'escalier — reflète
/// exactement `bench/grid_metrics.py` (bandes de 100 mm).
const BAND_W: f32 = 100.0;
/// Une encoche n'est considérée que si sa profondeur dépasse
/// max(NOTCH_EPS_MM, NOTCH_EPS_RATIO × hauteur médiane des pièces).
const NOTCH_EPS_MM: f32 = 20.0;
const NOTCH_EPS_RATIO: f32 = 0.25;
/// Le restack colonnes ne se déclenche que si l'escalier dépasse 1 % de la
/// bbox utilisée (en dessous, le notch-fill suffit ou le gain est négligeable).
const RESTACK_STAIR_RATIO: f32 = 0.01;
/// Encoche « une cellule » (clustering x_min, pas les bandes 100 mm —
/// un carré 100 mm + space 2 chevauche deux bandes et devenait invisible).
/// Seuil = 0,5 × hauteur médiane + 10 mm (50 mm → 35, 100 mm → 60).
/// Trou interne dans une colonne : on tasse si le gap dépasse 8 mm
/// (les 2 mm de space des tests / de la gravité restent intacts).
const LOOSE_GAP_MM: f32 = 8.0;
/// Régression de densité tolérée (points) avant restauration du snapshot.
const DENSITY_TOL: f32 = 0.005;
/// Pas de la marche ascendante grossière (fraction de la hauteur pièce) et
/// nombre de pas de bisection de raffinement (comme gravity : contact =
/// collision dans jagua, on converge vers la position de contact + ε).
const WALK_STEPS: usize = 8;
const REFINE_STEPS: usize = 12;
/// Budget global de sondes CDE du notch-fill (borne le coût pire cas).
const PROBE_CAP: usize = 200_000;

/// Point d'entrée : dispatche par classe directionnelle. Appelé après la
/// gravité aux mêmes endroits qu'elle (spp.rs). « bottom » n'est jamais
/// touché (le banc ne montre pas d'escalier sur cette classe).
pub fn post_pass_for_bias(prob: &mut SPProblem, bias: Option<&str>, max_strip_width: Option<f32>) {
    if prob.n_placed_items() < 2 {
        return;
    }
    match bias {
        Some("bottom") => {}
        Some("balanced") => rebalance_balanced(prob, max_strip_width),
        // left + défaut (la gravité par défaut est déjà « left », J-088).
        _ => column_fill_left(prob),
    }
}

// ---------------------------------------------------------------------------
// Métriques internes (miroir de bench/grid_metrics.py)
// ---------------------------------------------------------------------------

/// Instantané géométrique d'un placement (bbox monde + transformation).
#[derive(Clone, Copy)]
struct Boxed {
    pk: PItemKey,
    item_id: usize,
    d_transf: DTransformation,
    x_min: f32,
    y_min: f32,
    x_max: f32,
    y_max: f32,
}

impl Boxed {
    fn w(&self) -> f32 {
        self.x_max - self.x_min
    }
    fn h(&self) -> f32 {
        self.y_max - self.y_min
    }
}

/// Collecte déterministe des placements, triée (x_min, y_min, item_id, pk).
fn placed_boxes(prob: &SPProblem) -> Vec<Boxed> {
    let mut v: Vec<Boxed> = prob
        .layout
        .placed_items
        .iter()
        .map(|(pk, pi)| Boxed {
            pk,
            item_id: pi.item_id,
            d_transf: pi.d_transf,
            x_min: pi.shape.bbox.x_min,
            y_min: pi.shape.bbox.y_min,
            x_max: pi.shape.bbox.x_max,
            y_max: pi.shape.bbox.y_max,
        })
        .collect();
    v.sort_by(|a, b| {
        a.x_min
            .total_cmp(&b.x_min)
            .then(a.y_min.total_cmp(&b.y_min))
            .then(a.item_id.cmp(&b.item_id))
            .then(a.pk.cmp(&b.pk))
    });
    v
}

/// Bande i couvrant [i·W, (i+1)·W] — même test d'appartenance que le banc.
fn band_range(b: &Boxed) -> (usize, usize) {
    let lo = ((b.x_min + 1e-6) / BAND_W).floor().max(0.0) as usize;
    let hi = ((b.x_max - 1e-6) / BAND_W).floor().max(0.0) as usize;
    (lo, hi.max(lo))
}

/// Sommet par bande occupée (None si bande vide), en partant de x=0.
fn band_tops(boxes: &[Boxed]) -> Vec<Option<f32>> {
    let n = boxes
        .iter()
        .map(|b| band_range(b).1 + 1)
        .max()
        .unwrap_or(0);
    let mut tops = vec![None; n];
    for b in boxes {
        let (lo, hi) = band_range(b);
        for t in tops.iter_mut().take(hi + 1).skip(lo) {
            *t = Some(t.map_or(b.y_max, |cur: f32| cur.max(b.y_max)));
        }
    }
    tops
}

/// Escalier des bandes : aire vide au-dessus des bandes plus courtes que la
/// plus haute (mm²). 0 = toutes les bandes occupées au même sommet.
fn band_stair(boxes: &[Boxed]) -> f32 {
    let tops = band_tops(boxes);
    let max_top = tops.iter().flatten().copied().fold(0.0f32, f32::max);
    tops.iter()
        .flatten()
        .map(|t| (max_top - t).max(0.0) * BAND_W)
        .sum()
}

fn used_width(boxes: &[Boxed]) -> f32 {
    boxes.iter().map(|b| b.x_max).fold(0.0f32, f32::max)
}

fn used_height(boxes: &[Boxed]) -> f32 {
    boxes.iter().map(|b| b.y_max).fold(0.0f32, f32::max)
}

fn median(values: &mut [f32]) -> f32 {
    values.sort_by(f32::total_cmp);
    if values.is_empty() {
        0.0
    } else {
        values[values.len() / 2]
    }
}

// ---------------------------------------------------------------------------
// Sondes CDE (même pattern que gravity::pull_axis)
// ---------------------------------------------------------------------------

/// Sonde de placement pour UNE pièce (hors du layout) à rotation figée.
/// `x`/`y` désignent le coin bas-gauche de la bbox monde visée.
struct Prober {
    item: Item,
    buffer: SPolygon,
    rotation: f32,
    x_off: f32, // bbox.x_min - translation.x au moment du retrait
    y_off: f32, // bbox.y_min - translation.y
}

impl Prober {
    fn new(prob: &SPProblem, b: &Boxed) -> Self {
        let item = prob.instance.item(b.item_id).clone();
        let t = b.d_transf.translation();
        let mut buffer = (*item.shape_cd).clone();
        buffer.surrogate = None; // transform rapide ; la détection utilise le polygone exact
        Prober {
            item,
            buffer,
            rotation: b.d_transf.rotation(),
            x_off: b.x_min - t.0,
            y_off: b.y_min - t.1,
        }
    }

    fn valid(&mut self, prob: &SPProblem, x: f32, y: f32) -> bool {
        let dt = DTransformation::new(self.rotation, (x - self.x_off, y - self.y_off));
        let transf: Transformation = dt.compose();
        self.buffer.transform_from(&self.item.shape_cd, &transf);
        !prob.layout.cde().detect_poly_collision(&self.buffer, &NoFilter)
    }
}

/// Plus basse ordonnée valide dans [y_lo, y_hi] pour la pièce sondée à `x`.
/// Stratégie : y_lo d'abord (optimum), puis marche grossière ascendante —
/// elle trouve la position tassée juste au-dessus du contact (empilement
/// serré, capacité maximale des colonnes). Si la marche ne trouve rien, on
/// sonde y_hi en dernier recours : la fenêtre utile est parfois étroite et
/// collée au haut de l'intervalle (plancher d'encoche + ε), la marche la
/// survolerait. Raffinement par bisection n'acceptant que des milieux
/// valides (sûr même si la faisabilité n'est pas monotone, comme gravity).
/// None si rien de valide.
fn settle_vertical(
    prober: &mut Prober,
    prob: &SPProblem,
    x: f32,
    y_lo: f32,
    y_hi: f32,
    step: f32,
    probes: &mut usize,
) -> Option<f32> {
    fn refine(
        prober: &mut Prober,
        prob: &SPProblem,
        x: f32,
        lo: f32,
        hi: f32,
        probes: &mut usize,
    ) -> f32 {
        let (mut lo, mut hi) = (lo, hi);
        for _ in 0..REFINE_STEPS {
            let mid = (lo + hi) / 2.0;
            *probes += 1;
            if prober.valid(prob, x, mid) {
                hi = mid;
            } else {
                lo = mid;
            }
        }
        hi
    }
    if y_lo > y_hi + 1e-6 {
        return None;
    }
    *probes += 1;
    if prober.valid(prob, x, y_lo) {
        return Some(y_lo);
    }
    let mut last_inv = y_lo;
    let mut y = y_lo + step;
    while y < y_hi - 1e-6 {
        *probes += 1;
        if prober.valid(prob, x, y) {
            return Some(refine(prober, prob, x, last_inv, y, probes));
        }
        last_inv = y;
        y += step;
    }
    *probes += 1;
    if prober.valid(prob, x, y_hi) {
        return Some(refine(prober, prob, x, last_inv, y_hi, probes));
    }
    None
}

/// Empreinte stable d'un placement (survit à un retrait/re-pose, contrairement
/// à la PItemKey que slotmap régénère).
fn fingerprint(b: &Boxed) -> (usize, u32, u32, u32, u32) {
    (
        b.item_id,
        b.x_min.to_bits(),
        b.y_min.to_bits(),
        b.x_max.to_bits(),
        b.y_max.to_bits(),
    )
}

/// Localise un placement par empreinte dans l'état COURANT du layout.
fn find_by_fingerprint(prob: &SPProblem, fp: &(usize, u32, u32, u32, u32)) -> Option<Boxed> {
    placed_boxes(prob).into_iter().find(|b| &fingerprint(b) == fp)
}

/// Pièces « protégées » : bbox strictement contenue dans celle d'une autre
/// pièce (filler niché dans le trou d'un hôte), ou contenant une autre pièce
/// (hôte occupé — le déplacer abandonnerait ses fillers). Le trou n'existe
/// pas côté moteur (piège #5) : la stricte inclusion de bbox est le seul
/// signal. Les pièces protégées ne sont JAMAIS déplacées.
fn protected_fingerprints(
    boxes: &[Boxed],
) -> std::collections::BTreeSet<(usize, u32, u32, u32, u32)> {
    let mut out = std::collections::BTreeSet::new();
    for (i, a) in boxes.iter().enumerate() {
        for (j, b) in boxes.iter().enumerate() {
            if i != j
                && a.x_min > b.x_min + 1e-6
                && a.y_min > b.y_min + 1e-6
                && a.x_max < b.x_max - 1e-6
                && a.y_max < b.y_max - 1e-6
            {
                out.insert(fingerprint(a)); // niché
                out.insert(fingerprint(b)); // hôte occupé
                break;
            }
        }
    }
    out
}

/// Replace `b` exactement à sa transformation d'origine (annulation d'un
/// déplacement refusé). Toujours valide : c'était la position de départ.
fn restore_item(prob: &mut SPProblem, b: &Boxed) {
    prob.place_item(SPPlacement {
        item_id: b.item_id,
        d_transf: b.d_transf,
    });
}

// ---------------------------------------------------------------------------
// Classe « left » : notch-fill puis restack colonnes si l'escalier persiste
// ---------------------------------------------------------------------------

fn column_fill_left(prob: &mut SPProblem) {
    let n = prob.n_placed_items();
    let snapshot = prob.save();
    let density0 = prob.density();
    let incumbent_w = prob.strip_width();
    let strip_h = prob.instance.base_strip.fixed_height;

    let moves = notch_fill(prob, incumbent_w, strip_h, 2 * n);
    let restacked = restack_columns(prob, incumbent_w, strip_h);
    let filled = fill_column_notches(prob, incumbent_w, strip_h);
    let tightened = tighten_loose_gaps(prob, incumbent_w, strip_h);
    let collapsed = collapse_rightmost(prob, incumbent_w, strip_h);

    if moves == 0 && !restacked && !filled && !tightened && !collapsed {
        return; // rien touché — pas même un fit_strip
    }
    // Garde finale : jamais de dépassement ni de régression de densité.
    if prob.strip_width() > incumbent_w + 1e-3 || prob.density() < density0 - DENSITY_TOL {
        prob.restore(&snapshot);
        return;
    }
    prob.fit_strip(); // resserre si le remplissage a libéré de la largeur
    debug_assert!(prob.layout.is_feasible());
}

/// Comble les encoches hautes des bandes de gauche avec des pièces prises
/// dans les bandes de droite (la plus à droite / en haut d'abord). Retourne
/// le nombre de déplacements acceptés.
fn notch_fill(prob: &mut SPProblem, incumbent_w: f32, strip_h: f32, move_cap: usize) -> usize {
    let mut moves = 0;
    let mut probes = 0usize;
    'outer: loop {
        let boxes = placed_boxes(prob);
        let protected = protected_fingerprints(&boxes);
        let tops = band_tops(&boxes);
        let max_top = tops.iter().flatten().copied().fold(0.0f32, f32::max);
        let mut heights: Vec<f32> = boxes.iter().map(|b| b.h()).collect();
        let notch_eps = NOTCH_EPS_MM.max(NOTCH_EPS_RATIO * median(&mut heights));
        let stair_here = band_stair(&boxes);

        let mut accepted = false;
        for (bi, top) in tops.iter().enumerate() {
            let Some(floor) = top else { continue };
            let floor = *floor;
            if max_top - floor <= notch_eps {
                continue; // pas une encoche
            }
            // Bord gauche de l'encoche = bord gauche des pièces de la bande.
            let x0 = boxes
                .iter()
                .filter(|b| band_range(b).0 <= bi && bi <= band_range(b).1)
                .map(|b| b.x_min)
                .fold(f32::INFINITY, f32::min);
            // Candidats : pièces n'occupant QUE des bandes à droite de bi,
            // les plus à droite d'abord, puis les plus hautes. On ne garde
            // que leur empreinte : un retrait/re-pose (candidat refusé)
            // régénère les PItemKey — la clé fraîche est résolue au moment
            // du retrait.
            let mut cands: Vec<Boxed> = boxes
                .iter()
                .copied()
                .filter(|b| band_range(b).0 > bi && !protected.contains(&fingerprint(b)))
                .collect();
            cands.sort_by(|a, b| {
                band_range(b)
                    .0
                    .cmp(&band_range(a).0)
                    .then(b.y_max.total_cmp(&a.y_max))
                    .then(a.item_id.cmp(&b.item_id))
                    .then(a.pk.cmp(&b.pk))
            });
            let cand_fps: Vec<_> = cands.iter().map(fingerprint).collect();
            for fp in cand_fps {
                if moves >= move_cap || probes > PROBE_CAP {
                    break 'outer;
                }
                let Some(cand) = find_by_fingerprint(prob, &fp) else {
                    continue;
                };
                let (h, step) = (cand.h(), (cand.h() / WALK_STEPS as f32).max(1.0));
                if h > max_top - floor + 1e-3 {
                    continue; // la forme ne tient pas dans l'encoche
                }
                let y_hi = (max_top - h).min(strip_h - h);
                if y_hi < floor - 1e-3 {
                    continue;
                }
                prob.remove_item(cand.pk);
                let mut prober = Prober::new(prob, &cand);
                let mut target = None;
                for dx in [0.0f32, 1.0, 2.0, 5.0, 10.0] {
                    if let Some(y) =
                        settle_vertical(&mut prober, prob, x0 + dx, floor, y_hi, step, &mut probes)
                    {
                        target = Some((x0 + dx, y));
                        break;
                    }
                }
                let ok = if let Some((x, y)) = target {
                    let dt = DTransformation::new(
                        prober.rotation,
                        (x - prober.x_off, y - prober.y_off),
                    );
                    let new_pk = prob.place_item(SPPlacement {
                        item_id: cand.item_id,
                        d_transf: dt,
                    });
                    let after = placed_boxes(prob);
                    let fits = used_width(&after) <= incumbent_w + 1e-3
                        && band_stair(&after) < stair_here - 1e-3;
                    if !fits {
                        prob.remove_item(new_pk);
                    }
                    fits
                } else {
                    false
                };
                if ok {
                    moves += 1;
                    accepted = true;
                    break; // encoche comblée : recalcul complet
                }
                // Refusé : remettre la pièce exactement où elle était.
                restore_item(prob, &cand);
            }
            if accepted {
                continue 'outer;
            }
        }
        if !accepted {
            break;
        }
    }
    moves
}

/// Re-constructif borné : si l'escalier reste élevé (layout en colonnes
/// « brique » figé par l'emboîtement des pointes — la gravité ne peut pas en
/// sortir), on reconstruit les colonnes de gauche à droite en posant chaque
/// pièce au sommet de la colonne la plus basse (settle vertical sondé CDE).
/// Restaure le snapshot d'entrée si le résultat n'améliore pas l'escalier.
/// Retourne true si le layout a changé.
fn restack_columns(prob: &mut SPProblem, incumbent_w: f32, strip_h: f32) -> bool {
    let boxes = placed_boxes(prob);
    let n = boxes.len();
    if n < 4 {
        return false;
    }
    let stair0 = band_stair(&boxes);
    let imbalance0 = column_imbalance(&boxes);
    let mut heights0: Vec<f32> = boxes.iter().map(|b| b.h()).collect();
    let cell = median(&mut heights0) * 0.5 + 10.0;
    let bbox_area = used_width(&boxes) * used_height(&boxes);
    // band_stair rate le cran 100+2 mm (chevauchement de bandes). L'écart
    // de sommets par clustering x_min le voit : 4 colonnes pleines + une
    // courte à droite (capture utilisateur 2026-08-18).
    if stair0 <= RESTACK_STAIR_RATIO * bbox_area && imbalance0 < cell {
        return false;
    }
    // Nichage (fillers dans des trous d'hôtes) : reconstruire éjecterait les
    // fillers — le restack est forclos dès qu'une pièce est protégée.
    if !protected_fingerprints(&boxes).is_empty() {
        return false;
    }
    // Colonnes visuelles : clustering sur x_min (seuil = demi-largeur
    // médiane — l'emboîtement brique décale légèrement les x_min d'une même
    // colonne, le chevauchement simple fusionnerait tout).
    let mut widths: Vec<f32> = boxes.iter().map(|b| b.w()).collect();
    let threshold = median(&mut widths) / 2.0;
    let mut col_x: Vec<f32> = Vec::new(); // x_min mini de chaque colonne
    let mut prev_x_min = f32::NEG_INFINITY;
    for b in &boxes {
        if b.x_min - prev_x_min > threshold {
            col_x.push(b.x_min);
        }
        prev_x_min = b.x_min;
    }
    if col_x.len() < 2 {
        return false;
    }

    let snapshot = prob.save();
    let density0 = prob.density();
    // Plafond = largeur déjà utilisée, PAS l'alignement sur 100 mm.
    // floor(used_w/100)*100 coupe la dernière colonne d'une grille
    // 100+2 mm (used_w=510 → cap=500, pièce à x=410 refusée) et le
    // restack restaurait le cran.
    let width_cap = used_width(&boxes);

    // Ordre de pose : bas-haut, gauche-droite, tie-breaks déterministes.
    let mut order = boxes.clone();
    order.sort_by(|a, b| {
        a.y_min
            .total_cmp(&b.y_min)
            .then(a.x_min.total_cmp(&b.x_min))
            .then(a.item_id.cmp(&b.item_id))
            .then(a.pk.cmp(&b.pk))
    });
    for b in &boxes {
        prob.remove_item(b.pk);
    }

    let mut col_tops = vec![0.0f32; col_x.len()];
    let mut probes = 0usize;
    let mut failed = false;
    for b in &order {
        let h = b.h();
        let step = (h / WALK_STEPS as f32).max(1.0);
        let y_hi = strip_h - h;
        // Colonne la plus basse d'abord (égalise les sommets), gauche en
        // cas d'égalité — c'est ce qui supprime l'escalier.
        let mut cols: Vec<usize> = (0..col_x.len()).collect();
        cols.sort_by(|&a, &b| col_tops[a].total_cmp(&col_tops[b]).then(a.cmp(&b)));
        let mut placed = false;
        'cols: for c in cols {
            if col_tops[c] > y_hi + 1e-3 {
                continue; // colonne pleine
            }
            // Liberté en x DANS la colonne : l'emboîtement brique exige un
            // décalage variable pour que les pointes manquent les voisins
            // (le layout d'origine montre ±13 mm de dispersion intra-colonne).
            // On garde le (dx, y) de plus BAS y (ordre de la ladder en
            // tie-break, déterministe).
            let mut prober = Prober::new(prob, b);
            let mut best: Option<(f32, f32)> = None; // (y, x)
            for dx in [0.0f32, 2.0, -2.0, 4.0, -4.0, 6.0, -6.0, 8.0, -8.0, 12.0, -12.0] {
                let x = col_x[c] + dx;
                if x < 0.0 || x + b.w() > width_cap + 1e-3 {
                    continue;
                }
                if let Some(y) = settle_vertical(
                    &mut prober,
                    prob,
                    x,
                    col_tops[c],
                    y_hi,
                    step,
                    &mut probes,
                ) && best.is_none_or(|(by, _)| y < by - 1e-6)
                {
                    best = Some((y, x));
                }
            }
            if let Some((y, x)) = best {
                let dt = DTransformation::new(
                    prober.rotation,
                    (x - prober.x_off, y - prober.y_off),
                );
                let pk = prob.place_item(SPPlacement {
                    item_id: b.item_id,
                    d_transf: dt,
                });
                col_tops[c] = prob.layout.placed_items.get(pk).map_or(y + h, |pi| {
                    pi.shape.bbox.y_max
                });
                placed = true;
                break 'cols;
            }
        }
        if !placed {
            failed = true;
            break;
        }
    }

    if !failed {
        prob.fit_strip();
        let after = placed_boxes(prob);
        let stair1 = band_stair(&after);
        let imbalance1 = column_imbalance(&after);
        if (stair1 < stair0 - 1e-3 || imbalance1 < imbalance0 - 1.0)
            && prob.strip_width() <= incumbent_w + 1e-3
            && prob.density() >= density0 - DENSITY_TOL
        {
            return true;
        }
    }
    prob.restore(&snapshot);
    false
}

/// Colonnes visuelles : même clustering que `restack_columns` (x_min, seuil
/// = demi-largeur médiane). `boxes` doit être trié par x_min.
fn cluster_columns(boxes: &[Boxed]) -> Vec<Vec<Boxed>> {
    if boxes.is_empty() {
        return Vec::new();
    }
    let mut widths: Vec<f32> = boxes.iter().map(|b| b.w()).collect();
    let threshold = (median(&mut widths) / 2.0).max(1.0);
    let mut cols: Vec<Vec<Boxed>> = Vec::new();
    let mut prev = f32::NEG_INFINITY;
    for b in boxes {
        if cols.is_empty() || b.x_min - prev > threshold {
            cols.push(vec![*b]);
        } else {
            cols.last_mut().unwrap().push(*b);
        }
        prev = b.x_min;
    }
    cols
}

fn col_top(col: &[Boxed]) -> f32 {
    col.iter().map(|b| b.y_max).fold(0.0f32, f32::max)
}

fn col_x0(col: &[Boxed]) -> f32 {
    col.iter().map(|b| b.x_min).fold(f32::INFINITY, f32::min)
}

/// Écart de hauteur entre la colonne la plus haute et la plus basse
/// (clustering x_min). 0 = rectangle parfait. C'est la métrique qui
/// voit le cran du cas 100 mm + space 2 — `band_stair` le manque
/// (chaque pièce chevauche deux bandes de 100 mm).
fn column_imbalance(boxes: &[Boxed]) -> f32 {
    let cols = cluster_columns(boxes);
    if cols.len() < 2 {
        return 0.0;
    }
    let mut max_t = 0.0f32;
    let mut min_t = f32::INFINITY;
    for c in &cols {
        let t = col_top(c);
        max_t = max_t.max(t);
        min_t = min_t.min(t);
    }
    (max_t - min_t).max(0.0)
}

/// Rebouche les crans d'une cellule : une colonne plus basse que ses
/// voisines de droite récupère la pièce la plus haute à droite.
/// Clustering x_min (pas les bandes 100 mm) — c'est le cran visible sur
/// la grille régulière 100 mm + 2 mm d'écart.
fn fill_column_notches(prob: &mut SPProblem, incumbent_w: f32, strip_h: f32) -> bool {
    let mut any = false;
    let mut probes = 0usize;
    loop {
        let boxes = placed_boxes(prob);
        if boxes.len() < 3 {
            break;
        }
        let protected = protected_fingerprints(&boxes);
        let cols = cluster_columns(&boxes);
        if cols.len() < 2 {
            break;
        }
        let mut heights: Vec<f32> = boxes.iter().map(|b| b.h()).collect();
        let cell = median(&mut heights) * 0.5 + 10.0;
        let tops: Vec<f32> = cols.iter().map(|c| col_top(c)).collect();
        let max_top = tops.iter().copied().fold(0.0f32, f32::max);
        let imb_before = column_imbalance(&boxes);

        let mut moved = false;
        'cols: for (i, col) in cols.iter().enumerate() {
            if max_top - tops[i] < cell {
                continue;
            }
            let x0 = col_x0(col);
            let floor = tops[i];
            // Donneurs = sommet des colonnes PLUS HAUTES (gauche ou droite).
            // L'ancienne restriction « à droite seulement » laissait le cran
            // intact quand la colonne courte est la dernière (cas utilisateur :
            // 4 colonnes pleines + 5e partielle en bas).
            let mut donors: Vec<Boxed> = cols
                .iter()
                .enumerate()
                .filter(|(j, _)| *j != i && tops[*j] > floor + cell)
                .flat_map(|(_, c)| c.iter().copied())
                .filter(|b| !protected.contains(&fingerprint(b)))
                .collect();
            donors.sort_by(|a, b| {
                b.y_max
                    .total_cmp(&a.y_max)
                    .then(b.x_min.total_cmp(&a.x_min))
                    .then(a.item_id.cmp(&b.item_id))
            });
            for donor in donors {
                if probes > PROBE_CAP {
                    return any;
                }
                if donor.h() > max_top - floor + 1e-3 {
                    continue;
                }
                let y_hi = (max_top - donor.h()).min(strip_h - donor.h());
                if y_hi < floor - 1e-3 {
                    continue;
                }
                let Some(live) = find_by_fingerprint(prob, &fingerprint(&donor)) else {
                    continue;
                };
                prob.remove_item(live.pk);
                let mut prober = Prober::new(prob, &live);
                let mut target = None;
                for dx in [0.0f32, 1.0, 2.0, -1.0, 4.0, -2.0, 8.0] {
                    let x = x0 + dx;
                    if x < 0.0 {
                        continue;
                    }
                    if let Some(y) =
                        settle_vertical(&mut prober, prob, x, floor, y_hi, (donor.h() / WALK_STEPS as f32).max(1.0), &mut probes)
                    {
                        target = Some((x, y));
                        break;
                    }
                }
                let ok = if let Some((x, y)) = target {
                    let dt = DTransformation::new(
                        prober.rotation,
                        (x - prober.x_off, y - prober.y_off),
                    );
                    let new_pk = prob.place_item(SPPlacement {
                        item_id: live.item_id,
                        d_transf: dt,
                    });
                    let after = placed_boxes(prob);
                    let cols_after = cluster_columns(&after);
                    let dest_top = cols_after.get(i).map(|c| col_top(c)).unwrap_or(0.0);
                    let imb1 = column_imbalance(&after);
                    let fits = used_width(&after) <= incumbent_w + 1e-3
                        && dest_top > floor + 1.0
                        && imb1 < imb_before - 1.0;
                    if !fits {
                        prob.remove_item(new_pk);
                    }
                    fits
                } else {
                    false
                };
                if ok {
                    any = true;
                    moved = true;
                    break 'cols;
                }
                restore_item(prob, &live);
            }
        }
        if !moved {
            break;
        }
    }
    any
}

/// Tasse les gaps internes d'une colonne (> LOOSE_GAP_MM). La gravité
/// Down peut rester bloquée par un décalage X / emboîtement.
fn tighten_loose_gaps(prob: &mut SPProblem, incumbent_w: f32, _strip_h: f32) -> bool {
    let boxes = placed_boxes(prob);
    if boxes.len() < 2 {
        return false;
    }
    if !protected_fingerprints(&boxes).is_empty() {
        return false;
    }
    let cols = cluster_columns(&boxes);
    let snapshot = prob.save();
    let w0 = incumbent_w;
    let mut any = false;
    let mut probes = 0usize;
    for col in cols {
        if col.len() < 2 {
            continue;
        }
        let mut ordered = col;
        ordered.sort_by(|a, b| {
            a.y_min
                .total_cmp(&b.y_min)
                .then(a.item_id.cmp(&b.item_id))
        });
        for i in 1..ordered.len() {
            let gap = ordered[i].y_min - ordered[i - 1].y_max;
            if gap < LOOSE_GAP_MM {
                continue;
            }
            let Some(live) = find_by_fingerprint(prob, &fingerprint(&ordered[i])) else {
                continue;
            };
            let floor = ordered[i - 1].y_max;
            let x0 = live.x_min;
            prob.remove_item(live.pk);
            let mut prober = Prober::new(prob, &live);
            let step = (live.h() / WALK_STEPS as f32).max(1.0);
            let y = settle_vertical(
                &mut prober,
                prob,
                x0,
                floor,
                live.y_min,
                step,
                &mut probes,
            );
            if let Some(y) = y {
                if y < live.y_min - 0.5 {
                    let dt = DTransformation::new(
                        prober.rotation,
                        (x0 - prober.x_off, y - prober.y_off),
                    );
                    let pk = prob.place_item(SPPlacement {
                        item_id: live.item_id,
                        d_transf: dt,
                    });
                    if let Some(pi) = prob.layout.placed_items.get(pk) {
                        ordered[i].y_min = pi.shape.bbox.y_min;
                        ordered[i].y_max = pi.shape.bbox.y_max;
                        ordered[i].pk = pk;
                    }
                    any = true;
                    continue;
                }
            }
            restore_item(prob, &live);
        }
    }
    if any && used_width(&placed_boxes(prob)) > w0 + 1e-3 {
        prob.restore(&snapshot);
        return false;
    }
    any
}

/// Vide la colonne la plus à droite sur le sommet des colonnes de gauche
/// tant qu'il reste de la place (SPP left = minimiser la largeur). Sans
/// ça, un reste de 5-6 pièces reste collé en bas à droite alors que les
/// colonnes de gauche ont encore de la tête (capture 2026-08-18).
fn collapse_rightmost(prob: &mut SPProblem, incumbent_w: f32, strip_h: f32) -> bool {
    let mut any = false;
    let mut probes = 0usize;
    loop {
        let boxes = placed_boxes(prob);
        if boxes.len() < 3 {
            break;
        }
        let protected = protected_fingerprints(&boxes);
        let cols = cluster_columns(&boxes);
        if cols.len() < 2 {
            break;
        }
        let last = cols.len() - 1;
        let mut donors: Vec<Boxed> = cols[last]
            .iter()
            .copied()
            .filter(|b| !protected.contains(&fingerprint(b)))
            .collect();
        if donors.is_empty() {
            break;
        }
        donors.sort_by(|a, b| {
            b.y_max
                .total_cmp(&a.y_max)
                .then(a.item_id.cmp(&b.item_id))
        });
        let donor = donors[0];
        let w0 = used_width(&boxes);
        let mut dests: Vec<(usize, f32, f32)> = cols
            .iter()
            .enumerate()
            .take(last)
            .map(|(i, c)| (i, col_x0(c), col_top(c)))
            .collect();
        dests.sort_by(|a, b| a.2.total_cmp(&b.2).then(a.0.cmp(&b.0)));

        let Some(live) = find_by_fingerprint(prob, &fingerprint(&donor)) else {
            break;
        };
        let y_hi = strip_h - live.h();
        prob.remove_item(live.pk);
        let mut prober = Prober::new(prob, &live);
        let mut target = None;
        let step = (live.h() / WALK_STEPS as f32).max(1.0);
        'dests: for (_, x0, floor) in dests {
            if floor > y_hi + 1e-3 {
                continue;
            }
            for dx in [0.0f32, 1.0, 2.0, -1.0, 4.0, -2.0] {
                let x = x0 + dx;
                if x < 0.0 {
                    continue;
                }
                if let Some(y) =
                    settle_vertical(&mut prober, prob, x, floor, y_hi, step, &mut probes)
                {
                    target = Some((x, y));
                    break 'dests;
                }
            }
        }
        let ok = if let Some((x, y)) = target {
            let dt = DTransformation::new(
                prober.rotation,
                (x - prober.x_off, y - prober.y_off),
            );
            let new_pk = prob.place_item(SPPlacement {
                item_id: live.item_id,
                d_transf: dt,
            });
            let after = placed_boxes(prob);
            let fits = used_width(&after) <= w0 + 1e-3
                && used_width(&after) <= incumbent_w + 1e-3
                && (used_width(&after) < w0 - 1.0 || column_imbalance(&after) < column_imbalance(&boxes) - 1.0);
            if !fits {
                prob.remove_item(new_pk);
            }
            fits
        } else {
            false
        };
        if ok {
            any = true;
            continue;
        }
        restore_item(prob, &live);
        break;
    }
    any
}

// ---------------------------------------------------------------------------
// Classe « balanced » : réduire |free_top − free_right|
// ---------------------------------------------------------------------------

/// Déplace des pièces vers la chute libre (droite si le layout est trop
/// étroit/haut, haut s'il est trop large/bas), CDE-validé, sans jamais
/// dépasser `max_strip_width` (fitsSheet, piège #6).
///
/// J-092 suite : l'élargissement était borné par une garde densité (−1 pt) —
/// la densité strip (aire/(w×H)) chutant dès qu'on élargit, le plafond
/// n'autorisait que ~+1,4 % de la largeur (~+9 mm au banc capsules) alors
/// qu'une pièce fait ~200 mm : AUCUN déplacement n'était possible et
/// |delta| restait ~140 mm. La borne est désormais purement PHYSIQUE : la
/// largeur de tôle, jamais au-delà. Le corridor de la phase 2 n'est pas
/// repris ici : il est saturé par construction (mesuré au banc : used_w
/// 681,7 mm pour un corridor de 683 mm) — un plafond corridor serait un
/// no-op. L'acceptation reste stricte : |delta| doit décroître à chaque
/// déplacement ET à l'issue, sinon restore du snapshot d'entrée.
fn rebalance_balanced(prob: &mut SPProblem, max_strip_width: Option<f32>) {
    let Some(sheet_w) = max_strip_width else {
        return; // pas de borne tôle : les directions n'ont pas de sens
    };
    let strip_h = prob.instance.base_strip.fixed_height;
    let snapshot = prob.save();
    let incumbent_w = prob.strip_width();
    let w_cap = sheet_w;
    let delta = |boxes: &[Boxed]| {
        let free_top = strip_h - used_height(boxes);
        let free_right = sheet_w - used_width(boxes);
        (free_top - free_right).abs()
    };
    let delta0 = delta(&placed_boxes(prob));
    let entry_used_w = used_width(&placed_boxes(prob));
    let entry_used_h = used_height(&placed_boxes(prob));
    let n = prob.n_placed_items();
    let mut moves = 0;
    let mut probes = 0usize;

    let boxes0 = placed_boxes(prob);
    let free_top0 = strip_h - used_height(&boxes0);
    let free_right0 = sheet_w - used_width(&boxes0);

    if free_right0 > free_top0 && w_cap > entry_used_w + 1.0 {
        // Trop étroit/haut : déplacer les pièces du haut vers la bande
        // libre de droite (élargir, raccourcir).
        prob.change_strip_width(w_cap); // ouvre le couloir droit à la CDE
        'outer: loop {
            let boxes = placed_boxes(prob);
            let protected = protected_fingerprints(&boxes);
            let delta_here = delta(&boxes);
            let mut cands: Vec<Boxed> = boxes
                .iter()
                .copied()
                .filter(|b| !protected.contains(&fingerprint(b)))
                .collect();
            // Les plus hautes d'abord : ce sont elles qui font used_h.
            cands.sort_by(|a, b| {
                b.y_min
                    .total_cmp(&a.y_min)
                    .then(a.x_min.total_cmp(&b.x_min))
                    .then(a.item_id.cmp(&b.item_id))
                    .then(a.pk.cmp(&b.pk))
            });
            let mut accepted = false;
            for cand in cands {
                if moves >= 2 * n || probes > PROBE_CAP {
                    break 'outer;
                }
                let (w, h) = (cand.w(), cand.h());
                let step = (h / WALK_STEPS as f32).max(1.0);
                // Extrêmes sans le candidat (son retrait peut abaisser le
                // sommet / le bord droit) — base du delta PRÉDIT.
                let cand_fp = fingerprint(&cand);
                let mut uw_rem = 0.0f32;
                let mut uh_rem = 0.0f32;
                for b in &boxes {
                    if fingerprint(b) != cand_fp {
                        uw_rem = uw_rem.max(b.x_max);
                        uh_rem = uh_rem.max(b.y_max);
                    }
                }
                prob.remove_item(cand.pk);
                let mut prober = Prober::new(prob, &cand);
                // Meilleure cible de la ladder au delta prédit. Itération dx
                // croissant + amélioration stricte ⇒ tie-break au plus petit
                // dx (moins d'élargissement, densité préservée).
                let mut best: Option<(f32, f32, f32)> = None; // (delta, x, y)
                for dx in [0.0f32, 1.0, 2.0, 4.0, 8.0, 16.0, 32.0] {
                    let x = entry_used_w + dx;
                    if x + w > w_cap + 1e-3 {
                        break;
                    }
                    // (a) tasser au bas de la bande libre.
                    if let Some(y) = settle_vertical(
                        &mut prober, prob, x, 0.0, strip_h - h, step, &mut probes,
                    ) {
                        let d = ((strip_h - uh_rem.max(y + h))
                            - (sheet_w - uw_rem.max(x + w)))
                        .abs();
                        if best.is_none_or(|(bd, _, _)| d < bd - 1e-6) {
                            best = Some((d, x, y));
                        }
                    }
                    // (b) viser l'équilibre : la pièce devient le sommet avec
                    // free_top == free_right (chutes équilibrées à epsilon).
                    let fr = sheet_w - uw_rem.max(x + w);
                    let y_bal = strip_h - fr - h;
                    if y_bal >= 0.0 && y_bal + h > uh_rem + 1e-6 {
                        probes += 1;
                        if prober.valid(prob, x, y_bal) {
                            let d = ((strip_h - (y_bal + h)) - fr).abs();
                            if best.is_none_or(|(bd, _, _)| d < bd - 1e-6) {
                                best = Some((d, x, y_bal));
                            }
                        }
                    }
                }
                // Pas d'amélioration stricte prédite : inutile de poser.
                let ok = match best {
                    Some((d, x, y)) if d < delta_here - 1e-3 => {
                        let dt = DTransformation::new(
                            prober.rotation,
                            (x - prober.x_off, y - prober.y_off),
                        );
                        let new_pk = prob.place_item(SPPlacement {
                            item_id: cand.item_id,
                            d_transf: dt,
                        });
                        // Le delta RÉEL (post-pose) fait foi — la prédiction
                        // ne sert qu'à choisir la cible.
                        let fits = delta(&placed_boxes(prob)) < delta_here - 1e-3;
                        if !fits {
                            prob.remove_item(new_pk);
                        }
                        fits
                    }
                    _ => false,
                };
                if ok {
                    moves += 1;
                    accepted = true;
                    break;
                }
                restore_item(prob, &cand);
            }
            if !accepted {
                break;
            }
        }
    } else if free_top0 > free_right0 {
        // Trop large/bas : déplacer les pièces les plus à droite au-dessus
        // du blob (raccourcir, allonger), sans dépasser la hauteur de tôle.
        'outer: loop {
            let boxes = placed_boxes(prob);
            let protected = protected_fingerprints(&boxes);
            let delta_here = delta(&boxes);
            let mut cands: Vec<Boxed> = boxes
                .iter()
                .copied()
                .filter(|b| !protected.contains(&fingerprint(b)))
                .collect();
            cands.sort_by(|a, b| {
                b.x_max
                    .total_cmp(&a.x_max)
                    .then(a.y_min.total_cmp(&b.y_min))
                    .then(a.item_id.cmp(&b.item_id))
                    .then(a.pk.cmp(&b.pk))
            });
            let mut accepted = false;
            for cand in cands {
                if moves >= 2 * n || probes > PROBE_CAP {
                    break 'outer;
                }
                let h = cand.h();
                let cand_fp = fingerprint(&cand);
                let mut uw_rem = 0.0f32;
                let mut uh_rem = 0.0f32;
                for b in &boxes {
                    if fingerprint(b) != cand_fp {
                        uw_rem = uw_rem.max(b.x_max);
                        uh_rem = uh_rem.max(b.y_max);
                    }
                }
                // La pièce garde son x : la largeur utilisée ne change pas.
                let uw2 = uw_rem.max(cand.x_max);
                prob.remove_item(cand.pk);
                let mut prober = Prober::new(prob, &cand);
                let mut best: Option<(f32, f32)> = None; // (delta, y)
                for dy in [0.0f32, 1.0, 2.0, 4.0, 8.0, 16.0, 32.0] {
                    let y = entry_used_h + dy;
                    if y + h > strip_h - 1e-3 {
                        break;
                    }
                    // (a) poser juste au-dessus du blob.
                    probes += 1;
                    if prober.valid(prob, cand.x_min, y) {
                        let d = ((strip_h - uh_rem.max(y + h)) - (sheet_w - uw2)).abs();
                        if best.is_none_or(|(bd, _)| d < bd - 1e-6) {
                            best = Some((d, y));
                        }
                    }
                    // (b) viser l'équilibre free_top == free_right.
                    let fr = sheet_w - uw2;
                    let y_bal = strip_h - fr - h;
                    if y_bal >= 0.0 && y_bal + h > uh_rem + 1e-6 {
                        probes += 1;
                        if prober.valid(prob, cand.x_min, y_bal) {
                            let d = ((strip_h - (y_bal + h)) - fr).abs();
                            if best.is_none_or(|(bd, _)| d < bd - 1e-6) {
                                best = Some((d, y_bal));
                            }
                        }
                    }
                }
                let ok = match best {
                    Some((d, y)) if d < delta_here - 1e-3 => {
                        let dt = DTransformation::new(
                            prober.rotation,
                            (cand.x_min - prober.x_off, y - prober.y_off),
                        );
                        let new_pk = prob.place_item(SPPlacement {
                            item_id: cand.item_id,
                            d_transf: dt,
                        });
                        let after = placed_boxes(prob);
                        let fits = used_width(&after) <= incumbent_w + 1e-3
                            && delta(&after) < delta_here - 1e-3;
                        if !fits {
                            prob.remove_item(new_pk);
                        }
                        fits
                    }
                    _ => false,
                };
                if ok {
                    moves += 1;
                    accepted = true;
                    break;
                }
                restore_item(prob, &cand);
            }
            if !accepted {
                break;
            }
        }
    }

    if moves == 0 {
        prob.restore(&snapshot); // annule aussi l'éventuel change_strip_width
        return;
    }
    prob.fit_strip();
    let delta1 = delta(&placed_boxes(prob));
    if delta1 >= delta0 - 1e-3 || prob.strip_width() > w_cap + 1e-3 {
        prob.restore(&snapshot);
    }
    debug_assert!(prob.layout.is_feasible());
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use jagua_rs::io::import::Importer;
    use jagua_rs::probs::spp::io::ext_repr::ExtSPInstance;
    use jagua_rs::probs::spp::io::import_instance;

    /// Instance mono-type rectangle `w`×`h`, demande `n`, sans séparation.
    fn rect_instance(w: f32, h: f32, demand: usize, strip_h: f32) -> jagua_rs::probs::spp::entities::SPInstance {
        let json = serde_json::json!({
            "name": "column-fill-test",
            "strip_height": strip_h,
            "items": [{
                "id": 0,
                "demand": demand,
                "allowed_orientations": [0.0],
                "shape": {"type": "simple_polygon", "data": [[0,0],[w,0],[w,h],[0,h],[0,0]]}
            }]
        });
        let ext: ExtSPInstance = serde_json::from_value(json).unwrap();
        let importer = Importer::new(
            sparrow::config::DEFAULT_SPARROW_CONFIG.cde_config,
            Some(0.001),
            None,
            Some((0.01, 0.01)),
        );
        import_instance(&importer, &ext).unwrap()
    }

    /// Pose une pièce en visant le coin bas-gauche (x, y) de sa bbox monde —
    /// jagua centre les shapes sur la translation à l'import.
    fn place(prob: &mut SPProblem, w: f32, h: f32, x: f32, y: f32) {
        prob.place_item(SPPlacement {
            item_id: 0,
            d_transf: DTransformation::new(0.0, (x + w / 2.0, y + h / 2.0)),
        });
    }

    fn feasibility_ok(prob: &SPProblem) -> bool {
        prob.layout.is_feasible()
    }

    /// Encoche à gauche comblée par une pièce de droite : l'escalier doit
    /// décroître, la largeur ne doit pas bouger, le layout reste faisable.
    #[test]
    fn notch_fill_reduces_stair() {
        // Rects 100×50. Col A (bandes 0-1) : 1 pièce, top 52.5.
        // Col B (bandes 2-3) : 3 pièces, top 156.5 → encoche de 104 ≥ eps.
        let (w_, h_) = (100.0, 50.0);
        let mut prob = SPProblem::new(rect_instance(w_, h_, 4, 1000.0));
        prob.change_strip_width(600.0);
        place(&mut prob, w_, h_, 2.5, 2.5);
        place(&mut prob, w_, h_, 204.5, 2.5);
        place(&mut prob, w_, h_, 204.5, 54.5);
        place(&mut prob, w_, h_, 204.5, 106.5);
        assert!(feasibility_ok(&prob));
        let stair0 = band_stair(&placed_boxes(&prob));
        assert!(stair0 > 20_000.0, "stair initial {stair0}");

        post_pass_for_bias(&mut prob, Some("left"), Some(600.0));

        let stair1 = band_stair(&placed_boxes(&prob));
        assert!(stair1 < 1_000.0, "stair {stair0} -> {stair1}");
        assert!(prob.strip_width() <= 600.0 + 1e-3);
        assert!(feasibility_ok(&prob));
    }

    /// Layout déjà propre : le post-pass ne doit rien changer (restore à
    /// l'identique — jamais de dégradation).
    #[test]
    fn clean_layout_is_untouched() {
        let (w_, h_) = (100.0, 50.0);
        let mut prob = SPProblem::new(rect_instance(w_, h_, 2, 1000.0));
        prob.change_strip_width(600.0);
        place(&mut prob, w_, h_, 2.5, 2.5);
        place(&mut prob, w_, h_, 104.5, 2.5);
        let stair0 = band_stair(&placed_boxes(&prob));
        let w0 = prob.strip_width();
        let boxes0 = placed_boxes(&prob);

        post_pass_for_bias(&mut prob, Some("left"), Some(600.0));

        assert_eq!(band_stair(&placed_boxes(&prob)), stair0);
        assert_eq!(prob.strip_width(), w0);
        let boxes1 = placed_boxes(&prob);
        for (a, b) in boxes0.iter().zip(boxes1.iter()) {
            assert_eq!(a.d_transf.translation(), b.d_transf.translation());
        }
    }

    /// Encoche trop petite pour la seule forme dispo : aucun déplacement,
    /// et le restack (qui empirerait ici) doit restaurer le snapshot.
    #[test]
    fn no_move_when_nothing_fits_and_restack_restores() {
        // Col A : 1 pièce flottante top 74.5. Col B : tops 52.5 et 104.5.
        // Encoche bande 0-1 : profondeur 30 ≥ eps(20) mais < h(50) → pas de
        // candidat. Le restack produirait des colonnes 100/50 (pire) → restore.
        let (w_, h_) = (100.0, 50.0);
        let mut prob = SPProblem::new(rect_instance(w_, h_, 3, 1000.0));
        prob.change_strip_width(600.0);
        place(&mut prob, w_, h_, 2.5, 24.5);
        place(&mut prob, w_, h_, 204.5, 2.5);
        place(&mut prob, w_, h_, 204.5, 54.5);
        assert!(feasibility_ok(&prob));
        let stair0 = band_stair(&placed_boxes(&prob));
        assert!((6_000.0..7_000.0).contains(&stair0), "stair {stair0}");
        let w0 = prob.strip_width();

        post_pass_for_bias(&mut prob, Some("left"), Some(600.0));

        assert_eq!(band_stair(&placed_boxes(&prob)), stair0);
        assert_eq!(prob.strip_width(), w0);
        assert!(feasibility_ok(&prob));
    }

    /// Colonnes brique déséquilibrées (sommets 104.5 / 156.5 / 52.5) :
    /// le restack égalise les sommets et l'escalier s'effondre.
    #[test]
    fn restack_equalizes_column_tops() {
        let (w_, h_) = (100.0, 50.0);
        let mut prob = SPProblem::new(rect_instance(w_, h_, 6, 1000.0));
        prob.change_strip_width(600.0);
        place(&mut prob, w_, h_, 2.5, 2.5);
        place(&mut prob, w_, h_, 2.5, 54.5);
        place(&mut prob, w_, h_, 104.5, 2.5);
        place(&mut prob, w_, h_, 104.5, 54.5);
        place(&mut prob, w_, h_, 104.5, 106.5);
        place(&mut prob, w_, h_, 206.5, 2.5);
        assert!(feasibility_ok(&prob));
        let stair0 = band_stair(&placed_boxes(&prob));
        assert!(stair0 > 15_000.0, "stair {stair0}");

        post_pass_for_bias(&mut prob, Some("left"), Some(600.0));

        let boxes = placed_boxes(&prob);
        let stair1 = band_stair(&boxes);
        assert_eq!(boxes.len(), 6);
        assert!(stair1 < 1_000.0, "stair {stair0} -> {stair1}");
        assert!(prob.strip_width() <= 600.0 + 1e-3);
        assert!(feasibility_ok(&prob));
    }

    /// Balanced : pile étroite et haute dans une tôle large — le rééquilibrage
    /// déplace des pièces vers la droite et |delta| diminue, sans jamais
    /// dépasser la tôle. (J-092 suite : la garde densité a été remplacée par
    /// la borne physique — l'élargissement rogne la densité strip par
    /// construction, c'est le prix assumé de l'équilibre des chutes.)
    #[test]
    fn rebalance_balanced_reduces_delta() {
        // Rects 50×50 empilés x∈[2.5,52.5], 4 hauteurs → used_h ≈ 200.
        let (w_, h_) = (50.0, 50.0);
        let mut prob = SPProblem::new(rect_instance(w_, h_, 4, 400.0));
        prob.change_strip_width(100.0);
        place(&mut prob, w_, h_, 2.5, 2.5);
        place(&mut prob, w_, h_, 2.5, 54.5);
        place(&mut prob, w_, h_, 2.5, 106.5);
        place(&mut prob, w_, h_, 2.5, 158.5);
        assert!(feasibility_ok(&prob));
        let delta0 = {
            let b = placed_boxes(&prob);
            ((400.0 - used_height(&b)) - (600.0 - used_width(&b))).abs()
        };
        assert!(delta0 > 300.0, "delta0 {delta0}");

        post_pass_for_bias(&mut prob, Some("balanced"), Some(600.0));

        let b = placed_boxes(&prob);
        let delta1 = ((400.0 - used_height(&b)) - (600.0 - used_width(&b))).abs();
        assert!(delta1 < delta0 - 50.0, "delta {delta0} -> {delta1}");
        assert!(prob.strip_width() <= 600.0 + 1e-3);
        assert!(feasibility_ok(&prob));
    }

    /// J-092 suite : le spread n'est plus bridé par la garde densité. Pièces
    /// de 200×100 empilées (colonne de 16, used_w ≈ 202 mm) : l'ancienne
    /// borne (densité −1 pt) plafonnait l'élargissement à ~+1,4 % (~213 mm)
    /// — moins qu'UNE largeur de pièce, zéro déplacement possible. La borne
    /// physique (tôle 1000 mm) laisse le spread déplacer des pièces de la
    /// bande haute vers la chute de droite jusqu'à l'équilibre des chutes.
    #[test]
    fn rebalance_balanced_spreads_up_to_sheet() {
        let (w_, h_) = (200.0, 100.0);
        let mut prob = SPProblem::new(rect_instance(w_, h_, 16, 2000.0));
        prob.change_strip_width(210.0);
        for i in 0..16 {
            place(&mut prob, w_, h_, 2.5, 2.5 + i as f32 * 102.0);
        }
        assert!(feasibility_ok(&prob));
        let boxes0 = placed_boxes(&prob);
        let used_w0 = used_width(&boxes0);
        let delta0 = ((2000.0 - used_height(&boxes0)) - (1000.0 - used_w0)).abs();
        assert!(delta0 > 400.0, "delta0 {delta0}");
        // Ancien plafond (garde densité −1 pt) : ~1,014 × 210 ≈ 213 mm —
        // documente ce que le test verrouille (le spread va bien au-delà).
        let d0 = prob.density();
        let old_cap = 1000.0f32.min(210.0 * d0 / (d0 - 0.01));
        assert!(old_cap < 220.0, "old_cap {old_cap}");

        post_pass_for_bias(&mut prob, Some("balanced"), Some(1000.0));

        let b = placed_boxes(&prob);
        let delta1 = ((2000.0 - used_height(&b)) - (1000.0 - used_width(&b))).abs();
        assert!(delta1 < delta0 - 300.0, "delta {delta0} -> {delta1}");
        assert!(
            used_width(&b) > old_cap + 100.0,
            "le spread dépasse l'ancienne borne : used_w {}",
            used_width(&b)
        );
        assert!(prob.strip_width() <= 1000.0 + 1e-3, "fitsSheet");
        assert!(feasibility_ok(&prob));
    }

    /// Cran d'une cellule sur une grille régulière (colonne du milieu plus
    /// courte, pièce isolée à droite) : les bandes 100 mm ne le voient pas
    /// (pièce 100 mm + space 2 chevauche deux bandes). Le clustering x_min
    /// doit reboucher le cran.
    #[test]
    fn one_cell_notch_on_regular_grid_is_filled() {
        let (w_, h_) = (100.0, 50.0);
        let mut prob = SPProblem::new(rect_instance(w_, h_, 12, 1000.0));
        prob.change_strip_width(600.0);
        // 4 colonnes × 3, sauf col 1 à 2 pièces ; + 1 pièce isolée à droite.
        for (x, ys) in [
            (2.5, &[2.5, 54.5, 106.5][..]),
            (104.5, &[2.5, 54.5][..]),
            (206.5, &[2.5, 54.5, 106.5][..]),
            (308.5, &[2.5, 54.5, 106.5][..]),
        ] {
            for &y in ys {
                place(&mut prob, w_, h_, x, y);
            }
        }
        place(&mut prob, w_, h_, 410.5, 106.5);
        assert!(feasibility_ok(&prob));
        let cols0 = cluster_columns(&placed_boxes(&prob));
        assert_eq!(cols0.len(), 5);
        assert_eq!(cols0[1].len(), 2, "notch setup");

        post_pass_for_bias(&mut prob, Some("left"), Some(600.0));

        let cols1 = cluster_columns(&placed_boxes(&prob));
        assert!(feasibility_ok(&prob));
        assert!(prob.strip_width() <= 600.0 + 1e-3);
        // La colonne 1 a récupéré la pièce isolée (plus de cran d'une cellule).
        assert!(
            cols1.get(1).map(|c| c.len()).unwrap_or(0) >= 3,
            "col1 still short: {:?}",
            cols1.iter().map(|c| c.len()).collect::<Vec<_>>()
        );
    }

    /// Capture 2026-08-18 : 4 colonnes hautes + 5e partielle en bas.
    /// L'escalier doit s'égaliser — plus de cran d'une colonne entière.
    #[test]
    fn rightmost_short_column_is_equalized() {
        let (w_, h_) = (100.0, 50.0);
        let mut prob = SPProblem::new(rect_instance(w_, h_, 14, 1000.0));
        prob.change_strip_width(600.0);
        // 4 colonnes × 3 (tops 156.5) + 2 pièces en bas de la 5e.
        for x in [2.5, 104.5, 206.5, 308.5] {
            for y in [2.5, 54.5, 106.5] {
                place(&mut prob, w_, h_, x, y);
            }
        }
        place(&mut prob, w_, h_, 410.5, 2.5);
        place(&mut prob, w_, h_, 410.5, 54.5);
        assert!(feasibility_ok(&prob));
        let imb0 = column_imbalance(&placed_boxes(&prob));
        assert!(imb0 > 40.0, "imbalance setup {imb0}");

        post_pass_for_bias(&mut prob, Some("left"), Some(600.0));

        let after = placed_boxes(&prob);
        let imb1 = column_imbalance(&after);
        let cols = cluster_columns(&after);
        let counts: Vec<usize> = cols.iter().map(|c| c.len()).collect();
        assert!(feasibility_ok(&prob));
        assert_eq!(after.len(), 14);
        assert!(prob.strip_width() <= 600.0 + 1e-3);
        assert!(
            imb1 < imb0 - 1.0,
            "imbalance {imb0} -> {imb1}, counts={counts:?}"
        );
        let max_c = counts.iter().copied().max().unwrap_or(0);
        let min_c = counts.iter().copied().min().unwrap_or(0);
        assert!(
            max_c - min_c <= 1,
            "column counts still stepped: {counts:?}"
        );
    }

    /// La classe bottom n'est jamais touchée par le post-pass.
    #[test]
    fn bottom_is_never_touched() {
        let (w_, h_) = (100.0, 50.0);
        let mut prob = SPProblem::new(rect_instance(w_, h_, 3, 1000.0));
        prob.change_strip_width(600.0);
        place(&mut prob, w_, h_, 2.5, 2.5);
        place(&mut prob, w_, h_, 204.5, 2.5);
        place(&mut prob, w_, h_, 204.5, 54.5);
        let boxes0 = placed_boxes(&prob);

        post_pass_for_bias(&mut prob, Some("bottom"), Some(600.0));

        let boxes1 = placed_boxes(&prob);
        for (a, b) in boxes0.iter().zip(boxes1.iter()) {
            assert_eq!(a.d_transf.translation(), b.d_transf.translation());
        }
    }

    /// Un filler niché dans la bbox d'un hôte (cavité) et l'hôte occupé sont
    /// protégés : sans protection, le notch-fill déplacerait le filler dans
    /// l'encoche de la bande 0 (stair 15000 -> 10000) et viderait la cavité.
    #[test]
    fn nested_items_are_never_moved() {
        // Hôte en U : bbox 200×200, cavité x[50,150] × y[100,200] ouverte en
        // haut (le moteur ne connaît pas les trous fermés — piège #5).
        let json = serde_json::json!({
            "name": "nested-test",
            "strip_height": 1000.0,
            "items": [
                {"id": 0, "demand": 1, "allowed_orientations": [0.0],
                 "shape": {"type": "simple_polygon", "data": [
                    [0,0],[200,0],[200,200],[150,200],[150,100],[50,100],[50,200],[0,200],[0,0]]}},
                {"id": 1, "demand": 2, "allowed_orientations": [0.0],
                 "shape": {"type": "simple_polygon", "data": [[0,0],[50,0],[50,50],[0,50],[0,0]]}}
            ]
        });
        let ext: ExtSPInstance = serde_json::from_value(json).unwrap();
        let importer = Importer::new(
            sparrow::config::DEFAULT_SPARROW_CONFIG.cde_config,
            Some(0.001),
            None,
            Some((0.01, 0.01)),
        );
        let mut prob = SPProblem::new(import_instance(&importer, &ext).unwrap());
        prob.change_strip_width(600.0);
        // Bande 0 : filler seul (top 52.5) → encoche de 150 mm.
        // (rect : la translation est le centre de la bbox, vérifié plus haut)
        prob.place_item(SPPlacement {
            item_id: 1,
            d_transf: DTransformation::new(0.0, (27.5, 27.5)),
        });
        // Hôte en bandes 2-4, puis filler niché dans sa cavité.
        let pk_host = prob.place_item(SPPlacement {
            item_id: 0,
            d_transf: DTransformation::new(0.0, (304.5, 102.5)),
        });
        let hb = prob.layout.placed_items.get(pk_host).unwrap().shape.bbox;
        // Cavité monde : x [hb.x_min+50, hb.x_min+150], y [hb.y_min+100, ...].
        // Filler 50×50 à +60/+110 (marges 10 mm partout).
        let pk_fill = prob.place_item(SPPlacement {
            item_id: 1,
            d_transf: DTransformation::new(0.0, (hb.x_min + 85.0, hb.y_min + 135.0)),
        });
        let fb = prob.layout.placed_items.get(pk_fill).unwrap().shape.bbox;
        assert!(feasibility_ok(&prob));
        // Le filler est strictement contenu dans la bbox de l'hôte.
        assert!(fb.x_min > hb.x_min && fb.x_max < hb.x_max && fb.y_min > hb.y_min && fb.y_max < hb.y_max);
        let boxes0 = placed_boxes(&prob);
        let protected = protected_fingerprints(&boxes0);
        assert_eq!(protected.len(), 2, "hôte + filler protégés");
        let stair0 = band_stair(&boxes0);
        assert!(stair0 > 10_000.0, "stair {stair0}");

        post_pass_for_bias(&mut prob, Some("left"), Some(600.0));

        let boxes1 = placed_boxes(&prob);
        assert_eq!(band_stair(&boxes1), stair0, "aucun déplacement accepté");
        for (a, b) in boxes0.iter().zip(boxes1.iter()) {
            assert_eq!(a.d_transf.translation(), b.d_transf.translation());
        }
    }
}
