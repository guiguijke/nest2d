"""Placement data structures shared between the nesting orchestrator
(core/main.py) and the result metrics (core/metrics.py).

Kept dependency-free on purpose: both modules and the unit tests import this
without pulling in Mongo/GridFS/ezdxf.
"""


class Transform:
    def __init__(self, file_slug: str, handles, x, y, angle, item_id=None):
        self.file_slug = file_slug
        self.handles = handles
        self.x = x
        self.y = y
        self.angle = angle
        # Input item this placement came from (used by the metrics to recover
        # the part's geometry).
        self.item_id = item_id

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


import math

from worker_common.logger import setup_logger

logger = setup_logger("placement")

def parse_result_containers(output, input_items, bin_dims, shape_centroids=None):
    """Parses engine output into ResultContainers. Each layout keeps the
    container_id the engine assigned (= index of the bin type used; 0 for the
    SPP strip), so heterogeneous sheets get the right frame.
    Returns (containers, placed_count, density, cost).

    The exported transformation is applied AS-IS to the original geometry:
    jagua-rs composes the item's centering pre-transform into the exported
    transformation (io/export.rs int_to_ext_transformation), so there is
    nothing to undo on our side. (shape_centroids kept for call-site
    compatibility, unused.)
    """
    solution = output.get("solution")
    layouts = solution.get("layouts")

    # O(1) lookups — placed items reference input items by id.
    items_by_id = {item["id"]: item for item in input_items}

    result_containers = []
    total_placed_count = 0

    for seq_id, layout in enumerate(layouts, start=1):
        transforms = []
        placedItems = layout.get("placed_items")
        bin_id = layout.get("container_id", 0)
        if bin_id not in bin_dims:
            logger.warning(
                "Unknown container_id in engine output, falling back to first sheet dims",
                extra={"bin_id": bin_id, "known_bins": list(bin_dims.keys())},
            )
        bin_width, bin_height = bin_dims.get(bin_id, bin_dims[0])
        for item in placedItems:
            item_id = item.get("item_id")
            transformation = item.get("transformation")
            # jagua-rs 0.7.x reports rotations in DEGREES (0.6.x was radians);
            # everything downstream (Matrix44.z_rotate, hole relocation)
            # works in radians.
            rotation = math.radians(transformation.get("rotation"))
            translation = transformation.get("translation")
            x, y = translation[0], translation[1]

            source_item = items_by_id[item_id]
            file_slug = source_item.get("file_slug")
            handles = source_item.get("handles")

            transforms.append(Transform(file_slug, handles, x, y, rotation, item_id=item_id))
            total_placed_count += 1

        result_containers.append(ResultContainer(seq_id, transforms, bin_width, bin_height))

    # cost = number of bins used when bin costs are uniform (always the case
    # today); kept as the primary ranking criterion for alternatives.
    return result_containers, total_placed_count, solution.get("density"), solution.get("cost")

