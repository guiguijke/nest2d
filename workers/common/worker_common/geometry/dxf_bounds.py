"""Bounds on DXF explode — INSERT nesting and entity count — before ezdxf
walks an unbounded tree (pentest H-4). The MAX_ENTITY_LIMIT check in
fileprocessing runs AFTER recover+decompose; a crafted INSERT bomb would
already have exhausted RAM.
"""
from ezdxf.disassemble import recursive_decompose

MAX_INSERT_DEPTH = 32
MAX_DECOMPOSED_ENTITIES = 4000


def assert_insert_depth(doc, max_depth=MAX_INSERT_DEPTH):
    """Reject DXF block graphs deeper than max_depth (or cyclic)."""
    refs = {}
    for block in doc.blocks:
        names = set()
        try:
            for entity in block:
                if entity.dxftype() == "INSERT":
                    try:
                        names.add(entity.dxf.name)
                    except Exception:
                        pass
        except Exception:
            continue
        refs[block.name] = names

    memo = {}
    visiting = set()

    def depth_of(name):
        if name in memo:
            return memo[name]
        if name in visiting:
            return max_depth + 1
        visiting.add(name)
        kids = refs.get(name) or set()
        d = 0 if not kids else 1 + max(depth_of(k) for k in kids)
        visiting.discard(name)
        memo[name] = d
        return d

    msp = doc.modelspace()
    msp_name = getattr(msp, "name", None) or "*Model_Space"
    deepest = max(
        [depth_of(msp_name), *(depth_of(n) for n in refs)],
        default=0,
    )
    if deepest > max_depth:
        raise ValueError(f"DXF block nesting exceeds {max_depth} levels")


def decompose_bounded(msp, max_entities=MAX_DECOMPOSED_ENTITIES):
    """recursive_decompose with a hard cap on yielded entities."""
    out = []
    for entity in recursive_decompose(msp):
        out.append(entity)
        if len(out) > max_entities:
            raise ValueError(
                f"DXF exploded to more than {max_entities} entities"
            )
    return out
