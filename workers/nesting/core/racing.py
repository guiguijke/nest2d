"""Multi-fidelity racing orchestration for the lbf solver.

Instead of running N identical full-budget solver runs one after another
(the legacy behaviour), the search is organised as a tournament:

  Stage 1 — race:   K seeds run in parallel with a coarse sample budget.
                    Runs that failed to place every item are discarded.
  Stage 2 — refine: the best seeds (ranked by solution cost, then density)
                    are re-run in parallel with the full sample budget.
  Escalation:       if the race produced no complete placement at all, a
                    final attempt is made with an escalated budget before
                    the job is declared infeasible.

Each lbf run is an independent subprocess, so parallelism comes for free via
threads (subprocess.run releases the GIL) and scales with CPU cores.
"""

import json
import os
import secrets
import subprocess
import tempfile
from concurrent.futures import ThreadPoolExecutor

from core.nesting_input_builder import build_input_json
from utils.logger import setup_logger

logger = setup_logger("nesting_racing")

# Race shape (overridable per environment).
RACE_SEEDS = int(os.environ.get("NEST_RACE_SEEDS", "8"))
MAX_PARALLEL = int(os.environ.get("NEST_MAX_PARALLEL", str(min(os.cpu_count() or 4, 8))))
# Coarse budget = n_samples // RACE_BUDGET_DIVISOR, never below RACE_MIN_SAMPLES.
RACE_BUDGET_DIVISOR = int(os.environ.get("NEST_RACE_BUDGET_DIVISOR", "8"))
RACE_MIN_SAMPLES = int(os.environ.get("NEST_RACE_MIN_SAMPLES", "1000"))
# Escalation when nothing placed: ESCALATION_SEEDS runs at budget × multiplier.
ESCALATION_SEEDS = int(os.environ.get("NEST_ESCALATION_SEEDS", "2"))
ESCALATION_BUDGET_MULT = int(os.environ.get("NEST_ESCALATION_BUDGET_MULT", "4"))

LBF_TIMEOUT_SECONDS = int(os.environ.get("NEST_LBF_TIMEOUT", "3600"))


def run_lbf(input_json):
    """Runs one lbf subprocess and returns the parsed solution output.

    jagua-rs 0.7.x dropped the stdin/stdout JSON interface: lbf is now a
    file-based CLI (`lbf -i instance.json -s out_dir -c config.json -p bpp`)
    writing `sol_<stem>.json` (plus SVGs we ignore). Output rotations are in
    DEGREES since 0.7.x (they were radians in 0.6.x) — callers must convert.
    """
    with tempfile.TemporaryDirectory(prefix="lbf_") as tmpdir:
        instance_path = os.path.join(tmpdir, "instance.json")
        config_path = os.path.join(tmpdir, "config.json")
        out_dir = os.path.join(tmpdir, "out")

        with open(instance_path, "w") as f:
            json.dump(input_json["instance"], f)
        with open(config_path, "w") as f:
            json.dump(input_json["config"], f)

        result = subprocess.run(
            ["lbf", "-i", instance_path, "-s", out_dir,
             "-c", config_path, "-p", "bpp", "-l", "warn"],
            capture_output=True,
            text=True,
            timeout=LBF_TIMEOUT_SECONDS,
        )

        if result.returncode != 0:
            logger.error("❌ lbf failed with return code: %s", result.returncode)
            logger.error("Error output: %s", result.stderr)
            raise Exception(f"❌ lbf failed with return code: {result.returncode}")

        solution_path = os.path.join(out_dir, "sol_instance.json")
        with open(solution_path) as f:
            output = json.load(f)

    # Normalise to the shape the rest of the pipeline consumes.
    return {"solution": output["solution"], "config": output.get("config")}


def _solve_once(bins, jaguar_items, n_samples, seed, min_separation, has_holes=False):
    """Single solver run; returns a candidate dict."""
    input_json = build_input_json(
        bins, jaguar_items, n_samples=n_samples, prng_seed=seed,
        min_separation=min_separation, has_holes=has_holes,
    )
    output = run_lbf(input_json)
    solution = output.get("solution") or {}
    placed = sum(len(layout.get("placed_items", [])) for layout in solution.get("layouts", []))
    return {
        "seed": seed,
        "n_samples": n_samples,
        "output": output,
        "placed": placed,
        "density": solution.get("density"),
        "cost": solution.get("cost"),
    }


def _rank_key(candidate):
    """Lower is better: fewest sheets (uniform bin cost), then densest."""
    cost = candidate.get("cost")
    return (cost if cost is not None else float("inf"), -(candidate.get("density") or 0.0))


def _run_batch(bins, jaguar_items, n_samples, seeds, min_separation, stage, has_holes=False, on_progress=None):
    """Runs one batch of seeds in parallel; returns the list of candidates.
    on_progress(stage, done, total) is invoked as each run completes."""
    candidates = []
    workers = max(1, min(MAX_PARALLEL, len(seeds)))
    logger.info(
        "lbf batch started",
        extra={"stage": stage, "seeds": len(seeds), "n_samples": n_samples, "workers": workers},
    )
    done = 0
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {
            pool.submit(_solve_once, bins, jaguar_items, n_samples, seed, min_separation, has_holes): seed
            for seed in seeds
        }
        for future, seed in futures.items():
            try:
                candidate = future.result()
                candidates.append(candidate)
                logger.info(
                    "lbf run finished",
                    extra={
                        "stage": stage,
                        "seed": seed,
                        "placed": candidate["placed"],
                        "density": candidate["density"],
                        "cost": candidate["cost"],
                    },
                )
            except Exception as e:
                # A crashed/timed-out run loses its seed but must not kill the batch.
                logger.error("lbf run failed", extra={"stage": stage, "seed": seed, "error": str(e)})
            finally:
                # Count only COMPLETED runs — incrementing before result()
                # made the UI report done/total while the last run was still
                # solving, looking exactly like a hang.
                done += 1
                if on_progress is not None:
                    try:
                        on_progress(stage, done, len(seeds))
                    except Exception:
                        pass  # progress reporting must never break a solve
    return candidates


def _fresh_seeds(n, exclude=None):
    exclude = exclude or set()
    seeds = []
    while len(seeds) < n:
        seed = secrets.randbelow(2**32)
        if seed not in exclude:
            seeds.append(seed)
            exclude.add(seed)
    return seeds


def race_solve(bins, jaguar_items, n_samples, n_alternatives, min_separation, total_requested, has_holes=False, progress_cb=None):
    """Runs the racing tournament.

    Returns up to `n_alternatives` refined candidates (each placing all
    requested items), ranked best-first by (cost, -density). Returns an empty
    list when the instance appears infeasible even after escalation.
    """
    coarse_samples = max(RACE_MIN_SAMPLES, n_samples // RACE_BUDGET_DIVISOR)
    n_race = max(RACE_SEEDS, 2 * n_alternatives)

    # --- Stage 1: race ---
    seeds = _fresh_seeds(n_race)
    race_candidates = _run_batch(bins, jaguar_items, coarse_samples, seeds, min_separation, "race", has_holes, progress_cb)
    complete = [c for c in race_candidates if c["placed"] == total_requested]
    complete.sort(key=_rank_key)

    # --- Escalation: nothing placed everything, try harder before giving up ---
    if not complete:
        used_seeds = {c["seed"] for c in race_candidates}
        esc_seeds = _fresh_seeds(ESCALATION_SEEDS, used_seeds)
        esc_samples = n_samples * ESCALATION_BUDGET_MULT
        logger.warning(
            "Race produced no complete placement, escalating",
            extra={"escalation_seeds": len(esc_seeds), "n_samples": esc_samples},
        )
        esc_candidates = _run_batch(
            bins, jaguar_items, esc_samples, esc_seeds, min_separation, "escalation", has_holes, progress_cb
        )
        complete = [c for c in esc_candidates if c["placed"] == total_requested]
        complete.sort(key=_rank_key)
        if not complete:
            return []
        # Escalated runs already used a >= full budget: they are the finals.
        return complete[:n_alternatives]

    # --- Stage 2: refine the best race seeds with the full budget ---
    finalists = complete[:n_alternatives]
    refine_seeds = [c["seed"] for c in finalists]
    refined = _run_batch(bins, jaguar_items, n_samples, refine_seeds, min_separation, "refine", has_holes, progress_cb)
    refined_complete = [c for c in refined if c["placed"] == total_requested]

    # A refinement can occasionally lose items the coarse run had placed (the
    # RNG trajectory differs with the budget); fall back to the race result
    # for that seed so we never regress below the coarse solution.
    refined_by_seed = {c["seed"]: c for c in refined_complete}
    finals = []
    for race_candidate in finalists:
        finals.append(refined_by_seed.get(race_candidate["seed"], race_candidate))

    # Top up with fresh seeds if some finalists produced nothing usable.
    if len(finals) < n_alternatives:
        used_seeds = {c["seed"] for c in race_candidates}
        topup_seeds = _fresh_seeds(n_alternatives - len(finals), used_seeds)
        topup = _run_batch(bins, jaguar_items, n_samples, topup_seeds, min_separation, "topup", has_holes, progress_cb)
        finals.extend(c for c in topup if c["placed"] == total_requested)

    finals.sort(key=_rank_key)
    return finals[:n_alternatives]
