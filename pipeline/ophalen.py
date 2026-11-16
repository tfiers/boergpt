"""Stap 1: haal elke bron uit data/bronnen.json op als pdf in data/pdf/."""
import hashlib, json, pathlib, urllib.request

DATA = pathlib.Path(__file__).resolve().parent.parent / "data"

def bestandsnaam(url):
    return hashlib.sha1(url.encode()).hexdigest()[:12] + ".pdf"

def main():
    (DATA / "pdf").mkdir(exist_ok=True)
    for bron in json.loads((DATA / "bronnen.json").read_text()):
        doel = DATA / "pdf" / bestandsnaam(bron["url"])
        if doel.exists():
            continue
        req = urllib.request.Request(bron["url"], headers={"User-Agent": "Mozilla/5.0 (boergpt)"})
        try:
            inhoud = urllib.request.urlopen(req, timeout=180).read()
        except Exception as fout:
            print("NIET GELUKT", bron["url"], fout)
            continue
        if not inhoud.startswith(b"%PDF"):
            print("GEEN PDF", bron["url"])
            continue
        doel.write_bytes(inhoud)
        print(f"{len(inhoud)//1024:>6} kB  {bron['url']}")

if __name__ == "__main__":
    main()
