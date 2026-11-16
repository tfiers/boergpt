// Het blinde oordeel van experts (public/oordeel.html), in twee stappen.
//
//   node test/oordeel.mjs maak <uitslag A> <uitslag B> [aantal]
//     Neemt uit twee metingen op de echte vragen (test/meet.mjs claude|open --deel echt) de eerste
//     <aantal> vragen (standaard 15) die beide beantwoordden, en schrijft beide antwoorden door elkaar
//     naar data/oordeel.json, zonder het model. Welk antwoord van welk model is, staat in
//     test/oordeel-sleutel.json.
//
//   OORDEEL_GEHEIM=... node test/oordeel.mjs link <naam> [site]
//     De persoonlijke link voor één expert (het geheim staat in de Netlify-omgeving en in Bitwarden).
//
//   node test/oordeel.mjs vergelijk [site]
//     Haalt alle oordelen op (/api/oordeel?alles) en zet ze naast de sleutel en het oordeel van
//     de rechter (test/rechter.mjs): per model hoe vaak het klopt, en hoe vaak mens en rechter het eens zijn.
import { readFileSync, writeFileSync } from "node:fs";

const [, , wat, ...rest] = process.argv;
const lees = p => JSON.parse(readFileSync(p, "utf8"));

// Een vaste volgorde die toch door elkaar staat: zo is de ronde elke keer dezelfde.
function schud(lijst, zaad = 7) {
  const a = [...lijst];
  for (let i = a.length - 1; i > 0; i--) {
    zaad = (zaad * 1103515245 + 12345) % 2 ** 31;
    const j = zaad % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

if (wat === "maak") {
  const [pa, pb, aantal = 15] = rest;
  const [a, b] = [lees(pa), lees(pb)];
  const naam = u => u.model || u.wat;
  const vragen = lees("test/vragen.json");
  const goed = x => x?.antwoord && !x.fout;
  const nrs = a.r.filter(x => goed(x) && goed(b.r.find(y => y.nr === x.nr)) && vragen.find(v => v.nr === x.nr)?.bron)
    .slice(0, Number(aantal)).map(x => x.nr);
  const items = [], sleutel = {};
  for (const nr of nrs) for (const [u, model] of [[a, naam(a)], [b, naam(b)]]) {
    const x = u.r.find(y => y.nr === nr), v = vragen.find(y => y.nr === nr);
    items.push({ nr, model, rechter: x.rechter || null, vraag: x.vraag, antwoord: x.antwoord, bronnen: x.bronnen, kalender: x.kalender || null,
      herkomst: v.herkomst?.wie || null });
  }
  // Na het schudden krijgt elk antwoord een nummer dat niets over het model zegt.
  const ronde = { ronde: new Date().toISOString().slice(0, 10), items: schud(items).map(({ nr, model, rechter, ...item }, i) => {
    sleutel[`a${i + 1}`] = { nr, model, rechter };
    return { id: `a${i + 1}`, ...item };
  }) };
  writeFileSync("data/oordeel.json", JSON.stringify(ronde, null, 1));
  writeFileSync("test/oordeel-sleutel.json", JSON.stringify(sleutel, null, 1));
  console.log(`${items.length} antwoorden op ${nrs.length} vragen → data/oordeel.json (ronde ${ronde.ronde})`);
} else if (wat === "link") {
  const { sleutelVoor } = await import("../netlify/functions/oordeel.mjs");
  const [naam, site = "https://boergpt.netlify.app"] = rest;
  if (!process.env.OORDEEL_GEHEIM || !/^[a-z0-9-]{2,30}$/.test(naam || "")) throw new Error("Gebruik: OORDEEL_GEHEIM=... node test/oordeel.mjs link <naam in kleine letters>");
  console.log(`${site}/oordeel.html?wie=${naam}&sleutel=${sleutelVoor(naam)}`);
} else if (wat === "vergelijk") {
  const site = rest[0] || "https://boergpt.netlify.app";
  const sleutel = lees("test/oordeel-sleutel.json");
  const { oordelen } = await (await fetch(`${site}/api/oordeel?alles`)).json();
  const per = {};
  let eens = 0, samen = 0;
  for (const o of oordelen) {
    const s = sleutel[o.item];
    if (!s || o.klopt === "weet niet") continue;
    const m = (per[s.model] ??= { ja: 0, half: 0, nee: 0 });
    m[o.klopt]++;
    if (s.rechter?.klopt) { samen++; if (s.rechter.klopt === o.klopt) eens++; }
  }
  for (const [model, m] of Object.entries(per)) {
    const n = m.ja + m.half + m.nee;
    console.log(`${model}: klopt ${m.ja}/${n}, half ${m.half}, nee ${m.nee} (volgens de experts)`);
  }
  console.log(`Mens en rechter eens over "klopt": ${eens}/${samen}`);
  console.log(`Aantal experts: ${new Set(oordelen.map(o => o.door)).size}`);
} else {
  console.log("Gebruik: node test/oordeel.mjs maak <uitslag A> <uitslag B> [aantal] | link <naam> | vergelijk [site]");
}
