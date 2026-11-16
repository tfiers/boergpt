// BoerGPT: stelt de vraag aan beide modellen tegelijk en toont
// elk antwoord met zijn stappen en bronnen.
const VERSIE = 3;   // hoger bij elke versie die bezoekers merken; public/versies.json zegt wat er veranderde
const $ = s => document.querySelector(s);
const HTTP = { 400: "Bad Request", 405: "Method Not Allowed", 429: "Too Many Requests", 500: "Internal Server Error", 502: "Bad Gateway", 503: "Service Unavailable", 504: "Gateway Timeout" };
const STAPEL = { regels: "mestregels (VLM)", praktijk: "praktijkgidsen", onderzoek: "ILVO-onderzoek", subsidies: "GLB-subsidies", wet: "Mestdecreet" };
const esc = t => String(t).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const maand = d => new Date(d.length === 4 ? `${d}-06` : `${d}-01`).toLocaleDateString("nl-BE", d.length === 4 ? { year: "numeric" } : { month: "short", year: "numeric" });

// --- Wat je typt, blijft staan ---------------------------------------------
const veld = $("#vraag");
try { veld.value = localStorage.getItem("vraag") || ""; } catch {}
veld.addEventListener("input", () => {
  try { localStorage.setItem("vraag", veld.value); $("#bewaard").textContent = "bewaard op dit toestel"; } catch {}
});

// --- Uitleg: popover met tikbare tekening ---------------------------------
const knop = $(".q"), pop = $("#hoe");
const zet = open => { pop.hidden = !open; knop.setAttribute("aria-expanded", open); };
knop.addEventListener("click", e => { e.stopPropagation(); zet(pop.hidden); });
pop.querySelector(".x").addEventListener("click", () => zet(false));
pop.addEventListener("click", e => e.stopPropagation());
document.addEventListener("click", () => zet(false));
document.addEventListener("keydown", e => { if (e.key === "Escape") zet(false); });
pop.querySelectorAll(".blok").forEach(b => b.addEventListener("click", () => {
  pop.querySelectorAll(".blok").forEach(x => x.classList.toggle("aan", x === b));
  $("#uitleg").textContent = b.dataset.uitleg;
}));

// --- Vragen -----------------------------------------------------------------
document.querySelectorAll(".vb").forEach(b => b.addEventListener("click", () => {
  veld.value = b.textContent; veld.dispatchEvent(new Event("input")); stel();
}));
$("#vraagform").addEventListener("submit", e => { e.preventDefault(); stel(); });

// De drie voorbeeldvragen hebben een bewaard antwoord (test/voorbeelden.mjs): dat is er meteen
// en kost niets. Het staat erbij dat het bewaard is, met een knop om het live te vragen.
let bewaard = {};
fetch("voorbeelden.json").then(r => r.json()).then(j => { bewaard = j; }).catch(() => {});

function stel() {
  const vraag = veld.value.trim();
  if (vraag.length < 3) return;
  $("#antwoorden").hidden = false;
  for (const kaart of document.querySelectorAll(".kaart")) vraagAan(kaart, vraag);
}

// "Zoekt en schrijft… 12 s": de tijd loopt, zodat je ziet dat er nog iets gebeurt.
function laden(doos, model) {
  const t0 = performance.now();
  const zet = () => {
    const s = Math.round((performance.now() - t0) / 1000);
    doos.innerHTML = `<p class="laden">Zoekt en schrijft… ${s} s${s >= 15 && model === "open" ? "<br>Het open model wacht op zijn aanbieder (Groq, of Cloudflare als Groq te druk is)." : ""}</p>`;
  };
  zet();
  const klok = setInterval(zet, 1000);
  return () => clearInterval(klok);
}

async function vraagAan(kaart, vraag, live = false) {
  const doos = kaart.querySelector(".inhoud"), model = kaart.dataset.model;
  const stop = laden(doos, model);
  const oud = !live && bewaard[vraag]?.[model];
  if (oud) {
    await new Promise(k => setTimeout(k, 900));
    stop();
    toon(doos, oud, Math.round(oud.ms / 100) / 10);
    doos.insertAdjacentHTML("afterbegin", `<p class="bewaard">Bewaard antwoord van ${new Date(bewaard.datum).toLocaleDateString("nl-BE", { day: "numeric", month: "short" })}, niet nu gevraagd. <button type="button" class="live">Vraag het nu live</button></p>`);
    doos.querySelector(".live").addEventListener("click", () => vraagAan(kaart, vraag, true));
    return;
  }
  const t0 = performance.now();
  let r, data;
  try {
    r = await fetch("/api/vraag", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ vraag, model }), signal: AbortSignal.timeout(90000) });
    data = await r.json().catch(() => ({}));
  } catch (e) {
    stop();
    doos.innerHTML = e.name === "TimeoutError"
      ? `<p class="fout">Na anderhalve minuut nog geen antwoord. Probeer het zo opnieuw.</p>`
      : `<p class="fout">Geen verbinding. Je vraag blijft staan; probeer opnieuw als je weer online bent.</p>`;
    return;
  }
  stop();
  if (!r.ok) {
    doos.innerHTML = `<p class="fout"><span title="${esc(r.status)} ${esc(HTTP[r.status] || "")}">${r.status} ${HTTP[r.status] || ""}</span>: ${esc(data.fout || "er liep iets mis.")}</p>`;
    return;
  }
  toon(doos, data, Math.round((performance.now() - t0) / 100) / 10);
}

function toon(doos, d, sec) {
  const nr = new Map(d.bronnen.map((b, i) => [b.id, i + 1]));
  const zinnen = esc(d.antwoord).replace(/\[S(\d+)\]/g, (_, id) => nr.has(+id) ? `<button class="ref" data-ref="${id}">${nr.get(+id)}</button>` : "")
    .replace(/\[K\]/g, d.kalender ? `<button class="ref" data-ref="K">K</button>` : "");
  const stappen = d.stappen.map(s => s.wat === "zoek"
    ? `<li>Zocht <q>${esc(s.zoekvraag)}</q> in ${esc([].concat(s.stapels || []).map(x => STAPEL[x] || x).join(", "))} (${esc(s.manier)})</li>`
    : `<li>Keek de uitrijkalender na: type ${esc(s.type)}, ${esc(s.grond)}, ${esc(s.datum)} → ${esc(s.mag || "?")}</li>`).join("");
  // Bronnen per document, en binnen een document per pagina: de titel staat één keer,
  // elke pagina is een knop met de nummers die het antwoord ernaar gebruikt.
  const docs = new Map(), naarPagina = new Map();
  for (const b of d.bronnen) {
    if (!docs.has(b.titel)) docs.set(b.titel, { b, paginas: new Map() });
    const pag = docs.get(b.titel).paginas;
    const sleutel = `${[...docs.keys()].indexOf(b.titel)}-${b.pagina}`;
    if (!pag.has(b.pagina)) pag.set(b.pagina, { sleutel, stukjes: [] });
    pag.get(b.pagina).stukjes.push(b);
    naarPagina.set(String(b.id), sleutel);
  }
  const knop = (sleutel, refs, label) => `<button class="pag" data-pag="${sleutel}" aria-expanded="false">${refs}<span>${label}</span></button>`;
  const paneel = (sleutel, tekst, url, pagina, pad) => `<blockquote id="p-${sleutel}" hidden>${tekst}<span class="pdfknoppen">${pad ? `<button type="button" class="toon" data-pad="${pad}" data-pagina="${pagina}">Toon pagina ${pagina}</button>` : ""}<a href="${esc(url)}#page=${pagina}" target="_blank" rel="noopener">Open de pdf</a></span><span class="blad"></span></blockquote>`;
  const bronnen = [...docs.values()].map(({ b, paginas }) => `<li class="bron">
      <p class="doc">${esc(b.titel)} <span class="klein">${esc(b.uitgever)} · ${maand(b.datum)}</span></p>
      ${b.oud ? `<p class="oud">Deze bron is ouder dan drie jaar: kijk na of de regel nog geldt.</p>` : ""}
      <div class="paginas">${[...paginas].map(([pagina, p]) => knop(p.sleutel, p.stukjes.map(s => `<span class="ref">${nr.get(s.id)}</span>`).join(""), `p. ${pagina}`)).join("")}</div>
      ${[...paginas].map(([pagina, p]) => paneel(p.sleutel, p.stukjes.map(s => esc(s.tekst)).join("<br>…<br>"), b.url, pagina, bronNr.has(b.url) ? `pdf/${bronNr.get(b.url)}.pdf` : "")).join("")}
    </li>`).join("");
  if (d.kalender) naarPagina.set("K", "K");
  const kal = d.kalender ? `<li class="bron"><p class="doc">Uitrijkalender <span class="klein">${esc(d.kalender.bron)}</span></p>
      <div class="paginas">${knop("K", `<span class="ref">K</span>`, `p. ${d.kalender.pagina}`)}</div>
      ${paneel("K", `${esc(d.kalender.uitleg)} (${esc(d.kalender.van)} t.e.m. ${esc(d.kalender.tot)})`, d.kalender.url, d.kalender.pagina, "pdf/kalender.pdf")}</li>` : "";
  doos.innerHTML = `<p class="antwoord">${zinnen || "Geen antwoord."}</p>
    <ol class="bronnen">${bronnen}${kal}</ol>
    <details class="stappen"><summary>${d.stappen.length} ${d.stappen.length === 1 ? "stap" : "stappen"} · ${sec} s</summary><ol>${stappen}</ol></details>`;
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
}

function open(doos, sleutel, wissel) {
  const bq = doos.querySelector(`#p-${sleutel}`), k = doos.querySelector(`button.pag[data-pag="${sleutel}"]`);
  if (!bq) return;
  const nu = wissel ? bq.hidden : true;
  bq.hidden = !nu; k.setAttribute("aria-expanded", nu);
  if (nu && !wissel) bq.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

// --- De lijst documenten -----------------------------------------------------
// Welk nummer elke bron heeft: de pdf staat op /pdf/<nr>.pdf (public/_redirects).
const bronNr = new Map();
fetch("bronnen.json").then(r => r.json()).then(lijst => {
  lijst.forEach((b, i) => bronNr.set(b.url, i));
  $("#bronlijst").innerHTML = Object.entries(STAPEL).map(([k, naam]) => {
    const deze = lijst.filter(b => b.stapel === k);
    return `<li><b>${naam}</b> <span class="klein">(${deze.length})</span><ul>${deze.map(b =>
      `<li><a href="${esc(b.url)}" rel="noopener">${esc(b.titel)}</a> <span class="klein">${esc(b.uitgever)} · ${maand(b.datum)}</span></li>`).join("")}</ul></li>`;
  }).join("");
}).catch(() => { $("#bronlijst").innerHTML = `<li class="fout">De lijst laadt niet; ververs de pagina.</li>`; });

// --- Hoe goed is het? ---------------------------------------------------------
fetch("meting.json").then(r => r.json()).then(tabellen => {
  $("#metingen").innerHTML = tabellen.map(t => `<h3>${esc(t.titel)} <span class="klein">${esc(new Date(t.datum).toLocaleDateString("nl-BE", { day: "numeric", month: "short", year: "numeric" }))}</span></h3>
    <table><thead><tr>${t.kolommen.map(k => `<th>${esc(k)}</th>`).join("")}</tr></thead>
    <tbody>${t.rijen.map(r => `<tr><th>${esc(r[0])}</th>${r.slice(1).map(c => `<td>${esc(c)}</td>`).join("")}</tr>`).join("")}</tbody></table>`).join("");
}).catch(() => { $("#meting").hidden = true; });

// --- Versie: label met geschiedenis, en een knop als er een nieuwere live staat ---
const datum = d => new Date(d).toLocaleDateString("nl-BE", { day: "numeric", month: "short", year: "numeric" });
async function kijkVersie() {
  const lijst = await fetch("versies.json", { cache: "no-store" }).then(r => r.json()).catch(() => null);
  if (!lijst) return;
  const deze = lijst.find(v => v.versie === VERSIE);
  if (deze && !$("#versie").childElementCount) $("#versie").innerHTML = `<details><summary>versie ${VERSIE} · ${datum(deze.datum)}</summary><ul>${
    lijst.filter(v => v.versie <= VERSIE).reverse().map(v => `<li><b>v${v.versie}</b> ${datum(v.datum)}: ${esc(v.wat)}</li>`).join("")}</ul></details>`;
  $("#nieuw").hidden = !(lijst.at(-1).versie > VERSIE);
}
$("#nieuw").addEventListener("click", () => location.reload());
document.addEventListener("visibilitychange", () => { if (!document.hidden) kijkVersie(); });
kijkVersie();
