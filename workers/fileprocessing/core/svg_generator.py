from shapely.geometry import Point
from worker_common.logger import setup_logger
from worker_common.geometry.dxf_parser import flatten_entity

logger = setup_logger("svg_generator")

def get_entity_by_handle(drawing, handles):
    result = []
    for entity in drawing.modelspace():
        if entity.dxf.handle in handles:
            result.append(entity)
        
    return result
    
def build_svg_string(drawing, closed_parts):
    min_x = min([coord[0] for part in closed_parts for coord in part["coordinates"]])
    min_y = min([coord[1] for part in closed_parts for coord in part["coordinates"]])
    max_x = max([coord[0] for part in closed_parts for coord in part["coordinates"]])
    max_y = max([coord[1] for part in closed_parts for coord in part["coordinates"]])
    
    width = max_x - min_x
    height = max_y - min_y
    
    stroke_width = min(width, height) * 0.002
    
    svg_string = f"<?xml version='1.0' encoding='utf-8'?>\n"
    
    svg_string += f"<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"{width}mm\" height=\"{height}mm\" viewBox=\"0 0 {width} {height}\">\n"
    
    for part in closed_parts:
        coords = part["coordinates"]
        wrapper_coords_str = " ".join([f"{coord[0] - min_x} {coord[1] - min_y}" for coord in coords])
        svg_string += f"<path d=\"M {wrapper_coords_str} Z\" fill=\"none\" stroke=\"#00FF00\" stroke-width=\"{stroke_width}\" />"
        # Interior rings (cutouts) — dashed blue, so holes are visually
        # distinct from the outer contour and from raw entities.
        for hole in part.get("holes") or []:
            hole_coords_str = " ".join([f"{coord[0] - min_x} {coord[1] - min_y}" for coord in hole])
            svg_string += f"<path d=\"M {hole_coords_str} Z\" fill=\"none\" stroke=\"#0080FF\" stroke-width=\"{stroke_width}\" stroke-dasharray=\"{stroke_width * 4} {stroke_width * 2}\" />"
        handles = part["handles"]
        entities = get_entity_by_handle(drawing, handles)
        for entity in entities:
            flatten, _ = flatten_entity(entity, 0.1)  
            inner_coords_str = " ".join([f"{coord.x - min_x} {coord.y - min_y}" for coord in flatten])
            svg_string += f"<path d=\"M {inner_coords_str} Z\" fill=\"none\" stroke=\"#FF0000\" stroke-width=\"{stroke_width}\" />"
        
    svg_string += f"</svg>\n"
            
    return svg_string

def create_svg_from_doc(drawing, closed_parts):
    svg_string = build_svg_string(drawing, closed_parts)
            
    return svg_string