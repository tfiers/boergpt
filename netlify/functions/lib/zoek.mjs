// Zoeken in de stukjes: op betekenis (vectoren van bge-m3) en op woorden (BM25),
// samengevoegd met reciprocal rank fusion. Zonder Cloudflare-sleutel zoekt het
// alleen op woorden, zodat de demo blijft werken.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Netlify zet data/ (netlify.toml included_files) naast de functie; lokaal is het de map van de site.
const MAP = [process.env.LAMBDA_TASK_ROOT, process.cwd()].filter(Boolean)
  .map(r => join(r, "data")).find(m => existsSync(join(m, "bronnen.json")));
export const lees = naam => readFileSync(join(MAP, naam));

export const bronnen = JSON.parse(lees("bronnen.json"));
export const stukjes = JSON.parse(lees("stukjes.json"));
// Een inhoudstafel ("7.1 Hoe ... ......... 12") zegt niets; die stukjes slaan we over.
const inhoudstafel = new Set(stukjes.filter(s => (s.tekst.match(/\.{6,}/g) || []).length >= 3).map(s => s.id));
const DIM = 1024;
// De vectoren (stukjes × 1024, ×127). Een meting kan een ander bestand kiezen (test/meet.mjs).
const vectorCache = new Map();
const vectorenUit = naam => {
  if (!vectorCache.has(naam)) { const ruw = lees(naam); vectorCache.set(naam, new Int8Array(ruw.buffer, ruw.byteOffset, ruw.length)); }
  return vectorCache.get(naam);
};

// --- BM25: woorden tellen ---------------------------------------------------
const woorden = t => t.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
  .match(/[a-z0-9]{2,}/g) || [];
const K1 = 1.2, B = 0.75;

// Eén index per manier van tellen: met of zonder de titel van het document bij elk stukje.
const indexCache = new Map();
function index(kop) {
  if (indexCache.has(kop)) return indexCache.get(kop);
  const telling = stukjes.map(s => {
    const m = new Map();
    const tekst = kop ? `${bronnen[s.bron].titel} ${s.tekst}` : s.tekst;
    for (const w of woorden(tekst)) m.set(w, (m.get(w) || 0) + 1);
    return m;
  });
  const lengte = telling.map(m => [...m.values()].reduce((a, b) => a + b, 0));
  const gemLengte = lengte.reduce((a, b) => a + b, 0) / lengte.length;
  const df = new Map();
  for (const m of telling) for (const w of m.keys()) df.set(w, (df.get(w) || 0) + 1);
  const ix = { telling, lengte, gemLengte, df };
  indexCache.set(kop, ix);
  return ix;
}

function bm25(vraag, mag, kop) {
  const { telling, lengte, gemLengte, df } = index(kop);
  const termen = [...new Set(woorden(vraag))];
  const scores = [];
  telling.forEach((m, i) => {
    if (!mag(i)) return;
    let s = 0;
    for (const w of termen) {
      const f = m.get(w);
      if (!f) continue;
      const idf = Math.log(1 + (stukjes.length - df.get(w) + 0.5) / (df.get(w) + 0.5));
      s += idf * f * (K1 + 1) / (f + K1 * (1 - B + B * lengte[i] / gemLengte));
    }
    if (s > 0) scores.push([i, s]);
  });
  return scores.sort((a, b) => b[1] - a[1]).slice(0, 40).map(x => x[0]);
}

// --- Vectoren: betekenis ----------------------------------------------------
async function vraagVector(vraag) {
  const { CLOUDFLARE_ACCOUNT_ID_FOR_BOERGPT: acc, CLOUDFLARE_AI_TOKEN_FOR_BOERGPT: token } = process.env;
  if (!acc || !token) return null;
  const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${acc}/ai/run/@cf/baai/bge-m3`, {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ text: [vraag] }), signal: AbortSignal.timeout(8000),
  }).catch(() => null);
  if (!r?.ok) return null;
  const v = (await r.json()).result?.data?.[0];
  if (!v) return null;
  const n = Math.hypot(...v);
  return v.map(x => x / n);
}

function dichtbij(v, mag, vectoren) {
  const scores = [];
  for (let i = 0; i < stukjes.length; i++) {
    if (!mag(i)) continue;
    let s = 0;
    for (let d = 0, o = i * DIM; d < DIM; d++) s += v[d] * vectoren[o + d];
    scores.push([i, s]);
  }
  return scores.sort((a, b) => b[1] - a[1]).slice(0, 40).map(x => x[0]);
}

// --- Samen ------------------------------------------------------------------
export const STAPELS = ["regels", "praktijk", "onderzoek", "subsidies", "wet"];
export const STANDAARD = { aantal: 6, kop: false, gewicht: 1, vectoren: "vectoren.i8" };

// `vector`: de vraagvector als die al bekend is, `false` om alleen op woorden te zoeken.
// `gewicht`: hoe zwaar de lijst op betekenis telt tegenover die op woorden.
export async function zoek(vraag, stapels = STAPELS, { vector, ...opties } = {}) {
  const { aantal, kop, gewicht, vectoren } = { ...STANDAARD, ...opties };
  const ok = new Set([].concat(stapels || []).filter(s => STAPELS.includes(s)));
  if (!ok.size) STAPELS.forEach(s => ok.add(s));
  const mag = i => !inhoudstafel.has(i) && ok.has(bronnen[stukjes[i].bron].stapel);
  const v = vector ?? await vraagVector(vraag);
  const lijsten = [[bm25(vraag, mag, kop), 1]];
  if (v) lijsten.push([dichtbij(v, mag, vectorenUit(vectoren)), gewicht]);
  const rrf = new Map();
  for (const [lijst, g] of lijsten) lijst.forEach((i, r) => rrf.set(i, (rrf.get(i) || 0) + g / (60 + r)));
  const top = [...rrf].sort((a, b) => b[1] - a[1]).slice(0, aantal).map(x => x[0]);
  return { manier: v ? "betekenis + woorden" : "alleen woorden", stukjes: top.map(i => stukjes[i]) };
}
