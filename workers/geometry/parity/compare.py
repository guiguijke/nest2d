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


def compare_file(rust_path, golden_path):
    rust = json.load(open(rust_path))
    golden = json.load(open(golden_path))
    if "error" in golden:
        return ("GOLDEN-ERROR", golden["error"])
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
    if max_delta <= 1e-9:
        return ("DELTA<=1e-9", f"max {max_delta:.2e} on {divergent_bits}/{total_pts} pts")
    return ("DIVERGENT", f"max {max_delta:.2e} on {divergent_bits}/{total_pts} pts")


def main():
    golden_dir = sys.argv[1] if len(sys.argv) > 1 else GOLDEN_DIR_DEFAULT
    results = {}
    for name in sorted(os.listdir(golden_dir)):
        if not name.endswith(".golden.json"):
            continue
        dxf_name = name[: -len(".golden.json")]
        corpus_hit = None
        for d in [
            os.path.join(REPO, "workers", "fileprocessing", "tests", "fixtures"),
            os.path.join(REPO, "server", "seed", "demo"),
        ] + sys.argv[2:]:
            p = os.path.join(d, dxf_name)
            if os.path.exists(p):
                corpus_hit = p
                break
        if not corpus_hit:
            results[dxf_name] = ("MISSING-CORPUS", "")
            continue
        r = subprocess.run([CLI, corpus_hit], capture_output=True, text=True)
        if r.returncode != 0:
            results[dxf_name] = ("RUST-ERROR", r.stderr.strip()[:200])
            continue
        tmp = os.path.join(golden_dir, "_rust_out.json")
        with open(tmp, "w") as f:
            f.write(r.stdout)
        results[dxf_name] = compare_file(tmp, os.path.join(golden_dir, name))
    if os.path.exists(os.path.join(golden_dir, "_rust_out.json")):
        os.remove(os.path.join(golden_dir, "_rust_out.json"))

    counts = {}
    for name, (verdict, detail) in results.items():
        counts[verdict] = counts.get(verdict, 0) + 1
        if verdict not in ("IDENTICAL",):
            print(f"  {verdict}: {name} — {detail}")
    total = len(results)
    identical = counts.get("IDENTICAL", 0)
    print(f"\n=== PARITY: {identical}/{total} bit-identical "
          f"({(identical / total * 100 if total else 0):.1f} %) — gate: >= 99 % ===")
    for v, c in sorted(counts.items()):
        print(f"  {v}: {c}")


if __name__ == "__main__":
    main()
