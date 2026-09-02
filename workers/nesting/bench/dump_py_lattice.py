"""Dump le lattice Python sur une bande réaliste (compaction tôle 2)."""
import json
import sys

sys.path.insert(0, "/app")
from bench.seed_user_repro import FILLER_RING
from core.structure import small_lattice

lat = small_lattice(
    {"id": 1, "coords": FILLER_RING, "rotations": [0.0, 90.0, 180.0, 270.0]},
    0.1, (451.1, 0.1, 998.9, 999.9), want=120, axis="x")
poses = [[lp["transformation"]["rotation"], lp["transformation"]["translation"][0],
          lp["transformation"]["translation"][1]] for lp in lat]
print(json.dumps(poses[:30]))
print("count:", len(poses))
