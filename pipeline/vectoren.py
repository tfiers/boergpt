"""Stap 3: zet elk stukje om in een vector met het open model bge-m3.

Stukjes over hetzelfde onderwerp krijgen vectoren die dicht bij elkaar liggen,
ook als ze andere woorden gebruiken ("drijfmest" en "dierlijke mest").
De demo vergelijkt de vector van een vraag met deze vectoren.

  python pipeline/vectoren.py           alle stukjes → data/vectoren.i8 (± 75 min op een cpu)
  python pipeline/vectoren.py --vragen  de testvragen → test/vraagvectoren.json (± 1 min)

De vectoren worden als gehele getallen van -127 tot 127 bewaard: vier keer
kleiner dan gewone getallen, en het zoeken vindt nagenoeg dezelfde stukjes.
"""
import json, pathlib, sys
import numpy as np
from sentence_transformers import SentenceTransformer

MAP = pathlib.Path(__file__).resolve().parent.parent
DATA = MAP / "data"

def model():
    m = SentenceTransformer("BAAI/bge-m3")
    m.max_seq_length = 512
    return m

def main():
    if "--vragen" in sys.argv:
        vragen = [v["vraag"] for v in json.loads((MAP / "test/vragen.json").read_text())]
        v = model().encode(vragen, normalize_embeddings=True)
        uit = {q: [round(float(x), 5) for x in vec] for q, vec in zip(vragen, v)}
        (MAP / "test/vraagvectoren.json").write_text(json.dumps(uit))
        return
    stukjes = json.loads((DATA / "stukjes.json").read_text())
    v = model().encode([s["tekst"] for s in stukjes], batch_size=16,
                       normalize_embeddings=True, show_progress_bar=True)
    np.clip(np.round(v * 127), -127, 127).astype(np.int8).tofile(DATA / "vectoren.i8")
    print(v.shape)

if __name__ == "__main__":
    main()
