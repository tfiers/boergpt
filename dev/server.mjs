// Lokale stand-in: serveert public/ en beantwoordt /api/vraag en /api/perceel met een nep-model
// dat echt zoekt (zelfde agent-lus), met vertraging, en /api/oordeel met de echte functie en een
// opslag in het geheugen (maak een link met node test/oordeel.mjs code test http://localhost:8787).
// Alleen om de pagina's te testen.
import http from "node:http"; import { readFileSync, existsSync } from "node:fs"; import { join, extname } from "node:path";
process.chdir(process.argv[2]);
const echteFetch = globalThis.fetch;
globalThis.fetch = async (url, opt) => {
  if (!String(url).includes("anthropic") && !String(url).includes("groq")) return echteFetch(url, opt);
  await new Promise(r => setTimeout(r, 900));
  const b = JSON.parse(opt.body), isA = String(url).includes("anthropic");
  const laatste = JSON.stringify(b.messages.at(-1));
  const vraag = isA ? b.messages[0].content : b.messages[1].content;
  if (b.messages.length <= 2 && !isA || b.messages.length === 1) {
    const calls = [{ n: "zoek_documenten", a: { zoekvraag: vraag, stapels: ["regels", "praktijk", "onderzoek"] } }];
    if (/uitrij|mest/i.test(vraag)) calls.push({ n: "uitrijkalender", a: { type: 2, grond: "grasland", datum: "11-25" } });
    return new Response(JSON.stringify(isA ? { content: calls.map((c, i) => ({ type: "tool_use", id: "t" + i, name: c.n, input: c.a })) }
      : { choices: [{ message: { content: null, tool_calls: calls.map((c, i) => ({ id: "t" + i, function: { name: c.n, arguments: JSON.stringify(c.a) } })) } }] }));
  }
  const ids = [...JSON.stringify(b.messages).matchAll(/\[S(\d+)\]/g)].map(m => m[1]);
  // De perceelfiche: het formulier als JSON (Claude) of als oproep van vul_fiche (open model).
  const velden = b.output_config?.format.schema.required || (b.tool_choice?.function && b.tools.find(t => t.function.name === b.tool_choice.function.name).function.parameters.required);
  if (velden) {
    const fiche = JSON.stringify(Object.fromEntries(velden.map((k, i) => [k, i % 3 === 2 ? "Niet gevonden in mijn documenten." : `Nepveld ${k} [S${ids[i % ids.length]}]${/K\]/.test(JSON.stringify(b.messages)) && i < 2 ? " [K]" : ""}.`])));
    return new Response(JSON.stringify(isA ? { content: [{ type: "text", text: fiche }] }
      : { choices: [{ message: { content: null, tool_calls: [{ id: "f", function: { name: "vul_fiche", arguments: fiche } }] } }] }));
  }
  const txt = `Nepantwoord voor de test, uit het eerste stukje [S${ids[0]}]. Een tweede zin uit een ander stukje [S${ids[1]}].` + (/K\]/.test(laatste) ? " Volgens de uitrijkalender mag het niet [K]." : "");
  return new Response(JSON.stringify(isA ? { content: [{ type: "text", text: txt }] } : { choices: [{ message: { content: txt } }] }));
};
const { vraagAan, MODELLEN } = await import(join(process.cwd(), "netlify/functions/lib/agent.mjs"));
const { FICHE, perceelVraag } = await import(join(process.cwd(), "netlify/functions/lib/fiche.mjs"));
const { opslag } = await import(join(process.cwd(), "netlify/functions/lib/budget.mjs"));
const { nepStore } = await import(join(process.cwd(), "test/nep.mjs"));
const winkels = {};
opslag.open = naam => (winkels[naam] ??= nepStore());
const { default: oordeel } = await import(join(process.cwd(), "netlify/functions/oordeel.mjs"));
const lees = async req => { let body = ""; for await (const c of req) body += c; return JSON.parse(body); };
const stuur = (res, data, status = 200) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(data)); };
const TYPE = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json" };
http.createServer(async (req, res) => {
  if (req.url === "/api/vraag") {
    const { vraag, model } = await lees(req);
    if (vraag.includes("429")) return stuur(res, { fout: "De demo heeft zijn vragen voor vandaag op. Probeer het morgen opnieuw." }, 429);
    return stuur(res, { model: MODELLEN[model].naam, ...await vraagAan(model, vraag) });
  }
  if (req.url === "/api/perceel") {
    const p = await lees(req), vraag = perceelVraag(p);
    if (!vraag) return stuur(res, { fout: "Vul elk veld in." }, 400);
    return stuur(res, { model: MODELLEN[p.model === "open" ? "open" : "claude"].naam, vraag, ...await vraagAan(p.model === "open" ? "open" : "claude", vraag, { maxRondes: 4, taak: FICHE }) });
  }
  if (req.url.startsWith("/api/oordeel")) {
    const body = req.method === "POST" ? JSON.stringify(await lees(req)) : undefined;
    const r = await oordeel(new Request(`http://localhost${req.url}`, { method: req.method, body }));
    return stuur(res, await r.json(), r.status);
  }
  const p = join("public", req.url === "/" ? "index.html" : req.url.split("?")[0]);
  if (!existsSync(p)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "content-type": TYPE[extname(p)] || "text/plain" }); res.end(readFileSync(p));
}).listen(8787, () => console.log(`op http://localhost:8787`));
