"""Placement data structures shared between the nesting orchestrator
(core/main.py) and the hole-relocation post-pass (core/hole_relocation.py).

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
        # Input item this placement came from (used by the hole-relocation
        # post-pass to recover the part's holes and allowed rotations).
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
