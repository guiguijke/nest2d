"""Cross-target determinism lock (Phase 2 foundation): the SAME demo job run
through the native nest-engine binary and through the browser-target wasm
artifact (in Node/V8) must produce BIT-IDENTICAL alternatives — SHA-256 of
the canonical form, tolerance 0.

The fixture config is work-bounded (sa_max_iterations), so both targets do
exactly the same work regardless of machine speed (AGENTS.md moteur — libm).

Usage:
    python workers/nesting/bench/determinism_lock.py [nest-engine-bin]

Requires: the release binary built (cargo build --release) and the wasm
artifact installed (bash workers/nesting/engine/build-wasm.sh), plus node.
"""
import hashlib
import json
import os
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ENGINE = os.path.abspath(os.path.join(HERE, "..", "engine"))
FIXTURE = os.path.join(HERE, "fixtures", "b_demo")


def jsnum(x):
    """JS String(x) equivalent for tame magnitudes: integers without '.0'."""
    f = float(x)
    if f.is_integer() and abs(f) < 1e15:
        return str(int(f))
    return repr(f)


def canon(alternatives):
    lines = []
    for alt in alternatives:
        cost = alt.get("cost")
        strip = alt.get("strip_width")
        head = ",".join([
            str(alt.get("rank")),
            jsnum(cost) if cost is not None else jsnum(strip),
            jsnum(alt.get("density")),
            str(alt.get("iterations") if alt.get("iterations") is not None else alt.get("evaluations")),
        ])
        sol = alt.get("solution") or {}
        layouts = sol.get("layouts") or ([sol.get("layout")] if sol.get("layout") else [])
        lay_lines = []
        for l in layouts:
            items = []
            for pi in l["placed_items"]:
                t = pi["transformation"]
                items.append(",".join([
                    str(pi["item_id"]),
                    jsnum(t["rotation"]),
                    jsnum(t["translation"][0]),
                    jsnum(t["translation"][1]),
                ]))
            lay_lines.append(";".join(sorted(items)))
        lines.append(head + "#" + "|".join(lay_lines))
    return "\n".join(lines)


def native_hash(bin_path):
    with tempfile.TemporaryDirectory(prefix="nest_det_lock_") as tmp:
        subprocess.run(
            [bin_path, "-i", os.path.join(FIXTURE, "instance.json"),
             "-c", os.path.join(FIXTURE, "config_det.json"),
             "-s", tmp, "-p", "bpp"],
            check=True, capture_output=True,
        )
        alternatives = json.load(open(os.path.join(tmp, "alternatives.json")))
    return hashlib.sha256(canon(alternatives).encode()).hexdigest(), alternatives


def wasm_hash():
    r = subprocess.run(
        ["node", os.path.join(HERE, "wasm_canon_hash.mjs")],
        check=True, capture_output=True, text=True,
    )
    return r.stdout.strip().splitlines()[-1]


def main():
    bin_path = sys.argv[1] if len(sys.argv) > 1 else os.path.join(
        ENGINE, "target", "release",
        "nest-engine.exe" if os.name == "nt" else "nest-engine",
    )
    print(f"[lock] native binary: {bin_path}")
    nh, alts = native_hash(bin_path)
    print(f"[lock] native SHA-256: {nh}")
    wh = wasm_hash()
    print(f"[lock] wasm   SHA-256: {wh}")
    a = alts[0]
    print(f"[lock] native best: cost={a.get('cost')} density={a.get('density')} "
          f"iterations={a.get('iterations')}")
    if nh != wh:
        print("[lock] FAIL — alternatives diverge between native and wasm")
        sys.exit(1)
    print("[lock] OK — bit-identical alternatives (tolerance 0)")


if __name__ == "__main__":
    main()
