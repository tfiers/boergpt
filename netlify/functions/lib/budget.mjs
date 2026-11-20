// Wat de functies delen: een JSON-antwoord, en het dagbudget dat de kosten vasthoudt.
// Per dag hoogstens DAGLIMIET vragen in totaal en PER_PERSOON per IP-adres, geteld in Netlify Blobs.
// Een perceelfiche en de MCP-server hebben elk een eigen teller: een fiche kost een paar keer meer
// dan een vraag (meer rondes, langere antwoorden), MCP gebruikt geen taalmodel maar wel Cloudflare.
import { createHash, randomUUID } from "node:crypto";
import { getStore } from "@netlify/blobs";
import { kost } from "./prijzen.mjs";

const DAGLIMIET = Number(process.env.DAGLIMIET || 300);
const PER_PERSOON = Number(process.env.PER_PERSOON || 30);
const GRENZEN = { vraag: [DAGLIMIET, PER_PERSOON], perceel: [60, 10], mcp: [3000, 300] };
export const json = (data, status = 200) => Response.json(data, { status, headers: { "cache-control": "no-store" } });

// Elke vraag schrijft eerst een eigen sleutel en telt daarna. Zo telt een vraag
// die tegelijk met andere binnenkomt toch mee, en geraakt niemand over de grens
// door veel vragen tegelijk te sturen. Een geweigerde vraag haalt zijn sleutel
// weer weg, zodat één bezoeker het dagbudget van de anderen niet kan opmaken.
// Het IP-adres wordt niet bewaard, alleen een hash ervan die elke dag verandert.
export async function telOp(store, ip, dag = new Date().toISOString().slice(0, 10), [dagLimiet, perPersoon] = GRENZEN.vraag) {
  const wie = createHash("sha256").update(`${dag} ${ip}`).digest("hex").slice(0, 16);
  const sleutel = `${dag}/${wie}/${randomUUID()}`;
  await store.set(sleutel, "");
  const weiger = async tekst => { await store.delete(sleutel); return tekst; };
  const { blobs: eigen } = await store.list({ prefix: `${dag}/${wie}/` });
  if (eigen.length > perPersoon) return weiger("Je hebt vandaag al veel vragen gesteld. Probeer het morgen opnieuw.");
  const { blobs } = await store.list({ prefix: `${dag}/` });
  if (blobs.length > dagLimiet) return weiger("De demo heeft zijn vragen voor vandaag op. Probeer het morgen opnieuw.");
  return null;
}

// Telt de vraag mee in het budget. Geeft een antwoord terug als de vraag geweigerd wordt, anders null.
// Lukt het tellen niet, dan geen vraag: zonder teller is er geen grens aan de kosten.
// De tests zetten hier een nagemaakte opslag in de plaats van Netlify Blobs.
export const opslag = { open: naam => getStore({ name: naam, consistency: "strong" }) };

export async function budget(context, soort = "vraag") {
  const store = opslag.open(soort === "vraag" ? "budget" : `budget-${soort}`);
  const nee = await telOp(store, context.ip || "onbekend", undefined, GRENZEN[soort])
    .catch(e => { console.error(e); return "De teller werkt even niet. Probeer het zo opnieuw."; });
  return nee ? json({ fout: nee }, 429) : null;
}

// Claude kost per token, en de API-sleutel van de demo heeft een maandlimiet.
// Daarom hoogstens CLAUDE_DOLLAR_PER_DAG per dag. Zonder die
// variabele: $2 per dag (± 80 vragen) t.e.m. 4 dec 2026, daarna $0,50
// (± 20 vragen). Met 0 staat Claude uit.
// Geteld in dollar na elk antwoord: elk antwoord schrijft een sleutel met zijn kost in de naam.
// Is het budget op, dan antwoordt het open model in Claude's plaats (lib/antwoord.mjs).
const dagVan = () => new Date().toISOString().slice(0, 10);

export async function claudeOp() {
  const perDag = Number(process.env.CLAUDE_DOLLAR_PER_DAG ?? (dagVan() <= "2026-12-04" ? 2 : 0.5));
  if (!(perDag > 0)) return true;
  const { blobs } = await opslag.open("budget-claude").list({ prefix: `${dagVan()}/` });
  return blobs.reduce((s, b) => s + Number(b.key.split("/")[1]) / 1e6, 0) >= perDag;
}
export const claudeTel = gebruik =>
  opslag.open("budget-claude").set(`${dagVan()}/${Math.round(kost(gebruik) * 1e6)}/${randomUUID()}`, "");

// Een fout van het model als antwoord voor de pagina.
export function modelFout(e) {
  console.error(e);
  if (e.status === 429) return json({ fout: "Het open model is even te druk of heeft zijn portie voor vandaag op. Probeer het later opnieuw." }, 503);
  return json({ fout: "Het model antwoordde niet. Probeer het zo opnieuw." }, 502);
}
