// Claude met een dagbudget in dollar, en het open model in zijn plaats als dat op is of als
// Claude niet antwoordt (de maandlimiet van de sleutel). node --test test/antwoord.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { opslag, kost } from "../netlify/functions/lib/budget.mjs";
import { beantwoord } from "../netlify/functions/lib/antwoord.mjs";
import { nepStore } from "./nep.mjs";

process.env.GROQ_API_KEY ||= "test";
process.env.CLAUDE_DOLLAR_PER_DAG = "0.5";
const winkels = {};
opslag.open = naam => (winkels[naam] ??= nepStore());

// Een nagemaakt model: Claude antwoordt met `claude` (of een fout), het open model zegt altijd "open".
function nepModel(t, claude) {
  const aan = [];
  t.mock.method(globalThis, "fetch", async url => {
    const wie = String(url).includes("anthropic") ? "claude" : "open";
    aan.push(wie);
    if (wie === "claude") return claude();
    return Response.json({ choices: [{ message: { content: "Antwoord van open." } }], usage: { prompt_tokens: 10, completion_tokens: 5 } });
  });
  return aan;
}

test("Claude antwoordt en zijn kost telt mee", async t => {
  const aan = nepModel(t, () => Response.json({ content: [{ type: "text", text: "Antwoord van Claude." }], usage: { input_tokens: 100000, output_tokens: 10000 } }));
  const uit = await beantwoord("claude", "Wat is een ureaseremmer?", { maxRondes: 0 });
  assert.equal(uit.antwoord, "Antwoord van Claude.");
  assert.equal(uit.vervanger, undefined);
  assert.deepEqual(aan, ["claude"]);
  assert.equal(kost({ in: 100000, uit: 10000 }), 0.3);
});

test("is het dagbudget op, dan antwoordt het open model, en dat staat erbij", async t => {
  const aan = nepModel(t, () => assert.fail("Claude mag niet meer gevraagd worden"));
  // Na de vorige test staat er $0,30; nog één zo'n vraag en de standaard $0,50 is over.
  const dag = new Date().toISOString().slice(0, 10);
  await opslag.open("budget-claude").set(`${dag}/300000/x`, "");
  const uit = await beantwoord("claude", "Wat is een ureaseremmer?", { maxRondes: 0 });
  assert.deepEqual(aan, ["open"]);
  assert.equal(uit.antwoord, "Antwoord van open.");
  assert.match(uit.vervanger, /budget voor vandaag op.*open model/);
  assert.match(uit.model, /open model/);
});

test("antwoordt Claude niet (maandlimiet), dan antwoordt het open model", async t => {
  winkels["budget-claude"] = nepStore();
  const aan = nepModel(t, () => Response.json({ type: "error", error: { type: "invalid_request_error", message: "You have reached your specified API usage limits." } }, { status: 400 }));
  const uit = await beantwoord("claude", "Wat is een ureaseremmer?", { maxRondes: 0 });
  assert.deepEqual(aan, ["claude", "open"]);
  assert.match(uit.vervanger, /antwoordt nu niet/);
});
