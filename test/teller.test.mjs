// De dagteller: een grens die ook houdt als veel vragen tegelijk binnenkomen.
// node --test test/teller.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
process.env.DAGLIMIET = "5"; process.env.PER_PERSOON = "3";
const { telOp } = await import("../netlify/functions/lib/budget.mjs");

const nepStore = () => {
  const m = new Map();
  return {
    set: async (k, v) => { await null; m.set(k, v); },
    delete: async k => { await null; m.delete(k); },
    list: async ({ prefix }) => { await null; return { blobs: [...m.keys()].filter(k => k.startsWith(prefix)).map(key => ({ key })) }; },
  };
};

test("per persoon en per dag", async () => {
  const s = nepStore();
  for (let i = 0; i < 3; i++) assert.equal(await telOp(s, "1.1.1.1", "2026-11-13"), null);
  assert.match(await telOp(s, "1.1.1.1", "2026-11-13"), /veel vragen/);
  for (let i = 0; i < 2; i++) assert.equal(await telOp(s, "2.2.2.2", "2026-11-13"), null);
  assert.match(await telOp(s, "3.3.3.3", "2026-11-13"), /op/);
  assert.equal(await telOp(s, "3.3.3.3", "2026-11-14"), null);
});

test("veel vragen tegelijk geraken niet over de grens", async () => {
  const s = nepStore();
  const uit = await Promise.all(Array.from({ length: 50 }, (_, i) => telOp(s, `9.9.9.${i}`, "2026-11-13")));
  assert.ok(uit.filter(x => x === null).length <= 5);
});

test("één bezoeker kan het dagbudget van anderen niet opmaken", async () => {
  const s = nepStore();
  for (let i = 0; i < 20; i++) await telOp(s, "6.6.6.6", "2026-11-13");
  assert.equal(await telOp(s, "7.7.7.7", "2026-11-13"), null);
});

test("het IP-adres wordt niet bewaard", async () => {
  const s = nepStore(); const keys = [];
  s.set = async k => keys.push(k);
  s.list = async () => ({ blobs: [] });
  await telOp(s, "203.0.113.7", "2026-11-13");
  assert.ok(!keys[0].includes("203.0.113.7"));
});
