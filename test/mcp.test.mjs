// De MCP-server: handdruk, lijst van gereedschap en een oproep, zoals een MCP-programma ze stuurt.
// node --test test/mcp.test.mjs   (zonder Cloudflare-sleutel zoekt hij alleen op woorden)
import { test } from "node:test";
import assert from "node:assert/strict";
import { opslag } from "../netlify/functions/lib/budget.mjs";
import { nepStore } from "./nep.mjs";
const { default: mcp } = await import("../netlify/functions/mcp.mjs");
const winkels = {};
opslag.open = naam => (winkels[naam] ??= nepStore());

const stuur = async (bericht, tekst = JSON.stringify(bericht)) => {
  const r = await mcp(new Request("http://x/mcp", { method: "POST", body: tekst }), { ip: "203.0.113.9" });
  return { status: r.status, body: r.status === 202 ? null : await r.json() };
};

test("handdruk en melding", async () => {
  const { body } = await stuur({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } });
  assert.equal(body.result.protocolVersion, "2025-06-18");
  assert.equal((await stuur({ jsonrpc: "2.0", method: "notifications/initialized" })).status, 202);
});

test("gereedschap opvragen en gebruiken", async () => {
  const { body } = await stuur({ jsonrpc: "2.0", id: 2, method: "tools/list" });
  assert.deepEqual(body.result.tools.map(t => t.name), ["zoek_documenten", "uitrijkalender"]);
  const k = await stuur({ jsonrpc: "2.0", id: 3, method: "tools/call",
    params: { name: "uitrijkalender", arguments: { type: 2, grond: "grasland", datum: "11-25" } } });
  assert.match(k.body.result.content[0].text, /Neen/);
  const z = await stuur({ jsonrpc: "2.0", id: 4, method: "tools/call",
    params: { name: "zoek_documenten", arguments: { zoekvraag: "ureaseremmers", stapels: ["onderzoek"] } } });
  assert.match(z.body.result.content[0].text, /\[S\d+\] .*Ureaseremmers/);
});

test("fouten", async () => {
  const leeg = await stuur({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "uitrijkalender", arguments: {} } });
  assert.equal(leeg.body.result.isError, true);
  assert.equal((await stuur({ jsonrpc: "2.0", id: 6, method: "iets" })).body.error.code, -32601);
  assert.equal((await stuur(null, "null")).body.error.code, -32600);
  assert.equal((await stuur({ jsonrpc: "2.0", id: 7, method: "tools/list", params: null })).body.result.tools.length, 2);
  const lang = await stuur({ jsonrpc: "2.0", id: 8, method: "tools/call",
    params: { name: "zoek_documenten", arguments: { zoekvraag: "x".repeat(401), stapels: ["regels"] } } });
  assert.match(lang.body.result.content[0].text, /Te lang/);
});

test("een oproep telt mee in het eigen dagbudget van MCP", async () => {
  const voor = (await winkels["budget-mcp"].list()).blobs.length;
  await stuur({ jsonrpc: "2.0", id: 9, method: "tools/call", params: { name: "uitrijkalender", arguments: { type: 1, grond: "akkerland", datum: "03-01" } } });
  assert.equal((await winkels["budget-mcp"].list()).blobs.length, voor + 1);
});
