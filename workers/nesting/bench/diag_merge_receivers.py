"""Diagnostic W3 (vérif 2026-09-04, tour 4) : rejoue expand → hole-fill → passe fusionnée
receveuse sur l'état moteur brut d'un run navigateur (pre-solve.json) et imprime POURQUOI
mergedReceivers vaut 0 (poses lattice, non-posées, validate_return, min-dist réelle).
Usage : docker run --rm --user root -v <repo>:/src -w /src/workers/nesting nest2d-nesting-worker:dev \n  python bench/diag_merge_receivers.py /src/.qa-pw/<e2e-out>/pre-solve.json <space>"""
import copy, json, sys, os
sys.path.insert(0, "/src/workers/nesting")
from bench.seed_user_repro import FILLER_RING, host_geometry
from shapely.geometry import Polygon
def _simplify_part(coords, holes):
    poly = Polygon(coords, holes).simplify(0.05, preserve_topology=True)
    return [[x, y] for x, y in poly.exterior.coords], [[[x, y] for x, y in r.coords] for r in poly.interiors]
from core.nesting_input_builder import build_item
from core.holefill import plan_hole_fills, reduce_for_solve, expand_meta, expand_packs, apply_hole_fill
import core.residual as R

pre_path, space = sys.argv[1], float(sys.argv[2])
pre = json.load(open(pre_path))
Q = [0, 90, 180, 270]
outer, holes = host_geometry()
c0, h0 = _simplify_part([list(p) for p in outer], [[list(p) for p in h] for h in holes])
c1, _ = _simplify_part([list(p) for p in FILLER_RING], [])
items = [{"id": 0, "coords": c0, "holes": h0, "count": 100, "rotations": Q, "file_slug": "trou"},
         {"id": 1, "coords": c1, "holes": [], "count": 800, "rotations": Q, "file_slug": "fill"}]
jag = [build_item(it["id"], it["count"], it["coords"], Q) for it in items]
packs = plan_hole_fills(items, space)
meta, reduced = reduce_for_solve(items, jag, packs, space)
idmap = meta["idMap"]
layouts = copy.deepcopy(pre["alternatives"][0]["solution"]["layouts"])
for L in layouts:
    for pi in L["placed_items"]:
        pi["item_id"] = idmap[pi["item_id"]]
def counts(tag):
    print(tag, [(len(L["placed_items"]), sum(1 for p in L["placed_items"] if p["item_id"] == 0)) for L in layouts])
counts("PRE (moteur)")
layouts = expand_packs(items, meta["packs"], layouts) if meta.get("packs") else expand_meta(items, meta["host"], meta["fill"], meta["slots"], layouts, meta.get("ringRotations"))
counts("après expand")
n = apply_hole_fill(items, layouts, space); print("hole-fill recovered", n)
bin_dims = {0: (1000.0, 1000.0)}
items_by_id = {i["id"]: i for i in items}
# --- passe fusionnée instrumentée (copie de _merge_fill_compact_receivers) ---
ratios = [R._fill_ratio(l, items_by_id, bin_dims) for l in layouts]
donor_i = min(range(len(layouts)), key=lambda i: (ratios[i], -i))
print("donor =", donor_i, "ratios", [round(r, 3) for r in ratios])
donor = layouts[donor_i]
for recv_i in range(len(layouts)):
    if recv_i == donor_i: continue
    recv = layouts[recv_i]
    units, recv_free = R._helix_units_and_free(recv, items_by_id)
    donor_free = R._free_pis(donor, items_by_id)
    cands = recv_free + donor_free
    before = len(recv["placed_items"])
    print(f"recv {recv_i}: units {len(units)} recv_free {len(recv_free)} donor_free {len(donor_free)} before {before}")
    snap_recv = copy.deepcopy(recv["placed_items"]); snap_donor = copy.deepcopy(donor["placed_items"])
    saved = {id(p): dict(p["transformation"]) for p in cands}
    for pi in cands:
        recv["placed_items"] = [x for x in recv["placed_items"] if x is not pi]
        donor["placed_items"] = [x for x in donor["placed_items"] if x is not pi]
    used = R.layout_aabb(recv, items_by_id)
    print("  ancre AABB", [round(v, 1) for v in used], "bandes", [(b["name"], [round(v,1) for v in b["rect"]]) for b in R.residual_bands(used, 1000, 1000, space)])
    moved = R._relay_candidates_in_bands(layouts, recv_i, cands, items_by_id, bin_dims, space)
    placed_now = sum(1 for pi in cands if any(x is pi for x in recv["placed_items"]))
    print(f"  lattice a posé {placed_now} candidates (moved {moved}) ; recv count {len(recv['placed_items'])} vs before {before} → {'OK' if len(recv['placed_items']) + (len(cands)-placed_now if False else 0) >= 0 else ''}")
    remaining = [pi for pi in cands if not any(x is pi for x in recv["placed_items"])]
    rf = {id(p) for p in recv_free}
    back_recv = [p for p in remaining if id(p) in rf]; back_donor = [p for p in remaining if id(p) not in rf]
    print(f"  non posées : {len(back_recv)} retour receveuse, {len(back_donor)} retour donneuse")
    sr = {id(x): x for x in snap_recv}; sd = {id(x): x for x in snap_donor}
    for p in back_recv:
        p["transformation"] = dict(saved[id(p)]); recv["placed_items"].append(p)
    for p in back_donor:
        p["transformation"] = dict(saved[id(p)]); donor["placed_items"].append(p)
    ok_r = (not back_recv) or R._validate_return(back_recv, recv, items_by_id, space)
    ok_d = (not back_donor) or R._validate_return(back_donor, donor, items_by_id, space)
    # variante : les non-posées de la receveuse vont sur la DONNEUSE (validées là-bas)
    alt_ok = (not back_recv) or R._validate_return(back_recv, recv, items_by_id, space)
    ok_d2 = (not back_donor) or R._validate_return(back_donor, donor, items_by_id, max(0.0, space - 0.01))
    ok_r2 = (not back_recv) or R._validate_return(back_recv, recv, items_by_id, max(0.0, space - 0.01))
    print(f"  avec tolérance space-0.01 : receveuse={ok_r2} donneuse={ok_d2}")
    for tol in (0.06, 0.11, 0.2):
        okd = (not back_donor) or R._validate_return(back_donor, donor, items_by_id, max(0.0, space - tol))
        print(f"  tolérance space-{tol} : donneuse={okd}")
    # distance min réelle des retournées donneuse vs occupancy (anneaux simplifiés)
    entries, tree = R._occupancy(donor, items_by_id, exclude=[id(x) for x in back_donor])
    mind = 1e9
    for pi in back_donor:
        it = items_by_id[pi["item_id"]]; tr = pi["transformation"]
        poly = R._placed_poly(it, tr["rotation"], tr["translation"][0], tr["translation"][1])
        for j in tree.query(poly.buffer(space + 1)):
            e = entries[int(j)]
            mind = min(mind, poly.distance(e[-1] if not isinstance(e, dict) else e["poly"]))
    print(f"  min-dist retournées donneuse vs occupancy (simplifié) = {mind:.4f}")
    print(f"  validate_return receveuse={ok_r} donneuse={ok_d} ; count after {len(recv['placed_items'])} (≥ before ? {len(recv['placed_items']) >= before})")
    recv["placed_items"] = copy.deepcopy(snap_recv); donor["placed_items"] = copy.deepcopy(snap_donor)
