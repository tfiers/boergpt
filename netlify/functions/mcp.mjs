// BoerGPT als MCP-server: elk programma dat MCP spreekt (Claude, een eigen agent, een IDE)
// kan hier de documenten doorzoeken en de uitrijkalender raadplegen, zonder ons taalmodel.
// Zelfde gereedschap als de agent (lib/agent.mjs). Stateless "Streamable HTTP": elk verzoek
// is één JSON-RPC-bericht met één JSON-antwoord. Kost geen tokens; alleen de vraagvector
// komt van Cloudflare, zoals bij de demo.
//   claude mcp add --transport http boergpt https://boergpt.netlify.app/mcp
import { GEREEDSCHAP, voerUit } from "./lib/agent.mjs";

const VERSIES = ["2025-06-18", "2025-03-26", "2024-11-05"];
const tools = GEREEDSCHAP.map(g => ({ name: g.naam, description: g.uitleg,
  inputSchema: { type: "object", properties: g.velden, required: g.verplicht } }));

const antwoord = (id, result) => Response.json({ jsonrpc: "2.0", id, result });
const fout = (id, code, message, status = 200) => Response.json({ jsonrpc: "2.0", id, error: { code, message } }, { status });

export default async req => {
  if (req.method === "GET") return new Response("BoerGPT MCP-server: stuur JSON-RPC met POST.", { status: 405, headers: { allow: "POST" } });
  if (req.method !== "POST") return new Response(null, { status: 405, headers: { allow: "POST" } });
  let bericht;
  try { bericht = await req.json(); } catch { return fout(null, -32700, "Geen geldige JSON.", 400); }
  if (Array.isArray(bericht)) return fout(null, -32600, "Eén bericht per verzoek.", 400);
  const { id, method, params = {} } = bericht;
  if (id === undefined) return new Response(null, { status: 202 });   // een melding, bv. notifications/initialized
  switch (method) {
    case "initialize":
      return antwoord(id, {
        protocolVersion: VERSIES.includes(params.protocolVersion) ? params.protocolVersion : VERSIES[0],
        capabilities: { tools: {} },
        serverInfo: { name: "boergpt", title: "BoerGPT", version: "1.0.0" },
        instructions: "Openbare documenten over landbouw in Vlaanderen (VLM-mestregels, praktijkgidsen, GLB-subsidies, het Mestdecreet, ILVO-onderzoek) en de uitrijregeling van de VLM. Elk stukje heeft een nummer, titel, uitgever, datum en pagina: noem die als bron. Geen officieel advies.",
      });
    case "ping": return antwoord(id, {});
    case "tools/list": return antwoord(id, { tools });
    case "tools/call": {
      const g = GEREEDSCHAP.find(x => x.naam === params.name);
      if (!g) return fout(id, -32602, `Onbekend gereedschap: ${params.name}`);
      const args = params.arguments || {};
      const mist = g.verplicht.filter(v => args[v] === undefined);
      if (mist.length) return antwoord(id, { isError: true, content: [{ type: "text", text: `Ontbreekt: ${mist.join(", ")}` }] });
      try {
        const { tekst } = await voerUit(g.naam, args);
        return antwoord(id, { content: [{ type: "text", text: tekst }] });
      } catch (e) {
        console.error(e);
        return antwoord(id, { isError: true, content: [{ type: "text", text: "Het gereedschap liep fout. Probeer het opnieuw." }] });
      }
    }
    default: return fout(id, -32601, `Onbekende methode: ${method}`);
  }
};

// Netlify weigert wie meer dan 30 verzoeken per minuut stuurt, nog voor de functie draait.
export const config = { path: "/mcp", rateLimit: { action: "rate_limit", aggregateBy: ["ip", "domain"], windowSize: 60, windowLimit: 30 } };
