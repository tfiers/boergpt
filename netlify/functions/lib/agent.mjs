// De agent: een taalmodel met twee gereedschappen. Het model beslist zelf
// welke stapel documenten het doorzoekt en of het de uitrijkalender nodig heeft.
// Elke stap komt terug in `stappen`, zodat de pagina toont wat het deed.
import { bronnen, lees, zoek, STAPELS } from "./zoek.mjs";

const kalender = JSON.parse(lees("uitrijkalender.json"));

export const MODELLEN = {
  open: { naam: "gpt-oss-120b (open model, via Groq)", id: process.env.OPEN_MODEL || "openai/gpt-oss-120b" },
  claude: { naam: "Claude Sonnet 5.5", id: process.env.CLAUDE_MODEL || "claude-sonnet-5-5" },
};

const vandaag = () => new Date().toLocaleDateString("nl-BE", { timeZone: "Europe/Brussels", day: "numeric", month: "long", year: "numeric" });

const SYSTEEM = () => `Je beantwoordt vragen over landbouw in Vlaanderen, voor boeren en adviseurs.
Vandaag is het ${vandaag()}.
Je antwoordt alleen uit wat je gereedschap teruggeeft: de documenten (ILVO-onderzoek, praktijkgidsen, mestregels van de VLM, GLB-subsidies, het Mestdecreet) en de uitrijkalender.
- Zoek eerst. Kies de stapels die bij de vraag passen; zoek gerust een tweede keer met andere woorden.
- Gaat de vraag over wanneer je mest mag uitrijden, gebruik dan ook de uitrijkalender.
- Elke zin van je antwoord eindigt met de bron tussen vierkante haken: [S123] voor stukje 123, [K] voor de uitrijkalender. Gebruik alleen nummers die je echt kreeg.
- Staat het antwoord maar half in de stukjes, geef dan dat deel en zeg wat ontbreekt. Staat het er helemaal niet in, zeg dan: "Dat staat niet in mijn documenten."
- Is een bron ouder dan drie jaar, of gaat het om regels, zeg dan dat de lezer de huidige regel nakijkt bij de Mestbank of het Departement.
- Antwoord in de taal van de vraag, in 2 tot 6 korte zinnen, zonder opsomming van bronnen achteraan.`;

const GEREEDSCHAP = [
  {
    naam: "zoek_documenten",
    uitleg: "Zoek stukjes tekst in de documenten. Geeft de best passende stukjes terug, elk met een nummer, titel, datum en pagina.",
    velden: {
      zoekvraag: { type: "string", description: "Waar je naar zoekt, in gewone woorden." },
      stapels: { type: "array", items: { type: "string", enum: STAPELS },
        description: "Welke stapels: regels (VLM-mestregels), praktijk (praktijkgidsen), onderzoek (ILVO), subsidies (GLB), wet (Mestdecreet)." },
    },
    verplicht: ["zoekvraag", "stapels"],
  },
  {
    naam: "uitrijkalender",
    uitleg: "Zegt of je op een datum een type meststof mag uitrijden op grasland of akkerland, volgens de uitrijregeling van de VLM.",
    velden: {
      type: { type: "integer", enum: [1, 2, 3], description: "1: stalmest, champost, traagwerkende meststoffen. 2: alle andere, bv. drijfmest. 3: kunstmest, spuistroom, effluenten." },
      grond: { type: "string", enum: ["grasland", "akkerland"] },
      datum: { type: "string", description: "Datum als MM-DD, bv. 11-20 voor 20 november." },
    },
    verplicht: ["type", "grond", "datum"],
  },
];

const binnen = (d, van, tot) => van <= tot ? d >= van && d <= tot : d >= van || d <= tot;

function uitrij({ type, grond, datum }) {
  const d = String(datum).slice(-5);
  const r = kalender.regels.find(x => x.type === Number(type) && (x.grond === "alle" || x.grond === grond) && binnen(d, x.van, x.tot));
  if (!r) return { tekst: "Geen regel gevonden voor die combinatie.", kalender: null };
  return {
    tekst: `Type ${type} (${kalender.types[type]}) op ${grond}, ${d}: ${r.uitleg} Periode ${r.van} t.e.m. ${r.tot}. ${kalender.let_op} [K]`,
    kalender: { ...r, bron: kalender.bron, url: kalender.url },
  };
}

async function voerUit(naam, args, gezien) {
  if (naam === "zoek_documenten") {
    const { manier, stukjes } = await zoek(String(args.zoekvraag || ""), args.stapels);
    stukjes.forEach(s => gezien.stukjes.set(s.id, s));
    const tekst = stukjes.map(s => {
      const b = bronnen[s.bron];
      return `[S${s.id}] ${b.titel} (${b.uitgever}, ${b.datum}), p. ${s.pagina}:\n${s.tekst}`;
    }).join("\n\n") || "Niets gevonden.";
    return { tekst, stap: { wat: "zoek", zoekvraag: args.zoekvraag, stapels: args.stapels, manier, gevonden: stukjes.map(s => s.id) } };
  }
  if (naam === "uitrijkalender") {
    const u = uitrij(args);
    if (u.kalender) gezien.kalender = u.kalender;
    return { tekst: u.tekst, stap: { wat: "kalender", ...args, mag: u.kalender?.mag } };
  }
  return { tekst: "Onbekend gereedschap.", stap: { wat: naam } };
}

// --- Twee aanbieders, één lus ----------------------------------------------
// Groq's gratis laag geeft 8000 tokens per minuut, zo'n anderhalve vraag. Bij "te druk" (429)
// wacht dit zo lang als de aanbieder vraagt, maar niet langer dan WACHT_MAX seconden
// (live 15, zodat de functie binnen haar minuut blijft; de meting zet het hoger).
const WACHT_MAX = Number(process.env.WACHT_MAX || 15);
async function vraagModel(naam, url, headers, body) {
  for (let poging = 0; ; poging++) {
    const r = await fetch(url, { method: "POST", signal: AbortSignal.timeout(45000),
      headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify(body) });
    if (r.ok) return r.json();
    const wacht = Number(r.headers.get("retry-after")) || 10;
    if (r.status === 429 && poging < 3 && wacht <= WACHT_MAX) { await new Promise(k => setTimeout(k, wacht * 1000)); continue; }
    const fout = new Error(`${naam}: ${r.status} ${(await r.text()).slice(0, 200)}`);
    fout.status = r.status;
    throw fout;
  }
}

const anthropic = {
  tools: GEREEDSCHAP.map(g => ({ name: g.naam, description: g.uitleg,
    input_schema: { type: "object", properties: g.velden, required: g.verplicht } })),
  async stap(berichten) {
    const j = await vraagModel("Claude", "https://api.anthropic.com/v1/messages",
      { "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
      { model: MODELLEN.claude.id, max_tokens: 1200, system: SYSTEEM(), tools: this.tools, messages: berichten });
    berichten.push({ role: "assistant", content: j.content });
    const oproepen = j.content.filter(c => c.type === "tool_use").map(c => ({ id: c.id, naam: c.name, args: c.input }));
    return { oproepen, tekst: j.content.filter(c => c.type === "text").map(c => c.text).join(""),
      gebruik: { in: j.usage?.input_tokens || 0, uit: j.usage?.output_tokens || 0 } };
  },
  antwoorden(berichten, uit) {
    berichten.push({ role: "user", content: uit.map(u => ({ type: "tool_result", tool_use_id: u.id, content: u.tekst })) });
  },
  start: vraag => [{ role: "user", content: vraag }],
};

const groq = {
  tools: GEREEDSCHAP.map(g => ({ type: "function", function: { name: g.naam, description: g.uitleg,
    parameters: { type: "object", properties: g.velden, required: g.verplicht } } })),
  async stap(berichten) {
    const j = await vraagModel("Groq", "https://api.groq.com/openai/v1/chat/completions",
      { Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
      { model: MODELLEN.open.id, max_tokens: 1200, temperature: 0.2, tools: this.tools, messages: berichten });
    const m = j.choices[0].message;
    berichten.push({ role: "assistant", content: m.content || "", ...(m.tool_calls ? { tool_calls: m.tool_calls } : {}) });
    const oproepen = (m.tool_calls || []).map(t => {
      let args = {};
      try { args = JSON.parse(t.function.arguments || "{}"); } catch {}
      return { id: t.id, naam: t.function.name, args };
    });
    return { oproepen, tekst: m.content || "", gebruik: { in: j.usage?.prompt_tokens || 0, uit: j.usage?.completion_tokens || 0 } };
  },
  antwoorden(berichten, uit) {
    for (const u of uit) berichten.push({ role: "tool", tool_call_id: u.id, content: u.tekst });
  },
  start: vraag => [{ role: "system", content: SYSTEEM() }, { role: "user", content: vraag }],
};

// Hoogstens 4 modelaanroepen per vraag en 3 gereedschappen per ronde: zo blijft een
// vraag goedkoop, ook als iemand het model vraagt om twintig keer tegelijk te zoeken.
export async function vraagAan(model, vraag, { maxRondes = 3, perRonde = 3 } = {}) {
  const a = model === "claude" ? anthropic : groq;
  const berichten = a.start(vraag);
  const gezien = { stukjes: new Map(), kalender: null };
  const stappen = [];
  let tekst = "";
  const gebruik = { in: 0, uit: 0, aanroepen: 0 };  // tokens, om de kost per vraag te meten
  for (let ronde = 0; ronde <= maxRondes; ronde++) {
    const s = await a.stap(berichten);
    gebruik.in += s.gebruik.in; gebruik.uit += s.gebruik.uit; gebruik.aanroepen++;
    tekst = s.tekst;
    if (!s.oproepen.length) break;
    if (ronde === maxRondes) { tekst ||= "Ik vond niet genoeg om te antwoorden."; break; }
    const uit = [];
    for (const [i, o] of s.oproepen.entries()) {
      // Elke oproep krijgt een antwoord (beide API's eisen dat), maar alleen de eerste paar lopen echt.
      if (i >= perRonde) { uit.push({ id: o.id, tekst: `Niet uitgevoerd: hoogstens ${perRonde} per ronde.` }); continue; }
      const r = await voerUit(o.naam, o.args, gezien);
      stappen.push(r.stap);
      uit.push({ id: o.id, tekst: r.tekst });
    }
    a.antwoorden(berichten, uit);
  }
  return { ...opmaak(tekst, gezien, stappen), gebruik };
}

// Alleen bronnen die het model echt kreeg, worden getoond; een verzonnen nummer valt weg.
export function opmaak(tekst, gezien, stappen) {
  const jaar = new Date().getFullYear();
  const geciteerd = new Map();
  const schoon = tekst.replace(/\s*\[(S(\d+)|K|S[^\]]*)\]/g, (heel, wat, nr) => {
    if (wat === "K") return gezien.kalender ? " [K]" : "";
    if (nr === undefined) return "";
    const s = gezien.stukjes.get(Number(nr));
    if (!s) return "";
    const b = bronnen[s.bron];
    geciteerd.set(s.id, { id: s.id, titel: b.titel, uitgever: b.uitgever, datum: b.datum, url: b.url, stapel: b.stapel,
      pagina: s.pagina, tekst: s.tekst, oud: jaar - Number(b.datum.slice(0, 4)) > 3 });
    return ` [S${nr}]`;
  });
  return { antwoord: schoon.trim(), stappen, bronnen: [...geciteerd.values()], kalender: gezien.kalender };
}
