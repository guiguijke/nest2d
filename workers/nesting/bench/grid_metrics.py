"""Métriques directionnelles J-092 sur une sortie moteur native.

    python workers/nesting/bench/grid_metrics.py /tmp/grid-out/alternatives.json \
        [--instance workers/nesting/bench/fixtures/grid_instance.json] \
        [--sheet-w 1000] [--sheet-h 2000]

Pour chaque alternative (classe directionnelle) :
  - used_w / used_h   : bbox utilisée (mm, coords moteur y-up)
  - stair_excess      : aire vide au-dessus des colonnes plus courtes que la
                        plus haute (mm², % de la bbox utilisée) — cible LEFT :
                        0 = colonnes toutes remplies au même sommet
  - free_top/free_right et |delta| — cible BALANCED : delta ≈ 0
  - density
"""
import argparse
import json
import math
import sys


def load_items(instance):
    """item_id -> liste de points [(x, y), ...] (anneau externe)."""
    items = {}
    for item in instance["items"]:
        shape = item["shape"]
        # ExtShape tagged union : {"type": "...", "data": ...}
        data = shape.get("data", shape)
        if isinstance(data, dict):
            # polygon avec trous éventuels : premier anneau = externe
            data = data[0] if isinstance(data.get("points", data), list) else data
        if isinstance(data, dict) and "points" in data:
            data = data["points"]
        ring = data[0] if data and isinstance(data[0][0], (list, tuple)) and not isinstance(data[0][0], (int, float)) else data
        items[item["id"]] = [(float(p[0]), float(p[1])) for p in ring]
    return items


def placed_bbox(points, rotation_deg, translation):
    rad = math.radians(rotation_deg)
    c, s = math.cos(rad), math.sin(rad)
    xs, ys = [], []
    for x, y in points:
        xs.append(x * c - y * s + translation[0])
        ys.append(x * s + y * c + translation[1])
    return min(xs), min(ys), max(xs), max(ys)


def columns_metrics(bboxes):
    """Regroupe par colonnes (chevauchement des intervalles x) et mesure
    l'escalier des sommets."""
    order = sorted(bboxes, key=lambda b: (b[0], b[1]))
    cols = []
    for b in order:
        if cols and b[0] < cols[-1]["x_max"] - 1e-6:
            c = cols[-1]
            c["x_max"] = max(c["x_max"], b[2])
            c["top"] = max(c["top"], b[3])
            c["n"] += 1
        else:
            cols.append({"x_min": b[0], "x_max": b[2], "top": b[3], "n": 1})
    if not cols:
        return 0.0, 0.0, []
    max_top = max(c["top"] for c in cols)
    stair = sum((max_top - c["top"]) * (c["x_max"] - c["x_min"]) for c in cols)
    return stair, max_top, [(round(c["x_min"], 1), round(c["top"], 1), c["n"]) for c in cols]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("alternatives")
    ap.add_argument("--instance")
    ap.add_argument("--sheet-w", type=float, default=1000.0)
    ap.add_argument("--sheet-h", type=float, default=2000.0)
    args = ap.parse_args()

    alts = json.load(open(args.alternatives))
    if isinstance(alts, dict):
        alts = alts.get("alternatives", alts.get("runs", [alts]))
    if not alts:
        sys.exit("aucune alternative")

    items = {}
    if args.instance:
        items = load_items(json.load(open(args.instance)))

    print(f"{'classe':<10} {'used_w':>8} {'used_h':>8} {'stair_mm2':>12} {'stair%':>7} "
          f"{'free_top':>9} {'free_right':>10} {'|delta|':>8} {'density':>8}")
    for alt in alts:
        if not isinstance(alt, dict):
            print("alternative inattendue:", type(alt), str(alt)[:200])
            continue
        tag = alt.get("strategy") or alt.get("bias") or alt.get("tag") or "?"
        sol = alt.get("solution", alt)
        # SPP exporte "layout" (singulier), MSPP/BPP "layouts".
        layouts = sol.get("layouts") or ([sol["layout"]] if sol.get("layout") else [])
        bboxes = []
        for layout in layouts:
            for pi in layout.get("placed_items", []):
                t = pi["transformation"]
                pts = items.get(pi["item_id"])
                if pts is None:
                    sys.exit(f"item_id {pi['item_id']} absent de l'instance "
                             f"(passez --instance)")
                bboxes.append(placed_bbox(pts, t["rotation"], t["translation"]))
        if not bboxes:
            print(f"{tag:<10} (aucun placement)")
            continue
        used_w = max(b[2] for b in bboxes)
        used_h = max(b[3] for b in bboxes)
        stair, _, cols = columns_metrics(bboxes)
        # Vue fines bandes (100 mm) : sommet par bande — révèle les escaliers
        # intra-colonne que le clustering par chevauchement masque.
        n_bands = max(1, int(args.sheet_w // 100))
        band_tops = []
        for i in range(n_bands):
            x0, x1 = i * 100.0, (i + 1) * 100.0
            tops = [b[3] for b in bboxes if b[0] < x1 - 1e-6 and b[2] > x0 + 1e-6]
            band_tops.append(round(max(tops), 0) if tops else 0)
        band_max = max(band_tops) if band_tops else 0
        band_stair = sum((band_max - t) * 100.0 for t in band_tops if t > 0)
        bbox_area = used_w * used_h
        free_top = args.sheet_h - used_h
        free_right = args.sheet_w - used_w
        delta = abs(free_top - free_right)
        density = sol.get("density", float("nan"))
        print(f"{tag:<10} {used_w:>8.1f} {used_h:>8.1f} {stair:>12.0f} "
              f"{100 * stair / bbox_area if bbox_area else 0:>6.1f}% "
              f"{free_top:>9.1f} {free_right:>10.1f} {delta:>8.1f} {density:>8.4f}")
        print(f"{'':<10} colonnes (x_min, top, n): {cols}")
        print(f"{'':<10} bandes 100mm (tops): {band_tops}  stair_bandes={band_stair:.0f} mm²")


if __name__ == "__main__":
    main()
