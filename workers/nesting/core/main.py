from datetime import datetime
import json
import secrets
import subprocess
import sys
import os
import io
from pathlib import Path
from utils.mongo import valid_dxf_bucket, dxf_result_bucket, svg_result_bucket
from utils.mongo import db
from core.nesting_input_builder import build_bin, build_input_json, build_item
from dxf.dxf_utils import read_dxf
from core.svg_generator import create_svg_from_doc
from ezdxf.document import Drawing
import ezdxf
from ezdxf import xref
import ezdxf.bbox
import math
import io
from ezdxf.math import Matrix44
from shapely.geometry import Polygon

sys.path.append(str(Path(__file__).parent.parent))

from utils.logger import setup_logger
from utils.crypto import get_dek, read_gridfs, resolve_polygon_parts, write_gridfs

logger = setup_logger("core_nesting")

class Transform:
    def __init__(self, file_slug: str, handles, x, y, angle):
        self.file_slug = file_slug
        self.handles = handles
        self.x = x
        self.y = y
        self.angle = angle

    def __str__(self) -> str:
        return f"Transform -> File(Parts): {self.file_slug}, Handles: {self.handles}, X: {self.x}, Y: {self.y}, Angle: {self.angle}"
    
class ResultContainer:
    def __init__(self, container_id, transforms, bin_width=None, bin_height=None):
        self.container_id = container_id
        self.transforms = transforms
        self.bin_width = bin_width
        self.bin_height = bin_height

    def __str__(self) -> str:
        return f"ResultContainer -> Container(ID): {self.container_id}, Transforms: {self.transforms}"
    
def convert_files_to_input_items(files, space, dek=None):
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
            coords = part.get("coordinates")
            handles = part.get("handles")
            
            shapely_polygon = Polygon(coords)
            buffered_polygon = shapely_polygon.buffer(space)
            buffered_polygon_coords = list(buffered_polygon.exterior.coords)
            
            item = {
                'id': id,
                'file_slug': file_slug,
                'coords': buffered_polygon_coords,
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
    """

    logger.info("Building part", extra={"add_out_shape": add_out_shape})

    new_doc = ezdxf.new()
    new_msp = new_doc.modelspace()
    added_entities = []

    for transform in transforms:
        try:
            source_doc, entities_to_process = get_entities_from_dxf_file(
                transform.file_slug, transform.handles, owner_id, dek
            )
            
            if not entities_to_process:
                logger.warning("No entities found in file", extra={"file_slug": transform.file_slug})
                continue
            required_layers = {entity.dxf.layer for entity in entities_to_process}
            
            loader = ezdxf.xref.Loader(source_doc, new_doc)
            
            if required_layers:
                loader.load_layers(list(required_layers))
            
            loader.execute()

            rotationMatrix = Matrix44.z_rotate(transform.angle)
            translationMatrix = Matrix44.translate(transform.x, transform.y, 0)
            matrix = rotationMatrix * translationMatrix

            for entity in entities_to_process:
                new_entity = entity.copy()
                new_entity.transform(matrix)
                new_msp.add_entity(new_entity)
                added_entities.append(new_entity)
            
            logger.info(
                "Entities from file moved to file", 
                extra={"file_slug": transform.file_slug, "count": len(entities_to_process)}
            )

        except Exception as e:
            logger.error("Error processing transform", extra={"file_slug": transform.file_slug, "error": e})
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
DEFAULT_N_SAMPLES = 20000

def run_lbf(input_json):
    input_json_as_string : str = json.dumps(input_json)

    result = subprocess.run(
        ['lbf'],
        input=input_json_as_string,
        capture_output=True,
        text=True,
        timeout=3600
    )

    if result.returncode != 0:
        logger.error("❌ lbf failed with return code:", result.returncode)
        logger.error("Error output:")
        logger.error(result.stderr)
        raise Exception("❌ lbf failed with return code:", result.returncode)

    logger.info("✅ lbf executed successfully!")
    return json.loads(result.stdout)

def parse_result_containers(output, input_items, bin_dims):
    """Parses lbf output into ResultContainers. Each layout keeps the
    container_id lbf assigned (= index of the bin type used), so heterogeneous
    sheets get the right frame. Returns (containers, placed_count, density)."""
    solution = output.get("solution")
    layouts = solution.get("layouts")

    result_containers = []
    total_placed_count = 0

    for seq_id, layout in enumerate(layouts, start=1):
        transforms = []
        placedItems = layout.get("placed_items")
        bin_id = layout.get("container_id", 0)
        bin_width, bin_height = bin_dims.get(bin_id, bin_dims[0])
        for item in placedItems:
            item_id = item.get("item_id")
            transformation = item.get("transformation")
            rotation = transformation.get("rotation")
            translation = transformation.get("translation")
            x = translation[0]
            y = translation[1]

            file_slug = next(item for item in input_items if item.get("id") == item_id).get("file_slug")
            handles = next(item for item in input_items if item.get("id") == item_id).get("handles")

            transforms.append(Transform(file_slug, handles, x, y, rotation))
            total_placed_count += 1

        result_containers.append(ResultContainer(seq_id, transforms, bin_width, bin_height))

    return result_containers, total_placed_count, solution.get("density")

def nesting_process(doc):
    logger.info("Processing nesting", extra={"doc": doc["slug"]})
    dxf_document_cache.clear()

    slug = doc.get("slug")
    files = doc.get("files")
    params = doc.get("params")
    space = params.get("space")
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

    # Exploration budget and number of alternatives are set server-side at
    # enqueue time based on the owner's tier (params.nestQuality /
    # params.alternativesCount). Defaults cover jobs enqueued before the
    # tiered-compute feature existed.
    n_samples = int(params.get("nestQuality") or DEFAULT_N_SAMPLES)
    n_alternatives = max(1, int(params.get("alternativesCount") or N_ALTERNATIVES_DEFAULT))

    # Unwrapped DEK when the owner's vault is unlocked, None on the legacy
    # plaintext path. Raises VaultLockedError when files are encrypted but
    # the session expired mid-queue.
    dek = get_dek(db, owner_id)

    # Map allowRotation boolean to allowed_orientations array (fallback for backward compatibility)
    default_allowed_orientations = [0.0, 90.0, 180.0, 270.0] if allow_rotation else [0.0]

    input_items = convert_files_to_input_items(files, space, dek)
    jaguar_items = []

    total_requested_count = 0
    for item in input_items:
        count = item.get("count")
        # Use per-file rotations if available, otherwise fall back to global setting
        allowed_orientations = item.get("rotations", default_allowed_orientations)
        jaguar_item = build_item(item.get("id"), count, item.get("coords"), allowed_orientations)
        total_requested_count += count
        jaguar_items.append(jaguar_item)

    db["nesting_jobs"].update_one(
        {"_id": doc.get("_id")},
        {
            "$set": {
                "requested": total_requested_count,
                "update_ts": datetime.now()
            },
        }
    )

    # Run the solver N times with different random seeds and keep every
    # solution that placed all items — the user picks the layout they prefer.
    alternatives = []
    for alt_index in range(n_alternatives):
        seed = secrets.randbelow(2**32)
        logger.info("Running alternative", extra={"alt": alt_index, "seed": seed, "n_samples": n_samples})

        input_json = build_input_json(bins, jaguar_items, n_samples=n_samples, prng_seed=seed)
        output = run_lbf(input_json)
        result_containers, placed_count, density = parse_result_containers(output, input_items, bin_dims)

        if placed_count != total_requested_count:
            logger.warning(
                "Alternative did not place all items, discarding",
                extra={"alt": alt_index, "placed": placed_count, "requested": total_requested_count},
            )
            continue

        alt_slug = f"{slug}_alt{alt_index}"
        dxf_files, svg_files = build_result_dxf_files(
            owner_id, alt_slug, result_containers, add_out_shape, space, dek
        )

        alternatives.append({
            "seed": seed,
            "density": density,
            "layoutCount": len(result_containers),
            "dxf_files": dxf_files,
            "svg_files": svg_files,
        })

    if not alternatives:
        db["nesting_jobs"].update_one(
            { "slug": slug },
            {
                "$set": {
                    "placed": 0,
                    "status": "error",
                    "finishedAt": datetime.now(),
                    "update_ts": datetime.now(),
                    "information": "Not all items could be placed in the nesting job"
                }
            },
        )
        raise Exception("Not all items could be placed in the nesting job")

    # Best density first — alternatives[0] mirrors the legacy flat fields.
    alternatives.sort(key=lambda alt: alt.get("density") or 0, reverse=True)
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
                "update_ts": datetime.now()
            },
        }
    )