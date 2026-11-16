// De agent met een nagemaakt model: de perceelfiche (eerst zoeken, dan invullen als JSON in de
// laatste ronde; een verzonnen bronnummer valt weg), een leeg antwoord, en Groq's tool_use_failed.
// node --test test/agent.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { vraagAan } from "../netlify/functions/lib/agent.mjs";
import { FICHE, VELDEN, perceelVraag } from "../netlify/functions/lib/fiche.mjs";

const perceel = { teelt: "silomaïs", grond: "akkerland", mest: "2", klasse: "III", datum: "2026-11-20", oppervlakte: 2.5 };

test("perceel wordt een vraag, een fout perceel niet", () => {
  assert.match(perceelVraag(perceel), /drijfmest .*type 2.*11-20/s);
  assert.equal(perceelVraag({ ...perceel, grond: "bos" }), null);
  assert.equal(perceelVraag({ ...perceel, oppervlakte: -1 }), null);
});

test("zoekt, vult in, en houdt alleen echte bronnen", async t => {
  const vragen = [];
  let echt;
  t.mock.method(globalThis, "fetch", async (url, init) => {
    const body = JSON.parse(init.body);
    vragen.push(body);
    if (vragen.length === 1) return Response.json({ content: [{ type: "tool_use", id: "a", name: "zoek_documenten", input: { zoekvraag: "uitrijperiode drijfmest akkerland", stapels: ["regels"] } }], usage: {} });
    if (vragen.length === 2) {
      echt = body.messages.at(-1).content[0].content.match(/\[S(\d+)\]/)[1];
      return Response.json({ content: [{ type: "text", text: "Ik heb genoeg gevonden." }], usage: {} });
    }
    const input = Object.fromEntries(Object.keys(VELDEN).map(k => [k, `Iets over ${k} [S${echt}] [S9999999].`]));
    return Response.json({ content: [{ type: "text", text: JSON.stringify(input) }], usage: {} });
  });
  const uit = await vraagAan("claude", perceelVraag(perceel), { maxRondes: 4, taak: FICHE });
  // Zonder gereedschap klaar: dan meteen de laatste ronde, met het formulier als JSON-schema.
  assert.deepEqual(vragen.map(v => v.tool_choice.type), ["auto", "auto", "none"]);
  assert.deepEqual(vragen[2].output_config.format.schema.required, Object.keys(VELDEN));
  assert.equal(vragen[2].messages.at(-1).content, "Vul nu de fiche in.");
  assert.deepEqual(Object.keys(uit.formulier), Object.keys(VELDEN));
  assert.equal(uit.formulier.stikstof, `Iets over stikstof [S${echt}].`);
  assert.deepEqual(uit.bronnen.map(b => String(b.id)), [echt]);
});

test("een leeg laatste antwoord wordt nog één keer gevraagd", async t => {
  const vragen = [];
  t.mock.method(globalThis, "fetch", async (url, init) => {
    vragen.push(JSON.parse(init.body));
    if (vragen.length === 1) return Response.json({ content: [{ type: "tool_use", id: "a", name: "zoek_documenten", input: { zoekvraag: "bemesten gras voor 16 maart" } }], usage: {} });
    if (vragen.length === 2) return Response.json({ content: [], usage: {} });
    return Response.json({ content: [{ type: "text", text: "Ja, dat mag." }], usage: {} });
  });
  const uit = await vraagAan("claude", "Mag ik gras bemesten voor 16 maart?", { maxRondes: 1 });
  assert.equal(vragen.length, 3);
  // Het lege antwoord komt niet in het gesprek; de vraag staat bij de antwoorden van het zoeken.
  assert.deepEqual(vragen[2].messages.at(-1).content.map(c => c.type), ["tool_result", "text"]);
  assert.equal(uit.antwoord, "Ja, dat mag.");
});

test("open model dat niet zoekt waar het moest: één herinnering, daarna telt de tekst", async t => {
  process.env.GROQ_API_KEY ||= "test";
  const vragen = [];
  t.mock.method(globalThis, "fetch", async (url, init) => {
    vragen.push(JSON.parse(init.body));
    return Response.json({ error: { message: "Tool choice is required, but model did not call a tool",
      type: "invalid_request_error", code: "tool_use_failed", failed_generation: "Dat staat niet in mijn documenten." } }, { status: 400 });
  });
  const uit = await vraagAan("open", "Hoeveel kost een tractor?");
  assert.equal(vragen.length, 2);
  assert.match(vragen[1].messages.at(-1).content, /Zoek eerst/);
  assert.equal(uit.antwoord, "Dat staat niet in mijn documenten.");
});
