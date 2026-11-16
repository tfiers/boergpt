// Het blinde oordeel van experts (public/oordeel.html). De antwoorden staan in data/oordeel.json,
// zonder het model dat ze schreef. Elk oordeel wordt bewaard in Netlify Blobs onder de naam van de
// expert, zodat die kan stoppen en later verdergaan.
//
// Elke expert krijgt een eigen link met een sleutel: ?wie=wannes&sleutel=... (node test/oordeel.mjs
// link wannes). De sleutel is een HMAC van de naam met het geheim OORDEEL_GEHEIM (Netlify-omgeving):
// zonder dat geheim kan niemand oordelen namens een ander, of een nieuwe naam verzinnen.
//   GET  /api/oordeel?wie=naam&sleutel=s   de antwoorden en wat die persoon al oordeelde
//   GET  /api/oordeel?alles                alle oordelen, zonder naam en opmerking (voor test/oordeel.mjs vergelijk)
//   POST /api/oordeel {wie, sleutel, item, klopt, bron, opmerking}
import { createHmac, timingSafeEqual } from "node:crypto";
import { lees } from "./lib/zoek.mjs";
import { json, opslag } from "./lib/budget.mjs";

const KLOPT = ["ja", "half", "nee", "weet niet"], BRON = ["ja", "deels", "nee", "weet niet"];

export const sleutelVoor = (wie, geheim = process.env.OORDEEL_GEHEIM) =>
  createHmac("sha256", geheim).update(`oordeel ${wie}`).digest("hex").slice(0, 24);

function echt(wie, sleutel) {
  if (!process.env.OORDEEL_GEHEIM || typeof wie !== "string" || !/^[a-z0-9-]{2,30}$/.test(wie) || typeof sleutel !== "string") return false;
  const a = Buffer.from(sleutelVoor(wie)), b = Buffer.from(sleutel);
  return a.length === b.length && timingSafeEqual(a, b);
}

// Pas bij de eerste vraag gelezen: zonder ronde antwoordt de functie netjes in plaats van te crashen.
let ronde;
function laadRonde() {
  try { ronde ??= JSON.parse(lees("oordeel.json")); } catch { return null; }
  return ronde;
}

export default async req => {
  const r = laadRonde();
  if (!r) return json({ fout: "Er loopt nu geen ronde." }, 503);
  const store = opslag.open(`oordeel-${r.ronde}`);
  const url = new URL(req.url);
  if (req.method === "GET") {
    if (url.searchParams.has("alles")) {
      // Openbaar, maar zonder naam en opmerking: per expert alleen een volgnummer.
      const { blobs } = await store.list();
      const oordelen = await Promise.all(blobs.map(b => store.get(b.key, { type: "json" })));
      const nummer = [...new Set(oordelen.map(o => o.wie))];
      return json({ ronde: r.ronde, oordelen: oordelen.map(({ opmerking, wie, ...o }) => ({ ...o, door: nummer.indexOf(wie) + 1 })) });
    }
    const wie = url.searchParams.get("wie");
    if (!echt(wie, url.searchParams.get("sleutel"))) return json({ fout: "Open de link die je kreeg: hij bevat je naam en je sleutel." }, 403);
    const { blobs } = await store.list({ prefix: `${wie}/` });
    return json({ ...r, oordelen: await Promise.all(blobs.map(b => store.get(b.key, { type: "json" }))) });
  }
  if (req.method !== "POST") return json({ fout: "Alleen GET of POST." }, 405);
  let o;
  try { o = await req.json(); } catch { return json({ fout: "Geen geldige JSON." }, 400); }
  if (!o || !echt(o.wie, o.sleutel)) return json({ fout: "Open de link die je kreeg: hij bevat je naam en je sleutel." }, 403);
  if (!r.items.some(i => i.id === o.item) || !KLOPT.includes(o.klopt) || !BRON.includes(o.bron))
    return json({ fout: "Onvolledig oordeel." }, 400);
  const opmerking = String(o.opmerking || "").slice(0, 1000);
  await store.setJSON(`${o.wie}/${o.item}`, { wie: o.wie, item: o.item, klopt: o.klopt, bron: o.bron, opmerking, tijd: new Date().toISOString() });
  return json({ ok: true });
};

export const config = { path: "/api/oordeel",
  rateLimit: { action: "rate_limit", aggregateBy: ["ip", "domain"], windowSize: 60, windowLimit: 60 } };
