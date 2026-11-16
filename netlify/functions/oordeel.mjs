// Het blinde oordeel van experts (public/oordeel.html). De antwoorden staan in data/oordeel.json,
// zonder het model dat ze schreef. Elk oordeel wordt bewaard in Netlify Blobs onder de naam die
// in de link staat (?wie=...), zodat een expert kan stoppen en later verdergaan.
//   GET  /api/oordeel?wie=naam    de antwoorden en wat die persoon al oordeelde
//   GET  /api/oordeel?alles       alle oordelen (voor test/vergelijk-oordeel.mjs)
//   POST /api/oordeel {wie, item, klopt, bron, opmerking}
import { getStore } from "@netlify/blobs";
import { lees } from "./lib/zoek.mjs";

const ronde = JSON.parse(lees("oordeel.json"));
const items = new Set(ronde.items.map(i => i.id));
const KLOPT = ["ja", "half", "nee", "weet niet"], BRON = ["ja", "deels", "nee", "weet niet"];
const json = (data, status = 200) => Response.json(data, { status, headers: { "cache-control": "no-store" } });
const geldigeNaam = w => typeof w === "string" && /^[a-z0-9-]{2,30}$/.test(w);

export default async req => {
  const store = getStore({ name: `oordeel-${ronde.ronde}`, consistency: "strong" });
  const url = new URL(req.url);
  if (req.method === "GET") {
    const wie = url.searchParams.get("wie");
    const alles = url.searchParams.has("alles");
    if (!alles && !geldigeNaam(wie)) return json({ fout: "Open de link met je naam erin, bv. ?wie=expert." }, 400);
    const { blobs } = await store.list(alles ? {} : { prefix: `${wie}/` });
    const oordelen = await Promise.all(blobs.map(b => store.get(b.key, { type: "json" })));
    return json(alles ? { ronde: ronde.ronde, oordelen } : { ...ronde, oordelen });
  }
  if (req.method !== "POST") return json({ fout: "Alleen GET of POST." }, 405);
  let o;
  try { o = await req.json(); } catch { return json({ fout: "Geen geldige JSON." }, 400); }
  if (!geldigeNaam(o.wie) || !items.has(o.item) || !KLOPT.includes(o.klopt) || !BRON.includes(o.bron))
    return json({ fout: "Onvolledig oordeel." }, 400);
  const opmerking = String(o.opmerking || "").slice(0, 1000);
  await store.setJSON(`${o.wie}/${o.item}`, { wie: o.wie, item: o.item, klopt: o.klopt, bron: o.bron, opmerking, tijd: new Date().toISOString() });
  return json({ ok: true });
};

export const config = { path: "/api/oordeel",
  rateLimit: { action: "rate_limit", aggregateBy: ["ip", "domain"], windowSize: 60, windowLimit: 60 } };
