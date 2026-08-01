import io
import os
from worker_common.logger import setup_logger
from worker_common.mongo import db, get_bucket
from dxf_utils import read_dxf
from ezdxf.document import Drawing
from core.svg_generator import create_svg_from_doc

from typing import List
from ezdxf.document import Drawing
from shapely.geometry import Point
import time

from core.geometry.build_geometry import build_geometry
from worker_common.crypto import (
    encrypt_polygon_parts,
    get_dek,
    read_gridfs,
    resolve_polygon_parts,
    write_gridfs,
)

user_dxf_bucket = get_bucket("userDxf")
valid_dxf_bucket = get_bucket("validDxf")
user_dxf_files_svg_bucket = get_bucket("userDxfFilesSvg")

_drawing_cache = {}

def _getting_drawing(doc) -> Drawing:
    logger = setup_logger("getting_drawing")
    dxf_file_slug = doc["slug"]
    
    logger.info("Getting drawing", extra={"slug": dxf_file_slug})
    
    if dxf_file_slug in _drawing_cache:
        return _drawing_cache[dxf_file_slug]
    
    if not doc.get("isDxfCopyExist", False):
        raise Exception("Dxf copy not exists")
    
    dek = get_dek(db, doc["ownerId"])
    dxf_bytes = read_gridfs(valid_dxf_bucket, dxf_file_slug, doc["ownerId"], dek)

    drawing = read_dxf(io.BytesIO(dxf_bytes))
    _drawing_cache[dxf_file_slug] = drawing
    
    return drawing

def _make_dxf_copy(doc) -> Drawing:
    logger = setup_logger("dxf_copy_maker")
    dxf_file_slug = doc["slug"]
    
    if doc.get("isDxfCopyExist", False):
        logger.info("Dxf copy already exists", extra={"dxf_file_slug": dxf_file_slug})
        return 
    
    user_id = doc["ownerId"]

    logger.info("Making dxf copy", extra={"dxf_file_slug": dxf_file_slug})

    dek = get_dek(db, user_id)
    dxf_bytes = read_gridfs(user_dxf_bucket, dxf_file_slug, user_id, dek)

    dxf_copy = read_dxf(io.BytesIO(dxf_bytes))
    
    logger.info("Make a copy Drawing info", extra={"entity_count": len(dxf_copy.modelspace())})
    
    dxf_copy_text_stream = io.StringIO()
    dxf_copy.write(dxf_copy_text_stream)
    dxf_copy_text = dxf_copy_text_stream.getvalue()
    dxf_copy_text_stream.close()
    
    dxf_copy_bytes = dxf_copy_text.encode('utf-8')
 
    try:
        valid_dxf_bucket.delete_by_name(filename=dxf_file_slug)
    except Exception as e:
        logger.info("Error deleting dxf file", extra={"error": e})
        
    write_gridfs(valid_dxf_bucket, dxf_file_slug, dxf_copy_bytes, user_id, dek)
    
    db["user_dxf_files"].update_one(
        {"_id": doc["_id"]},
        {"$set": {"isDxfCopyExist": True}}
    )
    doc["isDxfCopyExist"] = True
    
    logger.info("Dxf copy made", extra={"dxf_file_slug": dxf_file_slug})

def _make_svg_file(doc):
    logger = setup_logger("svg_file_maker")
    #if doc.get("isSvgFileExist", False):
    #    logger.info("Svg file already exists", extra={"slug": doc["slug"]})
    #    return
    
    drawing = _getting_drawing(doc)

    slug = doc["slug"]
    owner_id = doc["ownerId"]
    dek = get_dek(db, owner_id)
    closed_parts = resolve_polygon_parts(db, doc, dek)
    svg_slug = slug.removesuffix('.dxf') + '-origin.svg'

    svg_string = create_svg_from_doc(drawing, closed_parts)
    svg_bytes = svg_string.encode("utf-8")

    write_gridfs(user_dxf_files_svg_bucket, svg_slug, svg_bytes, owner_id, dek)
    
    db["user_dxf_files"].update_one(
        {"_id": doc["_id"]},
        {"$set": {
            "isSvgFileExist": True,
            "svgFileSlug": svg_slug
        }}
    )
    doc["isSvgFileExist"] = True
    doc["svgFileSlug"] = svg_slug
    
def _check_handle_coverage(drawing, polygon_parts, logger, slug):
    """
    Compare how many drawing handles ended up in the saved polygonParts.

    Every entity should be attached to the part that contains it. A handle
    present in the drawing but missing from the saved parts means an entity
    was dropped (e.g. it fell outside every part contour, or its type is not
    convertible). Logged as a warning — not raised — because some entities
    can legitimately sit outside all parts; the warning surfaces real
    coverage gaps for inspection.
    """
    origin_handles = {entity.dxf.handle for entity in drawing.modelspace()}

    saved_handles = set()
    for part in polygon_parts:
        saved_handles.update(part.get("handles", []))

    missing = origin_handles - saved_handles

    logger.info(
        "handle_coverage_check",
        extra={
            "slug": slug,
            "origin_handles": len(origin_handles),
            "saved_handles": len(saved_handles),
            "missing_handles": len(missing),
        },
    )

    if missing:
        logger.warning(
            "handle_coverage_incomplete",
            extra={
                "slug": slug,
                "missing_count": len(missing),
                "missing_handles": sorted(missing),
            },
        )


def _close_polygon_from_dxf(doc, logger_tag: str):
    logger = setup_logger(logger_tag)
     
    if doc.get("polygonParts") or doc.get("encPolygonParts"):
        logger.info("polygon_parts_already_exist", extra={"slug": doc["slug"]})
     
    tolerance = doc["flattening"]
 
    start_time = time.time()
    drawing = _getting_drawing(doc)
    closed_parts = build_geometry(drawing, tolerance)
    
    logger.info("result", extra={
        "closed_parts": len(closed_parts),
    })
    
    if len(closed_parts) == 0:
        raise Exception("Closed parts is 0")
    
    polygon_parts = []
    for part in closed_parts:
        mongo_dict = part.to_mongo_dict()
        if mongo_dict is not None:
            polygon_parts.append(mongo_dict)

    _check_handle_coverage(drawing, polygon_parts, logger, doc["slug"])
    
    dek = get_dek(db, doc["ownerId"])
    if dek is not None:
        # Vault enabled: geometry is stored encrypted; the plaintext parts
        # only live in memory for the rest of this processing run.
        db["user_dxf_files"].update_one(
            {"_id": doc["_id"]},
            {
                "$set": {
                    "encPolygonParts": encrypt_polygon_parts(dek, doc["slug"], doc["ownerId"], polygon_parts)
                },
                "$unset": {"polygonParts": ""}
            }
        )
    else:
        db["user_dxf_files"].update_one(
            {"_id": doc["_id"]},
            {
                "$set": {
                    "polygonParts": polygon_parts
                }
            }
        )

    doc["polygonParts"] = polygon_parts
    
    end_time = time.time()
    logger.info("time taken", extra={"time": end_time - start_time})

def _set_valid_entity_count(doc):
    drawing = _getting_drawing(doc)
    entity_count = len(drawing.modelspace())
    
    if entity_count == 0:
        raise Exception("Entity count is 0")
    
    db["user_dxf_files"].update_one(
        {"_id": doc["_id"]},
        {
            "$set": {
                "validEntityCount": entity_count
            }
        }
    )
    
    return entity_count

max_entity_limit = int(os.environ.get("MAX_ENTITY_LIMIT", '999'))

settings_logger = setup_logger('settings_logger')
settings_logger.info("Max entity limit set", extra={"max_entity_limit": max_entity_limit})

def process_file(doc):
    _drawing_cache.clear()
    
    start_time = time.time()
    logger = setup_logger("core_fileprocessing")
    logger.info("Processing file", extra={"doc": doc["slug"]})
    
    _make_dxf_copy(doc)
    entity_count = _set_valid_entity_count(doc)
    
    if entity_count > max_entity_limit:
        db["user_dxf_files"].update_one(
            {"_id": doc["_id"]},
            {"$set": {"worker_tag": "1k_entity_count"}}
        )
        return False
    
    _close_polygon_from_dxf(doc, "dxf_polygonizer")
    
    _make_svg_file(doc)
    
    end_time = time.time()
    logger.info("time taken", extra={"time": end_time - start_time})
    
    original_processing_time = doc.get("processingTime", 0)
    
    db["user_dxf_files"].update_one(
        {"_id": doc["_id"]},
        {
            "$set": {
                "processingTime": original_processing_time + (end_time - start_time),
            }
        }
    )
    
    return True
    