// Lokale stand-in: serveert public/ en beantwoordt /api/vraag met een nep-model
// dat echt zoekt (zelfde agent-lus), met vertraging. Alleen om de pagina te testen.
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
  const ids = [...laatste.matchAll(/\[S(\d+)\]/g)].map(m => m[1]);
  const txt = `Nepantwoord voor de test, uit het eerste stukje [S${ids[0]}]. Een tweede zin uit een ander stukje [S${ids[1]}].` + (/K\]/.test(laatste) ? " Volgens de uitrijkalender mag het niet [K]." : "");
  return new Response(JSON.stringify(isA ? { content: [{ type: "text", text: txt }] } : { choices: [{ message: { content: txt } }] }));
};
const { vraagAan, MODELLEN } = await import(join(process.cwd(), "netlify/functions/lib/agent.mjs"));
const TYPE = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json" };
http.createServer(async (req, res) => {
  if (req.url === "/api/vraag") {
    let body = ""; for await (const c of req) body += c;
    const { vraag, model } = JSON.parse(body);
    if (vraag.includes("429")) { res.writeHead(429, { "content-type": "application/json" }); return res.end(JSON.stringify({ fout: "De demo heeft zijn vragen voor vandaag op. Probeer het morgen opnieuw." })); }
    const uit = await vraagAan(model, vraag);
    res.writeHead(200, { "content-type": "application/json" }); return res.end(JSON.stringify({ model: MODELLEN[model].naam, ...uit }));
  }
  const p = join("public", req.url === "/" ? "index.html" : req.url.split("?")[0]);
  if (!existsSync(p)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "content-type": TYPE[extname(p)] || "text/plain" }); res.end(readFileSync(p));
}).listen(8787, () => console.log("op http://localhost:8787"));
