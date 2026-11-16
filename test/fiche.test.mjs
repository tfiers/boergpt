// De papierwerk-agent met een nagemaakte Claude: eerst zoeken, dan de fiche invullen
// als JSON in de laatste ronde. Een verzonnen bronnummer valt weg.
// node --test test/fiche.test.mjs
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
