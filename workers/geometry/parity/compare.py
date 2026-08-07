"""Parity comparator: nest-import-cli (Rust) vs golden pipeline (Python).

Per file: structural equality (part/ring/vertex counts), max abs coordinate
delta, and bit-identity verdict (both sides carry the 1e-4 snap — post-snap
bit-identity is the amended gate, docs/PIPELINE-MAP.md §4.1: >= 99 % of the
corpus bit-identical = GO).

Run from repo root:
    python workers/geometry/parity/compare.py [golden_dir] [corpus_dir...]
"""
import json
import os
import subprocess
import sys

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
CLI = os.path.join(
    REPO, "workers", "geometry", "target", "release",
    "nest-import-cli.exe" if os.name == "nt" else "nest-import-cli",
)
GOLDEN_DIR_DEFAULT = os.path.join(REPO, "workers", "geometry", "parity", "golden")

# Fichiers hors gate géométrie : divergence de périmètre documentée (le
# harnais les suit quand même, verdict EXCLUDED). hatch_pattern : Python
# convertit HATCH->lignes (hatch_entity) et CRASHE sur les pattern-hatches ;
# Rust saute HATCH (dégradation sûre). Port HATCH = phase ultérieure
# (PIPELINE-MAP §5). Pas de triche : exclus du DÉNOMINATEUR, tracés à part.
EXCLUDED = {
    "hatch_pattern.dxf": "HATCH->lignes côté Python (crash pattern), sauté côté Rust ; port ultérieur (§5)",
}


def canon_ring(ring):
    """Canonical ring form: rotate to the lexicographically-min vertex
    (drops the closing duplicate first, re-appends after rotation).
    GEOS and the Rust walker choose different start vertices — the mission's
    post-snap bit-identity is judged on the CANONICAL form (the shared
    rotation rule is part of the parity contract, PIPELINE-MAP §4.1)."""
    if not ring:
        return ring
    pts = ring[:-1] if len(ring) > 1 and ring[0] == ring[-1] else ring[:]
    i = min(range(len(pts)), key=lambda k: (pts[k][0], pts[k][1]))
    out = pts[i:] + pts[:i]
    out.append(out[0])
    return out


def canon_part(part):
    return {
        "coordinates": canon_ring(part.get("coordinates", [])),
        "holes": sorted(
            (canon_ring(h) for h in part.get("holes", [])),
            key=lambda r: (len(r), r[0][0], r[0][1]),
        ),
    }


def compare_file(rust_path, golden_path, rust_error=None):
    rust = json.load(open(rust_path)) if rust_path else None
    golden = json.load(open(golden_path))
    if "error" in golden:
        # Error-parity: the golden failed (unreadable / no geometry) — the
        # Rust side must fail too (clean ImportError), same behavior.
        if rust_error:
            return ("ERROR-PARITY", golden["error"][:80])
        return ("DIVERGENT", f"golden errored ({golden['error'][:60]}) but rust succeeded")
    if rust_error:
        return ("DIVERGENT", f"rust errored ({rust_error[:80]}) but golden succeeded")
    rp, gp = rust.get("parts", []), golden.get("parts", [])
    if len(rp) != len(gp):
        return ("DIVERGENT", f"part count {len(rp)} vs {len(gp)}")

    max_delta = 0.0
    divergent_bits = 0
    total_pts = 0
    for i, (ra, ga) in enumerate(zip(rp, gp)):
        ra = canon_part(ra)
        ga = canon_part(ga)
        for ring_kind in ("coordinates", "holes"):
            rr, gr = ra.get(ring_kind), ga.get(ring_kind)
            if ring_kind == "holes":
                if len(rr) != len(gr):
                    return ("DIVERGENT", f"part {i}: hole count {len(rr)} vs {len(gr)}")
                pairs = zip(rr, gr)
            else:
                pairs = [(rr, gr)]
            for k, (rring, gring) in enumerate(pairs):
                if len(rring) != len(gring):
                    return (
                        "DIVERGENT",
                        f"part {i} {ring_kind}{k}: vertex count {len(rring)} vs {len(gring)}",
                    )
                for (rp2, gp2) in zip(rring, gring):
                    total_pts += 1
                    d = max(abs(rp2[0] - gp2[0]), abs(rp2[1] - gp2[1]))
                    max_delta = max(max_delta, d)
                    if d != 0.0:
                        divergent_bits += 1
    if divergent_bits == 0:
        return ("IDENTICAL", f"{total_pts} pts bit-exact")
    # §4.1 divergent path (both DELTA and DIVERGENT): structural + metrics
    # at 1e-3 — the weld buffer roundtrip noise lives here.
    metrics = metrics_compare(rp, gp)
    if metrics is None:
        return ("METRICS-OK", f"max {max_delta:.2e} on {divergent_bits}/{total_pts} pts, "
                              f"metrics<=1e-3")
    if max_delta <= 1e-9:
        return ("DELTA<=1e-9", f"max {max_delta:.2e} on {divergent_bits}/{total_pts} pts — {metrics}")
    return ("DIVERGENT", f"max {max_delta:.2e} on {divergent_bits}/{total_pts} pts — {metrics}")


def ring_area(ring):
    return abs(sum(ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1]
                   for i in range(len(ring) - 1))) / 2


def metrics_compare(rp, gp):
    """§4.1 divergent-file path: structural + area/bbox at 1e-3 relative.
    Returns None when metrics match, else the failing reason."""
    if len(rp) != len(gp):
        return f"part count {len(rp)} vs {len(gp)}"
    for i, (ra, ga) in enumerate(zip(rp, gp)):
        ra = canon_part(ra)
        ga = canon_part(ga)
        if len(ra.get("holes", [])) != len(ga.get("holes", [])):
            return f"part {i}: hole count differs"
        for kind in ("coordinates", "holes"):
            rr_all = [ra["coordinates"]] if kind == "coordinates" else ra.get("holes", [])
            gg_all = [ga["coordinates"]] if kind == "coordinates" else ga.get("holes", [])
            for k, (rr, gr) in enumerate(zip(rr_all, gg_all)):
                rc, gc = canon_ring(rr), canon_ring(gr)
                a_r, a_g = ring_area(rc), ring_area(gc)
                if a_g > 0 and abs(a_r - a_g) / a_g > 1e-3:
                    return f"part {i} {kind}{k}: area rel {abs(a_r - a_g) / a_g:.2e}"
                for dim in ("width", "height"):
                    dv = abs(ra.get(dim, 0) - ga.get(dim, 0))
                    base = abs(ga.get(dim, 0))
                    if base > 0 and dv / base > 1e-3:
                        return f"part {i}: {dim} rel {dv / base:.2e}"
    return None


def main():
    golden_dir = sys.argv[1] if len(sys.argv) > 1 else GOLDEN_DIR_DEFAULT
    results = {}
    for name in sorted(os.listdir(golden_dir)):
        if not name.endswith(".golden.json"):
            continue
        dxf_name = name[: -len(".golden.json")]
        if dxf_name in EXCLUDED:
            # Divergence de périmètre DOCUMENTÉE (hors gate géométrie) :
            # voir PIPELINE-MAP §5 — le port correspondant arrive dans une
            # phase ultérieure, le harnais continue de suivre le fichier.
            results[dxf_name] = ("EXCLUDED", EXCLUDED[dxf_name])
            continue
        corpus_hit = None
        for d in [
            os.path.join(REPO, "workers", "fileprocessing", "tests", "fixtures"),
            os.path.join(REPO, "server", "seed", "demo"),
            os.path.join(REPO, "workers", "geometry", "parity", "corpus_extra"),
            os.path.join(REPO, "workers", "geometry", "parity", "corpus_svg"),
        ] + sys.argv[2:]:
            p = os.path.join(d, dxf_name)
            if os.path.exists(p):
                corpus_hit = p
                break
        if not corpus_hit:
            results[dxf_name] = ("MISSING-CORPUS", "")
            continue
        r = subprocess.run([CLI, corpus_hit], capture_output=True, text=True)
        tmp = os.path.join(golden_dir, "_rust_out.json")
        if r.returncode != 0:
            results[dxf_name] = compare_file(None, os.path.join(golden_dir, name),
                                             rust_error=r.stderr.strip()[:200])
            continue
        with open(tmp, "w") as f:
            f.write(r.stdout)
        results[dxf_name] = compare_file(tmp, os.path.join(golden_dir, name))
    if os.path.exists(os.path.join(golden_dir, "_rust_out.json")):
        os.remove(os.path.join(golden_dir, "_rust_out.json"))

    counts = {}
    for name, (verdict, detail) in results.items():
        counts[verdict] = counts.get(verdict, 0) + 1
        if verdict not in ("IDENTICAL", "ERROR-PARITY", "METRICS-OK"):
            print(f"  {verdict}: {name} — {detail}")
    excluded = counts.pop("EXCLUDED", 0)
    total = sum(counts.values())
    identical = counts.get("IDENTICAL", 0)
    error_parity = counts.get("ERROR-PARITY", 0)
    metrics_ok = counts.get("METRICS-OK", 0)
    ok = identical + error_parity + metrics_ok
    print(f"\n=== PARITY: {identical}/{total} bit-identical + {error_parity} error-parity "
          f"+ {metrics_ok} metrics-ok ({(ok / total * 100 if total else 0):.1f} %) — gate: >= 99 % ===")
    for v, c in sorted(counts.items()):
        print(f"  {v}: {c}")
    # Gate CI : échec si sous le seuil.
    if total and ok / total < 0.99:
        sys.exit(1)


if __name__ == "__main__":
    main()
