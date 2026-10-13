"""Synthèse des résultats Flashlight (var/perf/*.json), par itération, avec les définitions de
docs/performance.md : FPS médian, médian hors lancement (sans les 10 premières mesures de 500 ms,
soit 5 s), minimum hors lancement (le pire instant : arrivée des résultats, balayage), moyen, p5 (5e centile par rang inférieur : 2e plus faible sur 51 mesures), CPU moyen
(somme des threads), RAM moyenne."""
import json
import statistics
import sys


def p5(values):
    s = sorted(values)
    return s[max(0, int(len(s) * 0.05) - 1)]


for path in sys.argv[1:]:
    with open(path, encoding="utf-8") as f:
        d = json.load(f)
    print(f"== {d['name']}")
    for i, it in enumerate(d["iterations"], 1):
        ms = it["measures"]
        fps = [m["fps"] for m in ms]
        late = fps[10:] or fps
        cpu = [sum(m["cpu"]["perName"].values()) for m in ms]
        ram = [m["ram"] for m in ms]
        print(
            f"  {i}. {it['status']:7} {len(ms) / 2:5.1f} s  FPS médian {statistics.median(fps):4.1f}"
            f"  hors lancement {statistics.median(late):4.1f} (min {min(late):4.1f})  moyen {statistics.mean(fps):4.1f}"
            f"  p5 {p5(fps):4.1f}  CPU {statistics.mean(cpu):3.0f} %  RAM {statistics.mean(ram):3.0f} Mo"
        )
