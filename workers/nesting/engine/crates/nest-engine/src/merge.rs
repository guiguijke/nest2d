//! Fusion de runs multi-walks en alternatives exportées (J-093).
//!
//! Unique implémentation du classement/fusion des runs, partagée entre :
//! - le chemin serveur : [`crate::spp::run_spp_mem`] et
//!   [`crate::bpp::run_bpp_mem`] l'appellent sur leurs runs internes,
//!   fraîchement exportés ;
//! - le point d'entrée wasm `merge_alternatives` (pool de Web Workers
//!   navigateur) : chaque worker produit un walk mono-thread complet, le pool
//!   JS fusionne via [`merge_alternatives_json`].
//!
//! À runs égaux (mêmes solutions exportées, seeds, classes, compteurs et
//! données de classement), la sortie est identique des deux côtés : filtrage
//! faisabilité (BPP `unplaced == 0`), champions par classe directionnelle
//! active dans l'ordre canonique [`DirBias::ALL`] (left/bottom/balanced),
//! repli qualité sur les runs restants, dédup par fingerprint de layout, cap
//! `n_alternatives`, ranks ré-assignés 0..n-1.
//!
//! Données de classement NON reconstruisibles depuis la seule forme externe
//! (mesurées côté moteur sur les shapes inflatées) : `used_height` (SPP) et
//! le détail de coût SA (BPP : unplaced/bin_cost/remnant/falkenauer). Elles
//! voyagent dans les champs additifs `used_height` / `cost_detail` des
//! alternatives exportées ; l'entrée JSON du merge les reprend en pass-through
//! pour une parité exacte avec un multi-start serveur. En leur absence, repli
//! documenté et déterministe mais NON garanti bit-identique au serveur
//! (ré-import jagua pour `used_height` ; `unplaced` reconstruit depuis la
//! demande + `remnant`/`falkenauer` à 0 pour BPP).

use crate::bpp::constructive::DirBias;
use crate::bpp::ExtBPOutput;
use crate::bpp::sa::Cost;
use crate::config::EngineConfig;
use crate::EngineOutput;
use anyhow::{Context, Result, bail};
use jagua_rs::io::import::Importer;
use jagua_rs::probs::bpp::io::ext_repr::{ExtBPInstance, ExtBPSolution};
use jagua_rs::probs::spp::io::ext_repr::{ExtSPInstance, ExtSPSolution};
use sparrow::util::io::ExtSPOutput;
use std::collections::HashSet;
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};

/// Un run SPP terminé, déjà exporté (champion d'un walk) + ses données de
/// classement mesurées côté moteur.
pub struct SpRun {
    pub seed: u64,
    /// Classe directionnelle du walk (mode directions) ; None en flux legacy.
    pub bias: Option<DirBias>,
    pub evals: usize,
    /// Hauteur utilisée (max y des shapes inflatées placées), mesurée sur la
    /// solution interne par le producteur du run — critère secondaire du
    /// classement qualité.
    pub used_height: f32,
    pub solution: ExtSPSolution,
}

/// Un run BPP terminé, déjà exporté, avec son coût SA complet.
pub struct BpRun {
    pub seed: u64,
    pub bias: DirBias,
    pub cost: Cost,
    pub iterations: usize,
    pub solution: ExtBPSolution,
}

/// Mode de fusion SPP : flux legacy (tri qualité à plat, sans classe) ou
/// directions (champions de classe dans l'ordre canonique, repli qualité).
pub enum SpMergeMode<'a> {
    Flat,
    Directions(&'a [DirBias]),
}

/// Résultat d'une fusion SPP : la sortie moteur + les métriques du best
/// (événement `done` côté appelant).
pub struct SpMergeOutcome {
    pub output: EngineOutput,
    pub best_strip_width: f32,
    pub best_density: f32,
}

/// Résultat d'une fusion BPP.
pub struct BpMergeOutcome {
    pub output: EngineOutput,
    pub best_cost: u64,
    pub best_density: f32,
}

/// Échec de fusion BPP : aucun run faisable.
#[derive(Debug)]
pub enum BpMergeError {
    /// `best_unplaced` = plus petit nombre de pièces non placées parmi les
    /// runs (premier du tri lexicographique coût/seed), 0 si aucun run.
    Infeasible { best_unplaced: usize },
}

impl std::fmt::Display for BpMergeError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            BpMergeError::Infeasible { best_unplaced } => {
                write!(f, "no feasible solution: {best_unplaced} items could not be placed")
            }
        }
    }
}

impl std::error::Error for BpMergeError {}

/// Fingerprint of a layout: two runs producing the same placements (to 0.1 mm
/// / 0.1°) are the same alternative and must not be exported twice.
fn sp_fingerprint(solution: &ExtSPSolution) -> u64 {
    let mut hasher = DefaultHasher::new();
    ((solution.strip_width * 10.0).round() as u64).hash(&mut hasher);
    let mut items: Vec<(u64, i64, i64, i64)> = solution
        .layout
        .placed_items
        .iter()
        .map(|pi| {
            (
                pi.item_id,
                (pi.transformation.rotation * 10.0).round() as i64,
                (pi.transformation.translation.0 * 10.0).round() as i64,
                (pi.transformation.translation.1 * 10.0).round() as i64,
            )
        })
        .collect();
    items.sort_unstable();
    items.hash(&mut hasher);
    hasher.finish()
}

/// Idem BPP : fingerprint sur chaque layout (conteneur + placements triés).
fn bp_fingerprint(solution: &ExtBPSolution) -> u64 {
    let mut hasher = DefaultHasher::new();
    for layout in &solution.layouts {
        layout.container_id.hash(&mut hasher);
        let mut items: Vec<(u64, i64, i64, i64)> = layout
            .placed_items
            .iter()
            .map(|pi| {
                (
                    pi.item_id,
                    (pi.transformation.rotation * 10.0).round() as i64,
                    (pi.transformation.translation.0 * 10.0).round() as i64,
                    (pi.transformation.translation.1 * 10.0).round() as i64,
                )
            })
            .collect();
        items.sort_unstable();
        items.hash(&mut hasher);
    }
    hasher.finish()
}

/// Clé qualité quantifiée à 1e-4 (mode directions) — comportement historique.
fn ordered_float(v: f32) -> u64 {
    (v * 1e4).round() as u64
}

/// Fusionne des runs SPP déjà exportés en alternatives + best
/// ([`EngineOutput`]). `None` si `runs` est vide (l'appelant émet alors
/// l'événement d'infaisabilité adapté à son mode).
///
/// Sémantique identique au classement historique de `run_spp_mem` :
/// - [`SpMergeMode::Directions`] : meilleur run de chaque classe active (ordre
///   canonique [`DirBias::ALL`]) puis tous les runs par qualité décroissante
///   ((strip_width, used_height) quantifiés à 1e-4, seed en tie-break) ;
/// - [`SpMergeMode::Flat`] : tri qualité à plat (comparaison f32 exacte,
///   sans quantification — flux legacy pré-directions).
pub fn merge_sp_runs(
    ext_instance: &ExtSPInstance,
    runs: &[SpRun],
    mode: SpMergeMode,
    n_alternatives: usize,
) -> Option<SpMergeOutcome> {
    if runs.is_empty() {
        return None;
    }

    let ordered: Vec<&SpRun> = match mode {
        SpMergeMode::Directions(biases) => {
            let quality = |r: &SpRun| {
                (
                    ordered_float(r.solution.strip_width),
                    ordered_float(r.used_height),
                    r.seed,
                )
            };
            let mut ordered: Vec<&SpRun> = DirBias::ALL
                .into_iter()
                .filter(|b| biases.contains(b))
                .filter_map(|b| {
                    runs.iter()
                        .filter(|r| r.bias == Some(b))
                        .min_by_key(|r| quality(r))
                })
                .collect();
            let mut rest: Vec<&SpRun> = runs.iter().collect();
            rest.sort_by_key(|r| quality(r));
            ordered.extend(rest);
            ordered
        }
        SpMergeMode::Flat => {
            let mut all: Vec<&SpRun> = runs.iter().collect();
            all.sort_by(|a, b| {
                a.solution
                    .strip_width
                    .total_cmp(&b.solution.strip_width)
                    .then(a.used_height.total_cmp(&b.used_height))
                    .then(a.seed.cmp(&b.seed))
            });
            all
        }
    };

    let mut seen = HashSet::new();
    let mut alternatives = Vec::new();
    let mut best_json: Option<ExtSPOutput> = None;
    for run in ordered {
        let fp = sp_fingerprint(&run.solution);
        if !seen.insert(fp) {
            continue; // même layout qu'une alternative déjà exportée
        }
        let output = ExtSPOutput {
            instance: ext_instance.clone(),
            solution: run.solution.clone(),
        };
        if best_json.is_none() {
            best_json = Some(output.clone());
        }
        let mut alt = serde_json::json!({
            "rank": alternatives.len(),
            "seed": run.seed,
            "evaluations": run.evals,
            // Additif (J-093) : données de classement pour le merge wasm —
            // ignorées par les consommateurs historiques.
            "used_height": run.used_height,
            "strip_width": output.solution.strip_width,
            "density": output.solution.density,
            "solution": output.solution,
        });
        if let Some(bias) = run.bias {
            alt["bias"] = serde_json::Value::from(bias.as_str());
        }
        alternatives.push(alt);
        if alternatives.len() >= n_alternatives {
            break;
        }
    }

    let best = best_json.expect("feasible solutions exist but none exported");
    Some(SpMergeOutcome {
        best_strip_width: best.solution.strip_width,
        best_density: best.solution.density,
        output: EngineOutput {
            sol_instance: serde_json::to_value(&best)
                .expect("serializing ExtSPOutput never fails"),
            alternatives,
        },
    })
}

/// Fusionne des runs BPP déjà exportés en alternatives + best.
///
/// Sémantique identique au classement historique de `run_bpp_mem` : tri
/// lexicographique (`cost.cmp_key()`, seed), filtrage faisabilité
/// (`unplaced == 0`), meilleur run de chaque classe active (ordre canonique),
/// puis tous les runs faisables en repli qualité, dédup fingerprint, cap.
pub fn merge_bp_runs(
    ext_instance: &ExtBPInstance,
    runs: &[BpRun],
    biases: &[DirBias],
    n_alternatives: usize,
) -> std::result::Result<BpMergeOutcome, BpMergeError> {
    let mut sorted: Vec<&BpRun> = runs.iter().collect();
    sorted.sort_by(|a, b| {
        a.cost
            .cmp_key()
            .cmp(&b.cost.cmp_key())
            .then(a.seed.cmp(&b.seed))
    });

    let feasible: Vec<&BpRun> = sorted
        .iter()
        .copied()
        .filter(|r| r.cost.unplaced == 0)
        .collect();
    if feasible.is_empty() {
        return Err(BpMergeError::Infeasible {
            best_unplaced: sorted.first().map(|r| r.cost.unplaced).unwrap_or(0),
        });
    }

    let mut ordered: Vec<&BpRun> = DirBias::ALL
        .into_iter()
        .filter(|b| biases.contains(b))
        .filter_map(|b| {
            feasible
                .iter()
                .copied()
                .filter(|r| r.bias == b)
                .min_by(|a, b| {
                    a.cost
                        .cmp_key()
                        .cmp(&b.cost.cmp_key())
                        .then(a.seed.cmp(&b.seed))
                })
        })
        .collect();
    ordered.extend(feasible.iter().copied());

    let mut seen = HashSet::new();
    let mut alternatives = Vec::new();
    let mut best_json: Option<ExtBPOutput> = None;
    for run in ordered {
        let fp = bp_fingerprint(&run.solution);
        if !seen.insert(fp) {
            continue;
        }
        let output = ExtBPOutput {
            instance: ext_instance.clone(),
            solution: run.solution.clone(),
        };
        if best_json.is_none() {
            best_json = Some(output.clone());
        }
        alternatives.push(serde_json::json!({
            "rank": alternatives.len(),
            "seed": run.seed,
            "bias": run.bias.as_str(),
            "cost": output.solution.cost,
            // Additif (J-093) : coût SA complet pour le merge wasm.
            "cost_detail": run.cost,
            "density": output.solution.density,
            "layout_count": output.solution.layouts.len(),
            "iterations": run.iterations,
            "solution": output.solution,
        }));
        if alternatives.len() >= n_alternatives {
            break;
        }
    }

    let best = best_json.expect("feasible solutions exist but none exported");
    Ok(BpMergeOutcome {
        best_cost: best.solution.cost,
        best_density: best.solution.density,
        output: EngineOutput {
            sol_instance: serde_json::to_value(&best)
                .expect("serializing ExtBPOutput never fails"),
            alternatives,
        },
    })
}

/// Seed acceptée en number ou en string (les seeds JS en BigInt se
/// sérialisent en string ; < 2^53 un number reste exact).
fn parse_seed(v: Option<&serde_json::Value>) -> Result<u64> {
    match v {
        Some(serde_json::Value::String(s)) => s
            .trim()
            .parse::<u64>()
            .context("invalid seed string"),
        Some(serde_json::Value::Number(n)) => n
            .as_u64()
            .or_else(|| n.as_f64().map(|f| f as u64))
            .context("seed number out of u64 range"),
        Some(_) => bail!("seed must be a number or a string"),
        None => bail!("run missing seed"),
    }
}

fn parse_bias(v: Option<&serde_json::Value>) -> Result<Option<DirBias>> {
    match v {
        None | Some(serde_json::Value::Null) => Ok(None),
        Some(serde_json::Value::String(s)) => DirBias::from_str(s)
            .map(Some)
            .ok_or_else(|| anyhow::anyhow!("unknown bias: {s}")),
        Some(_) => bail!("bias must be a string or null"),
    }
}

/// Point d'entrée JSON de la fusion (J-093) — appelé par le wrapper wasm
/// `merge_alternatives`. Entrée :
///
/// ```json
/// {
///   "problem": "spp" | "bpp",
///   "instance": { "...instance externe (comme run_nesting)..." },
///   "engineConfig": { "...config moteur (partielle acceptée)..." },
///   "runs": [ { "seed": 12345, "bias": "left", "evaluations": 12,
///               "iterations": 34, "used_height": 40.0,
///               "cost_detail": {"unplaced":0,"bin_cost":2,"remnant":0.4,"falkenauer":0.8},
///               "solution": { "...solution externe exportée..." } } ],
///   "biases": ["left"],
///   "n_alternatives": 3
/// }
/// ```
///
/// `biases` / `n_alternatives` top-level surchargent `engineConfig` (miroir
/// du pool JS). Sortie : `{ "problem", "sol_instance", "alternatives" }` —
/// la forme exacte de `run_nesting`. Parité serveur exacte si chaque run
/// reprend les champs additifs exportés par son walk (`used_height` SPP,
/// `cost_detail` BPP) ; voir la doc du module pour les replis.
pub fn merge_alternatives_json(input: &serde_json::Value) -> Result<serde_json::Value> {
    let mut cfg_value = match input.get("engineConfig") {
        None => serde_json::json!({}),
        Some(v) if v.is_object() => v.clone(),
        Some(_) => bail!("engineConfig must be an object"),
    };
    let cfg_obj = cfg_value.as_object_mut().expect("object checked above");
    // Champs obligatoires d'EngineConfig, sans sens pour un merge.
    cfg_obj
        .entry("time_budget_sec")
        .or_insert_with(|| serde_json::json!(0));
    cfg_obj
        .entry("prng_seed")
        .or_insert_with(|| serde_json::json!(0));
    if let Some(b) = input.get("biases") {
        cfg_obj.insert("biases".to_owned(), b.clone());
    }
    if let Some(n) = input.get("n_alternatives") {
        cfg_obj.insert("n_alternatives".to_owned(), n.clone());
    }
    let config: EngineConfig =
        serde_json::from_value(cfg_value).context("parsing engineConfig")?;

    let instance_value = input.get("instance").context("missing instance")?;
    let problem = input
        .get("problem")
        .and_then(serde_json::Value::as_str)
        .map(str::to_owned)
        .unwrap_or_else(|| {
            if instance_value.get("bins").is_some() {
                "bpp".to_owned()
            } else {
                "spp".to_owned()
            }
        });

    let runs = input
        .get("runs")
        .and_then(serde_json::Value::as_array)
        .context("missing runs array")?;

    match problem.as_str() {
        "spp" => merge_sp_json(instance_value, runs, &config),
        "bpp" => merge_bp_json(instance_value, runs, &config),
        other => bail!("unsupported problem type: {other}"),
    }
}

fn merge_sp_json(
    instance_value: &serde_json::Value,
    runs: &[serde_json::Value],
    config: &EngineConfig,
) -> Result<serde_json::Value> {
    let ext_instance: ExtSPInstance =
        serde_json::from_value(instance_value.clone()).context("parsing SPP instance")?;

    struct ParsedRun {
        seed: u64,
        bias: Option<DirBias>,
        evals: usize,
        used_height: Option<f32>,
        solution: ExtSPSolution,
    }
    let mut parsed = Vec::with_capacity(runs.len());
    for r in runs {
        let seed = parse_seed(r.get("seed"))?;
        let bias = parse_bias(r.get("bias"))?;
        let evals = r
            .get("evaluations")
            .and_then(serde_json::Value::as_u64)
            .unwrap_or(0) as usize;
        let used_height = r
            .get("used_height")
            .and_then(serde_json::Value::as_f64)
            .map(|v| v as f32);
        let solution: ExtSPSolution = serde_json::from_value(
            r.get("solution").cloned().context("run missing solution")?,
        )
        .context("parsing SPP run solution")?;
        parsed.push(ParsedRun {
            seed,
            bias,
            evals,
            used_height,
            solution,
        });
    }

    // Repli used_height : ré-import jagua de la solution (déterministe
    // cross-target via libm, mais pas garanti bit-identique à la mesure
    // interne du serveur — d'où le pass-through recommandé).
    if parsed.iter().any(|r| r.used_height.is_none()) {
        let sparrow_config = config.sparrow_config();
        let importer = Importer::new(
            sparrow_config.cde_config,
            sparrow_config.poly_simpl_tolerance,
            sparrow_config.min_item_separation,
            sparrow_config.narrow_concavity_cutoff_ratio,
        );
        let instance = jagua_rs::probs::spp::io::import_instance(&importer, &ext_instance)
            .context("importing SPP instance into jagua-rs (used_height fallback)")?;
        for r in parsed.iter_mut() {
            if r.used_height.is_none() {
                let sol = jagua_rs::probs::spp::io::import_solution(&instance, &r.solution);
                r.used_height = Some(crate::spp::used_height(&sol));
            }
        }
    }

    let sp_runs: Vec<SpRun> = parsed
        .into_iter()
        .map(|r| SpRun {
            seed: r.seed,
            bias: r.bias,
            evals: r.evals,
            used_height: r.used_height.expect("fallback fills used_height"),
            solution: r.solution,
        })
        .collect();

    // Même bascule que run_spp_mem : `biases` présent => mode directions.
    let biases = config.dir_biases();
    let mode = if config.biases.is_some() {
        SpMergeMode::Directions(&biases)
    } else {
        SpMergeMode::Flat
    };
    let merged = merge_sp_runs(&ext_instance, &sp_runs, mode, config.n_alternatives)
        .context("no SPP runs to merge")?;
    Ok(serde_json::json!({
        "problem": "spp",
        "sol_instance": merged.output.sol_instance,
        "alternatives": merged.output.alternatives,
    }))
}

fn merge_bp_json(
    instance_value: &serde_json::Value,
    runs: &[serde_json::Value],
    config: &EngineConfig,
) -> Result<serde_json::Value> {
    let ext_instance: ExtBPInstance =
        serde_json::from_value(instance_value.clone()).context("parsing BPP instance")?;
    let total_demand: u64 = ext_instance.items.iter().map(|it| it.demand).sum();

    let mut bp_runs = Vec::with_capacity(runs.len());
    for r in runs {
        let seed = parse_seed(r.get("seed"))?;
        let bias = parse_bias(r.get("bias"))?
            .context("bpp runs require a bias (left/bottom/balanced)")?;
        let iterations = r
            .get("iterations")
            .and_then(serde_json::Value::as_u64)
            .unwrap_or(0) as usize;
        let solution: ExtBPSolution = serde_json::from_value(
            r.get("solution").cloned().context("run missing solution")?,
        )
        .context("parsing BPP run solution")?;
        let cost: Cost = match r.get("cost_detail") {
            None | Some(serde_json::Value::Null) => {
                // Repli : unplaced reconstruit depuis la demande, bin_cost =
                // coût exporté, remnant/falkenauer à 0 (tie-breaks perdus —
                // passer cost_detail pour la parité exacte serveur).
                let placed: u64 = solution
                    .layouts
                    .iter()
                    .map(|l| l.placed_items.len() as u64)
                    .sum();
                Cost {
                    unplaced: total_demand.saturating_sub(placed) as usize,
                    bin_cost: solution.cost,
                    remnant: 0.0,
                    falkenauer: 0.0,
                }
            }
            Some(v) => serde_json::from_value(v.clone()).context("parsing cost_detail")?,
        };
        bp_runs.push(BpRun {
            seed,
            bias,
            cost,
            iterations,
            solution,
        });
    }

    let biases = config.dir_biases();
    let merged = merge_bp_runs(&ext_instance, &bp_runs, &biases, config.n_alternatives)
        .map_err(|e| anyhow::anyhow!("{e}"))?;
    Ok(serde_json::json!({
        "problem": "bpp",
        "sol_instance": merged.output.sol_instance,
        "alternatives": merged.output.alternatives,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use jagua_rs::io::ext_repr::{ExtLayout, ExtPlacedItem, ExtTransformation};

    fn sp_instance() -> ExtSPInstance {
        ExtSPInstance {
            name: "test".to_owned(),
            items: vec![],
            strip_height: 100.0,
        }
    }

    /// (item_id, rotation_deg, tx, ty)
    fn sp_layout(placements: &[(u64, f32, f32, f32)]) -> ExtLayout {
        ExtLayout {
            container_id: 0,
            placed_items: placements
                .iter()
                .map(|&(item_id, rotation, tx, ty)| ExtPlacedItem {
                    item_id,
                    transformation: ExtTransformation {
                        rotation,
                        translation: (tx, ty),
                    },
                })
                .collect(),
            density: 0.5,
        }
    }

    fn sp_run(
        seed: u64,
        bias: Option<DirBias>,
        strip_width: f32,
        used_height: f32,
        placements: &[(u64, f32, f32, f32)],
    ) -> SpRun {
        SpRun {
            seed,
            bias,
            evals: seed as usize * 10,
            used_height,
            solution: ExtSPSolution {
                strip_width,
                layout: sp_layout(placements),
                density: 0.5,
                run_time_sec: 0,
            },
        }
    }

    fn bp_instance(demand: u64) -> ExtBPInstance {
        ExtBPInstance {
            name: "test-bp".to_owned(),
            items: vec![jagua_rs::probs::bpp::io::ext_repr::ExtItem {
                base: jagua_rs::io::ext_repr::ExtItem {
                    id: 0,
                    allowed_orientations: None,
                    shape: jagua_rs::io::ext_repr::ExtShape::SimplePolygon(
                        jagua_rs::io::ext_repr::ExtSPolygon(vec![
                            (0.0, 0.0),
                            (10.0, 0.0),
                            (10.0, 10.0),
                            (0.0, 10.0),
                            (0.0, 0.0),
                        ]),
                    ),
                    min_quality: None,
                },
                demand,
            }],
            bins: vec![jagua_rs::probs::bpp::io::ext_repr::ExtBin {
                base: jagua_rs::io::ext_repr::ExtContainer {
                    id: 0,
                    shape: jagua_rs::io::ext_repr::ExtShape::SimplePolygon(
                        jagua_rs::io::ext_repr::ExtSPolygon(vec![
                            (0.0, 0.0),
                            (100.0, 0.0),
                            (100.0, 100.0),
                            (0.0, 100.0),
                            (0.0, 0.0),
                        ]),
                    ),
                    zones: vec![],
                },
                stock: 10,
                cost: 1,
            }],
        }
    }

    fn bp_run(
        seed: u64,
        bias: DirBias,
        unplaced: usize,
        bin_cost: u64,
        remnant: f64,
        falkenauer: f64,
        layouts: Vec<ExtLayout>,
    ) -> BpRun {
        BpRun {
            seed,
            bias,
            cost: Cost {
                unplaced,
                bin_cost,
                remnant,
                falkenauer,
            },
            iterations: seed as usize,
            solution: ExtBPSolution {
                cost: bin_cost,
                layouts,
                density: 0.5,
                run_time_sec: 0,
            },
        }
    }

    const LAYOUT_A: &[(u64, f32, f32, f32)] = &[(0, 0.0, 10.0, 20.0), (1, 90.0, 30.0, 40.0)];
    const LAYOUT_B: &[(u64, f32, f32, f32)] = &[(0, 0.0, 5.0, 5.0)];
    const LAYOUT_C: &[(u64, f32, f32, f32)] = &[(1, 0.0, 1.0, 1.0)];
    const LAYOUT_D: &[(u64, f32, f32, f32)] = &[(2, 45.0, 7.0, 8.0)];

    fn alt_seeds(out: &EngineOutput) -> Vec<u64> {
        out.alternatives
            .iter()
            .map(|a| a["seed"].as_u64().unwrap())
            .collect()
    }

    // ---------------- SPP directions mode ----------------

    #[test]
    fn spp_directions_canonical_class_order_beats_quality() {
        // Bottom a la meilleure largeur, mais l'ordre d'export reste
        // left/bottom/balanced (champions de classe d'abord).
        let runs = vec![
            sp_run(11, Some(DirBias::BottomFirst), 50.0, 20.0, LAYOUT_B),
            sp_run(22, Some(DirBias::LeftFirst), 80.0, 40.0, LAYOUT_A),
            sp_run(33, Some(DirBias::Balanced), 100.0, 60.0, LAYOUT_C),
        ];
        let out = merge_sp_runs(
            &sp_instance(),
            &runs,
            SpMergeMode::Directions(&DirBias::ALL),
            10,
        )
        .unwrap()
        .output;
        assert_eq!(alt_seeds(&out), vec![22, 11, 33]);
        assert_eq!(out.alternatives[0]["bias"], "left");
        assert_eq!(out.alternatives[1]["bias"], "bottom");
        assert_eq!(out.alternatives[2]["bias"], "balanced");
        // best = premier exporté = champion left (pas le meilleur global).
        assert_eq!(out.sol_instance["solution"]["strip_width"], 80.0);
        // ranks ré-assignés 0..n-1
        for (i, a) in out.alternatives.iter().enumerate() {
            assert_eq!(a["rank"], i as u64);
        }
    }

    #[test]
    fn spp_directions_champion_of_class_then_quality_fallback() {
        // Deux runs left : le champion est la meilleure largeur ; l'autre ne
        // réapparaît qu'en repli qualité.
        let runs = vec![
            sp_run(11, Some(DirBias::LeftFirst), 90.0, 10.0, LAYOUT_B),
            sp_run(22, Some(DirBias::LeftFirst), 80.0, 50.0, LAYOUT_A),
            sp_run(33, Some(DirBias::BottomFirst), 70.0, 30.0, LAYOUT_C),
        ];
        let biases = [DirBias::LeftFirst, DirBias::BottomFirst];
        let out = merge_sp_runs(
            &sp_instance(),
            &runs,
            SpMergeMode::Directions(&biases),
            10,
        )
        .unwrap()
        .output;
        // champions: left=22 (w80), bottom=33 (w70) ; repli trié: 33,22,11
        // (dédupliqués) => 11 en dernier.
        assert_eq!(alt_seeds(&out), vec![22, 33, 11]);
        assert_eq!(out.alternatives[0]["evaluations"], 220);
    }

    #[test]
    fn spp_directions_dedup_identical_layouts() {
        // Deux runs de layout identique (fp égal) : un seul exporté, et c'est
        // le meilleur (seed min à clé égale) qui gagne.
        let runs = vec![
            sp_run(44, Some(DirBias::LeftFirst), 80.0, 40.0, LAYOUT_A),
            sp_run(22, Some(DirBias::LeftFirst), 80.0, 40.0, LAYOUT_A),
            sp_run(33, Some(DirBias::LeftFirst), 85.0, 30.0, LAYOUT_C),
        ];
        let biases = [DirBias::LeftFirst];
        let out = merge_sp_runs(
            &sp_instance(),
            &runs,
            SpMergeMode::Directions(&biases),
            10,
        )
        .unwrap()
        .output;
        assert_eq!(alt_seeds(&out), vec![22, 33]);
        assert_eq!(out.alternatives.len(), 2);
    }

    #[test]
    fn spp_cap_n_alternatives() {
        let runs = vec![
            sp_run(11, Some(DirBias::LeftFirst), 80.0, 40.0, LAYOUT_A),
            sp_run(22, Some(DirBias::BottomFirst), 70.0, 30.0, LAYOUT_B),
            sp_run(33, Some(DirBias::Balanced), 90.0, 60.0, LAYOUT_C),
        ];
        let out = merge_sp_runs(
            &sp_instance(),
            &runs,
            SpMergeMode::Directions(&DirBias::ALL),
            2,
        )
        .unwrap()
        .output;
        assert_eq!(alt_seeds(&out), vec![11, 22]);
    }

    #[test]
    fn spp_directions_quantized_quality_key() {
        // Largeurs distinctes < 1e-4 : la clé quantifiée les voit égales, le
        // seed départage (le flux legacy Flat, lui, compare les f32 bruts).
        let runs = vec![
            sp_run(1, Some(DirBias::LeftFirst), 80.00002, 40.0, LAYOUT_A),
            sp_run(9, Some(DirBias::LeftFirst), 80.00001, 40.0, LAYOUT_B),
        ];
        let biases = [DirBias::LeftFirst];
        let out = merge_sp_runs(
            &sp_instance(),
            &runs,
            SpMergeMode::Directions(&biases),
            10,
        )
        .unwrap()
        .output;
        assert_eq!(alt_seeds(&out), vec![1, 9]); // seed 1 gagne à clé égale

        let flat = merge_sp_runs(&sp_instance(), &runs, SpMergeMode::Flat, 10)
            .unwrap()
            .output;
        assert_eq!(alt_seeds(&flat), vec![9, 1]); // 80.00001 < 80.00002 brut
    }

    // ---------------- SPP legacy (flat) mode ----------------

    #[test]
    fn spp_flat_sorts_by_quality_and_omits_bias() {
        let runs = vec![
            sp_run(11, None, 90.0, 40.0, LAYOUT_A),
            sp_run(22, None, 70.0, 50.0, LAYOUT_B),
            sp_run(33, None, 80.0, 30.0, LAYOUT_C),
        ];
        let out = merge_sp_runs(&sp_instance(), &runs, SpMergeMode::Flat, 10)
            .unwrap()
            .output;
        assert_eq!(alt_seeds(&out), vec![22, 33, 11]);
        assert!(out.alternatives[0].get("bias").is_none());
        assert_eq!(out.sol_instance["solution"]["strip_width"], 70.0);
    }

    #[test]
    fn spp_flat_used_height_tiebreak_then_seed() {
        let runs = vec![
            sp_run(9, None, 80.0, 50.0, LAYOUT_A),
            sp_run(5, None, 80.0, 30.0, LAYOUT_B),
            sp_run(7, None, 80.0, 50.0, LAYOUT_C),
        ];
        let out = merge_sp_runs(&sp_instance(), &runs, SpMergeMode::Flat, 10)
            .unwrap()
            .output;
        // uh 30 < 50 ; à (w, uh) égaux, seed 7 < 9.
        assert_eq!(alt_seeds(&out), vec![5, 7, 9]);
    }

    #[test]
    fn sp_merge_empty_runs_is_none() {
        assert!(
            merge_sp_runs(&sp_instance(), &[], SpMergeMode::Flat, 3).is_none()
        );
    }

    // ---------------- BPP ----------------

    #[test]
    fn bpp_infeasible_reports_min_unplaced() {
        let runs = vec![
            bp_run(5, DirBias::LeftFirst, 3, 1, 0.0, 0.0, vec![sp_layout(LAYOUT_A)]),
            bp_run(2, DirBias::BottomFirst, 1, 9, 0.0, 0.0, vec![sp_layout(LAYOUT_B)]),
        ];
        let err = merge_bp_runs(&bp_instance(10), &runs, &DirBias::ALL, 3)
            .err()
            .expect("infeasible expected");
        match err {
            BpMergeError::Infeasible { best_unplaced } => assert_eq!(best_unplaced, 1),
        }
        assert_eq!(
            err.to_string(),
            "no feasible solution: 1 items could not be placed"
        );
    }

    #[test]
    fn bpp_feasibility_filter_and_canonical_class_order() {
        // Le run left infaisable (bin_cost meilleur) est exclu ; le champion
        // left est le run faisable.
        let runs = vec![
            bp_run(11, DirBias::LeftFirst, 2, 1, 0.9, 0.9, vec![sp_layout(LAYOUT_D)]),
            bp_run(22, DirBias::LeftFirst, 0, 3, 0.1, 0.1, vec![sp_layout(LAYOUT_A)]),
            bp_run(33, DirBias::BottomFirst, 0, 2, 0.5, 0.5, vec![sp_layout(LAYOUT_B)]),
            bp_run(44, DirBias::Balanced, 0, 4, 0.2, 0.2, vec![sp_layout(LAYOUT_C)]),
        ];
        let out = merge_bp_runs(&bp_instance(10), &runs, &DirBias::ALL, 10)
            .unwrap()
            .output;
        assert_eq!(alt_seeds(&out), vec![22, 33, 44]);
        assert_eq!(out.sol_instance["solution"]["cost"], 3);
        for (i, a) in out.alternatives.iter().enumerate() {
            assert_eq!(a["rank"], i as u64);
        }
    }

    #[test]
    fn bpp_remnant_tiebreak_within_class() {
        // Même (unplaced, bin_cost) : le plus grand remnant est champion.
        let runs = vec![
            bp_run(11, DirBias::LeftFirst, 0, 2, 0.3, 0.4, vec![sp_layout(LAYOUT_A)]),
            bp_run(22, DirBias::LeftFirst, 0, 2, 0.5, 0.1, vec![sp_layout(LAYOUT_B)]),
        ];
        let biases = [DirBias::LeftFirst];
        let out = merge_bp_runs(&bp_instance(10), &runs, &biases, 10)
            .unwrap()
            .output;
        assert_eq!(alt_seeds(&out), vec![22, 11]);
    }

    #[test]
    fn bpp_dedup_and_cap() {
        let runs = vec![
            bp_run(11, DirBias::LeftFirst, 0, 2, 0.3, 0.4, vec![sp_layout(LAYOUT_A)]),
            bp_run(22, DirBias::BottomFirst, 0, 2, 0.3, 0.4, vec![sp_layout(LAYOUT_A)]), // dup fp
            bp_run(33, DirBias::Balanced, 0, 3, 0.2, 0.2, vec![sp_layout(LAYOUT_C)]),
        ];
        // Champions: left=11, bottom=22 (dup de 11 => sauté), balanced=33.
        // Cap 2 => [11, 22-dup-sauté... non: 22 sauté, 33 rank1].
        let out = merge_bp_runs(&bp_instance(10), &runs, &DirBias::ALL, 2)
            .unwrap()
            .output;
        assert_eq!(alt_seeds(&out), vec![11, 33]);
        assert_eq!(out.alternatives[1]["rank"], 1);
    }

    #[test]
    fn bpp_cost_detail_is_exported() {
        let runs = vec![bp_run(
            11,
            DirBias::LeftFirst,
            0,
            2,
            0.25,
            0.75,
            vec![sp_layout(LAYOUT_A)],
        )];
        let out = merge_bp_runs(&bp_instance(10), &runs, &DirBias::ALL, 3)
            .unwrap()
            .output;
        let cd = &out.alternatives[0]["cost_detail"];
        assert_eq!(cd["unplaced"], 0);
        assert_eq!(cd["bin_cost"], 2);
        assert_eq!(cd["remnant"], 0.25);
        assert_eq!(cd["falkenauer"], 0.75);
        assert_eq!(out.alternatives[0]["layout_count"], 1);
    }

    // ---------------- JSON entry (miroir wasm) ----------------

    #[test]
    fn json_spp_seed_number_or_string_and_overrides() {
        let input = serde_json::json!({
            "problem": "spp",
            "instance": {"name": "t", "strip_height": 100.0, "items": []},
            "engineConfig": {"biases": ["left", "bottom"]},
            "n_alternatives": 5,
            "runs": [
                {"seed": "111", "bias": "left", "evaluations": 1000, "used_height": 40.0,
                 "solution": {"strip_width": 80.0, "density": 0.6, "run_time_sec": 0,
                              "layout": {"container_id": 0, "density": 0.6, "placed_items": [
                                  {"item_id": 0, "transformation": {"rotation": 0.0, "translation": [10.0, 20.0]}}]}}},
                {"seed": 222, "bias": "bottom", "evaluations": 900, "used_height": 25.0,
                 "solution": {"strip_width": 70.0, "density": 0.65, "run_time_sec": 0,
                              "layout": {"container_id": 0, "density": 0.65, "placed_items": [
                                  {"item_id": 0, "transformation": {"rotation": 0.0, "translation": [5.0, 5.0]}}]}}}
            ]
        });
        let out = merge_alternatives_json(&input).unwrap();
        assert_eq!(out["problem"], "spp");
        let alts = out["alternatives"].as_array().unwrap();
        assert_eq!(alts.len(), 2);
        // ordre canonique des classes : left d'abord malgré la largeur 80 > 70
        assert_eq!(alts[0]["seed"], 111);
        assert_eq!(alts[0]["bias"], "left");
        assert_eq!(alts[1]["seed"], 222);
        assert_eq!(out["sol_instance"]["solution"]["strip_width"], 80.0);
        assert_eq!(out["sol_instance"]["name"], "t");
        assert_eq!(out["sol_instance"]["strip_height"], 100.0);
    }

    #[test]
    fn json_spp_flat_mode_without_biases() {
        let input = serde_json::json!({
            "problem": "spp",
            "instance": {"name": "t", "strip_height": 100.0, "items": []},
            "runs": [
                {"seed": 11, "bias": null, "used_height": 40.0,
                 "solution": {"strip_width": 90.0, "density": 0.5, "run_time_sec": 0,
                              "layout": {"container_id": 0, "density": 0.5, "placed_items": []}}},
                {"seed": 22, "used_height": 30.0,
                 "solution": {"strip_width": 70.0, "density": 0.5, "run_time_sec": 0,
                              "layout": {"container_id": 0, "density": 0.5, "placed_items": []}}}
            ]
        });
        let out = merge_alternatives_json(&input).unwrap();
        let alts = out["alternatives"].as_array().unwrap();
        assert_eq!(alts[0]["seed"], 22); // tri qualité à plat
        assert!(alts[0].get("bias").is_none());
    }

    #[test]
    fn json_spp_used_height_fallback_reimports() {
        // Run sans used_height : ré-import jagua (instance réelle minimale).
        let input = serde_json::json!({
            "problem": "spp",
            "instance": {
                "name": "fb", "strip_height": 20.0,
                "items": [{"id": 0, "demand": 1,
                           "allowed_orientations": [0.0, 90.0, 180.0, 270.0],
                           "shape": {"type": "simple_polygon",
                                     "data": [[0.0,0.0],[10.0,0.0],[10.0,10.0],[0.0,10.0],[0.0,0.0]]}}]
            },
            "engineConfig": {"min_item_separation": 2.0, "narrow_concavity_cutoff": null},
            "runs": [
                {"seed": 7, "bias": "left", "evaluations": 3,
                 "solution": {"strip_width": 12.0, "density": 0.7, "run_time_sec": 0,
                              "layout": {"container_id": 0, "density": 0.7, "placed_items": [
                                  {"item_id": 0, "transformation": {"rotation": 0.0, "translation": [1.0, 1.0]}}]}}}
            ],
            "biases": ["left"]
        });
        let out = merge_alternatives_json(&input).unwrap();
        let alts = out["alternatives"].as_array().unwrap();
        assert_eq!(alts.len(), 1);
        let uh = alts[0]["used_height"].as_f64().unwrap();
        assert!(uh > 0.0, "fallback used_height should be positive, got {uh}");
        // Déterministe : deux appels, même sortie.
        let out2 = merge_alternatives_json(&input).unwrap();
        assert_eq!(out, out2);
    }

    #[test]
    fn json_bpp_cost_detail_passthrough_and_reconstruction() {
        let instance = serde_json::json!({
            "name": "bp", "items": [{"id": 0, "demand": 1,
                "shape": {"type": "simple_polygon",
                          "data": [[0.0,0.0],[10.0,0.0],[10.0,10.0],[0.0,10.0],[0.0,0.0]]}}],
            "bins": [{"id": 0, "stock": 10, "cost": 1,
                "shape": {"type": "simple_polygon",
                          "data": [[0.0,0.0],[100.0,0.0],[100.0,100.0],[0.0,100.0],[0.0,0.0]]}}]
        });
        let solution_with_one = |tx: f32| {
            serde_json::json!({"cost": 2, "density": 0.5, "run_time_sec": 0,
                "layouts": [{"container_id": 0, "density": 0.5, "placed_items": [
                    {"item_id": 0, "transformation": {"rotation": 0.0, "translation": [tx, 5.0]}}]}]})
        };
        let input = serde_json::json!({
            "problem": "bpp",
            "instance": instance,
            "runs": [
                // cost_detail fourni : remnant 0.9 => champion à bin_cost égal
                {"seed": 11, "bias": "left", "iterations": 100,
                 "cost_detail": {"unplaced": 0, "bin_cost": 2, "remnant": 0.9, "falkenauer": 0.1},
                 "solution": solution_with_one(10.0)},
                // cost_detail absent : reconstruit (unplaced 0, remnant 0)
                {"seed": 22, "bias": "bottom", "iterations": 200,
                 "solution": solution_with_one(20.0)}
            ],
            "biases": ["left", "bottom"]
        });
        let out = merge_alternatives_json(&input).unwrap();
        let alts = out["alternatives"].as_array().unwrap();
        assert_eq!(alts.len(), 2);
        assert_eq!(alts[0]["seed"], 11); // champion left (remnant 0.9)
        assert_eq!(alts[0]["cost_detail"]["remnant"], 0.9);
        assert_eq!(alts[1]["cost_detail"]["unplaced"], 0); // demande 1 - 1 placé
        assert_eq!(alts[1]["cost_detail"]["bin_cost"], 2); // coût exporté repris
        assert_eq!(out["problem"], "bpp");
    }

    #[test]
    fn json_bpp_all_infeasible_errors() {
        let input = serde_json::json!({
            "problem": "bpp",
            "instance": {"name": "bp", "items": [{"id": 0, "demand": 2,
                "shape": {"type": "simple_polygon",
                          "data": [[0.0,0.0],[10.0,0.0],[10.0,10.0],[0.0,10.0],[0.0,0.0]]}}],
                         "bins": []},
            "runs": [
                {"seed": 5, "bias": "left",
                 "cost_detail": {"unplaced": 1, "bin_cost": 0, "remnant": 0.0, "falkenauer": 0.0},
                 "solution": {"cost": 0, "density": 0.0, "run_time_sec": 0, "layouts": []}}
            ]
        });
        let err = merge_alternatives_json(&input).unwrap_err();
        assert!(
            format!("{err:#}").contains("no feasible solution: 1 items could not be placed"),
            "unexpected error: {err:#}"
        );
    }
}
