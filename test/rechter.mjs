// Een model als rechter: leest vraag, antwoord en de aangehaalde stukjes, en oordeelt of het
// antwoord klopt en of de bronnen het dragen. Het weet niet welk model het antwoord schreef.
// Gebruikt door test/meet.mjs --rechter. Het oordeel van mensen (public/oordeel.html) toont
// hoe vaak de rechter het met een expert eens is.
const RECHTER = process.env.RECHTER_MODEL || "claude-sonnet-5-5";

const OPDRACHT = `Je beoordeelt een antwoord van een vraag-en-antwoordsysteem over Vlaamse landbouw.
Het systeem mag alleen antwoorden uit de stukjes die het aanhaalt. Je krijgt de vraag, het antwoord, de aangehaalde stukjes,
en wat we over het juiste antwoord weten. Oordeel streng maar eerlijk:
- klopt: "ja" als het antwoord de vraag juist beantwoordt, "half" als het deels juist of onvolledig is, "nee" als het fout is of naast de vraag.
  Is het antwoord niet in de documenten te vinden, dan is "ja" een antwoord dat dat eerlijk zegt, en "nee" een antwoord dat toch iets beweert.
- bron: "ja" als elke bewering steun vindt in de aangehaalde stukjes, "deels" als sommige beweringen geen steun hebben, "nee" als de stukjes het antwoord niet dragen. Zonder beweringen: "ja".
Geef een uitleg van één zin, in het Nederlands.`;

const GEREEDSCHAP = [{ name: "oordeel", description: "Je oordeel over het antwoord.",
  input_schema: { type: "object", required: ["klopt", "bron", "uitleg"], properties: {
    klopt: { type: "string", enum: ["ja", "half", "nee"] },
    bron: { type: "string", enum: ["ja", "deels", "nee"] },
    uitleg: { type: "string" } } } }];

export async function oordeel({ vraag, antwoord, bronnen = [], kalender, verwacht }) {
  const stukjes = bronnen.map(b => `[S${b.id}] ${b.titel}, p. ${b.pagina}:\n${b.tekst}`).join("\n\n") || "(geen)";
  const inhoud = `VRAAG: ${vraag}\n\nWAT WE WETEN: ${verwacht}\n\nANTWOORD:\n${antwoord}\n\nAANGEHAALDE STUKJES:\n${stukjes}${kalender ? `\n\n[K] Uitrijkalender: ${kalender}` : ""}`;
  for (let poging = 0; poging < 4; poging++) {
    const r = await fetch("https://api.anthropic.com/v1/messages", { method: "POST",
      headers: { "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: RECHTER, max_tokens: 400, system: OPDRACHT, tools: GEREEDSCHAP,
        tool_choice: { type: "tool", name: "oordeel" }, messages: [{ role: "user", content: inhoud }] }) });
    if (r.status === 429 || r.status >= 500) { await new Promise(k => setTimeout(k, 15000)); continue; }
    if (!r.ok) throw new Error(`rechter: ${r.status} ${(await r.text()).slice(0, 200)}`);
    return (await r.json()).content.find(c => c.type === "tool_use").input;
  }
  throw new Error("rechter: te druk");
}

// Wat we over het juiste antwoord weten, in woorden, uit een vraag van test/vragen.json.
export const verwacht = v => !v.bron ? "Het antwoord staat niet in de documenten."
  : v.bron === "kalender" ? `Het antwoord volgt uit de uitrijkalender; een juist antwoord past bij: ${v.sleutel}`
  : `Het antwoord staat in: ${[].concat(v.bron).join(" / ")}. Een juist antwoord bevat iets dat past bij het patroon: ${v.sleutel}`;
