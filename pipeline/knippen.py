"""Stap 2: knip elke pdf in stukjes van ± 1000 tekens, met bron en pagina erbij.

Een stukje begint en eindigt op een alinea of zin, en overlapt een beetje met
het vorige, zodat een zin die over de grens loopt in beide staat.
"""
import hashlib, json, pathlib, re
import pymupdf

DATA = pathlib.Path(__file__).resolve().parent.parent / "data"
GROOTTE, OVERLAP = 1000, 150

def pdf_van(url):
    return DATA / "pdf" / (hashlib.sha1(url.encode()).hexdigest()[:12] + ".pdf")

def schoon(tekst):
    tekst = re.sub(r"/{5,}|Lorem ipsum.*?magna aliqua", " ", tekst, flags=re.S)
    tekst = re.sub(r"-\n(?=[a-zà-ÿ])", "", tekst)          # afgebroken woorden
    tekst = re.sub(r"[ \t ]+", " ", tekst)
    return re.sub(r"\n\s*\n+", "\n\n", tekst).strip()

def stukjes(tekst):
    """Knip op alinea's; een te lange alinea op zinnen."""
    delen = []
    for alinea in tekst.split("\n\n"):
        alinea = " ".join(alinea.split())
        if len(alinea) <= GROOTTE:
            delen.append(alinea)
        else:
            delen += re.split(r"(?<=[.!?;])\s+", alinea)
    huidig = ""
    for deel in delen:
        if huidig and len(huidig) + len(deel) > GROOTTE:
            yield huidig
            huidig = huidig[-OVERLAP:].split(" ", 1)[-1] + " " + deel
        else:
            huidig = (huidig + "\n" + deel).strip()
    if len(huidig) > 80:
        yield huidig

def main():
    uit = []
    for nr, bron in enumerate(json.loads((DATA / "bronnen.json").read_text())):
        doc = pymupdf.open(pdf_van(bron["url"]))
        for pagina in range(len(doc)):
            for tekst in stukjes(schoon(doc[pagina].get_text())):
                if len(re.findall(r"[a-zA-Zà-ÿ]{3,}", tekst)) < 12:   # tabelresten, paginanummers
                    continue
                uit.append({"id": len(uit), "bron": nr, "pagina": pagina + 1, "tekst": tekst})
    (DATA / "stukjes.json").write_text(json.dumps(uit, ensure_ascii=False))
    print(len(uit), "stukjes,", sum(len(s["tekst"]) for s in uit) // 1000, "k tekens")

if __name__ == "__main__":
    main()
