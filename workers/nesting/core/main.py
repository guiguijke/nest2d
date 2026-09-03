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
from core.engine import EngineCancelled, EngineError, run_engine
from core.holed_polygons import channel_width_for_space, channels_usable, open_holes_with_channels
from core.placement import ResultContainer, Transform, parse_result_containers
from core.metrics import (
    compute_used_sheet_share,
    enrich_offcut,
    largest_empty_rectangle,
    per_class_counts_match,
    per_class_placed_counts,
    per_sheet_metrics,
    report_totals,
    verify_layout,
)
from dxf.dxf_utils import read_dxf
from core.svg_colored import build_colored_sheet_svg
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
from worker_common.colors import resolve_part_color
from worker_common.geometry.units import output_scale_and_headers

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
        rotations = file.get("rotations", [0, 90, 180, 270]) or [0.0]  # P-m.1 : [] -> [0] a l'entree

        user_dxf_file = db["user_dxf_files"].find_one({"slug": file_slug})
        # Decrypts the enc blob when the file was processed while the vault
        # was enabled; passes legacy plaintext through untouched.
        plogonParts = resolve_polygon_parts(db, user_dxf_file, dek)
        for part_index, part in enumerate(plogonParts):
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
                'rotations': rotations,
                # Display color (screen rendering only — never applied to the
                # production DXF). Persisted at import; deterministic fallback
                # for files imported before colors existed.
                'color': resolve_part_color(part, file_slug, part_index),
            }

            id += 1

            input_items.append(item)

    return input_items


def adaptive_plateau_patience_sec(time_budget_sec, n_parts, n_vertices, has_holes):
    """J-083 — patience adaptative : on arrête dès que la recherche converge.

    Le plancher historique de 12 s faisait tourner un job trivial (quelques
    pièces, dizaines de sommets) jusqu'au budget mur entier alors qu'il
    converge en ~1 s (« 14 s pour 4 pièces »). La patience est le temps
    d'attente toléré SANS amélioration globale avant de déclarer la
    convergence — le budget mur reste le filet de sécurité anytime :
      - plancher 2 s : même le job le plus simple doit confirmer son plateau
        (ne pas couper sur un creux isolé) ;
      - + charge de sommets placés : les instances denses voient des
        améliorations plus tardives ;
      - + prime trous PROPORTIONNELLE : le remplissage de trous (phase 2)
        améliore tard, mais seulement quand il y a de la matière à remplir —
        un job à 1 trou converge aussi vite qu'un job sans trou ;
      - + densité de pièces, plafonnée ;
      - plafond 30 s, et jamais au-delà du budget mur.
    """
    base = (
        2.0
        + n_vertices / 1500.0
        + (min(3.0, n_parts / 15.0) if has_holes else 0.0)
        + min(6.0, n_parts / 20.0)
    )
    return max(2.0, min(base, 30.0, float(time_budget_sec)))


def save_dxf_result(owner_id, file_name, drawing, dek=None):
    dxf_copy_text_stream = io.StringIO()
    drawing.write(dxf_copy_text_stream)
    dxf_copy_text = dxf_copy_text_stream.getvalue()
    dxf_copy_text_stream.close()

    dxf_copy_bytes = dxf_copy_text.encode('utf-8')

    write_gridfs(dxf_result_bucket, file_name, dxf_copy_bytes, owner_id, dek)

def save_svg_result(owner_id, file_name, transforms, items_by_id, dek=None,
                    bin_width=None, bin_height=None, unit_scale=1.0, unit_attr="mm"):
    # Colored per-part render from the placements + source rings — the
    # production DXF is never recolored, only this on-screen SVG is.
    # bin dims stay in canonical mm; the generator applies unit_scale itself.
    svg_string = build_colored_sheet_svg(
        transforms,
        items_by_id,
        bin_width,
        bin_height,
        unit_scale,
        unit_attr,
    )
    svg_bytes = svg_string.encode('utf-8')
    write_gridfs(svg_result_bucket, file_name, svg_bytes, owner_id, dek)

def build_result_dxf_files(owner_id, slug, result_containers, input_items, add_out_shape=False, space=0, dek=None,
                           output_unit="mm"):
    """
    Iterates through containers, builds a combined/transformed DXF for each,
    and saves the result. Returns (dxf_files, svg_files) — the caller is
    responsible for persisting them on the job document.
    """
    print(f"Starting build process for slug: {slug}")

    unit_scale, _, _ = output_scale_and_headers(output_unit)
    unit_attr = "in" if output_unit == "inch" else "mm"

    # O(1) color/ring lookup for the colored SVG render.
    items_by_id = {item["id"]: item for item in input_items}

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
            output_unit,
        )

        logger.info("Saving combined file", extra={"file_name": dxf_file_name})
        save_dxf_result(owner_id, dxf_file_name, new_drawing, dek)
        dxf_files.append(dxf_file_name)

        svg_file_name = f"{slug}_part_{result_container.container_id}.svg"
        save_svg_result(
            owner_id,
            svg_file_name,
            result_container.transforms,
            items_by_id,
            dek,
            result_container.bin_width,
            result_container.bin_height,
            unit_scale,
            unit_attr,
        )
        svg_files.append(svg_file_name)

    return dxf_files, svg_files

def build_part(transforms, add_out_shape=False, space=0, owner_id=None, dek=None, bin_width=None, bin_height=None,
               output_unit="mm"):
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

    # Export boundary: geometry was computed in canonical mm. Scale the whole
    # modelspace (parts, BIN_BOUNDARY, OUT_SHAPE) to the user's output unit —
    # full precision, never rounded — and make the headers agree with the
    # numbers so any CAM reads the file correctly.
    unit_scale, insunits, measurement = output_scale_and_headers(output_unit)
    if unit_scale != 1.0:
        scale_matrix = Matrix44.scale(unit_scale, unit_scale, 1.0)
        for entity in new_msp:
            entity.transform(scale_matrix)
    new_doc.header["$INSUNITS"] = insunits
    new_doc.header["$MEASUREMENT"] = measurement

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
        if doc is None:
            # validDxf a pourtant été écrit par fileprocessing : la relecture
            # en échec est rare, mais sans garde on cache None et on meurt
            # d'un AttributeError inexploitable au premier modelspace().
            raise Exception(
                f"The stored DXF copy for file {dxf_file_slug} could not "
                "be re-read (recovery failed). Re-upload the file."
            )
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

def part_fits_any_sheet(w, h, sheets, space):
    """Q-1 (audit 2026-08-31 §Q-1) : faisabilité jagua d'une bbox de pièce
    (w, h) sur une des tôles. jagua inflate l'item de space/2 ET déflate le
    conteneur de space/2 (jagua-rs/src/io/import.rs) → la condition réelle
    de placement est w + 2·space ≤ sw (space = 0 : w ≤ sw). L'ancienne
    garde `w + space` laissait passer 8×8 / tôle 10 / space 2 → panique SPP
    « strip-width is running away » (lbf.rs, panic = abort). Miroir exact :
    localPayloadBuilder.js::partFitsAnySheet (piège #49).
    """
    for sheet in sheets:
        sw, sh = float(sheet.get("width")), float(sheet.get("height"))
        if w + 2 * space <= sw + 1e-6 and h + 2 * space <= sh + 1e-6:
            return True
    return False


def nesting_process(doc):
    # P-m.5 (audit 2026-08-31 §P-m.5) : le cache ezdxf ne doit pas survivre
    # au job — le doc du job N restait en RAM pendant tout l'idle du worker
    # (vidé seulement au début du job SUIVANT, dizaines de Mo sur un gros
    # DXF). Le clear d'entrée reste (défense contre un résiduel).
    try:
        return _nesting_process_impl(doc)
    finally:
        dxf_document_cache.clear()


def _nesting_process_impl(doc):
    logger.info("Processing nesting", extra={"doc": doc["slug"]})
    dxf_document_cache.clear()

    slug = doc.get("slug")
    files = doc.get("files")
    params = doc.get("params")
    space = params.get("space") or 0
    allow_rotation = params.get("allowRotation", True)
    add_out_shape = params.get("addOutShape", False)
    # Hole filling switch (UI setting): when off, holed parts stay sealed —
    # the engine sees their plain outer ring, so nothing can be nested inside
    # their cutouts. Default ON for backward compatibility (jobs and clients
    # predating the switch always filled holes).
    fill_holes = bool(params.get("fillHoles", True))
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
    # C13 (audit 2026-09-03) : jagua exige des ids CONSECUTIFS — une tôle
    # `count: 0` au milieu de la liste cassait l'import (« consecutive
    # IDs », opaque). Les formats vides sont FILTRÉS ; container_map_back
    # retraduit les container_id moteur vers les ids de formats d'origine
    # (bin_dims reste indexé par l'id FORMAT, utilisé par le post-pass).
    container_map_back = {}
    for bin_id, sheet in enumerate(sheets):
        sheet_width = float(sheet.get("width"))
        sheet_height = float(sheet.get("height"))
        sheet_stock = int(sheet.get("count"))
        bin_dims[bin_id] = (sheet_width, sheet_height)
        if sheet_stock <= 0:
            continue
        container_map_back[len(bins)] = bin_id
        bins.append(build_bin(len(bins), sheet_stock, sheet_width, sheet_height))
    # bin_dims_engine : clés = ids MOTEUR (0..len(bins)-1), valeurs = dims
    # du format d'origine — le map-back des container_id (identité quand
    # aucun format n'est filtré).
    bin_dims_engine = {
        eid: bin_dims[fid] for eid, fid in container_map_back.items()}

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
    # Unit of the exported result DXF/SVG, written server-side at enqueue
    # from the owner's preference. Legacy jobs have no field -> mm (safe).
    output_unit = params.get("outputUnit") or "mm"

    # Unwrapped DEK when the owner's vault is unlocked, None on the legacy
    # plaintext path. Raises VaultLockedError when files are encrypted but
    # the session expired mid-queue.
    dek = get_dek(db, doc)

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
            if part_fits_any_sheet(w, h, sheets, space):
                fits_anywhere = True
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
    # When the user disabled hole filling, holes stay sealed: the collision
    # geometry is the plain outer ring and cutouts become dead space. The
    # Python-side item['holes'] is kept either way (exact verification and
    # hole-fill metrics still see the true geometry).
    #
    # Sealed-channel guard: jagua inflates items by space/2 on each side, so
    # a channel narrower than `space` is crushed shut — and the crushed ring
    # breaks the engine import (duplicate vertices / empty offset). Opening
    # holes in that case is worse than useless: skip the channel entirely and
    # let the holes go unused, which is the SAFE degradation the docstring of
    # holed_polygons.channel_width_for_space already promises.
    channel_width = channel_width_for_space(space)
    channels_sealed = fill_holes and not channels_usable(space)
    if channels_sealed:
        logger.warning(
            "Spacing seals hole channels — holes stay closed this run",
            extra={"space": space, "channel_width": channel_width},
        )
    has_holes = (
        fill_holes
        and not channels_sealed
        and any(item.get("holes") for item in input_items)
    )

    total_requested_count = 0
    # A4 : compte demandé PAR item_id (la garde anti-perte par total seul
    # laissait passer doublon + perte compensée).
    requested_by_id = {}
    total_part_area = 0.0
    total_outer_area = 0.0
    # Aire ENVELOPPE (anneaux externes, trous NON déduits) : c'est ce que le
    # placement occupe réellement — le test SPP « tout tient sur une
    # tôle » doit la utiliser, pas l'aire nette (bug démo 2026-08-29 :
    # 24 pièces marines à trous, net 75 % <= 80 % -> SPP forcé à tort,
    # 3 tôles écrasées en 1 seule, chevauchements).
    for item in input_items:
        count = item.get("count")
        # Use per-file rotations if available, otherwise fall back to global setting
        # P-m.1 : liste vide → [0] (plus de liste vide passée au moteur —
        # comportement jagua indéfini sur allowed_orientations vide).
        allowed_orientations = (
            item.get("rotations", default_allowed_orientations) or [0.0]
        )
        shape_coords = item.get("coords")
        if has_holes and item.get("holes"):
            # Channel widened past the separation inflation, otherwise jagua
            # seals it and the holes become unreachable (see holed_polygons).
            shape_coords = open_holes_with_channels(
                shape_coords, item["holes"], channel_width
            )
        jaguar_item = build_item(item.get("id"), count, shape_coords, allowed_orientations)
        total_requested_count += count
        requested_by_id[item.get("id")] = count
        total_part_area += _Polygon(item.get("coords"), item.get("holes") or []).area * count
        total_outer_area += _Polygon(item.get("coords") or []).area * count
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

    # Live combinations counter: SPP feeds it with placement evaluations
    # ('evals' events), BPP with SA iterations ('heartbeat' events) — the
    # progress doc carries the sum across workers. Per-worker counters are
    # RUN-scoped: a worker starting a new phase (new engine run) restarts at
    # zero, so the pipeline accumulates deltas into a monotone total.
    _worker_evals = {}
    _worker_evals_offset = {}

    def _record_worker_evals(worker, evals):
        if worker is None:
            return
        prev = _worker_evals.get(worker, 0)
        if evals < prev:
            # New run for this worker: bank the previous run's total.
            _worker_evals_offset[worker] = _worker_evals_offset.get(worker, 0) + prev
        _worker_evals[worker] = evals

    def _total_evals():
        return sum(_worker_evals.values()) + sum(_worker_evals_offset.values())

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
                        **({"evals": _total_evals()} if _worker_evals else {}),
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
                            **({"evals": _total_evals()} if _worker_evals else {}),
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
    total_stock = sum(int(s.get("count") or 1) for s in sheets)
    # SPP cannot span sheets. Stock count > 1 is BPP — sauf –X / left seul
    # (l'utilisateur demande une bande, pas un remplissage de stock).
    dirs = params.get("directions") or []
    left_only = isinstance(dirs, (list, tuple)) and list(dirs) == ["left"]
    is_spp = (
        len(bins) == 1
        and single_sheet_area > 0
        and total_outer_area <= single_sheet_area * SPP_MAX_AREA_RATIO
        and (total_stock == 1 or left_only)
    )
    problem_type = "spp" if is_spp else "bpp"
    logger.info(
        "Problem type selected",
        extra={
            "problem_type": problem_type,
            "total_part_area": round(total_part_area),
            "total_outer_area": round(total_outer_area),
            "single_sheet_area": single_sheet_area,
            "area_ratio": round(total_part_area / single_sheet_area, 3) if single_sheet_area else None,
        },
    )

    if is_spp and space > 0 and total_outer_area / bin_dims[0][1] <= space:
        # jagua initializes the strip width to total_area/strip_height and then
        # DEFLATES it by space/2 on each side (min_item_separation). When the
        # spacing exceeds that initial width the strip offset comes out empty
        # and the engine panics deep inside a rayon walk ("Offset resulted in
        # an empty polygon") — fail fast with an actionable message instead.
        # Aire ENVELOPPE (majorante de la géométrie moteur : anneaux ouverts
        # canaux ≤ aire externe) : l'aire nette sous-estime et laisserait
        # passer le panic sur les pièces très trouées.
        raise Exception(
            f"Spacing {space} mm is too large for this instance: parts total "
            f"{round(total_outer_area)} mm² on a {bin_dims[0][1]:.0f} mm-high sheet "
            f"(initial strip width {total_outer_area / bin_dims[0][1]:.1f} mm). "
            f"Reduce the spacing or add more parts/stock."
        )

    if is_spp:
        instance = build_spp_instance(
            jaguar_items, bin_dims[0][0], bin_dims[0][1], name=slug
        )
        max_strip_width = bin_dims[0][0]
    else:
        instance = build_bpp_instance(jaguar_items, bins, name=slug)
        max_strip_width = None

    # D-MOT-16 : trous d'abord (SPP et BPP, pièces mixtes). Packer générique
    # + repli J-085 (1 hôte + 1 filler, pinwheel 4/4) si le packer lève,
    # dépasse son budget ou score moins bien. Hôtes avec au moins un filler
    # → trous FERMÉS (piège #3b). Ids RÉINDEXÉS 0..n-1 (piège #3b).
    meta = None
    solve_instance = instance
    if has_holes:
        from core.holefill import plan_hole_fills, reduce_for_solve
        packs = plan_hole_fills(input_items, space)
        if packs:
            meta, reduced = reduce_for_solve(input_items, jaguar_items, packs, space)
            if reduced:
                if is_spp:
                    solve_instance = build_spp_instance(
                        reduced, bin_dims[0][0], bin_dims[0][1], name=slug
                    )
                else:
                    solve_instance = build_bpp_instance(reduced, bins, name=slug)
            else:
                meta = None

    seed = deterministic_seed({
        "instance": solve_instance,
        "space": space,
        "budget": time_budget_sec,
    })

    # D-PAY-12 : la recherche BPP fait toujours QUALITY_WALKS (8) walks
    # jusqu'au plateau. vcores = concurrence rayon seulement (Free 1,
    # Unlimited 4, Pro 8) — même résultat, plus lent. SPP garde un
    # multi-start plancher 3 (une classe directionnelle par walk) ; le
    # separator interne reste à 3 threads, borné par RAYON_NUM_THREADS.
    # vcores == 0 : job legacy, le moteur dimensionne sur les CPU hôte.
    QUALITY_WALKS = 8
    search_walks = int(params.get("walks") or params.get("browser_walks") or QUALITY_WALKS)
    rayon_threads = None
    if vcores:
        n_workers = search_walks if not is_spp else max(3, vcores // 3)
        rayon_threads = max(1, int(vcores))
    else:
        n_workers = None
    separator_workers = None
    if params.get("computeLocation") == "local":
        # J-083 (profil navigateur mono-walk, cf. #14c) : wasm n'a AUCUN
        # thread OS — le multi-start et le parallélisme du separator y sont
        # SÉQUENTIELS : chaque walk ajouté multiplie le temps mur sans gain
        # de qualité sur un budget de 13 s. Le solve navigateur = 1 walk,
        # 1 separator, comme le profil démo.
        n_workers = 1
        separator_workers = 1
    # Plateau stop (J-083, adaptatif) : on arrête les walks dès que la
    # recherche converge au lieu de brûler le budget mur. La patience suit la
    # taille de l'instance (sommets placés, trous, pièces) — un job trivial
    # confirme son plateau en 2-4 s, une instance dense garde de la marge
    # pour les améliorations tardives ; le budget mur reste le plafond.
    placed_vertices = sum(
        (len(item.get("coords") or []) + sum(len(h) for h in (item.get("holes") or [])))
        * (item.get("count") or 1)
        for item in input_items
    )
    plateau_patience_sec = adaptive_plateau_patience_sec(
        time_budget_sec, total_requested_count, placed_vertices, has_holes
    )

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
        separator_workers=separator_workers,
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
                    "walks": search_walks,
                    "concurrency": rayon_threads,
                    "directions": directions,
                },
                "update_ts": datetime.now(),
            }},
        )
    except Exception as e:
        logger.warning("Failed to write compute profile", extra={"error": str(e)})

    # Phase 2 (flag-gated local compute): the worker only PREPARES the exact
    # engine payload (same instance building, hole channels, SPP/BPP choice,
    # deterministic seed as a server solve) and stops here — the browser runs
    # the WASM engine on it and POSTs the result back (or reports failure,
    # which refunds the consumed quota). run_engine is never called and no
    # compute-pool token is acquired for a local job.
    if params.get("computeLocation") == "local":
        _heartbeat_stop.set()
        # J-082: the browser builds the colored SVG / report / DXF exports
        # ITSELF (geometry bundle) and must produce byte-identical artifacts
        # to the server path. It therefore needs the SAME per-item data the
        # server finalization uses (parse_result_containers -> transforms +
        # input_items -> geometry): clean coords+holes (the engine instance
        # only carries the channel-opened rings), display color, source file
        # slug and DXF entity handles (exports copy entities BY HANDLE).
        # Input data only (server -> client, already uploaded by the owner):
        # the J-077 claim is about OUTGOING geometry, unchanged.
        payload_parts = [
            {
                "id": item["id"],
                "file_slug": item.get("file_slug"),
                "handles": item.get("handles") or [],
                "color": item.get("color"),
                "coords": item.get("coords"),
                "holes": item.get("holes") or [],
                "count": item.get("count") or 0,
                # D4 (audit 2026-09-03) : rotations de la PART, pas de
                # l'instance réduite — le miroir JS attribuait à un hôte
                # les rotations d'un autre item dès que la classe fan
                # était absorbée (idMap non identité).
                "rotations": item.get("rotations")
                    or default_allowed_orientations or [0.0],
            }
            for item in input_items
        ]
        db["nesting_jobs"].update_one(
            {"_id": doc.get("_id")},
            {
                "$set": {
                    "status": "awaiting_local",
                    "localPayload": {
                        "problem": problem_type,
                        "instance": solve_instance,
                        # J-085 : le navigateur résout l'instance réduite puis
                        # rattache les fillers en pinwheel (miroir du serveur).
                        "meta": meta,
                        "engineConfig": engine_config,
                        "parts": payload_parts,
                        # D7 (audit 2026-09-03) : gate de trou identique au
                        # serveur — le navigateur remplissait les trous sur
                        # un payload préparé trous fermés (space > 2,4 :
                        # canneaux scellés) alors que le serveur ne le
                        # fait pas.
                        "hasHoles": bool(has_holes),
                        "fillHoles": bool(fill_holes and not channels_sealed),
                        # J-082: the client's DXF export must match the server
                        # byte-for-byte — same unit headers, same sheet outline
                        # option (both come from the job params server-side).
                        "outputUnit": output_unit,
                        "addOutShape": add_out_shape,
                        # D-PAY-12 : walks = recherche (qualité, identique
                        # pour tous) ; concurrency = vitesse (tier / démo).
                        "walks": int(params.get("browser_walks") or 8),
                        "concurrency": int(params.get("browser_concurrency") or params.get("vcores") or 1),
                    },
                    "update_ts": datetime.now(),
                },
                "$unset": {"progress": ""},
            },
        )
        logger.info("Job routed to local (browser) compute", extra={"slug": slug, "problem_type": problem_type})
        return

    # Live layout snapshots for the visualizer: the engine streams placed
    # item positions ~2Hz per worker; we persist the latest one (throttled)
    # on the job doc, the SSE stream pushes it to the browser.
    _last_live_write = [0.0]

    def report_live_layout(event):
        now = _time.time()
        stage = event.get("stage", "")
        # Stage changes always pass (they mark phase transitions), otherwise
        # one write per 2s max.
        if stage == _current_progress.get("stage") and now - _last_live_write[0] < 0.35:
            return
        _last_live_write[0] = now
        try:
            items = event.get("items", [])
            if meta and items:
                # J-085 : l'instance résolue est réindexée — la vue live
                # (itemMap, ids d'origine) ne connaît que les ids d'origine.
                id_map = meta["idMap"]
                items = [
                    [id_map[i[0]] if isinstance(i[0], int) and 0 <= i[0] < len(id_map) else i[0], *i[1:]]
                    for i in items
                ]
            sheet_pairs = [[float(s.get("width")), float(s.get("height"))] for s in sheets]
            holes_filled = 0
            density = event.get("density")
            if items and (meta or has_holes):
                from core.holefill import decorate_live_items
                items, live_stats = decorate_live_items(
                    items, input_items, space,
                    meta=meta,
                    apply_fill=bool(has_holes),
                    sheets=sheet_pairs,
                )
                holes_filled = live_stats.get("holesFilled") or 0
                if live_stats.get("density") is not None:
                    density = live_stats["density"]
            live = {
                "stage": stage,
                "worker": event.get("worker"),
                "bias": event.get("bias"),
                "feasible": event.get("feasible"),
                "strip_width": event.get("strip_width"),
                # Phase 2 (frames remappées) : hauteur utilisée dans le
                # repère original — critère secondaire du champion live
                # (miroir du merge SPP), sinon la compaction de hauteur
                # reste invisible de la vue.
                "used_height": event.get("used_height"),
                "density": density,
                "bins": event.get("bins"),
                "unplaced": event.get("unplaced"),
                "remnant": event.get("remnant"),
                "holesFilled": holes_filled,
                "elapsed_ms": event.get("elapsed_ms"),
                # Sheet frame(s) so the browser can draw the sheet(s).
                "sheets": sheet_pairs,
                "isSpp": is_spp,
                "items": items,
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
        elif etype == "evals":
            _record_worker_evals(event.get("worker"), event.get("evals") or 0)
        elif etype in ("progress", "heartbeat"):
            if etype == "heartbeat" and event.get("iterations") is not None:
                _record_worker_evals(event.get("worker"), event["iterations"])
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

    def _finalize_cancelled():
        """Finalisation d'annulation partagée : solve principal ET pass
        structurel (ses sous-solves de zones lèvent aussi
        EngineCancelled). Statut cancelled + nettoyage des champs
        éphémères ; le refund passe par JobCancelled côté worker_loop."""
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

    try:
        engine_alternatives = run_engine(
            solve_instance, engine_config, problem_type, on_event=_on_engine_event,
            should_cancel=should_cancel,
            rayon_threads=rayon_threads,
        )
    except EngineCancelled:
        _finalize_cancelled()
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

    # Pass structurel (grille canonique) — SPP mono-tôle : item rectangulaire
    # dominant + petites pièces. Le solveur minimise la largeur et est
    # indifférent à la FORME (piège #14e) : à faible espacement il gagne
    # quelques mm en quinconçant les gros pavés AVEC les petites pièces
    # (52 « colonnes » échelonnées, fans éclatés — mesuré 2026-08-28 sur
    # 100 carrés + 800 fans à 0,1 mm). Ce pass construit la grille canonique
    # (colonnes exactes + zones denses pour les petites pièces) et remplace
    # le rang 0 si elle reste à STRUCT_TOL de la largeur moteur. Tout échec
    # est silencieux : le résultat moteur est livré tel quel.
    if is_spp and engine_alternatives:
        try:
            from core.structure import (
                STRUCT_TOL, build_structural_layout, detect_structural_case,
                layout_used_extent,
            )
            orig_by_id = {it["id"]: it for it in input_items}

            def _geom_of(item_id):
                # Vue ORIGINALE (ids d'input_items) : la détection et les
                # zones travaillent sur les quantités COMPLÈTES — la pré-passe
                # « trous d'abord » (J-085) a pu extraire toute la classe
                # petite (constat 2026-08-29 : instance réduite à 1 classe →
                # la grille ne se déclenchait jamais à demande exacte).
                # P-m.1 : rotations absentes → quarts de tour (rétrocompat),
                # liste VIDE → [0] (normalisée à l'entrée job ; jobs legacy).
                it = orig_by_id.get(item_id) or {}
                rots = it.get("rotations")
                if rots is None:
                    rots = [0.0, 90.0, 180.0, 270.0]
                elif not rots:
                    rots = [0.0]
                return {
                    "coords": it.get("coords") or [],
                    "rotations": rots,
                }

            orig_items = [{"id": it["id"], "demand": int(it.get("count") or 0)}
                          for it in input_items]
            total_area = sum(
                _Polygon(it.get("coords") or []).area * int(it.get("count") or 0)
                for it in input_items
            )
            case = detect_structural_case(orig_items, _geom_of, total_area)
            if case:
                # Objectif de la grille : −Y NATIF si le job ne demande QUE
                # bottom (la grille doit répondre à la question posée — une
                # grille compactée en X sur un job −Y utilise toute la
                # hauteur, hors-sujet) ; −X sinon (la grille est la version
                # « propre » de la classe left). Mixed SEUL : pas de grille —
                # l'objectif « bras équilibrés » (J-088) n'a pas de layout
                # rectangulaire canonique, la classe moteur Balanced fait
                # ce travail mieux qu'un forçage hors-classe.
                dirs_list = list(directions or [])
                if dirs_list == ["balanced"]:
                    struct_objective = None
                elif dirs_list == ["bottom"]:
                    struct_objective = "y"
                else:
                    struct_objective = "x"

                def _zone_solver(count, strip_h, max_w, budget_sec,
                                 transposed=False):
                    # Sous-solve moteur « petites pièces seules » : la bande
                    # SPP n'a pas de borne dure (piège #6), la largeur
                    # réellement utilisée est re-mesurée par l'appelant.
                    # transposed : coords tournées (x,y)→(y,−x), map-back
                    # chez l'appelant (bande du haut de la grille −Y).
                    small_coords = case["small"]["coords"]
                    if transposed:
                        small_coords = [[y, -x] for x, y in small_coords]
                    zone_item = build_item(
                        0, count, small_coords,
                        case["small"]["rotations"],
                    )
                    zone_inst = build_spp_instance(
                        [zone_item], max_w, strip_h, name=f"{slug}-zone",
                    )
                    zone_cfg = build_engine_config(
                        budget_sec, deterministic_seed({"zone": zone_inst}), 1,
                        min_separation=space, has_holes=True,
                        max_strip_width=max_w, n_workers=3, biases=["left"],
                        plateau_patience_sec=4.0,
                    )
                    zone_cfg["live_events"] = False
                    try:
                        zone_alts = run_engine(
                            zone_inst, zone_cfg, "spp",
                            should_cancel=should_cancel, rayon_threads=3,
                        )
                    except EngineError:
                        # Zone saturée pour ce compte (bande sans borne dure
                        # mais directions mode jette les runs hors largeur) :
                        # None = signal « réduire la demande » pour la boucle
                        # de repli de _zone_solve.
                        return None
                    return zone_alts[0]["solution"]["layouts"][0]["placed_items"]

                # Trous des hôtes (mode « trous d'abord » J-085, meta 1+1) :
                # la grille remplit les zones internes A/C d'abord (silhouette
                # rectangulaire pleine), les trous absorbent l'excédent, la
                # zone B ne garde que l'incompressible (constat user
                # 2026-08-29 : les rectangles en cascade avant les trous).
                hole_plan = None
                if (meta and not meta.get("packs")
                        and isinstance(meta.get("ringRotations"), list)
                        and meta.get("host") == case["rect"]["id"]
                        and meta.get("fill") == case["small"]["id"]):
                    host_item = orig_by_id.get(case["rect"]["id"]) or {}
                    if host_item.get("holes"):
                        hole_plan = {
                            "host_item": host_item,
                            "fill_id": case["small"]["id"],
                            "ring_rotations": meta["ringRotations"],
                        }

                if struct_objective:
                    struct = build_structural_layout(
                        orig_items, _geom_of, bin_dims[0][0], bin_dims[0][1],
                        space, _zone_solver, objective=struct_objective,
                        hole_plan=hole_plan,
                    )
                else:
                    struct = None
                if struct:
                    axis = "y" if struct_objective == "y" else "x"
                    struct_w = layout_used_extent(struct, _geom_of, space,
                                                  axis=axis)
                    best_alt = engine_alternatives[0]
                    # Comparaison sur l'axe de l'objectif : largeur pour −X,
                    # hauteur utilisée (champ moteur) pour −Y.
                    best_w = (
                        best_alt.get("used_height")
                        if axis == "y"
                        else (best_alt["solution"].get("strip_width")
                              or best_alt["metrics"].get("strip_width"))
                    )
                    if best_w and struct_w <= float(best_w) * (1.0 + STRUCT_TOL):
                        # Le layout canonique vit sa PROPRE alternative
                        # (stratégie 'grid', affichée en premier) : le
                        # résultat compact du moteur reste disponible juste
                        # derrière avec son meilleur chiffre — l'utilisateur
                        # compare visuel vs matière dans le modal.
                        # AUTO-SUFFISANT quand un hole_plan a servi : ids
                        # d'origine + trous remplis par le pass — l'expansion
                        # meta et le post-pass hole-fill sont SAUTÉS pour
                        # cette alternative (sinon : ids corrompus par le
                        # remap, fillers doublés, fans des zones téléportées
                        # vers les trous restés vides).
                        cross = (bin_dims[0][0] if axis == "y"
                                 else bin_dims[0][1])
                        # Densité à l'échelle moteur : aire MATÉRIAU (moins
                        # les trous — les fans y vivent, sinon > 1) / bande.
                        def _material_area(it):
                            outer = _Polygon(it.get("coords") or []).area
                            holes = sum(
                                _Polygon(r).area
                                for r in (it.get("holes") or [])
                            )
                            return max(0.0, outer - holes) * int(it.get("count") or 0)
                        material_area = sum(_material_area(it) for it in input_items)
                        struct_density = (
                            material_area / (struct_w * cross)
                            if struct_w > 0 and cross > 0 else None
                        )
                        engine_alternatives.append({
                            "rank": len(engine_alternatives),
                            "seed": None,
                            "bias": None,
                            "structural": True,
                            "self_contained": bool(hole_plan),
                            "solution": {
                                "layouts": [{
                                    "container_id": 0,
                                    "placed_items": struct["placed_items"],
                                }],
                                "density": struct_density,
                                "cost": 1,
                                "strip_width": (
                                    struct_w if axis == "x" else None
                                ),
                            },
                            "metrics": {
                                "strip_width": struct_w if axis == "x" else None,
                                "density": struct_density,
                                "cost": 1,
                                "layout_count": 1,
                            },
                        })
                        logger.info(
                            "structural grid alternative added",
                            extra={
                                "objective": struct_objective,
                                "engine_extent": round(float(best_w), 2),
                                "struct_extent": round(struct_w, 2),
                                "lines": struct["case"]["lines"],
                                "remainder": struct["case"]["remainder"],
                                "hole_fills": struct["case"].get("holes", 0),
                            },
                        )
        except EngineCancelled:
            # Une annulation pendant un sous-solve de zone (A→C→trous→B)
            # n'est PAS un échec du pass structurel : même finalisation que
            # le solve principal (cancelled + JobCancelled → refund). Un
            # `raise` nu ne suffirait pas — worker_loop ne connaît que
            # JobCancelled et traiterait l'annulation en erreur générique.
            _finalize_cancelled()
            raise JobCancelled(slug)
        except Exception as e:
            logger.warning("structural pass failed, keeping engine result",
                           extra={"error": str(e)})

    # J-085 / D-MOT-16 : expansion meta — rattache les fillers figés aux
    # hôtes posés par le solve réduit, avant reveal + finalisation.
    if meta:
        from core.holefill import expand_meta, expand_packs
        id_map = meta["idMap"]
        for engine_alt in engine_alternatives:
            engine_alt["postPass"] = {
                "expandMeta": 0, "holeFillRecovered": 0, "residualMoved": 0,
                "residualRounds": 0, "compactRollback": False, "errors": [],
            }
            # Alternative structurelle : ids d'ORIGINE + trous déjà remplis
            # par le pass grille (self_contained). Le remap ci-dessous
            # CORROMPRait ses ids (un id d'origine indexé comme id réduit) et
            # l'expansion doublerait les fillers — tout est sauté.
            if engine_alt.get("structural"):
                continue
            sol = engine_alt.get("solution") or {}
            if "layouts" not in sol and "layout" in sol:
                sol = {**sol, "layouts": [sol["layout"]]}
                engine_alt["solution"] = sol
            layouts = sol.get("layouts") or []
            # ids réduits → ids d'origine : tout l'aval (expansion, vérifs,
            # métriques, exports) ne connaît que les ids d'input_items.
            for layout in layouts:
                for pi in layout.get("placed_items", []):
                    pid = pi.get("item_id")
                    if isinstance(pid, int) and 0 <= pid < len(id_map):
                        pi["item_id"] = id_map[pid]
            before = sum(len(l.get("placed_items", [])) for l in layouts)
            if meta.get("packs"):
                sol["layouts"] = expand_packs(input_items, meta["packs"], layouts)
            else:
                sol["layouts"] = expand_meta(
                    input_items, meta["host"], meta["fill"], meta["slots"],
                    layouts, meta.get("ringRotations"),
                )
            # A5 : traçabilité du post-pass (additif, jamais muet).
            engine_alt["postPass"]["expandMeta"] = (
                sum(len(l.get("placed_items", []))
                    for l in sol.get("layouts") or []) - before)

    # Post-pass hole-fill (SPP et BPP) : AVANT le reveal.
    if has_holes:
        from core.holefill import apply_hole_fill
        for engine_alt in engine_alternatives:
            # Structurelle self-contained : le post-pass téléporterait les
            # fillers des zones vers les trous laissés vides — détruire la
            # silhouette en cascade (constat user 2026-08-29).
            if engine_alt.get("structural") and engine_alt.get("self_contained"):
                continue
            sol = engine_alt.get("solution") or {}
            if "layouts" not in sol and "layout" in sol:
                sol = {**sol, "layouts": [sol["layout"]]}
                engine_alt["solution"] = sol
            n = apply_hole_fill(input_items, sol.get("layouts", []), space)
            if n:
                logger.info("hole-fill post-pass relocated fillers", extra={"n": n})
            engine_alt.setdefault(
                "postPass",
                {"expandMeta": 0, "holeFillRecovered": 0, "residualMoved": 0,
                 "residualRounds": 0, "compactRollback": False, "errors": []},
            )["holeFillRecovered"] = n

    # D-MOT-19 (docs/PLAN-bpp-impl.md) : remplissage des bandes résiduelles
    # — BPP multi-tôles uniquement. Le constructif empile les petites
    # pièces libres sur la DERNIÈRE tôle (croissance de bbox minimale) et
    # le recuit ne backfill pas (remnant moyen = optimum local) : ce pass
    # pose au lattice les pièces libres de la tôle la moins remplie dans
    # les bandes vides des tôles plus remplies. Après hole-fill (les trous
    # sont de meilleurs emplacements), avant reveal/artefacts. Miroir JS :
    # localBridge.js → residualClient.js.
    if not is_spp:
        from core.residual import fill_residual_bands
        for engine_alt in engine_alternatives:
            if engine_alt.get("structural"):
                continue
            sol = engine_alt.get("solution") or {}
            if "layouts" not in sol and "layout" in sol:
                sol = {**sol, "layouts": [sol["layout"]]}
                engine_alt["solution"] = sol
            engine_alt.setdefault(
                "postPass",
                {"expandMeta": 0, "holeFillRecovered": 0, "residualMoved": 0,
                 "residualRounds": 0, "compactRollback": False, "errors": []},
            )
            n = fill_residual_bands(sol.get("layouts") or [], input_items,
                                    bin_dims_engine, space,
                                    stats=engine_alt["postPass"])
            if n:
                logger.info("residual-band pass moved parts", extra={"n": n})
            if engine_alt["postPass"].get("compactRollback"):
                logger.warning("compaction rolled back (donor sheet restored)",
                               extra={"strategy": engine_alt.get("bias")})
            # A10 : le retrait d'un layout vide doit rafraîchir le coût de
            # l'alternative (alternatives[].cost était périmé).
            sol = engine_alt.get("solution") or {}
            if sol.get("layouts") is not None and "cost" in sol:
                sol["cost"] = len(sol["layouts"])
            # A13 (audit 2026-09-03) : le pass résidiel déplace des libres
            # entre tôles — un trou resté vide sur une tôle SANS libre peut
            # devenir remplissable maintenant que des libres existent
            # ailleurs. Deuxième hole-fill, scopé tôle (piège #52).
            if has_holes:
                n2 = apply_hole_fill(input_items, sol.get("layouts", []), space)
                if n2:
                    logger.info("hole-fill second pass relocated fillers",
                                extra={"n": n2})
                engine_alt["postPass"]["holeFillRecovered"] += n2

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
            # C12 : bins = NOMBRE de tôles (l'ancien champ portait le
            # coût — fausse « quantité » dès que le coût/tôle ≠ 1).
            "bins": len(solution.get("layouts") or []),
            "binCost": engine_alt.get("metrics", {}).get("cost"),
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

    invalid_alt_count = [0]

    def _finalize_alternative(engine_alt, strategy, rank):
        # Échappatoire debug (A4) : livrer quand même une alternative
        # mesurée invalide pour inspection.
        allow_invalid_alts = os.environ.get("NEST_ALLOW_INVALID_ALTS") == "1"
        result_containers, placed_count, density, cost = parse_result_containers(
            {"solution": engine_alt["solution"]}, input_items, bin_dims_engine
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

        # A4 : garde par CLASSE — le total seul était aveugle : une pièce
        # posée deux fois + une autre perdue compensée PASSAIENT (191
        # doublons livrés au banc, audit 2026-09-03 §A4). Compte par item_id.
        if not per_class_counts_match(result_containers, requested_by_id):
            logger.error(
                "Alternative per-class count mismatch, discarding it",
                extra={
                    "strategy": strategy,
                    "placed_by_id": per_class_placed_counts(result_containers),
                    "requested_by_id": requested_by_id,
                },
            )
            return

        # Measured physical verification — AVANT l'export DXF (P-4 : ne pas
        # payer l'export d'un layout qu'on jette). Filet structurel : le
        # layout grille ne se « répare » pas (piège #41), une alt
        # structurelle hors tôle est JETÉE → repli moteur. Les alternatives
        # MOTEUR gardent leur badge insideSheet (piège #6 : le SPP sparrow
        # n'a pas de borne dure, c'est le contrat moteur).
        verification = verify_layout(result_containers, input_items, space)
        if engine_alt.get("structural") and not verification.get("insideSheet"):
            logger.warning(
                "structural alternative outside sheet, discarding",
                extra={"strategy": strategy},
            )
            return
        # A4/U1 : un post-pass qui échoue ne doit plus être livré avec un
        # badge rouge — l'alternative mesurée en chevauchement ou en poses
        # dupliquées est ÉCARTÉE (les autres walks restent). Échappatoire
        # debug uniquement.
        if not allow_invalid_alts and (
            verification.get("overlapFree") is False
            or verification.get("duplicatePoses")
        ):
            invalid_alt_count[0] += 1
            logger.error(
                "alternative physically invalid (overlap/duplicates), discarding",
                extra={
                    "strategy": strategy,
                    "overlapFree": verification.get("overlapFree"),
                    "duplicatePoses": verification.get("duplicatePoses"),
                },
            )
            return

        alt_slug = f"{slug}_alt{rank}"
        report_progress("building", rank, n_alternatives,
                        min(99, round(rank / max(1, n_alternatives) * 100)))
        dxf_files, svg_files = build_result_dxf_files(
            owner_id, alt_slug, result_containers, input_items, add_out_shape, space, dek,
            output_unit
        )
        sheet_area = sum(
            (c.bin_width or 0) * (c.bin_height or 0) for c in result_containers
        )
        offcut = largest_empty_rectangle(result_containers, input_items)
        # Per-sheet measured material accounting (quoting numbers) — ADDITIVE
        # report fields, legacy jobs without them keep the old UI block.
        sheets_metrics = per_sheet_metrics(result_containers, input_items)
        alternatives.append({
            "seed": engine_alt.get("seed"),
            "strategy": strategy,
            "density": density,
            # Share of sheet actually consumed (used bbox / sheet area,
            # lower = better): the score that rewards compaction.
            "usedSheetShare": compute_used_sheet_share(result_containers, input_items),
            "offcut": offcut,
            "cost": cost,
            "layoutCount": len(result_containers),
            "dxf_files": dxf_files,
            "svg_files": svg_files,
            # Nesting report data (measured verification + engine stats).
            "report": {
                **verification,
                "partsAreaMm2": round(total_part_area, 1),
                "sheetAreaMm2": round(sheet_area, 1),
                "iterations": engine_alt.get("evaluations") or engine_alt.get("iterations"),
                "vcores": vcores or None,
                # Quoting view: per-sheet measured metrics + totals (material
                # to buy) + the enriched offcut (reusable vs scrap).
                "sheets": sheets_metrics,
                "totals": report_totals(sheets_metrics),
                "offcut": enrich_offcut(offcut),
                # A5 : observabilité des post-pass (additif — les jobs
                # antérieurs n'ont pas le champ, l'UI l'ignore).
                "postPass": engine_alt.get("postPass"),
            },
        })

    def _strategy_for(engine_alt, rank):
        # Le layout structurel (grille canonique) porte sa propre classe.
        if engine_alt.get("structural"):
            return "grid"
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

    # P-m.8 (audit 2026-08-31 §P-m.8) : une annulation demandée pendant le
    # reveal (~2-15 s entre la fin du solve et l'écriture finale) doit
    # suivre le flux cancelled + refund, pas finir en done sans refund.
    # Même finalisation que le handler du solve principal.
    if should_cancel():
        _finalize_cancelled()
        raise JobCancelled(slug)

    for rank, engine_alt in enumerate(engine_alternatives):
        _finalize_alternative(engine_alt, _strategy_for(engine_alt, rank), rank)

    if invalid_alt_count[0]:
        logger.error(
            "physically invalid alternatives discarded",
            extra={"count": invalid_alt_count[0],
                   "kept": len(alternatives)},
        )

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
    # Display order: la grille canonique d'abord (choix visuel par défaut),
    # puis l'ordre canonique des classes (left/bottom/balanced), qualité
    # au sein de chaque classe. Untagged (legacy) : qualité seule.
    _DIRECTION_ORDER = {"grid": -1, "left": 0, "bottom": 1, "balanced": 2}
    if any(alt.get("strategy") in _DIRECTION_ORDER for alt in alternatives):
        alternatives.sort(key=lambda alt: (
            _DIRECTION_ORDER.get(alt.get("strategy"), 99),
            alt.get("layoutCount") or 0,
            alt.get("usedSheetShare") or 1.0,
        ))
    else:
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
