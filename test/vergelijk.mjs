// Modellen naast elkaar: kwaliteit, kost en snelheid, uit metingen van test/meet.mjs open|claude.
// "Klopt" is volgens de sleutel van elke vraag (het juiste getal of woord staat in het antwoord), op
// de vragen met een antwoord in de documenten; zo telt elk model op dezelfde manier, ook zonder rechter.
//   node test/vergelijk.mjs <uitslag.json> [<uitslag.json> ...]   → public/modellen.json (de grafiek op de site)
// De kost is tokens × de prijs per miljoen tokens hieronder (Cloudflare Workers AI geeft ook een
// prijs per miljoen tokens, naast zijn neurons).
import { readFileSync, writeFileSync } from "node:fs";

// Dollar per miljoen tokens (in, uit), zoals de aanbieders ze op 16 november 2026 vroegen.
const PRIJS = {
  claude: { naam: "Claude Sonnet 5.5", open: false, in: 2, uit: 10, bron: "https://platform.claude.com/docs/en/about-claude/pricing" },
  "openai/gpt-oss-120b": { naam: "gpt-oss-120b", open: true, in: 0.15, uit: 0.6, bron: "https://groq.com/pricing" },
  "@cf/openai/gpt-oss-120b": { naam: "gpt-oss-120b", open: true, in: 0.35, uit: 0.75, bron: "https://developers.cloudflare.com/workers-ai/platform/pricing/" },
  "openai/gpt-oss-20b": { naam: "gpt-oss-20b", open: true, in: 0.075, uit: 0.3, bron: "https://groq.com/pricing" },
  "qwen/qwen3.8-27b": { naam: "Qwen3.8 27B", open: true, in: 0.8, uit: 4, bron: "https://groq.com/pricing" },
  "@cf/openai/gpt-oss-20b": { naam: "gpt-oss-20b", open: true, in: 0.2, uit: 0.3, bron: "https://developers.cloudflare.com/workers-ai/platform/pricing/" },
  "@cf/qwen/qwen3.8-27b": { naam: "Qwen3.8 27B", open: true, in: 0.45, uit: 3.2, bron: "https://developers.cloudflare.com/workers-ai/platform/pricing/" },
  "@cf/mistralai/mistral-small-3.1-24b-instruct": { naam: "Mistral Small 3.1 24B", open: true, in: 0.351, uit: 0.555, bron: "https://developers.cloudflare.com/workers-ai/platform/pricing/" },
  "@cf/meta/llama-3.3-70b-instruct-fp8-fast": { naam: "Llama 3.3 70B", open: true, in: 0.293, uit: 2.253, bron: "https://developers.cloudflare.com/workers-ai/platform/pricing/" },
  "@cf/google/gemma-4-26b-a4b-it": { naam: "Gemma 4 26B", open: true, in: 0.1, uit: 0.3, bron: "https://developers.cloudflare.com/workers-ai/platform/pricing/" },
};

const tel = (r, f) => r.filter(f).length;
const rijen = process.argv.slice(2).map(pad => {
  const u = JSON.parse(readFileSync(pad, "utf8"));
  const id = u.model ? u.model.slice(u.model.indexOf(":") + 1) : u.wat;
  const p = PRIJS[id] || PRIJS[u.wat];
  if (!p) throw new Error(`Geen prijs voor ${id} (${pad})`);
  const r = u.r.filter(x => !x.fout), met = u.r.filter(x => "klopt" in x), zonder = u.r.filter(x => "weetNiet" in x);
  const gem = k => r.reduce((s, x) => s + (k(x) || 0), 0) / r.length;
  const tin = gem(x => x.gebruik?.in), tuit = gem(x => x.gebruik?.uit);
  const pct = (n, d) => Math.round(100 * n / d);
  return {
    model: p.naam, open: p.open, via: u.model ? u.model.split(":")[0] : "anthropic", deel: u.deel, datum: u.datum,
    vragen: u.r.length, fouten: u.r.length - r.length,
    klopt: pct(tel(met, x => x.klopt), met.length),
    bron: pct(tel(met, x => x.bron), met.length),
    weetNiet: `${tel(zonder, x => x.weetNiet)} van ${zonder.length}`,
    seconden: Math.round(gem(x => x.ms) / 100) / 10,
    tokensIn: Math.round(tin), tokensUit: Math.round(tuit),
    kostPer1000: Math.round((tin * p.in + tuit * p.uit) / 1000 * 100) / 100,  // dollar per 1000 vragen
    prijsbron: p.bron,
  };
});
rijen.sort((a, b) => b.klopt - a.klopt);
writeFileSync("public/modellen.json", JSON.stringify(rijen, null, 1));
console.table(rijen.map(({ prijsbron, ...r }) => r));
