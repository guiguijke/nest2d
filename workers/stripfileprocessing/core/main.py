import io
import time

from worker_common.logger import setup_logger
from worker_common.mongo import db, get_bucket
from worker_common.colors import pick_colors
from worker_common.crypto import encrypt_polygon_parts, get_dek, read_gridfs

strip_user_dxf_bucket = get_bucket("stripUserDxf")
from dxf_utils import read_dxf
from core.geometry.build_geometry import build_geometry

strip_user_dxf_files = db["strip_user_dxf_files"]


def _check_handle_coverage(original_footprints, polygon_parts, logger, slug):
    """
    Compare how many original DXF handles ended up in the saved polygonParts.

    Every original entity should be attached to the part that contains it. Any
    handle present in the source DXF but missing from the saved parts means an
    entity was dropped (e.g. it fell outside every part contour). This is logged
    as a warning — not raised — because some annotations can legitimately sit
    outside all parts; the warning surfaces real coverage gaps for inspection.
    """
    origin_handles = {handle for handle, _ in original_footprints}

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

    return origin_handles, saved_handles, missing


def _close_polygon_from_dxf(doc):
    """
    Reads the user input DXF for a strip file, builds the closed polygon parts
    and attaches them as the `polygonParts` field (coordinates + handles +
    bounding box) to the strip_user_dxf_files document.
    """
    logger = setup_logger("strip_dxf_polygonizer")

    if doc.get("polygonParts") or doc.get("encPolygonParts"):
        logger.info("polygon_parts_already_exist", extra={"slug": doc["slug"]})

    tolerance = doc.get("flattening", 0.01)

    start_time = time.time()

    dek = get_dek(db, doc)
    dxf_bytes = read_gridfs(strip_user_dxf_bucket, doc["slug"], doc["ownerId"], dek)
    drawing, original_footprints = read_dxf(io.BytesIO(dxf_bytes))

    closed_parts = build_geometry(drawing, tolerance, original_footprints)

    logger.info("result", extra={"closed_parts": len(closed_parts)})

    if len(closed_parts) == 0:
        raise Exception("Closed parts is 0")

    polygon_parts = []
    # One random display color per part (screen rendering only), sampled
    # without replacement first so parts of the same file look distinct.
    for part, color in zip(closed_parts, pick_colors(len(closed_parts))):
        mongo_dict = part.to_mongo_dict(color=color)
        if mongo_dict is not None:
            polygon_parts.append(mongo_dict)

    _check_handle_coverage(original_footprints, polygon_parts, logger, doc["slug"])

    if dek is not None:
        # Vault enabled: geometry is stored encrypted; the plaintext parts
        # only live in memory for the rest of this processing run.
        strip_user_dxf_files.update_one(
            {"_id": doc["_id"]},
            {
                "$set": {
                    "encPolygonParts": encrypt_polygon_parts(dek, doc["slug"], doc["ownerId"], polygon_parts)
                },
                "$unset": {"polygonParts": ""}
            }
        )
    else:
        strip_user_dxf_files.update_one(
            {"_id": doc["_id"]},
            {"$set": {"polygonParts": polygon_parts}}
        )
    doc["polygonParts"] = polygon_parts

    end_time = time.time()
    logger.info("time taken", extra={"time": end_time - start_time})

    return polygon_parts


def process_file(doc):
    start_time = time.time()
    logger = setup_logger("core_stripfileprocessing")
    logger.info("Processing strip file", extra={"slug": doc["slug"]})

    polygon_parts = _close_polygon_from_dxf(doc)

    if len(polygon_parts) == 0:
        return False

    end_time = time.time()
    logger.info("time taken", extra={"time": end_time - start_time})

    original_processing_time = doc.get("processingTime", 0)

    strip_user_dxf_files.update_one(
        {"_id": doc["_id"]},
        {"$set": {"processingTime": original_processing_time + (end_time - start_time)}}
    )

    return True
