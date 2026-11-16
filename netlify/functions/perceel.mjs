// POST /api/perceel {teelt, grond, mest, klasse, datum, oppervlakte, model} → een ingevulde fiche
// voor één perceel, elk veld met zijn bron (lib/fiche.mjs). Heeft een eigen, kleiner dagbudget.
import { budget, json, modelFout } from "./lib/budget.mjs";
import { MODELLEN, vraagAan } from "./lib/agent.mjs";
import { FICHE, perceelVraag } from "./lib/fiche.mjs";

export default async (req, context) => {
  let body;
  try { body = await req.json(); } catch { return json({ fout: "Geen geldig perceel." }, 400); }
  const vraag = perceelVraag(body);
  if (!vraag) return json({ fout: "Vul elk veld in: teelt, grond, meststof, fosfaatklasse, datum en oppervlakte." }, 400);
  const model = body?.model === "open" ? "open" : "claude";
  const nee = await budget(context, "perceel");
  if (nee) return nee;
  const start = Date.now();
  try {
    const uit = await vraagAan(model, vraag, { maxRondes: 4, taak: FICHE });
    if (!uit.formulier) return json({ fout: "Het model vulde de fiche niet in. Probeer het opnieuw." }, 502);
    return json({ model: model === "open" ? `gpt-oss-120b (open model, via ${uit.via})` : MODELLEN.claude.naam, ms: Date.now() - start, vraag, ...uit });
  } catch (e) {
    return modelFout(e, model);
  }
};

export const config = { path: "/api/perceel", method: "POST",
  rateLimit: { action: "rate_limit", aggregateBy: ["ip", "domain"], windowSize: 60, windowLimit: 5 } };
