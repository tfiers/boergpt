"""Meet wat een herrangschikker (reranker) toevoegt aan het zoeken.

Een herrangschikker leest vraag en stukje samen en geeft een nauwkeurige score, maar is te
traag om alle 5.039 stukjes te lezen. Dus: eerst de 30 beste kandidaten zoeken zoals de demo
dat doet, dan die 30 opnieuw sorteren, en kijken of het juiste document vaker bij de 6 zit.

  node test/meet.mjs zoek --deel oefen --opties '{"aantal":30,"herrangschik":false}'
  python test/herrangschik.py test/uitslag-zoek.json [model]

Standaardmodel: BAAI/bge-reranker-v2-m3 (open, meertalig, ± 2 GB).
"""
import json, pathlib, sys, time
from sentence_transformers import CrossEncoder

MAP = pathlib.Path(__file__).resolve().parent.parent
uitslag = json.loads(pathlib.Path(sys.argv[1]).read_text())
naam = sys.argv[2] if len(sys.argv) > 2 else "BAAI/bge-reranker-v2-m3"
stukjes = json.loads((MAP / "data/stukjes.json").read_text())
bronnen = json.loads((MAP / "data/bronnen.json").read_text())
model = CrossEncoder(naam, max_length=512)

def plaats(ids, bron):
    titels = [bron] if isinstance(bron, str) else bron
    for i, s in enumerate(ids[:6]):
        if bronnen[stukjes[s]["bron"]]["titel"] in titels:
            return i + 1
    return None

voor, na, t0 = [], [], time.time()
for r in uitslag["r"]:
    ids = r["stukjes"]
    scores = model.predict([(r["vraag"], stukjes[s]["tekst"]) for s in ids], batch_size=8)
    nieuw = [s for _, s in sorted(zip(scores, ids), key=lambda x: -x[0])]
    voor.append(plaats(ids, r["bron"])); na.append(plaats(nieuw, r["bron"]))
    if voor[-1] != na[-1]:
        print(f"  {voor[-1] or '–'} → {na[-1] or '–'}  {r['vraag']}")

def samen(p):
    n = len(p)
    return {"bij de 6": f"{sum(x is not None for x in p)}/{n}", "bovenaan": f"{sum(x == 1 for x in p)}/{n}",
            "MRR": round(sum(1 / x for x in p if x) / n, 3)}
print(json.dumps({"deel": uitslag["deel"], "model": naam, "zonder": samen(voor), "met": samen(na),
                  "seconden per vraag": round((time.time() - t0) / len(voor), 1)}, ensure_ascii=False))
