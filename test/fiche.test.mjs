// De papierwerk-agent met een nagemaakte Claude: eerst zoeken (verplicht), dan de fiche
// invullen (verplicht in de laatste ronde). Een verzonnen bronnummer valt weg.
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
  const keuzes = [];
  let echt;
  t.mock.method(globalThis, "fetch", async (url, init) => {
    const body = JSON.parse(init.body);
    keuzes.push(body.tool_choice);
    const ronde = keuzes.length;
    if (ronde === 1) return Response.json({ content: [{ type: "tool_use", id: "a", name: "zoek_documenten", input: { zoekvraag: "uitrijperiode drijfmest akkerland", stapels: ["regels"] } }], usage: {} });
    echt = body.messages.at(-1).content[0].content.match(/\[S(\d+)\]/)[1];
    const input = Object.fromEntries(Object.keys(VELDEN).map(k => [k, `Iets over ${k} [S${echt}] [S9999999].`]));
    return Response.json({ content: [{ type: "tool_use", id: "b", name: "vul_fiche", input }], usage: {} });
  });
  const uit = await vraagAan("claude", perceelVraag(perceel), { maxRondes: 4, taak: FICHE });
  assert.deepEqual(keuzes, [{ type: "any" }, { type: "any" }]);
  assert.deepEqual(Object.keys(uit.formulier), Object.keys(VELDEN));
  assert.equal(uit.formulier.stikstof, `Iets over stikstof [S${echt}].`);
  assert.deepEqual(uit.bronnen.map(b => String(b.id)), [echt]);
});
