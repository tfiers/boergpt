"""Stap 3: zet elk stukje om in een vector met het open model bge-m3.

Stukjes over hetzelfde onderwerp krijgen vectoren die dicht bij elkaar liggen,
ook als ze andere woorden gebruiken ("drijfmest" en "dierlijke mest").
De demo vergelijkt de vector van een vraag met deze vectoren.

  python pipeline/vectoren.py           alle stukjes → data/vectoren.i8 (± 75 min op een cpu)
  python pipeline/vectoren.py --vragen  de testvragen → test/vraagvectoren.json (± 1 min)
  python pipeline/vectoren.py --map M   de stukjes in M/stukjes.json → M/vectoren.i8

Het werk wordt per 640 stukjes bewaard (vectoren.i8.deel), zodat een onderbroken run verder kan.

De vectoren worden als gehele getallen van -127 tot 127 bewaard: vier keer
kleiner dan gewone getallen, en het zoeken vindt nagenoeg dezelfde stukjes.
"""
import json, os, pathlib, sys
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
    map_ = pathlib.Path(sys.argv[sys.argv.index("--map") + 1]) if "--map" in sys.argv else DATA
    teksten = [s["tekst"] for s in json.loads((map_ / "stukjes.json").read_text())]
    deel = map_ / "vectoren.i8.deel"
    klaar = deel.stat().st_size // 1024 if deel.exists() else 0
    m = model()
    for begin in range(klaar, len(teksten), 640):
        v = m.encode(teksten[begin:begin + 640], batch_size=16, normalize_embeddings=True)
        with open(deel, "ab") as f:
            f.write(np.clip(np.round(v * 127), -127, 127).astype(np.int8).tobytes())
        print(f"{min(begin + 640, len(teksten))}/{len(teksten)}", flush=True)
    os.replace(deel, map_ / "vectoren.i8")

if __name__ == "__main__":
    main()
