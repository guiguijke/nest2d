"""Rejoue plan_hole_fills + reduce_for_solve sur l'input du banc 100/800
pour inspecter le plan (packs vs legacy, slots, ringRotations)."""
import os
import sys

sys.path.insert(0, "/app")
from bench.seed_user_repro import FILLER_RING, filler_geometry, host_geometry
from core.holefill import plan_hole_fills, reduce_for_solve, PINWHEEL

SPACE = float(os.environ.get("SPACE", "0.1"))

input_items = []
outer, holes = host_geometry()
input_items.append({
    "id": 0, "coords": [[x, y] for x, y in outer],
    "holes": [[[x, y] for x, y in h] for h in holes],
    "rotations": [0, 90, 180, 270], "qty": 100,
})
fring, _ = filler_geometry()
input_items.append({
    "id": 1, "coords": [[x, y] for x, y in fring],
    "holes": [], "rotations": [0, 90, 180, 270], "qty": 800,
})
# jaguar-like items : demande = qty
jaguar_items = [{"id": i, "demand": it["qty"]} for i, it in enumerate(input_items)]

packs = plan_hole_fills(input_items, SPACE)
print("packs:", len(packs) if packs else None)
if packs:
    per = [len(p.get("fills") or []) for p in packs]
    from collections import Counter
    print("fills par pack:", Counter(per))
    print("pack[0]:", {k: v for k, v in packs[0].items() if k != "fills"})
    print("pack[0] fills[0..2]:", packs[0]["fills"][:2])

meta, reduced = reduce_for_solve(input_items, jaguar_items, packs, SPACE)
print("meta keys:", sorted(meta.keys()))
if "packs" in meta:
    print("→ chemin PACKS (générique)")
else:
    print("→ chemin LEGACY 1+1 : host", meta["host"], "fill", meta["fill"])
    print("slots[:10]:", meta["slots"][:10], "| total slots:", sum(meta["slots"]))
    print("ringRotations:", meta["ringRotations"])
print("instance réduite:", [(e["id"], e["demand"], "solid" if "shape" in e else "open") for e in reduced])
