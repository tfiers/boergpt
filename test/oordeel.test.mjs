// Het blinde oordeel: alleen wie de link met zijn code heeft, kan oordelen of zijn oordelen lezen,
// en de openbare lijst toont geen namen en geen opmerkingen.
// node --test test/oordeel.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { opslag } from "../netlify/functions/lib/budget.mjs";
import { nepStore } from "./nep.mjs";

// Een eigen ronde, in de plaats van data/oordeel.json zolang de test loopt.
const { hash } = await import("../netlify/functions/oordeel.mjs");
const echt = existsSync("data/oordeel.json") ? readFileSync("data/oordeel.json") : null;
writeFileSync("data/oordeel.json", JSON.stringify({ ronde: "2026-01-01", codes: { wannes: hash("c0de") }, items: [{ id: "a1", vraag: "v", antwoord: "a", bronnen: [] }] }));
const { default: oordeel } = await import("../netlify/functions/oordeel.mjs");
const winkel = nepStore();
opslag.open = () => winkel;
const vraag = (pad, body) => oordeel(new Request(`http://x/api/oordeel${pad}`, body ? { method: "POST", body: JSON.stringify(body) } : {}));

test("sleutel nodig om te oordelen en te lezen; de lijst is anoniem", async t => {
  t.after(() => { if (echt) writeFileSync("data/oordeel.json", echt); else rmSync("data/oordeel.json"); });
  const item = "a1";
  assert.equal((await vraag("", { wie: "wannes", item, klopt: "ja", bron: "ja", opmerking: "geheim" })).status, 403);
  assert.equal((await vraag("", { wie: "wannes", code: "fout", item, klopt: "ja", bron: "ja" })).status, 403);
  assert.equal((await vraag("", { wie: "isabeau", code: "c0de", item, klopt: "ja", bron: "ja" })).status, 403);
  assert.equal((await vraag("", { wie: "toString", code: "c0de", item, klopt: "ja", bron: "ja" })).status, 403);
  assert.equal((await vraag("", { wie: "wannes", code: "c0de", item, klopt: "ja", bron: "ja", opmerking: "geheim" })).status, 200);
  assert.equal((await vraag("?wie=wannes")).status, 403);
  const eigen = await (await vraag("?wie=wannes&code=c0de")).json();
  assert.equal(eigen.oordelen[0].opmerking, "geheim");
  assert.equal(eigen.codes, undefined);
  const alles = await (await vraag("?alles")).json();
  assert.deepEqual(alles.oordelen.map(o => [o.door, o.wie, o.opmerking]), [[1, undefined, undefined]]);
});
