"""Builds the nest-engine input: instance JSON (jagua-rs external
representation) and engine config JSON.

Problem type selection:
  - single sheet type  -> SPP (strip packing): the sheet is the strip, the
    engine minimizes the used length natively (= maximum reusable offcut).
    strip_height is the sheet's height, max_strip_width its width.
  - multiple sheet types -> BPP (bin packing): the engine minimizes the
    number of sheets, then compacts via its annealing objective.

Determinism: the master PRNG seed is derived from a SHA-256 of the canonical
instance + parameters, so a job always replays the same search trajectory
(the wall-clock budget may cut it at slightly different points under varying
machine load — standard for anytime solvers).
"""
import hashlib
import json
import os

# Stream full layout snapshots from the engine (live visualizer). The payload
# is small (per placed item: id, rotation, translation) and the worker
# throttles Mongo writes — the value of watching the algorithm think is high.
LIVE_EVENTS = os.environ.get("NEST_LIVE_EVENTS", "1") == "1"

# P4 — exposant du biais d'éjection par aire du séparateur GLS (0 = off).
# Par défaut 0 : activé seulement après validation A/B (constaté au banc le
# 2026-08-28, voir specs). La faisabilité et les poids GLS restent purs.
EJECT_AREA_BIAS = float(os.environ.get("NEST_EJECT_BIAS", "0"))


def deterministic_seed(payload):
    """Stable 63-bit seed derived from the job payload (geometry + params)."""
    canonical = json.dumps(payload, sort_keys=True, separators=(",", ":"))
    digest = hashlib.sha256(canonical.encode("utf-8")).digest()
    return int.from_bytes(digest[:8], "big") & 0x7FFF_FFFF_FFFF_FFFF


def build_engine_config(
    time_budget_sec,
    prng_seed,
    n_alternatives,
    min_separation=None,
    has_holes=False,
    max_strip_width=None,
    n_workers=None,
    biases=None,
    plateau_patience_sec=None,
    separator_workers=None,
    sa_stop_k=None,
    sa_stop_floor=None,
):
    """Engine configuration (consumed by nest-engine's `-c config.json`).

    min_separation is the exact minimum distance between any two placed items
    (and between items and the bin edge). jagua-rs enforces it natively by
    inflating items / deflating containers by half the value, so the geometry
    stays untouched and the gap is exactly `min_item_separation` — do NOT pre-buffer
    the polygons on the Python side.

    has_holes disables narrow-concavity closing: holed items are opened to the
    exterior by a hairline channel (core/holed_polygons.py) and the closing
    heuristic would seal that channel shut, silently re-filling the holes.
    Without holed items, the heuristic stays on (faster collision checks on
    noisy contours).

    n_workers caps the engine's parallelism (BPP: SA walks; SPP: multi-start
    runs at 3 threads each) — derived from the owner's tier vcores. biases
    lists the directional alternatives to explore (BPP only). plateau_patience_sec
    lets walks stop once converged instead of burning the full wall budget.
    separator_workers overrides sparrow's inner separator parallelism; the
    browser (wasm, mono-walk, AGENTS #14c) forces it to 1 since wasm has no
    OS threads and extra workers would only run sequentially.
    """
    config = {
        "time_budget_sec": int(time_budget_sec),
        "prng_seed": int(prng_seed),
        "n_alternatives": int(n_alternatives),
        "poly_simpl_tolerance": 0.001,
        "min_item_separation": float(min_separation) if min_separation else None,
        # Explicit null disables concavity closing for holed instances.
        "narrow_concavity_cutoff": None if has_holes else [0.01, 0.01],
        "live_events": LIVE_EVENTS,
    }
    if max_strip_width is not None:
        config["max_strip_width"] = float(max_strip_width)
    if n_workers is not None:
        config["n_workers"] = int(n_workers)
    if biases:
        config["biases"] = list(biases)
    if plateau_patience_sec is not None:
        config["plateau_patience_sec"] = float(plateau_patience_sec)
    # AB1 (L2-bis) : patience P3 pilotable — A/B sans rebuild. Env
    # NEST_SA_STOP_K=0 désactive la règle (bras « avant P3 »).
    if sa_stop_k is not None:
        config["sa_stop_k"] = int(sa_stop_k)
    if sa_stop_floor is not None:
        config["sa_stop_floor"] = int(sa_stop_floor)
    if separator_workers is not None:
        # Q-m.2 (audit 2026-08-31 §Q-m.2) : clamp bas — 0 fait paniquer
        # move_items_multi (unwrap sur un itérateur vide côté Rust). Le
        # clamp JS est le miroir (localPayloadBuilder.js).
        config["separator_workers"] = max(1, int(separator_workers))
    if EJECT_AREA_BIAS > 0:
        config["eject_area_bias"] = EJECT_AREA_BIAS
    return config


def build_item(id, demand, points, allowed_orientations):
    return {
        "id": id,
        "demand": demand,
        "allowed_orientations": allowed_orientations,
        "shape": {
            "type": "simple_polygon",
            "data": points,
        },
    }


def build_bin(bin_id, stock, width, height):
    return {
        "id": bin_id,
        "cost": 1,
        "stock": stock,
        "shape": {
            "type": "polygon",
            "data": {
                "outer": [
                    [0.0, 0.0],
                    [width, 0.0],
                    [width, height],
                    [0.0, height],
                    [0.0, 0.0],
                ]
            },
        },
    }


def build_spp_instance(items, sheet_width, sheet_height, name="nest2d"):
    """Strip packing instance: fixed strip height = sheet height, the engine
    minimizes the used width (<= sheet width = max_strip_width)."""
    return {
        "name": name,
        "items": items,
        "strip_height": float(sheet_height),
    }


def build_bpp_instance(items, bins, name="nest2d"):
    """Bin packing instance: heterogeneous sheet types, each with a stock."""
    return {
        "name": name,
        "items": items,
        "bins": bins,
    }
