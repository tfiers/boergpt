// POST /api/vraag {vraag, model: "open"|"claude"} → antwoord met stappen en bronnen.
// Een dagbudget houdt de kosten vast: per dag hoogstens DAGLIMIET vragen in
// totaal en PER_PERSOON per IP-adres, geteld in Netlify Blobs.
import { createHash, randomUUID } from "node:crypto";
import { getStore } from "@netlify/blobs";
import { MODELLEN, vraagAan } from "./lib/agent.mjs";

const DAGLIMIET = Number(process.env.DAGLIMIET || 300);
const PER_PERSOON = Number(process.env.PER_PERSOON || 30);
const json = (data, status = 200) => Response.json(data, { status, headers: { "cache-control": "no-store" } });

// Elke vraag schrijft eerst een eigen sleutel en telt daarna. Zo telt een vraag
// die tegelijk met andere binnenkomt toch mee, en geraakt niemand over de grens
// door veel vragen tegelijk te sturen. Een geweigerde vraag haalt zijn sleutel
// weer weg, zodat één bezoeker het dagbudget van de anderen niet kan opmaken.
// Het IP-adres wordt niet bewaard, alleen een hash ervan die elke dag verandert.
export async function telOp(store, ip, dag = new Date().toISOString().slice(0, 10)) {
  const wie = createHash("sha256").update(`${dag} ${ip}`).digest("hex").slice(0, 16);
  const sleutel = `${dag}/${wie}/${randomUUID()}`;
  await store.set(sleutel, "");
  const weiger = async tekst => { await store.delete(sleutel); return tekst; };
  const { blobs: eigen } = await store.list({ prefix: `${dag}/${wie}/` });
  if (eigen.length > PER_PERSOON) return weiger("Je hebt vandaag al veel vragen gesteld. Probeer het morgen opnieuw.");
  const { blobs } = await store.list({ prefix: `${dag}/` });
  if (blobs.length > DAGLIMIET) return weiger("De demo heeft zijn vragen voor vandaag op. Probeer het morgen opnieuw.");
  return null;
}

export default async (req, context) => {
  if (req.method !== "POST") return json({ fout: "Alleen POST." }, 405);
  let body;
  try { body = await req.json(); } catch { return json({ fout: "Geen geldige vraag." }, 400); }
  const vraag = String(body?.vraag || "").trim();
  const model = body?.model === "claude" ? "claude" : "open";
  if (vraag.length < 3 || vraag.length > 400) return json({ fout: "Een vraag is 3 tot 400 tekens lang." }, 400);
  // Lukt het tellen niet, dan geen vraag: zonder teller is er geen grens aan de kosten.
  const nee = await telOp(getStore({ name: "budget", consistency: "strong" }), context.ip || "onbekend")
    .catch(e => { console.error(e); return "De teller werkt even niet. Probeer het zo opnieuw."; });
  if (nee) return json({ fout: nee }, 429);
  const start = Date.now();
  try {
    const uit = await vraagAan(model, vraag);
    return json({ model: MODELLEN[model].naam, ms: Date.now() - start, ...uit });
  } catch (e) {
    console.error(e);
    if (e.status === 429) return json({ fout: model === "open"
      ? (e.perDag ? "Het open model heeft zijn gratis portie bij Groq voor vandaag op. Vraag het Claude, of probeer morgen opnieuw."
        : "Het open model is even te druk: de gratis laag van Groq laat zo'n anderhalve vraag per minuut toe. Probeer over een minuut, of vraag het Claude.")
      : "Claude is even te druk. Probeer het over een minuut opnieuw." }, 503);
    return json({ fout: "Het model antwoordde niet. Probeer het zo opnieuw." }, 502);
  }
};

// Netlify weigert zelf al wie meer dan 10 vragen per minuut stuurt, nog voor de functie draait.
export const config = { path: "/api/vraag", method: "POST",
  rateLimit: { action: "rate_limit", aggregateBy: ["ip", "domain"], windowSize: 60, windowLimit: 10 } };
