from datetime import datetime
import sys
import os
import io
from pathlib import Path
from worker_common.mongo import db, get_bucket
from core.nesting_input_builder import (
    build_bin,
    build_bpp_instance,
    build_engine_config,
    build_item,
    build_spp_instance,
    deterministic_seed,
)
from core.engine import EngineCancelled, run_engine
from core.holed_polygons import channel_width_for_space, open_holes_with_channels
from core.placement import ResultContainer, Transform, parse_result_containers
from core.metrics import compute_used_sheet_share, largest_empty_rectangle
from dxf.dxf_utils import read_dxf
from core.svg_generator import create_svg_from_doc
from ezdxf.document import Drawing
import ezdxf
from ezdxf import xref
import ezdxf.bbox
import math
import io
from ezdxf.math import Matrix44

sys.path.append(str(Path(__file__).parent.parent))

from worker_common.logger import setup_logger
from worker_common.crypto import get_dek, read_gridfs, resolve_polygon_parts, write_gridfs

valid_dxf_bucket = get_bucket("validDxf")
dxf_result_bucket = get_bucket("nestDxf")
svg_result_bucket = get_bucket("nestSvg")

logger = setup_logger("core_nesting")


class JobCancelled(Exception):
    """The user cancelled the job while it was being processed. The job doc
    is already finalized (status=cancelled) when this is raised — the daemon
    only needs to refund the charge and move on."""

# Simplification tolerance (mm) applied to part geometry before it is sent
# to the engine. Ornate DXFs come in as 1000-3000-vertex polylines (splines
# flattened at ~0.2mm): every collision check scales with vertex count and
# jagua's own area-ratio simplification is quadratic on top of it. A 0.05mm
# Douglas-Peucker pass cuts the vertex count by ~5x in milliseconds, with a
# deviation far below any real kerf/spacing (result DXFs are rebuilt from
# the ORIGINAL entities, so cutting fidelity is untouched).
SIMPLIFY_MM = float(os.environ.get("NEST_SIMPLIFY_MM", "0.05"))


def _simplify_part(coords, holes):
    """Lightens a part's rings (Douglas-Peucker). Returns (coords, holes)."""
    if SIMPLIFY_MM <= 0:
        return coords, holes
    from shapely.geometry import Polygon
    poly = Polygon(coords, holes)
    simplified = poly.simplify(SIMPLIFY_MM, preserve_topology=True)
    if simplified.is_empty or simplified.geom_type != "Polygon":
        return coords, holes
    new_coords = [[x, y] for x, y in simplified.exterior.coords]
    new_holes = [[[x, y] for x, y in ring.coords] for ring in simplified.interiors]
    if len(new_coords) < len(coords):
        logger.info(
            "Part simplified",
            extra={"before": len(coords), "after": len(new_coords)},
        )
    return new_coords, new_holes


def convert_files_to_input_items(files, dek=None):
    """Builds the nesting input items from the project's files.

    The requested gap (`space`) is enforced natively by jagua-rs via
    `min_item_separation` (exact distance, geometry unmodified). Holes
    (interior rings extracted at file processing time) are carried along and
    opened with a hairline channel so the engine nests parts inside cutouts
    natively. Geometry is lightly simplified first (see SIMPLIFY_MM).
    """
    input_items = []
    id = 0
    for file in files:
        file_slug = file.get("slug")
        count = file.get("count")
        rotations = file.get("rotations", [0, 90, 180, 270])  # Default to all rotations if not specified

        user_dxf_file = db["user_dxf_files"].find_one({"slug": file_slug})
        # Decrypts the enc blob when the file was processed while the vault
        # was enabled; passes legacy plaintext through untouched.
        plogonParts = resolve_polygon_parts(db, user_dxf_file, dek)
        for part in plogonParts:
            coords, holes = _simplify_part(
                part.get("coordinates"), part.get("holes") or []
            )
            handles = part.get("handles")

            item = {
                'id': id,
                'file_slug': file_slug,
                'coords': coords,
                'holes': holes,
                'handles': handles,
                'count': count,
                'rotations': rotations
            }

            id += 1

            input_items.append(item)

    return input_items


def save_dxf_result(owner_id, file_name, drawing, dek=None):
    dxf_copy_text_stream = io.StringIO()
    drawing.write(dxf_copy_text_stream)
    dxf_copy_text = dxf_copy_text_stream.getvalue()
    dxf_copy_text_stream.close()

    dxf_copy_bytes = dxf_copy_text.encode('utf-8')

    write_gridfs(dxf_result_bucket, file_name, dxf_copy_bytes, owner_id, dek)

def save_svg_result(owner_id, file_name, drawing, dek=None, bin_width=None, bin_height=None):
    svg_string = create_svg_from_doc(drawing, 0.001, bin_width, bin_height)
    svg_bytes = svg_string.encode('utf-8')
    write_gridfs(svg_result_bucket, file_name, svg_bytes, owner_id, dek)

def build_result_dxf_files(owner_id, slug, result_containers, add_out_shape=False, space=0, dek=None):
    """
    Iterates through containers, builds a combined/transformed DXF for each,
    and saves the result. Returns (dxf_files, svg_files) — the caller is
    responsible for persisting them on the job document.
    """
    print(f"Starting build process for slug: {slug}")

    dxf_files = []
    svg_files = []
    for result_container in result_containers:
        dxf_file_name = f"{slug}_part_{result_container.container_id}.dxf"

        new_drawing = build_part(
            result_container.transforms,
            add_out_shape,
            space,
            owner_id,
            dek,
            result_container.bin_width,
            result_container.bin_height,
        )

        logger.info("Saving combined file", extra={"file_name": dxf_file_name})
        save_dxf_result(owner_id, dxf_file_name, new_drawing, dek)
        dxf_files.append(dxf_file_name)

        svg_file_name = f"{slug}_part_{result_container.container_id}.svg"
        save_svg_result(
            owner_id,
            svg_file_name,
            new_drawing,
            dek,
            result_container.bin_width,
            result_container.bin_height,
        )
        svg_files.append(svg_file_name)

    return dxf_files, svg_files

def build_part(transforms, add_out_shape=False, space=0, owner_id=None, dek=None, bin_width=None, bin_height=None):
    """
    Creates a single new DXF drawing by fetching, transforming, and combining
    entities from a list of transform operations. When bin dimensions are
    provided, the sheet boundary is always drawn on a BIN_BOUNDARY layer.

    Transforms are grouped by source file: the xref Loader is created once
    per file (it re-processes the source document's tables on execute —
    one call per placed part made large jobs crawl).
    """

    logger.info("Building part", extra={"add_out_shape": add_out_shape})

    new_doc = ezdxf.new()
    new_msp = new_doc.modelspace()
    added_entities = []

    # Group transforms by source file, preserving placement order within a file.
    transforms_by_file = {}
    for transform in transforms:
        transforms_by_file.setdefault(transform.file_slug, []).append(transform)

    for file_slug, file_transforms in transforms_by_file.items():
        try:
            all_handles = [h for t in file_transforms for h in t.handles]
            source_doc, entities_to_process = get_entities_from_dxf_file(
                file_slug, all_handles, owner_id, dek
            )

            if not entities_to_process:
                logger.warning("No entities found in file", extra={"file_slug": file_slug})
                continue
            required_layers = {entity.dxf.layer for entity in entities_to_process}

            loader = ezdxf.xref.Loader(source_doc, new_doc)

            if required_layers:
                loader.load_layers(list(required_layers))

            loader.execute()

            entities_by_handle = {e.dxf.handle: e for e in entities_to_process}

            for transform in file_transforms:
                rotationMatrix = Matrix44.z_rotate(transform.angle)
                translationMatrix = Matrix44.translate(transform.x, transform.y, 0)
                matrix = rotationMatrix * translationMatrix

                for handle in transform.handles:
                    entity = entities_by_handle.get(handle)
                    if entity is None:
                        continue
                    new_entity = entity.copy()
                    new_entity.transform(matrix)
                    new_msp.add_entity(new_entity)
                    added_entities.append(new_entity)

            logger.info(
                "Entities from file moved to file",
                extra={"file_slug": file_slug, "count": len(entities_to_process)}
            )

        except Exception as e:
            logger.error("Error processing transform", extra={"file_slug": file_slug, "error": e})
            raise e

    if bin_width is not None and bin_height is not None:
        # Sheet boundary — always drawn so the user sees the plate outline in
        # the result, distinct from the parts (blue layer).
        try:
            if "BIN_BOUNDARY" not in new_doc.layers:
                new_doc.layers.new(name="BIN_BOUNDARY", dxfattribs={"color": 5})  # blue
            new_msp.add_lwpolyline(
                [(0, 0), (bin_width, 0), (bin_width, bin_height), (0, bin_height)],
                close=True,
                dxfattribs={"layer": "BIN_BOUNDARY"},
            )
        except Exception as e:
            logger.error("Failed to add bin boundary", extra={"error": e})

    if add_out_shape and added_entities:
        try:
            bbox = ezdxf.bbox.extents(added_entities)
            if bbox.has_data:
                # Create a new layer for the bounding box
                if "OUT_SHAPE" not in new_doc.layers:
                    new_doc.layers.new(name="OUT_SHAPE", dxfattribs={"color": 1}) # Red color

                points = [
                    (bbox.extmin.x - space, bbox.extmin.y - space),
                    (bbox.extmax.x + space, bbox.extmin.y - space),
                    (bbox.extmax.x + space, bbox.extmax.y + space),
                    (bbox.extmin.x - space, bbox.extmax.y + space)
                ]
                new_msp.add_lwpolyline(points, close=True, dxfattribs={"layer": "OUT_SHAPE"})
                logger.info("Added bounding box to layout on layer OUT_SHAPE")
        except Exception as e:
            logger.error("Failed to add bounding box", extra={"error": e})

    return new_doc

dxf_document_cache = {}

def get_entities_from_dxf_file(dxf_file_slug, handles, owner_id=None, dek=None):
    """
    Opens a DXF file and returns the doc object and a list of entities
    matching the given handles.
    """
    if dxf_file_slug in dxf_document_cache:
        doc = dxf_document_cache[dxf_file_slug]
    else:
        dxf_bytes = read_gridfs(valid_dxf_bucket, dxf_file_slug, owner_id, dek)
        doc = read_dxf(io.BytesIO(dxf_bytes))
        dxf_document_cache[dxf_file_slug] = doc

    msp = doc.modelspace()

    handle_set = set(handles)

    entities = []
    for entity in msp:
        if entity.dxf.handle in handle_set:
            entities.append(entity)

    return doc, entities

N_ALTERNATIVES_DEFAULT = 3
DEFAULT_TIME_BUDGET_SEC = 45

# Human-readable labels for the live progress shown in the UI while a job runs.
STAGE_LABELS = {
    "preparing": "Preparing geometry",
    "explore": "Exploring layouts",
    "compress": "Compressing layout",
    "bpp-search": "Optimizing sheets",
    "reveal": "Revealing final layouts",
    "building": "Building result files",
}

def nesting_process(doc):
    logger.info("Processing nesting", extra={"doc": doc["slug"]})
    dxf_document_cache.clear()

    slug = doc.get("slug")
    files = doc.get("files")
    params = doc.get("params")
    space = params.get("space") or 0
    allow_rotation = params.get("allowRotation", True)
    add_out_shape = params.get("addOutShape", False)
    owner_id = doc.get("ownerId")

    # Sheet types: new multi-sheet format, falling back to the legacy single
    # width/height/sheetCount params.
    sheets = params.get("sheets")
    if not sheets:
        sheets = [{
            "width": params.get("width"),
            "height": params.get("height"),
            "count": params.get("sheetCount"),
        }]

    bin_dims = {}
    bins = []
    for bin_id, sheet in enumerate(sheets):
        sheet_width = float(sheet.get("width"))
        sheet_height = float(sheet.get("height"))
        sheet_stock = int(sheet.get("count"))
        bin_dims[bin_id] = (sheet_width, sheet_height)
        bins.append(build_bin(bin_id, sheet_stock, sheet_width, sheet_height))

    # Time budget (wall-clock cap) and number of alternatives are set
    # server-side at enqueue time based on the owner's tier
    # (params.timeBudgetSec / params.alternativesCount). Defaults cover jobs
    # enqueued before the tiered-compute feature existed.
    time_budget_sec = int(params.get("timeBudgetSec") or DEFAULT_TIME_BUDGET_SEC)
    n_alternatives = max(1, int(params.get("alternativesCount") or N_ALTERNATIVES_DEFAULT))

    # Tier compute: vcores caps the engine's parallelism (server-side value,
    # never the client's), directions picks the layout biases to explore.
    # Defaults: legacy jobs without tier fields get the previous behaviour
    # (engine auto-sizes threads, all directions).
    vcores = max(1, int(params.get("vcores") or 0))
    directions = params.get("directions") or None

    # Unwrapped DEK when the owner's vault is unlocked, None on the legacy
    # plaintext path. Raises VaultLockedError when files are encrypted but
    # the session expired mid-queue.
    dek = get_dek(db, owner_id)

    # Map allowRotation boolean to allowed_orientations array (fallback for backward compatibility)
    default_allowed_orientations = [0.0, 90.0, 180.0, 270.0] if allow_rotation else [0.0]

    input_items = convert_files_to_input_items(files, dek)

    # ------------------------------------------------------------------
    # Instant feasibility pre-check: an item whose bbox (+ the requested
    # spacing, which the engine enforces on every side) does not fit in ANY
    # sheet in ANY allowed orientation can never be placed. Failing here
    # saves a full (pointless) optimization run and, more importantly, tells
    # the user EXACTLY which part is the problem.
    # ------------------------------------------------------------------
    from shapely.geometry import Polygon as _Polygon
    from shapely.affinity import rotate as _sh_rotate

    unplaceable = []
    for item in input_items:
        poly = _Polygon(item.get("coords"), item.get("holes") or [])
        rotations = item.get("rotations", default_allowed_orientations) or [0.0]
        fits_anywhere = False
        for angle in rotations:
            rotated = _sh_rotate(poly, float(angle), origin=(0, 0)) if angle else poly
            bx = rotated.bounds
            w, h = bx[2] - bx[0], bx[3] - bx[1]
            for sheet in sheets:
                sw, sh = float(sheet.get("width")), float(sheet.get("height"))
                if w + space <= sw + 1e-6 and h + space <= sh + 1e-6:
                    fits_anywhere = True
                    break
            if fits_anywhere:
                break
        if not fits_anywhere:
            bx = poly.bounds
            unplaceable.append({
                "name": item.get("file_slug"),
                "width": bx[2] - bx[0],
                "height": bx[3] - bx[1],
                "count": item.get("count"),
            })

    if unplaceable:
        details = ", ".join(
            f"'{p['name']}' ({p['width']:.0f}x{p['height']:.0f}mm, x{p['count']})"
            for p in unplaceable[:5]
        )
        sheet_desc = " / ".join(
            f"{float(s.get('width')):.0f}x{float(s.get('height')):.0f}mm" for s in sheets
        )
        message = (
            f"Part(s) too large for the sheet: {details} — sheet(s): {sheet_desc}, "
            f"spacing: {space}mm. Use a larger sheet, allow more rotations, or reduce spacing."
        )
        logger.warning("Unplaceable parts detected", extra={"unplaceable": unplaceable})
        db["nesting_jobs"].update_one(
            { "slug": slug },
            {
                "$set": {
                    "placed": 0,
                    "status": "error",
                    "finishedAt": datetime.now(),
                    "update_ts": datetime.now(),
                    "information": message,
                },
                "$unset": {"progress": "", "liveLayout": "", "itemMap": "", "compute": ""}
            },
        )
        raise Exception(message)

    jaguar_items = []

    # Holed parts are opened to the exterior with a hairline channel so the
    # engine can nest parts inside their cutouts natively (the channel exists
    # only in the collision geometry; result DXFs use the original entities).
    has_holes = any(item.get("holes") for item in input_items)

    total_requested_count = 0
    total_part_area = 0.0
    for item in input_items:
        count = item.get("count")
        # Use per-file rotations if available, otherwise fall back to global setting
        allowed_orientations = item.get("rotations", default_allowed_orientations)
        shape_coords = item.get("coords")
        if item.get("holes"):
            # Channel widened past the separation inflation, otherwise jagua
            # seals it and the holes become unreachable (see holed_polygons).
            shape_coords = open_holes_with_channels(
                shape_coords, item["holes"], channel_width_for_space(space)
            )
        jaguar_item = build_item(item.get("id"), count, shape_coords, allowed_orientations)
        total_requested_count += count
        total_part_area += _Polygon(item.get("coords"), item.get("holes") or []).area * count
        jaguar_items.append(jaguar_item)

    # Map engine item ids back to (file, part) for the live visualizer:
    # input_items are built sequentially, so the part index is its position
    # within its file's polygonParts.
    part_index_by_id = {}
    per_file_counter = {}
    for item in input_items:
        item_file_slug = item.get("file_slug")
        part_index_by_id[item["id"]] = {
            "slug": item_file_slug,
            "part": per_file_counter.get(item_file_slug, 0),
        }
        per_file_counter[item_file_slug] = per_file_counter.get(item_file_slug, 0) + 1

    db["nesting_jobs"].update_one(
        {"_id": doc.get("_id")},
        {
            "$set": {
                "requested": total_requested_count,
                "itemMap": [
                    {"id": item_id, "slug": m["slug"], "part": m["part"]}
                    for item_id, m in part_index_by_id.items()
                ],
                "update_ts": datetime.now()
            },
        }
    )

    # Live progress for the UI (the results SSE stream polls the job every
    # second). Writes are throttled: Mongo sees at most one update per 2s
    # unless a stage completes.
    import time as _time
    import threading as _threading
    _last_progress_write = [0.0]
    _last_stage = [None]
    _job_started = _time.monotonic()
    # Shared with the heartbeat: the latest stage state, re-written with a
    # fresh elapsed time so the UI timer keeps ticking during long stages
    # where nothing else reports.
    _current_progress = {"stage": "preparing", "done": 0, "total": 1}
    _heartbeat_stop = _threading.Event()

    def report_progress(stage, done, total, pct=None):
        _current_progress.update({"stage": stage, "done": done, "total": total, "pct": pct})
        now = _time.time()
        # Stage changes are always written immediately — throttling them away
        # made the UI look stuck on the previous stage's final count.
        stage_changed = stage != _last_stage[0]
        if not stage_changed and done < total and now - _last_progress_write[0] < 2.0:
            return
        _last_progress_write[0] = now
        _last_stage[0] = stage
        try:
            db["nesting_jobs"].update_one(
                {"_id": doc.get("_id")},
                {"$set": {
                    "progress": {
                        "stage": stage,
                        "label": STAGE_LABELS.get(stage, stage),
                        "done": done,
                        "total": total,
                        # Ticking seconds prove the worker is alive even on
                        # long stages.
                        "elapsed_sec": int(_time.monotonic() - _job_started),
                    },
                    "update_ts": datetime.now(),
                }},
            )
        except Exception as e:
            logger.warning("Failed to write progress", extra={"error": str(e)})

    def _progress_heartbeat():
        while not _heartbeat_stop.is_set():
            p = dict(_current_progress)
            try:
                # Self-terminating: a daemon thread must never rewrite the
                # progress of a job that already finished or failed (the
                # field is unset on completion).
                current = db["nesting_jobs"].find_one(
                    {"_id": doc.get("_id")}, {"status": 1}
                )
                if not current or current.get("status") != "processing":
                    return
                db["nesting_jobs"].update_one(
                    {"_id": doc.get("_id")},
                    {"$set": {
                        "progress": {
                            "stage": p["stage"],
                            "label": STAGE_LABELS.get(p["stage"], p["stage"]),
                            "done": p["done"],
                            "total": p["total"],
                            "pct": p.get("pct"),
                            "elapsed_sec": int(_time.monotonic() - _job_started),
                        },
                        "update_ts": datetime.now(),
                    }},
                )
            except Exception:
                pass
            _heartbeat_stop.wait(2.0)

    report_progress("preparing", 0, 1)
    _heartbeat_thread = _threading.Thread(target=_progress_heartbeat, daemon=True)
    _heartbeat_thread.start()

    # ------------------------------------------------------------------
    # Solve: ONE call to the nest-engine Rust binary.
    #   - SPP (single strip = ONE sheet, min used length = max offcut) only
    #     when every requested part plausibly fits on a single sheet;
    #   - otherwise BPP (min sheets over the declared stock) — even with a
    #     single sheet type, since SPP cannot span multiple sheets.
    # The seed is derived from the job payload: runs are reproducible.
    # ------------------------------------------------------------------
    SPP_MAX_AREA_RATIO = float(os.environ.get("NEST_SPP_MAX_AREA_RATIO", "0.80"))
    single_sheet_area = (bin_dims[0][0] * bin_dims[0][1]) if bins else 0.0
    is_spp = (
        len(bins) == 1
        and single_sheet_area > 0
        and total_part_area <= single_sheet_area * SPP_MAX_AREA_RATIO
    )
    problem_type = "spp" if is_spp else "bpp"
    logger.info(
        "Problem type selected",
        extra={
            "problem_type": problem_type,
            "total_part_area": round(total_part_area),
            "single_sheet_area": single_sheet_area,
            "area_ratio": round(total_part_area / single_sheet_area, 3) if single_sheet_area else None,
        },
    )

    if is_spp:
        instance = build_spp_instance(
            jaguar_items, bin_dims[0][0], bin_dims[0][1], name=slug
        )
        max_strip_width = bin_dims[0][0]
    else:
        instance = build_bpp_instance(jaguar_items, bins, name=slug)
        max_strip_width = None

    seed = deterministic_seed({
        "instance": instance,
        "space": space,
        "budget": time_budget_sec,
    })

    # Tier vcores -> engine threads. BPP walks are single-threaded (1 walk
    # per vcore, floor 3: strict quality parity — the free tier runs the
    # same multi-start diversity, just oversubscribed and therefore slower).
    # SPP runs use a 3-thread separator each (floor 2 runs).
    # vcores == 0: legacy job, let the engine auto-size from the host CPUs.
    if vcores:
        n_workers = max(3, vcores) if not is_spp else max(2, vcores // 3)
    else:
        n_workers = None
    # Plateau stop: end walks once converged instead of burning the whole
    # wall cap. Generous floor — hard instances (swim-like) have long flat
    # regions before a late improvement.
    plateau_patience_sec = max(15.0, time_budget_sec / 4.0)

    engine_config = build_engine_config(
        time_budget_sec,
        seed,
        n_alternatives,
        min_separation=space,
        has_holes=has_holes,
        max_strip_width=max_strip_width,
        n_workers=n_workers,
        biases=directions,
        plateau_patience_sec=plateau_patience_sec,
    )

    # Surface the effective compute profile on the job doc: the frontend
    # animates the vcores at work during the solve.
    try:
        db["nesting_jobs"].update_one(
            {"_id": doc.get("_id")},
            {"$set": {
                "compute": {
                    "vcores": vcores or None,
                    "workers": n_workers,
                    "directions": directions,
                },
                "update_ts": datetime.now(),
            }},
        )
    except Exception as e:
        logger.warning("Failed to write compute profile", extra={"error": str(e)})

    # Live layout snapshots for the visualizer: the engine streams placed
    # item positions ~2Hz per worker; we persist the latest one (throttled)
    # on the job doc, the SSE stream pushes it to the browser.
    _last_live_write = [0.0]

    def report_live_layout(event):
        now = _time.time()
        stage = event.get("stage", "")
        # Stage changes always pass (they mark phase transitions), otherwise
        # one write per 2s max.
        if stage == _current_progress.get("stage") and now - _last_live_write[0] < 2.0:
            return
        _last_live_write[0] = now
        try:
            live = {
                "stage": stage,
                "worker": event.get("worker"),
                "feasible": event.get("feasible"),
                "strip_width": event.get("strip_width"),
                "density": event.get("density"),
                "bins": event.get("bins"),
                "unplaced": event.get("unplaced"),
                "remnant": event.get("remnant"),
                "elapsed_ms": event.get("elapsed_ms"),
                # Sheet frame(s) so the browser can draw the sheet(s).
                "sheets": [[float(s.get("width")), float(s.get("height"))] for s in sheets],
                "isSpp": is_spp,
                "items": event.get("items", []),
            }
            db["nesting_jobs"].update_one(
                {"_id": doc.get("_id")},
                {"$set": {"liveLayout": live, "update_ts": datetime.now()}},
            )
        except Exception as e:
            logger.warning("Failed to write live layout", extra={"error": str(e)})

    def _on_engine_event(event):
        etype = event.get("type")
        if etype == "layout":
            report_live_layout(event)
        elif etype in ("progress", "heartbeat"):
            stage = event.get("stage", "explore")
            # Real percentage: the engine reports its elapsed seconds and we
            # know the time budget it was given (it stops by itself at 100%).
            elapsed = int(event.get("elapsed_sec") or 0)
            pct = min(99, round(elapsed / max(1, time_budget_sec) * 100))
            report_progress(stage, elapsed, time_budget_sec, pct)

    # Cancellation: the API sets cancelRequested on the job doc when the user
    # aborts. The engine driver polls this (~1s); reads are cached 2s.
    _cancel_state = {"flag": False, "checked": 0.0}

    def should_cancel():
        now = _time.time()
        if now - _cancel_state["checked"] < 2.0:
            return _cancel_state["flag"]
        _cancel_state["checked"] = now
        try:
            current = db["nesting_jobs"].find_one(
                {"_id": doc.get("_id")}, {"cancelRequested": 1}
            )
            _cancel_state["flag"] = bool(current and current.get("cancelRequested"))
        except Exception:
            pass
        return _cancel_state["flag"]

    try:
        engine_alternatives = run_engine(
            instance, engine_config, problem_type, on_event=_on_engine_event,
            should_cancel=should_cancel,
        )
    except EngineCancelled:
        _heartbeat_stop.set()
        db["nesting_jobs"].update_one(
            { "slug": slug },
            {
                "$set": {
                    "status": "cancelled",
                    "information": "Nesting cancelled by user.",
                    "finishedAt": datetime.now(),
                    "update_ts": datetime.now(),
                },
                "$unset": {"progress": "", "liveLayout": "", "itemMap": "", "compute": ""}
            },
        )
        raise JobCancelled(slug)
    except Exception as e:
        _heartbeat_stop.set()
        # Surface the real failure reason when we have one (geometry rejected
        # at import, engine crash, timeout…) — the generic message tells the
        # user nothing actionable.
        detail = str(e)
        if "no feasible solution" in detail:
            information = ("Not all items could be placed in the nesting job — "
                           "the engine could not fit every part. Try a larger sheet, "
                           "more sheets, or a bigger compute budget.")
        else:
            information = f"Nesting failed: {detail[:400]}"
        db["nesting_jobs"].update_one(
            { "slug": slug },
            {
                "$set": {
                    "placed": 0,
                    "status": "error",
                    "finishedAt": datetime.now(),
                    "update_ts": datetime.now(),
                    "information": information
                },
                "$unset": {"progress": "", "liveLayout": "", "itemMap": "", "compute": ""}
            },
        )
        raise Exception(information) from e

    # Strategy-labelled alternatives — the engine already returns its best
    # distinct layouts, ranked. SPP layouts are inherently max-offcut (used
    # length minimized); BPP layouts are inherently min-sheets.
    alternatives = []

    # ------------------------------------------------------------------
    # Final reveal: replay the exported alternatives on the live feed, one
    # at a time, so the visualizer ends exactly on the final results (the
    # search frames are mid-optimization working states — without this the
    # last live frame could lag behind the exported layout).
    # ------------------------------------------------------------------
    REVEAL_STEP_SEC = float(os.environ.get("NEST_REVEAL_STEP_SEC", "1.2"))

    def _alt_to_live(engine_alt, rank):
        solution = engine_alt["solution"]
        if is_spp:
            items = [
                [pi.get("item_id"), pi.get("transformation", {}).get("rotation", 0),
                 pi.get("transformation", {}).get("translation", [0, 0])[0],
                 pi.get("transformation", {}).get("translation", [0, 0])[1]]
                for layout in solution.get("layouts", [])
                for pi in layout.get("placed_items", [])
            ]
        else:
            items = [
                [pi.get("item_id"), li, pi.get("transformation", {}).get("rotation", 0),
                 pi.get("transformation", {}).get("translation", [0, 0])[0],
                 pi.get("transformation", {}).get("translation", [0, 0])[1]]
                for li, layout in enumerate(solution.get("layouts", []))
                for pi in layout.get("placed_items", [])
            ]
        return {
            "stage": "reveal",
            "worker": rank,
            "feasible": True,
            "strip_width": engine_alt.get("metrics", {}).get("strip_width"),
            "density": engine_alt.get("metrics", {}).get("density"),
            "bins": engine_alt.get("metrics", {}).get("cost"),
            "elapsed_ms": int((_time.monotonic() - _job_started) * 1000),
            "sheets": [[float(s.get("width")), float(s.get("height"))] for s in sheets],
            "isSpp": is_spp,
            "items": items,
        }

    if REVEAL_STEP_SEC > 0 and engine_alternatives:
        report_progress("reveal", 0, len(engine_alternatives), 0)
        for rank, engine_alt in enumerate(engine_alternatives):
            try:
                db["nesting_jobs"].update_one(
                    {"_id": doc.get("_id")},
                    {"$set": {
                        "liveLayout": _alt_to_live(engine_alt, rank),
                        "update_ts": datetime.now(),
                    }},
                )
            except Exception as e:
                logger.warning("Failed to write reveal layout", extra={"error": str(e)})
            report_progress("reveal", rank + 1, len(engine_alternatives),
                            min(99, round((rank + 1) / len(engine_alternatives) * 100)))
            if rank < len(engine_alternatives) - 1:
                _time.sleep(REVEAL_STEP_SEC)

    def _finalize_alternative(engine_alt, strategy, rank):
        result_containers, placed_count, density, cost = parse_result_containers(
            {"solution": engine_alt["solution"]}, input_items, bin_dims
        )

        # Part-loss guard: the engine only exports complete placements, but
        # never trust a solver blindly — discard anything short.
        n = sum(len(c.transforms) for c in result_containers)
        if n != total_requested_count:
            logger.error(
                "Alternative lost parts, discarding it",
                extra={"strategy": strategy, "transforms": n,
                       "requested": total_requested_count},
            )
            return

        alt_slug = f"{slug}_alt{rank}"
        report_progress("building", rank, n_alternatives,
                        min(99, round(rank / max(1, n_alternatives) * 100)))
        dxf_files, svg_files = build_result_dxf_files(
            owner_id, alt_slug, result_containers, add_out_shape, space, dek
        )
        alternatives.append({
            "seed": engine_alt.get("seed"),
            "strategy": strategy,
            "density": density,
            # Share of sheet actually consumed (used bbox / sheet area,
            # lower = better): the score that rewards compaction.
            "usedSheetShare": compute_used_sheet_share(result_containers, input_items),
            "offcut": largest_empty_rectangle(result_containers, input_items),
            "cost": cost,
            "layoutCount": len(result_containers),
            "dxf_files": dxf_files,
            "svg_files": svg_files,
        })

    def _strategy_for(engine_alt, rank):
        # The engine tags each BPP alternative with its directional bias
        # (left / bottom / balanced) — that IS the alternative's identity.
        # Fallbacks: SPP (rank 0 maximizes the offcut) and engines without
        # bias tagging (legacy binaries).
        bias = engine_alt.get("bias")
        if bias:
            return bias
        if rank == 0:
            return "max offcut" if is_spp else "compact"
        return "balanced"

    for rank, engine_alt in enumerate(engine_alternatives):
        _finalize_alternative(engine_alt, _strategy_for(engine_alt, rank), rank)

    if not alternatives:
        _heartbeat_stop.set()
        db["nesting_jobs"].update_one(
            { "slug": slug },
            {
                "$set": {
                    "placed": 0,
                    "status": "error",
                    "finishedAt": datetime.now(),
                    "update_ts": datetime.now(),
                    "information": "Not all items could be placed in the nesting job"
                },
                "$unset": {"progress": "", "liveLayout": "", "itemMap": "", "compute": ""}
            },
        )
        raise Exception("Not all items could be placed in the nesting job")

    _heartbeat_stop.set()
    # Best first: fewest sheets, then least sheet consumed.
    alternatives.sort(
        key=lambda alt: (alt.get("layoutCount") or 0, alt.get("usedSheetShare") or 1.0)
    )
    for alt_id, alt in enumerate(alternatives):
        alt["alt_id"] = alt_id

    best = alternatives[0]
    db["nesting_jobs"].update_one(
        { "slug": slug },
        {
            "$set": {
                "alternatives": alternatives,
                # Legacy fields = best alternative (retro-compat readers).
                "dxf_files": best["dxf_files"],
                "svg_files": best["svg_files"],
                "placed": total_requested_count,
                "layoutCount": best["layoutCount"],
                "density": best["density"],
                "usedSheetShare": best["usedSheetShare"],
                "update_ts": datetime.now()
            },
            "$unset": {"progress": "", "liveLayout": "", "itemMap": "", "compute": ""}
        }
    )
