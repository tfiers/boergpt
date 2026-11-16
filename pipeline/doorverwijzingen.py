# Schrijft public/_redirects: /pdf/<nr>.pdf haalt de pdf van de bron op via Netlify (proxy),
# zodat de pagina hem van haar eigen adres kan lezen en een pagina ervan kan tonen.
# Draai vanuit de map van de site, na ophalen.py: python3 pipeline/doorverwijzingen.py
import json
bronnen = json.load(open("data/bronnen.json"))
with open("public/_redirects", "w") as f:
    for i, b in enumerate(bronnen):
        f.write(f"/pdf/{i}.pdf  {b['url']}  200\n")
    f.write(f"/pdf/kalender.pdf  {json.load(open('data/uitrijkalender.json'))['url']}  200\n")
print(f"public/_redirects: {len(bronnen)} pdf's")
