// Zet de laatste uitslagen van test/meet.mjs samen in public/meting.json, voor de
// rubriek "Hoe goed is het?" op de pagina: per tabel rijen × kolommen. Draai na elke meting.
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const lees = naam => existsSync(`test/${naam}.json`) ? JSON.parse(readFileSync(`test/${naam}.json`, "utf8")) : null;
const procent = s => s?.match(/\((\d+%)\)/)?.[1] ?? "–";
const cel = (naam, sleutel) => { const u = lees(naam); return u ? procent(Object.entries(u.samen).find(([k]) => k.startsWith(sleutel))?.[1]) : "–"; };
const datum = namen => namen.map(lees).filter(Boolean).map(u => u.datum).sort().at(-1);

const zoekNamen = ["uitslag-zoek-woorden", "uitslag-zoek", "uitslag-zoek-apart-woorden", "uitslag-zoek-apart"];
const modelNamen = ["uitslag-open", "uitslag-claude"];
const modelRij = (label, naam) => { const u = lees(naam); return u && [label,
  procent(u.samen["juiste bron geciteerd"]), procent(u.samen["antwoord klopt"]),
  procent(u.samen["zegt eerlijk 'weet ik niet'"]), `${u.samen.seconden} s`]; };

const meting = [
  { titel: "Zoeken: zit het juiste document bij de 6 stukjes die het model krijgt?", datum: datum(zoekNamen),
    kolommen: ["", "oefenvragen", "apart gehouden"],
    rijen: [["alleen op woorden", cel("uitslag-zoek-woorden", "juiste bron bij"), cel("uitslag-zoek-apart-woorden", "juiste bron bij")],
            ["woorden + betekenis", cel("uitslag-zoek", "juiste bron bij"), cel("uitslag-zoek-apart", "juiste bron bij")]] },
  { titel: "Antwoorden, op de oefenvragen", datum: datum(modelNamen),
    kolommen: ["", "juiste bron", "klopt", "zegt 'weet ik niet'", "tijd"],
    rijen: [modelRij("open model", "uitslag-open"), modelRij("Claude", "uitslag-claude")].filter(Boolean) },
].filter(t => t.rijen.length);
writeFileSync("public/meting.json", JSON.stringify(meting, null, 1));
console.log(`public/meting.json: ${meting.length} tabellen`);
