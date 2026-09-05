"""P3 (plan PERF-UX §1) — journée de mesure : analyse des dumps d'évènements
moteur (BENCH_DUMP_EVENTS) pour choisir la constante d'arrêt par itérations.

Règle proposée par le plan : un walk s'arrête après
    max(15, k × it_dernière_amélioration) itérations sans amélioration
ET ≥ 3 s. La valeur de k (et du plancher) revient au propriétaire : ce
script mesure, par cas × espacement × walk :

- la trajectoire des améliorations (itération, coût) et les GAPS entre
  améliorations ;
- pour k ∈ {1, 2, 3, 5, 8} (plancher 15) : où la règle aurait arrêté le
  walk, combien d'itérations économisées, et la QUALITÉ PERDUE
  (coût à l'arrêt vs coût final — bins et remnant) ;
- le rythme it/s (heartbeats) pour traduire en temps.

Usage (dans le conteneur worker, montages faits) :
    python bench/measure_p3.py /dump/events-*.ndjson [--floor 15]
Écrit un rapport markdown sur stdout.
"""
import glob
import json
import sys
from collections import defaultdict

FLOOR = 15
KS = [1, 2, 3, 5, 8]


def load(paths):
    walks = defaultdict(lambda: {"improvements": [], "heartbeats": []})
    for path in paths:
        with open(path, encoding="utf-8") as f:
            for line in f:
                try:
                    rec = json.loads(line)
                except json.JSONDecodeError:
                    continue
                ev = rec.get("line") or {}
                job = rec.get("job") or "?"
                w = ev.get("worker")
                if w is None:
                    continue
                key = (job, w)
                if ev.get("type") == "progress" and ev.get("stage") == "bpp-search":
                    it = ev.get("iters")
                    if it is None:
                        continue
                    walks[key]["improvements"].append({
                        "it": it,
                        "t": ev.get("elapsed_sec", 0),
                        "bins": ev.get("bins"),
                        "bin_cost": ev.get("bin_cost"),
                        "unplaced": ev.get("unplaced"),
                    })
                elif ev.get("type") == "heartbeat" and ev.get("stage") == "bpp-search":
                    walks[key]["heartbeats"].append({
                        "it": ev.get("iterations", 0),
                        "t": ev.get("elapsed_sec", 0),
                    })
    for v in walks.values():
        v["improvements"].sort(key=lambda e: e["it"])
        v["heartbeats"].sort(key=lambda e: e["it"])
    return walks


def simulate(improvements, k, floor):
    """Où la règle « max(floor, k×it_dernière_amélioration) sans amélioration »
    arrête le walk : renvoie (index de la dernière amélioration CONSERVÉE,
    itération d'arrêt). L'horloge d'itérations est celle des améliorations
    elles-mêmes (entre deux améliorations on ne sait rien — l'arrêt tombe
    dans le gap)."""
    if not improvements:
        return None, None
    last_it = improvements[0]["it"]
    for i in range(1, len(improvements)):
        it = improvements[i]["it"]
        patience = max(floor, k * last_it)
        if it - last_it >= patience:
            # arrêt dans le gap AVANT cette amélioration
            return i - 1, last_it + patience
        last_it = it
    total = improvements[-1]["it"]
    patience = max(floor, k * last_it)
    if total - last_it >= patience:
        return len(improvements) - 1, last_it + patience
    return len(improvements) - 1, None  # pas d'arrêt avant la fin observée


def cost_key(e):
    return (e.get("unplaced") or 0, e.get("bin_cost") or 0)


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    floor = FLOOR
    for a in sys.argv[1:]:
        if a.startswith("--floor="):
            floor = int(a.split("=")[1])
    paths = []
    for pat in args:
        paths.extend(glob.glob(pat))
    walks = load(paths)
    if not walks:
        print("aucun évènement — vérifier BENCH_DUMP_EVENTS / les chemins")
        return

    print(f"# Mesure P3 — {len(walks)} walks, plancher {floor}\n")
    print("## Par walk : dernière amélioration, gaps, rythme\n")
    print("| job | walk | améliorations | it. dernière | gap max avant fin | it/s | it. totales (hb) |")
    print("|---|---|---|---|---|---|---|")
    for (job, w), v in sorted(walks.items()):
        imps = v["improvements"]
        hbs = v["heartbeats"]
        if not imps:
            continue
        gaps = [b["it"] - a["it"] for a, b in zip(imps, imps[1:])]
        max_gap = max(gaps) if gaps else 0
        itps = 0
        if len(hbs) >= 2 and hbs[-1]["t"] > hbs[0]["t"]:
            itps = (hbs[-1]["it"] - hbs[0]["it"]) / (hbs[-1]["t"] - hbs[0]["t"])
        total_it = hbs[-1]["it"] if hbs else imps[-1]["it"]
        print(f"| {job} | {w} | {len(imps)} | {imps[-1]['it']} | {max_gap} | "
              f"{itps:.1f} | {total_it} |")

    print("\n## Simulation de la règle pour k ∈ " + str(KS) + f" (plancher {floor})\n")
    print("| k | walks arrêtés avant la fin | qualité perdue (walks) | pire cas | itérations économisées (médiane) |")
    print("|---|---|---|---|---|")
    for k in KS:
        stopped = 0
        lost = 0
        worst = ""
        saved = []
        for (job, w), v in sorted(walks.items()):
            imps = v["improvements"]
            hbs = v["heartbeats"]
            if not imps:
                continue
            idx, stop_it = simulate(imps, k, floor)
            final = imps[-1]
            total_it = hbs[-1]["it"] if hbs else final["it"]
            if stop_it is not None:
                stopped += 1
                saved.append(max(0, total_it - stop_it))
                at_stop = imps[idx]
                if cost_key(at_stop) > cost_key(final):
                    lost += 1
                    worst = f"{job}/w{w}: stop bin_cost {at_stop.get('bin_cost')} → final {final.get('bin_cost')}"
        med = sorted(saved)[len(saved) // 2] if saved else 0
        print(f"| {k} | {stopped}/{len(walks)} | {lost} | {worst or '—'} | {med} |")


def job_level(walks, ks, floor):
    """NIVEAU JOB — le résultat exporté est le MEILLEUR des walks : simule
    l'arrêt sur tous les walks d'un job et compare le meilleur conservé au
    meilleur réel. C'est le chiffre qui compte pour la décision."""
    jobs = defaultdict(list)
    for (job, w), v in walks.items():
        if v["improvements"]:
            jobs[job].append((w, v))

    def ckey(e):
        return (e.get("unplaced") or 0, e.get("bin_cost") or 0, -(e.get("bins") or 0))

    print()
    print("## NIVEAU JOB (le résultat = meilleur des walks)")
    print("| k | jobs | jobs perdant (bins) | jobs perdant (unplaced) | détail pire |")
    print("|---|---|---|---|---|")
    for k in ks:
        lost_bins = lost_unp = 0
        worst = "—"
        for job, wl in jobs.items():
            final_best = min((v["improvements"][-1] for _w, v in wl), key=ckey)
            stopped_best = final_best
            for _w, v in wl:
                idx, _stop = simulate(v["improvements"], k, floor)
                if idx is not None:
                    cand = v["improvements"][idx]
                    if ckey(cand) < ckey(stopped_best):
                        stopped_best = cand
            if stopped_best.get("bin_cost") != final_best.get("bin_cost"):
                lost_bins += 1
                worst = (f"{job[:28]}: stop {stopped_best.get('bin_cost')}"
                         f" → final {final_best.get('bin_cost')}")
            if (stopped_best.get("unplaced") or 0) > (final_best.get("unplaced") or 0):
                lost_unp += 1
        print(f"| {k} | {len(jobs)} | {lost_bins} | {lost_unp} | {worst} |")


if __name__ == "__main__":
    _paths = []
    _floor = FLOOR
    for a in sys.argv[1:]:
        if a.startswith("--floor="):
            _floor = int(a.split("=")[1])
        else:
            _paths.append(a)
    _all = []
    for _pat in _paths:
        _all.extend(glob.glob(_pat))
    _walks = load(_all)
    main()
    job_level(_walks, KS, _floor)
