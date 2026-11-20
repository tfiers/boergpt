// Wat de vraagpagina en de perceelpagina delen: bronnen tonen bij een tekst met [S12] en [K].
export const $ = s => document.querySelector(s);
export const esc = t => String(t).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
export const STAPEL = { regels: "mestregels (VLM)", praktijk: "praktijkgidsen", onderzoek: "ILVO-onderzoek", subsidies: "GLB-subsidies", wet: "Mestdecreet" };
export const maand = d => new Date(d.length === 4 ? `${d}-06` : `${d}-01`).toLocaleDateString("nl-BE", d.length === 4 ? { year: "numeric" } : { month: "short", year: "numeric" });
const HTTP = { 400: "Bad Request", 405: "Method Not Allowed", 429: "Too Many Requests", 500: "Internal Server Error", 502: "Bad Gateway", 503: "Service Unavailable", 504: "Gateway Timeout" };

// Welk nummer elke bron heeft: de pdf staat op /pdf/<nr>.pdf (public/_redirects).
export const bronLijst = fetch("bronnen.json").then(r => r.json());
const bronNr = new Map();
bronLijst.then(lijst => lijst.forEach((b, i) => bronNr.set(b.url, i))).catch(() => {});

// Vraagt iets aan een functie van de site en geeft de data terug, of zet een foutmelding in doos.
export async function haal(doos, pad, body, stop) {
  let r, data;
  try {
    r = await fetch(pad, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify(body), signal: AbortSignal.timeout(90000) });
    data = await r.json().catch(() => ({}));
  } catch (e) {
    stop();
    doos.innerHTML = e.name === "TimeoutError"
      ? `<p class="fout">Na anderhalve minuut nog geen antwoord. Probeer het zo opnieuw.</p>`
      : `<p class="fout">Geen verbinding. Wat je invulde blijft staan; probeer opnieuw als je weer online bent.</p>`;
    return null;
  }
  stop();
  if (!r.ok) {
    doos.innerHTML = `<p class="fout"><span title="${esc(r.status)} ${esc(HTTP[r.status] || "")}">${r.status} ${HTTP[r.status] || ""}</span>: ${esc(data.fout || "er liep iets mis.")}</p>`;
    return null;
  }
  return data;
}

// "Zoekt en schrijft… 12 s": de tijd loopt, zodat je ziet dat er nog iets gebeurt.
export function laden(doos, wat, traag = "") {
  const t0 = performance.now();
  const zet = () => {
    const s = Math.round((performance.now() - t0) / 1000);
    doos.innerHTML = `<p class="laden">${wat}… ${s} s${s >= 15 && traag ? `<br>${traag}` : ""}</p>`;
  };
  zet();
  const klok = setInterval(zet, 1000);
  return () => clearInterval(klok);
}

// Zet [S12] en [K] om in tikbare nummers. nr: stukje-id → nummer in de bronnenlijst.
export const refs = (tekst, d, nr) => esc(tekst)
  .replace(/\[S(\d+)\]/g, (_, id) => nr.has(+id) ? `<button class="ref" data-ref="${id}">${nr.get(+id)}</button>` : "")
  .replace(/\[K\]/g, d.kalender ? `<button class="ref" data-ref="K">K</button>` : "");

export const nummers = d => new Map(d.bronnen.map((b, i) => [b.id, i + 1]));

export const stappenHtml = (d, sec) => `<details class="stappen"><summary>${d.stappen.length} ${d.stappen.length === 1 ? "stap" : "stappen"} · ${sec} s</summary><ol>${
  d.stappen.map(s => s.wat === "zoek"
    ? `<li>Zocht <q>${esc(s.zoekvraag)}</q> in ${esc([].concat(s.stapels || []).map(x => STAPEL[x] || x).join(", "))} (${esc(s.manier)})</li>`
    : `<li>Keek de uitrijkalender na: type ${esc(s.type)}, ${esc(s.grond)}, ${esc(s.datum)} → ${esc(s.mag || "?")}</li>`).join("")}</ol></details>`;

// De bronnen per document, en binnen een document per pagina: de titel staat één keer,
// elke pagina is een knop met de nummers die de tekst ernaar gebruikt.
// Geeft de html en een functie die de knoppen in doos laat werken.
export function bronnenHtml(d, nr) {
  const docs = new Map(), naarPagina = new Map();
  for (const b of d.bronnen) {
    if (!docs.has(b.titel)) docs.set(b.titel, { b, paginas: new Map() });
    const pag = docs.get(b.titel).paginas;
    const sleutel = `${[...docs.keys()].indexOf(b.titel)}-${b.pagina}`;
    if (!pag.has(b.pagina)) pag.set(b.pagina, { sleutel, stukjes: [] });
    pag.get(b.pagina).stukjes.push(b);
    naarPagina.set(String(b.id), sleutel);
  }
  const knop = (sleutel, labels, label) => `<button class="pag" data-pag="${sleutel}" aria-expanded="false">${labels}<span>${label}</span></button>`;
  const paneel = (sleutel, tekst, url, pagina, pad) => `<blockquote id="p-${sleutel}" hidden>${tekst}<span class="pdfknoppen">${pad ? `<button type="button" class="toon" data-pad="${pad}" data-pagina="${pagina}">Toon pagina ${pagina}</button>` : ""}<a href="${esc(url)}#page=${pagina}" target="_blank" rel="noopener">Open de pdf</a></span><span class="blad"></span></blockquote>`;
  const lijst = [...docs.values()].map(({ b, paginas }) => `<li class="bron">
      <p class="doc">${esc(b.titel)} <span class="klein">${esc(b.uitgever)} · ${maand(b.datum)}</span></p>
      ${b.oud ? `<p class="oud">Deze bron is ouder dan drie jaar: kijk na of de regel nog geldt.</p>` : ""}
      <div class="paginas">${[...paginas].map(([pagina, p]) => knop(p.sleutel, p.stukjes.map(s => `<span class="ref">${nr.get(s.id)}</span>`).join(""), `p. ${pagina}`)).join("")}</div>
      ${[...paginas].map(([pagina, p]) => paneel(p.sleutel, p.stukjes.map(s => esc(s.tekst)).join("<br>…<br>"), b.url, pagina, bronNr.has(b.url) ? `pdf/${bronNr.get(b.url)}.pdf` : "")).join("")}
    </li>`).join("");
  if (d.kalender) naarPagina.set("K", "K");
  const kal = d.kalender ? `<li class="bron"><p class="doc">Uitrijkalender <span class="klein">${esc(d.kalender.bron)}</span></p>
      <div class="paginas">${knop("K", `<span class="ref">K</span>`, `p. ${d.kalender.pagina}`)}</div>
      ${paneel("K", `${esc(d.kalender.uitleg)} (${esc(d.kalender.van)} t.e.m. ${esc(d.kalender.tot)})`, d.kalender.url, d.kalender.pagina, "pdf/kalender.pdf")}</li>` : "";
  const koppel = doos => {
    doos.querySelectorAll("button.ref").forEach(b => b.addEventListener("click", () => open(doos, naarPagina.get(b.dataset.ref))));
    doos.querySelectorAll("button.pag").forEach(k => k.addEventListener("click", () => open(doos, k.dataset.pag, true)));
    doos.querySelectorAll("button.toon").forEach(k => k.addEventListener("click", async () => {
      const blad = k.closest("blockquote").querySelector(".blad"), tekst = k.closest("blockquote").textContent;
      k.disabled = true; blad.textContent = "Pagina laden…";
      try {
        const { toonPagina } = await import("./pagina.js");
        await toonPagina(blad, k.dataset.pad, Number(k.dataset.pagina), tekst);
        k.hidden = true;
      } catch { blad.textContent = "Deze pagina laadt niet; open de pdf."; k.disabled = false; }
    }));
  };
  return { html: `<ol class="bronnen">${lijst}${kal}</ol>`, koppel };
}

function open(doos, sleutel, wissel) {
  const bq = doos.querySelector(`#p-${sleutel}`), k = doos.querySelector(`button.pag[data-pag="${sleutel}"]`);
  if (!bq) return;
  const nu = wissel ? bq.hidden : true;
  bq.hidden = !nu; k.setAttribute("aria-expanded", nu);
  if (nu && !wissel) bq.scrollIntoView({ block: "nearest" });
}

// --- Versie: label met geschiedenis, en een knop als er een nieuwere live staat ---
// public/versies.json zegt per versie wat er veranderde.
const datum = d => new Date(d).toLocaleDateString("nl-BE", { day: "numeric", month: "short", year: "numeric" });
export function volgVersie(versie) {
  const kijk = async () => {
    const lijst = await fetch("versies.json", { cache: "no-store" }).then(r => r.json()).catch(() => null);
    if (!lijst) return;
    const deze = lijst.find(v => v.versie === versie);
    if (deze && !$("#versie").childElementCount) $("#versie").innerHTML = `<details><summary>versie ${versie} · ${datum(deze.datum)}</summary><ul>${
      lijst.filter(v => v.versie <= versie).reverse().map(v => `<li><b>v${v.versie}</b> ${datum(v.datum)}: ${esc(v.wat)}</li>`).join("")}</ul></details>`;
    $("#nieuw").hidden = !(lijst.at(-1).versie > versie);
  };
  $("#nieuw").addEventListener("click", () => location.reload());
  document.addEventListener("visibilitychange", () => { if (!document.hidden) kijk(); });
  kijk();
}
