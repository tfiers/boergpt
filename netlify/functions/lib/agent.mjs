// De agent: een taalmodel met twee gereedschappen. Het model beslist zelf
// welke stapel documenten het doorzoekt en of het de uitrijkalender nodig heeft.
// Elke stap komt terug in `stappen`, zodat de pagina toont wat het deed.
import { bronnen, lees, zoek, STAPELS } from "./zoek.mjs";

const kalender = JSON.parse(lees("uitrijkalender.json"));

// CLAUDE_MODEL kiest een ander Claude-model, voor een meting (bv. claude-haiku-5-5).
const CLAUDE = process.env.CLAUDE_MODEL || "claude-sonnet-5-5";
export const MODELLEN = {
  open: { naam: "gpt-oss-120b (open model)" },
  claude: { naam: CLAUDE.replace(/^claude-(\w+)-(\d+)-(\d+)$/, (_, m, a, b) => `Claude ${m[0].toUpperCase()}${m.slice(1)} ${a}.${b}`), id: CLAUDE },
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
- Gaat een vraag uit van iets dat volgens de documenten niet klopt (bv. dat een regel is afgeschaft), ga daar dan niet in mee: zeg wat de documenten zeggen.
- Je geeft geen bindend of officieel advies; vraagt iemand dat, zeg het en verwijs naar de Mestbank.
- Schrijft iemand dat het niet meer gaat of dat die aan zelfdoding denkt, antwoord dan warm en kort, en geef de Zelfmoordlijn (1813, gratis, dag en nacht) en Tele-Onthaal (106).
- Weiger je iets, zeg dat dan in één zin, ook in de taal van de vraag.
- Antwoord in de taal van de vraag, in 2 tot 6 korte zinnen, zonder opsomming van bronnen achteraan.`;

export const GEREEDSCHAP = [
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

// Zonder "verboden" las een open model "Periode 08-15 t.e.m. 02-15" bij een "Neen" als de periode
// waarin het wel mag.
const MAG = { ja: "toegelaten", nee: "verboden", voorwaarden: "toegelaten onder voorwaarden" };
export const periode = r => `Deze regel geldt van ${r.van} t.e.m. ${r.tot} (MM-DD): in die hele periode is het ${MAG[r.mag]}.`;

function uitrij({ type, grond, datum }) {
  const d = String(datum).slice(-5);
  const r = kalender.regels.find(x => x.type === Number(type) && (x.grond === "alle" || x.grond === grond) && binnen(d, x.van, x.tot));
  if (!r) return { tekst: "Geen regel gevonden voor die combinatie.", kalender: null };
  return {
    tekst: `Type ${type} (${kalender.types[type]}) op ${grond}, ${d}: ${r.uitleg} ${periode(r)} ${kalender.let_op} [K]`,
    kalender: { ...r, bron: kalender.bron, url: kalender.url },
  };
}

export async function voerUit(naam, args, gezien = { stukjes: new Map(), kalender: null }) {
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

// --- Aanbieders, één lus -----------------------------------------------------
// Groq's gratis laag geeft 8000 tokens per minuut, zo'n anderhalve vraag, en 200.000 per dag.
// Bij "te druk" (429) wacht dit zo lang als de aanbieder vraagt, maar niet langer dan `geduld`
// seconden (live 15, zodat de functie binnen haar minuut blijft; de meting zet WACHT_MAX hoger).
const WACHT_MAX = Number(process.env.WACHT_MAX || 15);
// Hoe lang één antwoord van een model mag duren (live 45 s; de meting zet TIJD_MAX hoger,
// want Cloudflare doet er soms langer over).
const TIJD_MAX = Number(process.env.TIJD_MAX || 45);
async function vraagModel(naam, url, headers, body, geduld = WACHT_MAX) {
  for (let poging = 0; ; poging++) {
    const r = await fetch(url, { method: "POST", signal: AbortSignal.timeout(TIJD_MAX * 1000),
      headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify(body) });
    if (r.ok) return r.json();
    const wacht = Number(r.headers.get("retry-after")) || 10;
    if (r.status === 429 && poging < 3 && wacht <= geduld) { await new Promise(k => setTimeout(k, wacht * 1000)); continue; }
    const tekst = await r.text();
    const fout = new Error(`${naam}: ${r.status} ${tekst.slice(0, 200)}`);
    fout.status = r.status;
    try { fout.json = JSON.parse(tekst); } catch {}
    throw fout;
  }
}

// Een taak: de opdracht, het gereedschap, en eventueel een formulier dat het model op het einde
// invult in plaats van een antwoord te schrijven (zie fiche.mjs).
export const VRAAG = { opdracht: SYSTEEM, gereedschap: GEREEDSCHAP, formulier: null };
const metFormulier = taak => taak.formulier ? [...taak.gereedschap, taak.formulier] : taak.gereedschap;

// Claude (Sonnet 5.5) kan niet gedwongen worden een gereedschap te gebruiken: het kiest zelf ("auto"),
// en de opdracht zegt dat het eerst zoekt. Het formulier vult het in als JSON volgens een schema
// (structured output), in een laatste ronde zonder gereedschap.
const schema = g => ({ type: "object", properties: g.velden, required: g.verplicht, additionalProperties: false });
const anthropic = {
  naam: "Anthropic",
  async stap(berichten, geduld, moet, taak) {
    const tools = taak.gereedschap.map(g => ({ name: g.naam, description: g.uitleg, input_schema: schema(g) }));
    const invullen = moet === "schrijven" && taak.formulier;
    const j = await vraagModel("Claude", "https://api.anthropic.com/v1/messages",
      { "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
      { model: MODELLEN.claude.id, max_tokens: taak.formulier ? 4000 : 1500, system: taak.opdracht(), tools, messages: berichten,
        tool_choice: { type: moet === "schrijven" ? "none" : "auto" },
        ...(invullen ? { output_config: { format: { type: "json_schema", schema: schema(taak.formulier) } } } : {}) }, geduld);
    if (j.content.length) berichten.push({ role: "assistant", content: j.content });  // een leeg bericht weigert de API later
    // Weigert Claude's veiligheidsfilter de vraag, dan komt er geen tekst: zeg het dan zelf.
    if (j.stop_reason === "refusal") return { oproepen: [], tekst: "Daarbij help ik niet. Ik beantwoord alleen vragen over landbouw in Vlaanderen, uit mijn documenten.", gebruik: { in: j.usage?.input_tokens || 0, uit: j.usage?.output_tokens || 0 } };
    const tekst = j.content.filter(c => c.type === "text").map(c => c.text).join("");
    const oproepen = invullen ? [{ id: "formulier", naam: taak.formulier.naam, args: JSON.parse(tekst) }]
      : j.content.filter(c => c.type === "tool_use").map(c => ({ id: c.id, naam: c.name, args: c.input }));
    return { oproepen, tekst, gebruik: { in: j.usage?.input_tokens || 0, uit: j.usage?.output_tokens || 0 } };
  },
  antwoorden(berichten, uit) {
    berichten.push({ role: "user", content: uit.map(u => ({ type: "tool_result", tool_use_id: u.id, content: u.tekst })) });
  },
  start: vraag => [{ role: "user", content: vraag }],
};

// Het open model, bij een aanbieder met de OpenAI-vorm van API. De berichten hebben bij
// beide dezelfde vorm, dus een vraag kan halverwege van aanbieder wisselen.
const openAanbieder = (naam, url, sleutel, id) => ({
  naam,
  klaar: () => Boolean(sleutel()),
  async stap(berichten, geduld, moet, taak) {
    const tools = metFormulier(taak).map(g => ({ type: "function", function: { name: g.naam, description: g.uitleg,
      parameters: { type: "object", properties: g.velden, required: g.verplicht } } }));
    const kies = moet === "gereedschap" ? "required"
      : moet === "schrijven" ? (taak.formulier ? { type: "function", function: { name: taak.formulier.naam } } : "none") : "auto";
    let m, j, extra = [];
    // Niet elke aanbieder dwingt tool_choice af. Cloudflare laat het model soms meteen antwoorden
    // waar het moest zoeken; Groq geeft dan een fout met wat het model schreef ("tool_use_failed").
    // Zo'n model krijgt één herinnering om eerst te zoeken; doet het het weer niet, dan telt de tekst.
    // Riep het een gereedschap waar het moest schrijven, dan vragen we het nog eens.
    for (let poging = 0; !m; poging++) {
      try {
        j = await vraagModel(naam, url(), { Authorization: `Bearer ${sleutel()}` },
          { model: id(), max_tokens: taak.formulier ? 2500 : 1200, temperature: 0.2, tools, messages: [...berichten, ...extra], tool_choice: kies }, geduld);
        m = j.choices[0].message;
      } catch (e) {
        const mislukt = e.json?.error?.code === "tool_use_failed" ? e.json.error.failed_generation : null;
        if (mislukt == null) throw e;
        if (kies === "required" && !mislukt.trim().startsWith("{")) { m = { content: mislukt }; j = {}; }
        else if (poging >= 1) { m = { content: "" }; j = {}; }
      }
      if (m && kies === "required" && !m.tool_calls?.length && poging === 0) {
        m = undefined;
        extra = [{ role: "user", content: "Zoek eerst in de documenten met zoek_documenten; antwoord daarna." }];
      }
    }
    berichten.push({ role: "assistant", content: m.content || "", ...(m.tool_calls ? { tool_calls: m.tool_calls } : {}) });
    const oproepen = (m.tool_calls || []).map(t => {
      let args = t.function.arguments || {};
      if (typeof args === "string") try { args = JSON.parse(args || "{}"); } catch { args = {}; }
      return { id: t.id, naam: t.function.name, args };
    });
    return { oproepen, tekst: m.content || "", gebruik: { in: j.usage?.prompt_tokens || 0, uit: j.usage?.completion_tokens || 0 } };
  },
  antwoorden(berichten, uit) {
    for (const u of uit) berichten.push({ role: "tool", tool_call_id: u.id, content: u.tekst });
  },
  start: (vraag, taak) => [{ role: "system", content: taak.opdracht() }, { role: "user", content: vraag }],
});
// OPEN_VIA + OPEN_MODEL kiezen een ander model bij één aanbieder, om modellen te vergelijken.
const gekozen = (via, standaard) => () => (process.env.OPEN_VIA === via && process.env.OPEN_MODEL) || standaard;
const groq = openAanbieder("Groq", () => "https://api.groq.com/openai/v1/chat/completions",
  () => process.env.GROQ_API_KEY, gekozen("groq", "openai/gpt-oss-120b"));
// Reserve: hetzelfde model op Cloudflare Workers AI, met de sleutel die ook de vraagvector haalt.
const cloudflare = openAanbieder("Cloudflare",
  () => `https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}/ai/v1/chat/completions`,
  () => process.env.CLOUDFLARE_ACCOUNT_ID && process.env.CLOUDFLARE_API_TOKEN, gekozen("cloudflare", "@cf/openai/gpt-oss-120b"));

// OPEN_VIA=groq of cloudflare legt de aanbieder vast (voor een meting); anders eerst Groq,
// en Cloudflare zodra Groq "te druk" zegt, zonder te wachten.
function aanbieders(model) {
  if (model === "claude") return [anthropic];
  const via = process.env.OPEN_VIA;
  if (via === "groq") return [groq];
  if (via === "cloudflare") return [cloudflare];
  return cloudflare.klaar() ? [groq, cloudflare] : [groq];
}

// De eerste ronde moet het open model gereedschap gebruiken (zo antwoordt het nooit uit het hoofd;
// Claude kan dat niet afdwingen en volgt de opdracht),
// de laatste ronde moet het schrijven (zo eindigt een vraag nooit zonder antwoord).
// Hoogstens 4 modelaanroepen per vraag en 3 gereedschappen per ronde: zo blijft een
// vraag goedkoop, ook als iemand het model vraagt om twintig keer tegelijk te zoeken.
export async function vraagAan(model, vraag, { maxRondes = 3, perRonde = 3, taak = VRAAG } = {}) {
  const rij = aanbieders(model);
  let a = rij.shift();
  const berichten = a.start(vraag, taak);
  let formulier = null;
  const gezien = { stukjes: new Map(), kalender: null };
  const stappen = [];
  let tekst = "", nogEens = false;
  const gebruik = { in: 0, uit: 0, aanroepen: 0 };  // tokens, om de kost per vraag te meten
  for (let ronde = 0; ronde <= maxRondes; ronde++) {
    let s;
    // Met een formulier moet elke ronde een gereedschap gebruiken: zoeken of het formulier invullen.
    const moet = ronde === maxRondes ? "schrijven" : ronde === 0 || taak.formulier ? "gereedschap" : null;
    try { s = await a.stap(berichten, rij.length ? 0 : WACHT_MAX, moet, taak); }
    catch (e) {
      if (e.status !== 429 || !rij.length) throw e;
      a = rij.shift();
      s = await a.stap(berichten, WACHT_MAX, moet, taak);
    }
    gebruik.in += s.gebruik.in; gebruik.uit += s.gebruik.uit; gebruik.aanroepen++;
    tekst = s.tekst;
    formulier = s.oproepen.find(o => o.naam === taak.formulier?.naam)?.args || null;
    if (formulier) break;
    if (!s.oproepen.length) {
      // Klaar met zoeken maar het formulier nog niet ingevuld, of klaar zonder één woord te schrijven:
      // vraag het dan nog één keer, in de laatste ronde.
      const nog = taak.formulier ? "Vul nu de fiche in." : !tekst.trim() && !nogEens ? "Schrijf nu je antwoord, met de bronnen." : null;
      if (!nog || (taak.formulier && ronde === maxRondes)) break;
      nogEens = true;
      vraagNog(berichten, nog);
      ronde = maxRondes - 1;
      continue;
    }
    if (ronde === maxRondes) break;
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
  if (formulier) {
    // Elk veld van het formulier krijgt dezelfde controle van de bronnen als een antwoord.
    const b = bronControle(gezien);
    const velden = Object.fromEntries(Object.entries(formulier).map(([k, v]) => [k, b.schoon(String(v))]));
    return { formulier: velden, stappen, bronnen: b.lijst(), kalender: gezien.kalender, gebruik, via: a.naam };
  }
  return { ...opmaak(tekst || "Dat staat niet in mijn documenten.", gezien, stappen), gebruik, via: a.naam };
}

// Een extra vraag aan het model. Staan er al antwoorden van gereedschap als laatste bericht van de
// gebruiker (Claude's vorm), dan komt de vraag daarbij: twee gebruikersberichten na elkaar mogen niet.
function vraagNog(berichten, vraag) {
  const laatste = berichten.at(-1);
  if (laatste.role === "user" && Array.isArray(laatste.content)) laatste.content.push({ type: "text", text: vraag });
  else berichten.push({ role: "user", content: vraag });
}

// Alleen bronnen die het model echt kreeg, worden getoond; een verzonnen nummer valt weg.
export function opmaak(tekst, gezien, stappen) {
  const b = bronControle(gezien);
  return { antwoord: b.schoon(tekst), stappen, bronnen: b.lijst(), kalender: gezien.kalender };
}

function bronControle(gezien) {
  const jaar = new Date().getFullYear();
  const geciteerd = new Map();
  const bewaar = id => {
    const s = gezien.stukjes.get(id);
    if (!s) return "";
    const b = bronnen[s.bron];
    geciteerd.set(s.id, { id: s.id, titel: b.titel, uitgever: b.uitgever, datum: b.datum, url: b.url, stapel: b.stapel,
      pagina: s.pagina, tekst: s.tekst, oud: jaar - Number(b.datum.slice(0, 4)) > 3 });
    return ` [S${id}]`;
  };
  // Modellen schrijven het niet altijd netjes: "[ S12 ]", "[S12, S13]", "【S12】" of "[12]" tellen ook.
  return { schoon: tekst => tekst.replace(/\s*[\[【]\s*(K|S[^\]】]*|\d+(?:\s*,\s*S?\d+)*)\s*[\]】]/g, (heel, wat) => {
    if (wat.trim() === "K") return gezien.kalender ? " [K]" : "";
    return (wat.match(/\d+/g) || []).map(n => bewaar(Number(n))).join("");
  }).trim(), lijst: () => [...geciteerd.values()] };
}
