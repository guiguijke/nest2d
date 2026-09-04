"""Audit BPP 2026-09-02 : relance le pipeline nesting_process AVEC le pass
residual.py instrumenté (re-grid tracé), pour observer pourquoi le 1er
passage ne re-grille pas les hélices de la donneuse (bande basse perdue).
Process UN job bench puis sort (claim manuel du doc).
"""
import os
import sys
import time
import traceback

sys.path.insert(0, "/app")

from worker_common.mongo import db
from datetime import datetime

# --- Instrumentation AVANT l'import de core.main (le module capture les refs)
from core import residual
import core.structure as st

_orig_regrid = residual._regrid_helices
_orig_compact = residual._compact_last_sheet
_orig_fill_batch = residual._fill_one_batch


def traced_regrid(last, units, items_by_id, sw, sh, space):
    by_cls = {}
    for u in units:
        by_cls.setdefault(u["host"]["item_id"], []).append(u)
    print(f"[TRACE] _regrid_helices: {len(units)} unités / {len(by_cls)} classes, "
          f"tôle {sw}x{sh}, space={space}", flush=True)
    for cls, group in by_cls.items():
        it = items_by_id[cls]
        small = {"id": cls, "coords": it["coords"],
                 "rotations": it.get("rotations") or [0.0]}
        rect = (space, space, sw - space, sh - space)
        lat = st.small_lattice(small, space, rect, want=len(group), axis="x")
        print(f"[TRACE]   classe {cls}: {len(group)} hélices, rotations="
              f"{it.get('rotations')!r}, lattice={len(lat) if lat else 0} poses", flush=True)
    moved = _orig_regrid(last, units, items_by_id, sw, sh, space)
    print(f"[TRACE] _regrid_helices -> moved={moved}", flush=True)
    return moved


def traced_compact(layouts, sheet_i, items_by_id, bin_dims, space):
    print(f"[TRACE] _compact_last_sheet sur layout {sheet_i} "
          f"({len(layouts[sheet_i]['placed_items'])} pièces)", flush=True)
    return _orig_compact(layouts, sheet_i, items_by_id, bin_dims, space)


residual._regrid_helices = traced_regrid
residual._compact_last_sheet = traced_compact

from core.main import nesting_process

slug = os.environ.get("AUDIT_SLUG") or (sys.argv[1] if len(sys.argv) > 1 else None)
doc = db["nesting_jobs"].find_one_and_update(
    {"slug": slug, "status": "pending"},
    {"$set": {"status": "processing", "priority": 0}},
)
if doc is None:
    # re-seed : le seed upsert les fichiers puis crée le job ; on fait l'inverse
    # d'une reprise : on marque un NOUVEAU job en pending processé ici.
    print("[AUDIT] pas de job pending pour ce slug", flush=True)
    sys.exit(1)

try:
    nesting_process(doc)
    print("[AUDIT] job done", flush=True)
except Exception:
    traceback.print_exc()
    print("[AUDIT] job failed", flush=True)
