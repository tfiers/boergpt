// Kijkt de opmaak na zoals een bezoeker hem ziet, op telefoon en laptop: geen tekstregel langer
// dan ± 75 tekens, en niets dat zijwaarts scrollt. Draai vóór elke deploy.
//   node test/opmaak.cjs [url]        (standaard: python3 -m http.server 8765 in public/)
const { chromium } = require("playwright");
const url = process.argv[2] || "http://127.0.0.1:8765/";
const MAX = 75;

(async () => {
  const b = await chromium.launch();
  let fout = 0;
  for (const pad of ["", "perceel.html"]) for (const [naam, w] of [["telefoon", 360], ["laptop", 1440]]) {
    const p = await b.newPage({ viewport: { width: w, height: 900 } });
    await p.goto(url + pad, { waitUntil: "networkidle" });
    await p.locator(".q").first().click().catch(() => {});
    const r = await p.evaluate(MAX => {
      // Tekens per regel: breedte van het blok gedeeld door de breedte van een gemiddeld teken.
      const meet = document.createElement("span");
      const lang = [...document.querySelectorAll("p, li")].filter(e => e.offsetParent && e.textContent.trim().length > MAX)
        .map(e => {
          meet.style.font = getComputedStyle(e).font; meet.textContent = "abcdefghijklmnopqrstuvwxyz ";
          document.body.append(meet); const teken = meet.getBoundingClientRect().width / 27; meet.remove();
          return { tekst: e.textContent.trim().slice(0, 50), tekens: Math.round(e.getBoundingClientRect().width / teken) };
        }).filter(x => x.tekens > MAX);
      return { lang, zijwaarts: document.documentElement.scrollWidth > innerWidth };
    }, MAX);
    for (const x of r.lang) console.log(`✗ ${pad || "index"} ${naam}: ${x.tekens} tekens per regel: "${x.tekst}…"`);
    if (r.zijwaarts) console.log(`✗ ${pad || "index"} ${naam}: de pagina scrollt zijwaarts`);
    fout += r.lang.length + r.zijwaarts;
    await p.close();
  }
  await b.close();
  console.log(fout ? `${fout} fouten in de opmaak` : "opmaak: ok");
  process.exit(fout ? 1 : 0);
})();
