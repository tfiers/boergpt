// Elke meting heeft een plafond in dollar: KOST_MAX (standaard $1). De Claude-sleutel heeft één
// maandlimiet voor de demo en de metingen samen, dus een meting mag die nooit opmaken.
// Vooraf zegt `schat` wat de meting ongeveer kost en stopt als dat boven het plafond ligt; tijdens
// de meting telt `tel` de echte tokens, en `op` zegt wanneer het plafond bereikt is.
// Geteld wordt wat Claude kost (antwoorden en rechter) en een rechter op Cloudflare; de antwoorden
// van open modellen niet (Cloudflare Workers Paid, ± $0,002 per vraag).
import { kost } from "../netlify/functions/lib/budget.mjs";

const MAX = Number(process.env.KOST_MAX || 1);
let besteed = 0;

// Dollar per vraag, gemeten op 16 november 2026 (± 8.400 tokens in en 500 uit voor een antwoord van Claude).
export const PER_VRAAG = { claude: 0.025, rechterClaude: 0.012, rechterOpen: 0.002 };

export function schat(n, perVraag) {
  const s = n * perVraag;
  console.log(`Geschatte kost: ${n} × $${perVraag.toFixed(3)} = $${s.toFixed(2)} (plafond $${MAX}, KOST_MAX)`);
  if (s > MAX) { console.log("Dat is meer dan het plafond. Zet KOST_MAX hoger als dat de bedoeling is."); process.exit(1); }
}
export const tel = (gebruik, prijs) => { besteed += kost(gebruik, prijs); };
export const op = () => besteed >= MAX;
export const besteedTot = () => Math.round(besteed * 1000) / 1000;
