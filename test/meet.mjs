// Meet hoe goed BoerGPT is, op de vragen in test/vragen.json.
//   node test/meet.mjs zoek            alleen het zoeken: zit de juiste bron bij de 6 stukjes?
//   node test/meet.mjs open|claude     de hele agent: juiste bron, antwoord klopt, "weet ik niet"
// Voeg --deel apart toe om de apart gehouden vragen te meten (alleen op het einde, één keer),
// of --deel echt voor de vragen die echte boeren en adviseurs stelden.
// Voeg --alleen-woorden toe om zonder zoeken op betekenis te meten.
// Voeg --opties '{"aantal":8,"kop":true}' toe om een andere instelling van het zoeken
// te meten (zie STANDAARD in netlify/functions/lib/zoek.mjs).
// Voeg --max 5 toe om alleen de eerste 5 vragen te meten (een snelle proef).
// OPEN_VIA=groq of cloudflare kiest de aanbieder van het open model (zie agent.mjs).
// Draai vanuit de map van de site. De uitslag komt in test/uitslag-<wat>.json.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { bronnen, stukjes, zoek, STAPELS, STANDAARD } from "../netlify/functions/lib/zoek.mjs";

const wat = process.argv[2];
const deel = process.argv.includes("--deel") ? process.argv[process.argv.indexOf("--deel") + 1] : "oefen";
const max = process.argv.includes("--max") ? Number(process.argv[process.argv.indexOf("--max") + 1]) : Infinity;
const vragen = JSON.parse(readFileSync("test/vragen.json", "utf8")).filter(v => v.deel === deel).slice(0, max);
// Vraagvectoren die vooraf met bge-m3 berekend zijn (pipeline/vectoren.py --vragen); zo meet het zoeken
// op betekenis ook zonder Cloudflare-sleutel.
// Met --alleen-woorden meet je het zoeken zonder vectoren, om het verschil te zien.
const woorden = process.argv.includes("--alleen-woorden");
const i = process.argv.indexOf("--opties");
const opties = i > 0 ? JSON.parse(process.argv[i + 1]) : {};
const vv = existsSync("test/vraagvectoren.json") ? JSON.parse(readFileSync("test/vraagvectoren.json", "utf8")) : {};
// "Weet ik niet" telt alleen als het antwoord ermee begint: een antwoord dat zegt dat één detail
// ontbreekt ("de termijn staat niet in mijn documenten"), geeft wel een antwoord.
const WEET_NIET = /^[^.]*(staat niet in mijn documenten|not in my documents)/i;
// "bron" is de titel van het juiste document, zoals in data/bronnen.json, of een lijst
// titels als het antwoord in meer dan één document staat.
const isBron = (b, bron) => [].concat(bron).includes(b.titel);
const pct = (n, d) => d ? `${n}/${d} (${Math.round(100 * n / d)}%)` : "–";

async function meetZoek() {
  const r = [];
  for (const v of vragen.filter(v => v.bron && v.bron !== "kalender")) {
    const { manier, stukjes: top } = await zoek(v.vraag, STAPELS, { ...opties, vector: woorden ? false : vv[v.vraag] });
    const plaats = top.findIndex(s => isBron(bronnen[s.bron], v.bron)) + 1;
    r.push({ nr: v.nr, vraag: v.vraag, manier, raak: plaats > 0, plaats: plaats || null });
  }
  const raak = r.filter(x => x.raak).length;
  const n = { ...STANDAARD, ...opties }.aantal;
  return { r, samen: {
    [`juiste bron bij de ${n} stukjes`]: pct(raak, r.length),
    "juiste bron bovenaan": pct(r.filter(x => x.plaats === 1).length, r.length),
    // Gemiddelde van 1/plaats (1 = altijd bovenaan, 0 = nooit gevonden): ziet ook kleine verschuivingen.
    "MRR": Math.round(1000 * r.reduce((s, x) => s + (x.plaats ? 1 / x.plaats : 0), 0) / r.length) / 1000,
    manier: r[0]?.manier, opties,
  } };
}

// Per vraag gemiddeld: tokens in en uit, modelaanroepen en seconden.
const gemiddeld = rs => {
  const g = f => rs.length ? Math.round(rs.reduce((s, x) => s + f(x), 0) / rs.length * 10) / 10 : 0;
  return { "tokens in": g(x => x.gebruik.in), "tokens uit": g(x => x.gebruik.uit),
    "modelaanroepen": g(x => x.gebruik.aanroepen), "seconden": g(x => x.ms / 1000) };
};

async function meetAgent(model) {
  const { vraagAan } = await import("../netlify/functions/lib/agent.mjs");
  const r = [];
  for (const v of vragen) {
    let a; const t0 = Date.now();
    try { a = await vraagAan(model, v.vraag); } catch (e) { r.push({ nr: v.nr, vraag: v.vraag, fout: String(e.message).slice(0, 200) }); continue; }
    const zegtWeetNiet = WEET_NIET.test(a.antwoord);
    const rij = { nr: v.nr, vraag: v.vraag, antwoord: a.antwoord, stappen: a.stappen.length, gebruik: a.gebruik, ms: Date.now() - t0 };
    if (v.bron) {
      rij.bron = v.bron === "kalender" ? !!a.kalender : a.bronnen.some(b => isBron(b, v.bron));
      // NFKC maakt van een smalle harde spatie ("60\u202f%") een gewone, zoals de sleutels verwachten.
      rij.klopt = new RegExp(v.sleutel, "i").test(a.antwoord.normalize("NFKC")) && !zegtWeetNiet;
    } else {
      rij.weetNiet = zegtWeetNiet;
    }
    r.push(rij);
    process.stdout.write(".");
  }
  console.log();
  const met = r.filter(x => "bron" in x), zonder = r.filter(x => "weetNiet" in x);
  return { r, samen: {
    "juiste bron geciteerd": pct(met.filter(x => x.bron).length, met.length),
    "antwoord klopt": pct(met.filter(x => x.klopt).length, met.length),
    "zegt eerlijk 'weet ik niet'": pct(zonder.filter(x => x.weetNiet).length, zonder.length),
    "fouten": r.filter(x => x.fout).length,
    ...gemiddeld(r.filter(x => x.gebruik)),
  } };
}

if (!["zoek", "open", "claude"].includes(wat)) { console.log("Gebruik: node test/meet.mjs zoek|open|claude [--deel oefen|apart|echt]"); process.exit(1); }
const uit = wat === "zoek" ? await meetZoek() : await meetAgent(wat);
uit.wat = wat; uit.deel = deel; uit.model = process.env.OPEN_VIA ? `${process.env.OPEN_VIA}:${process.env.OPEN_MODEL || "gpt-oss-120b"}` : undefined; uit.datum = new Date().toISOString().slice(0, 10); uit.stukjes = stukjes.length;
writeFileSync(`test/uitslag-${wat}${deel === "oefen" ? "" : `-${deel}`}${woorden ? "-woorden" : ""}.json`, JSON.stringify(uit, null, 1));
for (const x of uit.r) if (x.raak === false || x.bron === false || x.klopt === false || x.weetNiet === false || x.fout)
  console.log(`  ✗ ${x.nr}. ${x.vraag}${x.fout ? `  (${x.fout})` : ""}`);
console.log(uit.samen);
