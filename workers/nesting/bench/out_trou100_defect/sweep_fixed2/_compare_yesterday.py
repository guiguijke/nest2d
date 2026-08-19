"""Compare sweep_fixed2 (today, snap-fallback) vs sweep_fixed (yesterday):
counts pixel-identical outputs, and for differing seeds whether the output
is still clean + same width (±0.01 mm) — i.e. harmless µm-level churn vs
meaningful change. Run after _run_sweep.py + _analyze.py in both dirs.
"""
import filecmp
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent            # sweep_fixed2/
YESTERDAY = ROOT.parent / "sweep_fixed"

ident, differ = [], []
for d in sorted(ROOT.glob("seed_*")):
    s = d.name.split("_")[1]
    old = YESTERDAY / f"seed_{s}" / "run" / "sol_instance.json"
    new = d / "run" / "sol_instance.json"
    if not old.exists() or not new.exists():
        continue
    (ident if filecmp.cmp(new, old, shallow=False) else differ).append(s)

print(f"{len(ident)} pixel-identiques, {len(differ)} diffèrent sur {len(ident)+len(differ)}")
for s in differ:
    a = json.loads((YESTERDAY / f"seed_{s}" / "analysis.json").read_text())
    b = json.loads((ROOT / f"seed_{s}" / "analysis.json").read_text())
    print(f"  {s}: w {a['used_w']:.3f} -> {b['used_w']:.3f}  "
          f"defect {a['defective']} -> {b['defective']}  {b['motif']}")
