"""Hoe zeker zijn de cijfers? Op de bewaarde metingen, zonder nieuwe modelaanroepen.

  python3 test/statistiek.py metingen/oefen-*.json

- Wilson-interval (95%) rond "klopt volgens de sleutel": met 41 vragen is één vraag 2,4 punten.
- McNemar (exact, tweezijdig) per paar modellen op dezelfde vragen: telt alleen de vragen waar
  ze verschillen, zodat een gemakkelijke vraag die beide goed hebben niets bewijst.
  Met veel paren is p < 0,05 vaak toeval; de Holm-correctie houdt de kans op één vals verschil
  over alle paren samen onder 5%.
- Overeenkomst tussen rechter en sleutel (Cohen's kappa), op de rijen die beide hebben, en tussen
  twee rechters waar een tweede oordeelde (veld "rechter:<model>", test/rechter.mjs).
Elk bestand heet naar zijn naam (oefen-claude-2.json: claude-2), zodat herhaalde metingen naast
elkaar staan.
"""
import json
import sys
from pathlib import Path
from itertools import combinations
from math import comb, sqrt

Z = 1.96


def wilson(k, n):
    if not n:
        return (0, 0)
    p = k / n
    mid = (p + Z * Z / (2 * n)) / (1 + Z * Z / n)
    half = Z * sqrt(p * (1 - p) / n + Z * Z / (4 * n * n)) / (1 + Z * Z / n)
    return (100 * (mid - half), 100 * (mid + half))


def mcnemar(b, c):
    """Exacte p-waarde: kans op zo'n scheve verdeling van b + c verschillen als beide even goed zijn."""
    n = b + c
    if not n:
        return 1.0
    staart = sum(comb(n, i) for i in range(min(b, c) + 1)) / 2 ** n
    return min(1.0, 2 * staart)


def kappa(paren):
    n = len(paren)
    if not n:
        return None
    eens = sum(a == b for a, b in paren) / n
    pa = sum(a for a, _ in paren) / n
    pb = sum(b for _, b in paren) / n
    kans = pa * pb + (1 - pa) * (1 - pb)
    return (eens - kans) / (1 - kans) if kans < 1 else 1.0


def holm(ps):
    """Holm-gecorrigeerde p-waarden, in dezelfde volgorde."""
    orde = sorted(range(len(ps)), key=lambda i: ps[i])
    uit, hoogste = [0.0] * len(ps), 0.0
    for rang, i in enumerate(orde):
        hoogste = max(hoogste, min(1.0, (len(ps) - rang) * ps[i]))
        uit[i] = hoogste
    return uit


def ja(oordeel):
    return oordeel["klopt"] == "ja"


def main(paden):
    modellen = {}
    for pad in paden:
        u = json.load(open(pad))
        rijen = {x["nr"]: x for x in u["r"] if "klopt" in x and not x.get("fout")}
        modellen[Path(pad).stem.split("-", 1)[1]] = rijen

    print("| model | klopt | 95%-interval | rechter en sleutel eens | kappa |")
    print("|---|---|---|---|---|")
    for m, r in sorted(modellen.items(), key=lambda kv: -sum(x["klopt"] for x in kv[1].values())):
        k, n = sum(x["klopt"] for x in r.values()), len(r)
        lo, hi = wilson(k, n)
        paren = [(x["klopt"], ja(x["rechter"])) for x in r.values() if x.get("rechter", {}).get("klopt")]
        ka = kappa(paren)
        eens = sum(a == b for a, b in paren)
        print(f"| {m} | {k}/{n} ({100 * k / n:.0f}%) | {lo:.0f}–{hi:.0f}% | {eens}/{len(paren)} | "
              f"{'–' if ka is None else f'{ka:.2f}'} |")

    tweede = sorted({k for r in modellen.values() for x in r.values() for k in x if k.startswith("rechter:")})
    for veld in tweede:
        print(f"\nTwee rechters eens (klopt = ja): standaardrechter en {veld[8:]}\n")
        print("| model | eens | kappa |")
        print("|---|---|---|")
        for m, r in modellen.items():
            paren = [(ja(x["rechter"]), ja(x[veld])) for x in r.values()
                     if x.get("rechter", {}).get("klopt") and x.get(veld, {}).get("klopt")]
            if paren:
                ka = kappa(paren)
                print(f"| {m} | {sum(a == b for a, b in paren)}/{len(paren)} | {ka:.2f} |")

    print("\nMcNemar per paar (vragen die beide hebben; b = alleen de eerste klopt, c = alleen de tweede):\n")
    print("| paar | b | c | p | p (Holm) |")
    print("|---|---|---|---|---|")
    rijen = []
    for (m1, r1), (m2, r2) in combinations(modellen.items(), 2):
        samen = r1.keys() & r2.keys()
        b = sum(r1[i]["klopt"] and not r2[i]["klopt"] for i in samen)
        c = sum(r2[i]["klopt"] and not r1[i]["klopt"] for i in samen)
        rijen.append((m1, m2, b, c, mcnemar(b, c)))
    for (m1, m2, b, c, p), ph in zip(rijen, holm([x[4] for x in rijen])):
        print(f"| {m1} – {m2} | {b} | {c} | {p:.3f} | {ph:.3f}{' *' if ph < 0.05 else ''} |")


if __name__ == "__main__":
    main(sys.argv[1:])
