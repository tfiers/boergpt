// Een vraag of fiche beantwoorden met het gekozen model. Claude antwoordt zolang zijn dagbudget
// niet op is (lib/budget.mjs) en de API antwoordt; anders antwoordt het open model, en het antwoord
// zegt dat erbij. Zo werkt de demo altijd, ook als de maandlimiet van de Claude-sleutel bereikt is.
import { claudeOp, claudeTel } from "./budget.mjs";
import { MODELLEN, vraagAan } from "./agent.mjs";

export async function beantwoord(model, vraag, opties) {
  let reden = null;
  if (model === "claude") {
    // Werkt de teller niet, dan liever het open model dan een kost zonder grens.
    if (await claudeOp().catch(e => { console.error(e); return true; })) reden = "Claude staat uit of heeft zijn budget voor vandaag op";
    else {
      try {
        const uit = await vraagAan("claude", vraag, opties);
        await claudeTel(uit.gebruik).catch(console.error);
        return { model: MODELLEN.claude.naam, ...uit };
      } catch (e) { console.error(e); reden = "Claude antwoordt nu niet"; }
    }
  }
  const uit = await vraagAan("open", vraag, opties);
  return { model: `gpt-oss-120b (open model, via ${uit.via})`, ...uit,
    ...(reden && { vervanger: `${reden}. Dit antwoord komt van het open model gpt-oss-120b.` }) };
}
