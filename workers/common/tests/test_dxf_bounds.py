import ezdxf
import pytest

from worker_common.geometry.dxf_bounds import (
    MAX_INSERT_DEPTH,
    assert_insert_depth,
    decompose_bounded,
)


def test_shallow_insert_is_accepted():
    doc = ezdxf.new()
    blk = doc.blocks.new("part")
    blk.add_line((0, 0), (10, 0))
    doc.modelspace().add_blockref("part", (0, 0))
    assert_insert_depth(doc)
    ents = decompose_bounded(doc.modelspace())
    assert len(ents) >= 1


def test_insert_chain_deeper_than_max_is_rejected():
    doc = ezdxf.new()
    prev = None
    depth = MAX_INSERT_DEPTH + 3
    for i in range(depth):
        name = f"B{i}"
        blk = doc.blocks.new(name)
        if prev is None:
            blk.add_line((0, 0), (1, 0))
        else:
            blk.add_blockref(prev, (0, 0))
        prev = name
    doc.modelspace().add_blockref(prev, (0, 0))
    with pytest.raises(ValueError, match="block nesting"):
        assert_insert_depth(doc)
