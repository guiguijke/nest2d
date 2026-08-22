import os
import tempfile
import uuid
import ezdxf
from ezdxf.document import Drawing
from gridfs.synchronous.grid_file import GridOut
from ezdxf.audit import Auditor
from ezdxf.explode import explode_entity
from ezdxf import recover
from worker_common.logger import setup_logger
from worker_common.geometry.units import insunits_to_mm, insunits_code
from ezdxf.math import Matrix44
from ezdxf.render.hatching import hatch_entity
from ezdxf.entities import DXFGraphic
from worker_common.geometry.dxf_bounds import assert_insert_depth, decompose_bounded

logger = setup_logger("dxf_utils")

def read_dxf(dxf_stream: GridOut, normalize_units: bool = True) -> Drawing:
    """
    Reads a DXF stream and returns the modelspace without entities TEXT and MTEXT.

    Parameters:
        dxf_stream: The DXF string to process.
        normalize_units: scale foreign-unit geometry ($INSUNITS) to canonical
            mm. False when reading a pipeline-produced copy (already mm —
            copies written before the units feature declare meters while
            holding mm numbers, so re-normalizing would corrupt them).

    Returns:
        Modelspace: The modelspace of the DXF document.
    """
    with tempfile.TemporaryDirectory() as tmpdir:
        temp_file_path = os.path.join(tmpdir, "input.dxf")
        with open(temp_file_path, "wb") as temp_file:
            temp_file.write(dxf_stream.read())
        return read_dxf_file(temp_file_path, normalize_units)

def read_dxf_file(dxf_path: str, normalize_units: bool = True) -> Drawing | None:
    """
    Reads a DXF file and performs several cleaning operations.

    - Handles corrupt files with duplicate handles by auditing and fixing them.
    - Removes all TEXT and MTEXT entities.
    - Explodes complex entities like HATCH, INSERT (blocks), and DIMENSIONS into
      simpler geometric primitives (lines, arcs, etc.).

    Args:
        dxf_path: The file path to the DXF document.

    Returns:
        The modified ezdxf Drawing object, or None if the file cannot be loaded.
    """
    try:
        # 1. Load the document. ezdxf will attempt to fix minor errors on load.
        doc, auditor = recover.readfile(dxf_path)
    except IOError:
        logger.error(f"Could not find or read file: {dxf_path}")
        return None
    except ezdxf.DXFStructureError:
        logger.error(f"File '{dxf_path}' is severely corrupt and cannot be loaded.")
        return None

    if auditor.has_errors:
        logger.warning("Auditor found and fixed errors in document.", extra={"count": len(auditor.errors)})

    msp = doc.modelspace()

    # Unit normalization ($INSUNITS -> canonical mm). The factor is computed
    # on the SOURCE document, before anything is rebuilt.
    unit_factor = insunits_to_mm(doc) if normalize_units else 1.0
    source_insunits = insunits_code(doc)

    text_entities = msp.query("TEXT MTEXT IMAGE SOLID")
    if text_entities:
        for text_entity in text_entities:
            msp.delete_entity(text_entity)
        logger.info(f"Removed {len(text_entities)} TEXT/MTEXT/IMAGE entities.")

    new_doc = ezdxf.new()
    new_msp = new_doc.modelspace()

    assert_insert_depth(doc)
    flattened_entities = decompose_bounded(msp)

    # Decompose FIRST (block INSERTs are resolved into flat primitives in
    # modelspace coordinates), THEN scale: non-scaled block definitions can
    # never corrupt the result.
    scale_matrix = Matrix44.scale(unit_factor, unit_factor, 1.0) if unit_factor != 1.0 else None
    for entity in flattened_entities:
        if isinstance(entity, DXFGraphic):
            new_entity = entity.copy()
            if scale_matrix is not None:
                new_entity.transform(scale_matrix)
            new_msp.add_entity(new_entity)

    # The cleaned document is canonical mm from here on — say so explicitly
    # (CAM tools that honor the header then read it correctly).
    new_doc.header["$INSUNITS"] = 4
    new_doc.header["$MEASUREMENT"] = 1
    # Traceability: the source document's declared units (0 = unitless),
    # read by _make_dxf_copy to persist `sourceUnits` on the file record.
    new_doc.source_insunits = source_insunits
                
    logger.info(f"Successfully processed.")
    
    hatches = new_msp.query("HATCH")
    if hatches:
        logger.info(f"Found {len(hatches)} HATCH entities to convert to lines.")
        for hatch in hatches:  
            try:
                for line in hatch_entity(hatch):
                    new_msp.add_line(line.start, line.end, dxfattribs=hatch.graphic_properties())
                new_msp.delete_entity(hatch)
            except Exception as e:
                logger.error(f"Failed to convert HATCH (handle #{hatch.dxf.handle}): {e}")
                raise e
            
    exist_hatches = new_msp.query("HATCH")
    logger.info(f"After for loop, there are {len(exist_hatches)} HATCH entities to convert to lines.")
    logger.info(f"Successfully processed '{dxf_path}'.")
    
    return new_doc
