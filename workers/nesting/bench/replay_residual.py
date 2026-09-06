"""AD3 (L2-quater) — rejeu pas-à-pas de la passe résiduelle à partir du
snapshot moteur persisté dans le diagnostic d'écartage
(`discardedAlternatives[].preLayouts`, poses compactes).

La passe `fill_residual_bands` est déterministe à entrée donnée : ce
script rejoue expand_meta → apply_hole_fill → fill_residual_bands sur le
snapshot et imprime l'étape qui introduit chaque paire fautive (les
paires sont relues du diagnostic). Confirme AD1 sur les récidives déjà
en base.

Usage (conteneur worker, réseau nest2d) :
    MONGO_URI=… python bench/replay_residual.py <slug> [alt_rank]
"""
import math
import sys

from pymongo import MongoClient
from shapely.geometry import Polygon
from shapely.strtree import STRtree
from shapely.affinity import rotate, translate

from core.holefill import expand_meta, apply_hole_fill
from core.residual import fill_residual_bands


def _poly(item, rot, tx, ty):
    p = Polygon(item["coords"], item.get("holes") or [])
    return translate(rotate(p, float(rot), origin=(0, 0)), float(tx), float(ty))


def _dirty_pairs(layouts, items_by_id):
    out = []
    for si, l in enumerate(layouts):
        polys, keys = [], []
        for k, pi in enumerate(l.get("placed_items", [])):
            it = items_by_id.get(pi.get("item_id"))
            if it is None:
                continue
            tr = pi.get("transformation") or {}
            t = tr.get("translation") or [0, 0]
            polys.append(_poly(it, tr.get("rotation", 0), t[0], t[1]))
            keys.append((si, k))
        if not polys:
            continue
        tree = STRtree(polys)
        for i, a in enumerate(polys):
            for j in tree.query(a.buffer(5.0)):
                j = int(j)
                if j <= i:
                    continue
                inter = a.intersection(polys[j])
                if inter.area > 0.01:
                    # exemption trou : la géométrie Polygon est trou-aware,
                    # intersection nulle si nichée dans un trou ✓
                    out.append((keys[i], keys[j], round(inter.area, 2)))
    return out


def main():
    slug = sys.argv[1]
    rank = int(sys.argv[2]) if len(sys.argv) > 2 else 0
    import os
    db = MongoClient(os.environ["MONGO_URI"]).get_default_database()
    job = db["nesting_jobs"].find_one({"slug": slug})
    if not job:
        print("job inconnu:", slug)
        return
    disc = (job.get("discardedAlternatives") or [])
    d = next((x for x in disc if (x.get("rank") == rank)), disc[0] if disc else None)
    if d is None or not d.get("preLayouts"):
        print("pas de preLayouts dans le diagnostic (job pré-AD3 ?)")
        return
    print(f"job {slug} alt{rank}: reason={d.get('reason')} origin={d.get('originStage')}")

    # reconstruire input_items depuis les fichiers du job (géométrie bench
    # déterministe) : le seed_corpus régénère — ici on relit les fichiers.
    files = job.get("files") or []
    items = []
    iid = 0
    for f in files:
        parts = f.get("parts") or []
        for p in parts:
            items.append({
                "id": iid,
                "file_slug": f.get("slug"),
                "coords": p.get("coordinates") or p.get("coords"),
                "holes": p.get("holes") or [],
                "count": f.get("count"),
                "rotations": f.get("rotations") or [0.0, 90.0, 180.0, 270.0],
            })
            iid += 1
    items_by_id = {i["id"]: i for i in items}
    space = float(job.get("params", {}).get("tolerance", 2.0)
                  or job.get("params", {}).get("space", 2.0) or 2.0)
    sheets = job.get("sheets") or job.get("params", {}).get("sheets") or []
    bin_dims = {k: (float(s.get("width")), float(s.get("height")))
                for k, s in enumerate(sheets)} or {0: (1000.0, 1000.0)}

    snapshot = [{"container_id": 0, "placed_items": [
        {"item_id": p[0],
         "transformation": {"rotation": p[1], "translation": [p[2], p[3]]}}
        for p in sheet.get("poses", [])
    ]} for sheet in d["preLayouts"]]

    meta = (job.get("compute") or {}).get("meta") or job.get("meta") or {}

    print("\n[1] snapshot moteur :", _dirty_pairs(snapshot, items_by_id) or "propre")
    layouts = [dict(l, placed_items=list(l["placed_items"])) for l in snapshot]
    if meta.get("host") is not None:
        layouts = expand_meta(items, meta["host"], meta["fill"],
                              meta.get("slots") or [], layouts,
                              meta.get("ringRotations"))
        print("[2] après expansion :", _dirty_pairs(layouts, items_by_id) or "propre")
    apply_hole_fill(items, layouts, space)
    print("[3] après hole-fill :", _dirty_pairs(layouts, items_by_id) or "propre")
    stats = {}
    fill_residual_bands(layouts, items, bin_dims, space, stats=stats,
                        profile="compact")
    dirty = _dirty_pairs(layouts, items_by_id)
    print("[4] après résiduel  :", dirty or "propre")
    print("\npostPass rejeu :", {k: v for k, v in stats.items()
                                 if k in ("residualMoved", "mergedReceivers",
                                          "compactRollback",
                                          "compactRollbackReason",
                                          "mergedRollbackReason",
                                          "residualRolledBack")})
    if dirty:
        print("→ la passe résiduelle INTRODUIT les paires ci-dessus (cause confirmée)")
    elif d.get("overlaps"):
        print("→ rejeu propre : la récidive dépend de l'état moteur exact du run "
              "(variance Y6) — la ceinture reste le filet")


if __name__ == "__main__":
    main()
