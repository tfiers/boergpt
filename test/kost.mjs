// Elke meting heeft een plafond in dollar: KOST_MAX (standaard $1). De Claude-sleutel heeft één
// maandlimiet voor de demo en de metingen samen, dus een meting mag die nooit opmaken.
// Vooraf zegt `schat` wat de meting ongeveer kost en stopt als dat boven het plafond ligt; tijdens
// de meting telt `tel` de echte tokens, en `op` zegt wanneer het plafond bereikt is.
// Geteld wordt wat Claude kost (antwoorden en rechter) en een rechter op Cloudflare; de antwoorden
// van open modellen niet (Cloudflare Workers Paid, ± $0,002 per vraag).
import { kost, PRIJZEN } from "../netlify/functions/lib/budget.mjs";

const MAX = Number(process.env.KOST_MAX || 1);
let besteed = 0;

// Tokens per vraag, ruim genomen, naar de metingen van 16 november 2026 (± 8.400 in en 500 uit voor
// een antwoord van Claude Sonnet 5.5).
const TOKENS = { antwoord: { in: 9500, uit: 600 }, oordeel: { in: 4000, uit: 400 } };

// Prijs van een Claude-model; een model zonder prijs in PRIJZEN meet niet, want dan klopt het plafond niet.
export function prijs(model) {
  if (!PRIJZEN[model]) throw new Error(`geen prijs voor ${model} in PRIJZEN (netlify/functions/lib/budget.mjs)`);
  return PRIJZEN[model];
}
// Dollar per vraag: een antwoord of een oordeel van een Claude-model; een oordeel op Cloudflare ± $0,002.
export const perAntwoord = model => kost(TOKENS.antwoord, prijs(model));
export const perOordeel = model => kost(TOKENS.oordeel, prijs(model));
export const PER_OORDEEL_OPEN = 0.002;

export function schat(n, perVraag) {
  const s = n * perVraag;
  console.log(`Geschatte kost: ${n} × $${perVraag.toFixed(3)} = $${s.toFixed(2)} (plafond $${MAX}, KOST_MAX)`);
  if (s > MAX) { console.log("Dat is meer dan het plafond. Zet KOST_MAX hoger als dat de bedoeling is."); process.exit(1); }
}
export const tel = (gebruik, prijs) => { besteed += kost(gebruik, prijs); };
export const op = () => besteed >= MAX;
export const besteedTot = () => Math.round(besteed * 1000) / 1000;
