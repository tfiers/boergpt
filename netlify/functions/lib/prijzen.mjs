// Wat Claude kost. Apart van budget.mjs, zodat de metingen (test/) het lezen zonder Netlify Blobs.
// Dollar per miljoen tokens, prijslijst van Anthropic (Haiku: voor een prompt tot 100.000 tokens).
export const PRIJZEN = {
  "claude-sonnet-5-5": { in: 2, uit: 10 },
  "claude-opus-5-5": { in: 4, uit: 20 },
  "claude-haiku-5-5": { in: 0.1, uit: 0.5 },
};
export const kost = (gebruik, prijs = PRIJZEN["claude-sonnet-5-5"]) => (gebruik.in * prijs.in + gebruik.uit * prijs.uit) / 1e6;
