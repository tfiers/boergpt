// Het blinde oordeel: alleen wie de link met sleutel heeft, kan oordelen of zijn oordelen lezen,
// en de openbare lijst toont geen namen en geen opmerkingen.
// node --test test/oordeel.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, writeFileSync, rmSync } from "node:fs";
import { opslag } from "../netlify/functions/lib/budget.mjs";
import { nepStore } from "./nep.mjs";

process.env.OORDEEL_GEHEIM = "test-geheim";
const nieuw = !existsSync("data/oordeel.json");
if (nieuw) writeFileSync("data/oordeel.json", JSON.stringify({ ronde: "2026-01-01", items: [{ id: "a1", vraag: "v", antwoord: "a", bronnen: [] }] }));
const { default: oordeel, sleutelVoor } = await import("../netlify/functions/oordeel.mjs");
const winkel = nepStore();
opslag.open = () => winkel;
const vraag = (pad, body) => oordeel(new Request(`http://x/api/oordeel${pad}`, body ? { method: "POST", body: JSON.stringify(body) } : {}));

test("sleutel nodig om te oordelen en te lezen; de lijst is anoniem", async t => {
  t.after(() => { if (nieuw) rmSync("data/oordeel.json"); });
  const item = "a1";   // de eerste id van elke ronde
  const s = sleutelVoor("wannes");
  assert.equal((await vraag("", { wie: "wannes", item, klopt: "ja", bron: "ja", opmerking: "geheim" })).status, 403);
  assert.equal((await vraag("", { wie: "wannes", sleutel: "0".repeat(24), item, klopt: "ja", bron: "ja" })).status, 403);
  assert.equal((await vraag("", { wie: "wannes", sleutel: s, item, klopt: "ja", bron: "ja", opmerking: "geheim" })).status, 200);
  assert.equal((await vraag("?wie=wannes")).status, 403);
  const eigen = await (await vraag(`?wie=wannes&sleutel=${s}`)).json();
  assert.equal(eigen.oordelen[0].opmerking, "geheim");
  const alles = await (await vraag("?alles")).json();
  assert.deepEqual(alles.oordelen.map(o => [o.door, o.wie, o.opmerking]), [[1, undefined, undefined]]);
});
