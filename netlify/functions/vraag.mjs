// POST /api/vraag {vraag, model: "open"|"claude"} → antwoord met stappen en bronnen.
// Elke vraag telt mee in het dagbudget (lib/budget.mjs).
import { budget, json, modelFout } from "./lib/budget.mjs";
import { MODELLEN, vraagAan } from "./lib/agent.mjs";

export default async (req, context) => {
  if (req.method !== "POST") return json({ fout: "Alleen POST." }, 405);
  let body;
  try { body = await req.json(); } catch { return json({ fout: "Geen geldige vraag." }, 400); }
  const vraag = String(body?.vraag || "").trim();
  const model = body?.model === "claude" ? "claude" : "open";
  if (vraag.length < 3 || vraag.length > 400) return json({ fout: "Een vraag is 3 tot 400 tekens lang." }, 400);
  const nee = await budget(context);
  if (nee) return nee;
  const start = Date.now();
  try {
    const uit = await vraagAan(model, vraag);
    return json({ model: model === "open" ? `gpt-oss-120b (open model, via ${uit.via})` : MODELLEN[model].naam, ms: Date.now() - start, ...uit });
  } catch (e) {
    return modelFout(e, model);
  }
};

// Netlify weigert zelf al wie meer dan 10 vragen per minuut stuurt, nog voor de functie draait.
export const config = { path: "/api/vraag", method: "POST",
  rateLimit: { action: "rate_limit", aggregateBy: ["ip", "domain"], windowSize: 60, windowLimit: 10 } };
