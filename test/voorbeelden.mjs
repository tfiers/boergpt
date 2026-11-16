// Vraagt de drie voorbeeldvragen van de pagina live aan beide modellen en bewaart de antwoorden
// in public/voorbeelden.json. De pagina toont ze meteen, met de vermelding dat ze bewaard zijn.
//   node test/voorbeelden.mjs [https://boergpt.netlify.app]
import { readFileSync, writeFileSync } from "node:fs";

const site = process.argv[2] || "https://boergpt.netlify.app";
const vragen = [...readFileSync("public/index.html", "utf8").matchAll(/<button type="button" class="vb">([^<]+)<\/button>/g)].map(m => m[1]);
const uit = { datum: new Date().toISOString().slice(0, 10) };

for (const vraag of vragen) {
  uit[vraag] = {};
  for (const model of ["open", "claude"]) {
    // Groq's gratis laag laat zo'n anderhalve vraag per minuut toe: bij "te druk" na een minuut opnieuw.
    for (let poging = 0; poging < 4; poging++) {
      const r = await fetch(`${site}/api/vraag`, { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ vraag, model }) });
      const d = await r.json();
      if (r.ok) { uit[vraag][model] = d; console.log(`✓ ${model}: ${vraag}`); break; }
      console.log(`  ${r.status} ${model}: ${d.fout}`);
      await new Promise(k => setTimeout(k, 60000));
    }
  }
}
writeFileSync("public/voorbeelden.json", JSON.stringify(uit));
console.log(`public/voorbeelden.json: ${vragen.length} vragen`);
