from worker_common.logger import setup_logger
from worker_common.geometry.dxf_parser import flatten_entity

logger = setup_logger("svg_generator")

def build_svg_string(drawing, bin_width=None, bin_height=None):
    entities = drawing.modelspace()

    flatten_entities = []
    for entity in entities:
        # The bin boundary is drawn as a dedicated rect below — never as a part.
        if entity.dxf.layer == "BIN_BOUNDARY":
            continue
        try:
            flatten, _ = flatten_entity(entity, 0.1)
        except Exception as e:
            # One foreign entity must not crash the whole thumbnail.
            logger.warning("Skipping unsupported entity", extra={"error": str(e)})
            continue
        if flatten:
            flatten_entities.append(flatten)

    has_bin_frame = bin_width is not None and bin_height is not None

    if has_bin_frame:
        # Parts are already in bin coordinates — draw them raw into the bin viewBox.
        min_x, min_y = 0.0, 0.0
        width, height = float(bin_width), float(bin_height)
    else:
        min_x = min([coord.x for flatten in flatten_entities for coord in flatten])
        min_y = min([coord.y for flatten in flatten_entities for coord in flatten])
        max_x = max([coord.x for flatten in flatten_entities for coord in flatten])
        max_y = max([coord.y for flatten in flatten_entities for coord in flatten])

        width = max_x - min_x
        height = max_y - min_y

    stroke_width = min(width, height) * 0.002

    svg_string = f"<?xml version='1.0' encoding='utf-8'?>\n"
    svg_string += f"<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"{width}mm\" height=\"{height}mm\" viewBox=\"0 0 {width} {height}\">\n"

    if has_bin_frame:
        svg_string += (
            f"<rect x=\"0\" y=\"0\" width=\"{width}\" height=\"{height}\" "
            f"fill=\"none\" stroke=\"#3B82F6\" stroke-width=\"{stroke_width * 1.5}\" />\n"
        )

    for flatten in flatten_entities:
        coords_str = " ".join([f"{coord.x - min_x} {coord.y - min_y}" for coord in flatten])
        svg_string += f"<path d=\"M {coords_str} Z\" fill=\"none\" stroke=\"#FF0000\" stroke-width=\"{stroke_width}\" />"

    svg_string += f"</svg>\n"

    return svg_string

def create_svg_from_doc(doc, max_flattening_distance, bin_width=None, bin_height=None):
    svg_string = build_svg_string(doc, bin_width, bin_height)

    return svg_string
