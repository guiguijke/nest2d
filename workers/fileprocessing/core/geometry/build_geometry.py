from dataclasses import dataclass
from time import time
from typing import List, Dict, Iterable
from itertools import chain

from .dxf_parser import DxfEntityGeometry, convert_entity_to_shapely

from ezdxf.document import Drawing
from shapely.geometry import Polygon
from shapely.validation import make_valid
from shapely.ops import unary_union
from shapely import concave_hull
from utils.logger import setup_logger

logger = setup_logger("build_geometry")

@dataclass(slots=True)
class ClosedPolygon:
    geometry: Polygon
    handles: List[str]
    
    def to_mongo_dict(self) -> Dict[str, List[List[float]]] :
        if not isinstance(self.geometry, Polygon):
            raise TypeError("The 'geometry' attribute must be a shapely Polygon.")

        bounding_box = self.geometry.bounds
        
        width = bounding_box[2] - bounding_box[0]
        height = bounding_box[3] - bounding_box[1]
        
        if (abs(width) < 0.1 or abs(height) < 0.1):
            return None
        
        coords = list(zip(*self.geometry.exterior.coords.xy))
        if not coords:
            exterior_coords = []
        else:
            reduced = list()  
            reduced.append(coords[0])
            
            for idx in range(1, len(coords)):
                point = coords[idx]
                last = reduced[len(reduced) - 1]
                if abs(point[0] - last[0]) > 0.01 or abs(point[1] - last[1]) > 0.01:
                    reduced.append(point)
                    
            exterior_coords = reduced
        
        return {
            'coordinates': exterior_coords,
            'handles': self.handles,
            'width': width,
            'height': height
        }

def merge_dxf_entities_into_polygons(dxf_entities: Iterable[DxfEntityGeometry], tolerance: float) -> List[ClosedPolygon]:
    result = []
    logger.info("Merging polygons started", extra={"len": len(dxf_entities)})

    # 1. On regroupe TOUTES les géométries en une seule avant tout hull
    all_geoms = []
    all_handles = []
    for dxf_entity in dxf_entities:
        if dxf_entity.geometry.is_empty or not dxf_entity.geometry.is_valid:
            continue
        all_geoms.append(dxf_entity.geometry)
        all_handles.append(dxf_entity.handle)

    if not all_geoms:
        return []

    # 2. Union globale + make_valid + un seul concave_hull OPTIMISÉ
    union_geom = unary_union(all_geoms)
    union_geom = make_valid(union_geom)

    if union_geom.is_empty:
        return []

    # Ratio entre 0.03 et 0.08 pour une croix occitane : capture les concavités sans explosion
    hull = concave_hull(union_geom, ratio=0.05, allow_holes=False)
    hull = make_valid(hull)

    # 3. Buffer léger UNIQUEMENT à la fin (pas sur chaque entité !)
    final_geom = hull.buffer(tolerance * 0.5)  # Réduit le gonflement

    if final_geom.area < 1e-8:
        return []

    # 4. Un seul polygon fermé
    closed_poly = ClosedPolygon(
        geometry=final_geom,
        handles=all_handles
    )
    result.append(closed_poly)

    logger.info("Merged into ONE polygon", extra={
        "area": final_geom.area,
        "vertices": len(list(final_geom.exterior.coords))
    })
    return result


def build_geometry(drawing: Drawing, tolerance: float) -> List[ClosedPolygon]:
    """
    Build geometry from DXF drawing with simple buffering.
    """
    msp = drawing.modelspace()

    dxf_geometries: List[DxfEntityGeometry] = []
    for entity in msp:
        try:
            dxf_geometry: DxfEntityGeometry = convert_entity_to_shapely(entity, tolerance)
            if dxf_geometry is not None:
                dxf_geometries.append(dxf_geometry)
        except Exception as e:
            logger.error("Error converting entity", extra={"entity": entity.dxftype(), "handle": entity.dxf.handle, "error": e})
            raise e

    closed_polygons = merge_dxf_entities_into_polygons(dxf_geometries, tolerance)
    logger.info("Computed closed polygons", extra={"len": len(closed_polygons)})
    for idx, cp in enumerate(closed_polygons):
        logger.info(f"Final closed polygon {idx}", extra={"coords": list(cp.geometry.exterior.coords), "area": cp.geometry.area})
    return closed_polygons    