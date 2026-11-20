// Een model als rechter: leest vraag, antwoord en de aangehaalde stukjes, en oordeelt of het
// antwoord klopt en of de bronnen het dragen. Het weet niet welk model het antwoord schreef.
// Gebruikt door test/meet.mjs --rechter en test/aanval.mjs. Het oordeel van mensen
// (public/oordeel.html) toont hoe vaak de rechter het met een expert eens is.
//
// RECHTER_MODEL kiest de rechter: standaard Claude Sonnet 5.5, of een model op Cloudflare
// (bv. @cf/meta/llama-3.3-70b-instruct-fp8-fast). Elke oproep telt mee in het plafond van de
// meting (test/kost.mjs).
//
// Opnieuw oordelen over bewaarde metingen, alleen waar het oordeel ontbreekt of mislukte:
//   node test/rechter.mjs metingen/<uitslag>.json [...]
// Met RECHTER_MODEL komt dat oordeel in een eigen veld ("rechter:<model>"), naast dat van de
// standaardrechter: zo meet test/statistiek.py hoe vaak twee rechters het eens zijn.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as kost from "./kost.mjs";

export const RECHTER = process.env.RECHTER_MODEL || "claude-sonnet-5-5";
const opCloudflare = RECHTER.startsWith("@cf/");
export const PER_OORDEEL = opCloudflare ? kost.PER_OORDEEL_OPEN : kost.perOordeel(RECHTER);
const PRIJS_CF = { in: 0.35, uit: 0.75 };  // dollar per miljoen tokens, gpt-oss-120b op Workers AI; de andere zijn goedkoper

// Eén oordeel als JSON volgens `schema`. Claude geeft structured output; een model op Cloudflare
// krijgt het schema in de opdracht, en een antwoord dat er niet bij past, wordt opnieuw gevraagd.
export async function vraagRechter(opdracht, schema, inhoud) {
  if (kost.op()) throw new Error("plafond van de meting bereikt (KOST_MAX)");
  for (let poging = 0; poging < 4; poging++) {
    const r = opCloudflare
      ? await fetch(`https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}/ai/v1/chat/completions`, { method: "POST",
          headers: { Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`, "content-type": "application/json" },
          body: JSON.stringify({ model: RECHTER, max_tokens: 2000, messages: [
            { role: "system", content: `${opdracht}\nAntwoord met alleen een JSON-object volgens dit schema: ${JSON.stringify(schema)}` },
            { role: "user", content: inhoud }] }) })
      : await fetch("https://api.anthropic.com/v1/messages", { method: "POST",
          headers: { "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
          body: JSON.stringify({ model: RECHTER, max_tokens: 2000, system: opdracht,
            output_config: { format: { type: "json_schema", schema } }, messages: [{ role: "user", content: inhoud }] }) });
    if (r.status === 429 || r.status >= 500) { await new Promise(k => setTimeout(k, 15000)); continue; }
    if (!r.ok) throw new Error(`rechter: ${r.status} ${(await r.text()).slice(0, 200)}`);
    const j = await r.json();
    if (!opCloudflare) {
      kost.tel({ in: j.usage?.input_tokens || 0, uit: j.usage?.output_tokens || 0 }, kost.prijs(RECHTER));
      return JSON.parse(j.content.find(c => c.type === "text").text);
    }
    kost.tel({ in: j.usage?.prompt_tokens || 0, uit: j.usage?.completion_tokens || 0 }, PRIJS_CF);
    let o = null;
    try { o = JSON.parse(j.choices?.[0]?.message?.content?.match(/\{[\s\S]*\}/)?.[0]); } catch { /* opnieuw */ }
    if (o && schema.required.every(k => k in o) && Object.entries(schema.properties).every(([k, p]) => !p.enum || p.enum.includes(o[k]))) return o;
  }
  throw new Error("rechter: te druk, of geen geldig oordeel");
}

const OPDRACHT = `Je beoordeelt een antwoord van een vraag-en-antwoordsysteem over Vlaamse landbouw.
Het systeem mag alleen antwoorden uit de stukjes die het aanhaalt. Je krijgt de vraag, het antwoord, de aangehaalde stukjes,
en wat we over het juiste antwoord weten. Oordeel streng maar eerlijk:
- klopt: "ja" als het antwoord de vraag juist beantwoordt, "half" als het deels juist of onvolledig is, "nee" als het fout is of naast de vraag.
  Is het antwoord niet in de documenten te vinden, dan is "ja" een antwoord dat dat eerlijk zegt, en "nee" een antwoord dat toch iets beweert.
- bron: "ja" als elke bewering steun vindt in de aangehaalde stukjes, "deels" als sommige beweringen geen steun hebben, "nee" als de stukjes het antwoord niet dragen. Zonder beweringen: "ja".
  Het systeem moet zeggen hoe oud een bron is en aanraden de geldende regel na te kijken (bij de Mestbank, het Departement of een adviseur).
  Zulke zinnen zijn geen beweringen over de inhoud en hebben geen bron nodig; de datum van elk stukje staat erbij.
Geef een uitleg van één zin, in het Nederlands.`;

// Het oordeel komt terug als JSON volgens dit schema.
const SCHEMA = { type: "object", required: ["klopt", "bron", "uitleg"], additionalProperties: false, properties: {
  klopt: { type: "string", enum: ["ja", "half", "nee"] },
  bron: { type: "string", enum: ["ja", "deels", "nee"] },
  uitleg: { type: "string" } } };

export function oordeel({ vraag, antwoord, bronnen = [], kalender, verwacht }) {
  const stukjes = bronnen.map(b => `[S${b.id}] ${b.titel}${b.datum ? ` (${b.datum})` : ""}, p. ${b.pagina}:\n${b.tekst}`).join("\n\n") || "(geen)";
  return vraagRechter(OPDRACHT, SCHEMA, `VRAAG: ${vraag}\n\nWAT WE WETEN: ${verwacht}\n\nANTWOORD:\n${antwoord}\n\nAANGEHAALDE STUKJES:\n${stukjes}${kalender ? `\n\n[K] Uitrijkalender: ${kalender}` : ""}`);
}

// Wat we over het juiste antwoord weten, in woorden, uit een vraag van test/vragen.json.
export const verwacht = v => !v.bron ? "Het antwoord staat niet in de documenten."
  : v.bron === "kalender" ? `Het antwoord volgt uit de uitrijkalender; een juist antwoord past bij: ${v.sleutel}`
  : `Het antwoord staat in: ${[].concat(v.bron).join(" / ")}. Een juist antwoord bevat iets dat past bij het patroon: ${v.sleutel}`;

// Wat de rechter vond, samengevat zoals test/meet.mjs het toont.
export const pct = (n, d) => d ? `${n}/${d} (${Math.round(100 * n / d)}%)` : "–";
export function samenRechter(r) {
  const g = r.filter(x => x.rechter?.klopt), antwoorden = r.filter(x => x.antwoord).length;
  if (!g.length) return {};
  return { "rechter": RECHTER,
    "rechter: klopt": pct(g.filter(x => x.rechter.klopt === "ja").length, g.length),
    "rechter: half": pct(g.filter(x => x.rechter.klopt === "half").length, g.length),
    "rechter: bronnen dragen het": pct(g.filter(x => x.rechter.bron === "ja").length, g.length),
    ...(g.length < antwoorden ? { "rechter: geoordeeld": `${g.length} van ${antwoorden}` } : {}) };
}

// Opnieuw oordelen over bewaarde metingen (zie boven).
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const vragen = JSON.parse(readFileSync("test/vragen.json", "utf8"));
  // Alleen metingen van antwoorden (test/meet.mjs open|claude), niet die van het red team.
  const bestanden = process.argv.slice(2).map(pad => [pad, JSON.parse(readFileSync(pad, "utf8"))])
    .filter(([, u]) => ["open", "claude"].includes(u.wat));
  const veld = process.env.RECHTER_MODEL ? `rechter:${RECHTER}` : "rechter";
  const open = u => u.r.filter(x => x.antwoord && !x[veld]?.klopt);
  kost.schat(bestanden.reduce((n, [, u]) => n + open(u).length, 0), PER_OORDEEL);
  for (const [pad, u] of bestanden) {
    for (const x of open(u)) {
      try { x[veld] = await oordeel({ ...x, verwacht: verwacht(vragen.find(v => v.nr === x.nr)) }); }
      catch (e) { x[veld] = { fout: String(e.message).slice(0, 200) }; }
      process.stdout.write(".");
    }
    if (veld === "rechter") u.samen = { ...Object.fromEntries(Object.entries(u.samen).filter(([k]) => !k.startsWith("rechter"))), ...samenRechter(u.r) };
    writeFileSync(pad, JSON.stringify(u, null, 1));
    console.log(`\n${pad}`, u.samen);
  }
  console.log(`Besteed: $${kost.besteedTot()}`);
}
