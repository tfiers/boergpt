// BoerGPT: stelt de vraag aan beide modellen tegelijk en toont
// elk antwoord met zijn stappen en bronnen.
const VERSIE = "v1 · 13 nov 2026";
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

function stel() {
  const vraag = veld.value.trim();
  if (vraag.length < 3) return;
  $("#antwoorden").hidden = false;
  for (const kaart of document.querySelectorAll(".kaart")) vraagAan(kaart, vraag);
}

async function vraagAan(kaart, vraag) {
  const doos = kaart.querySelector(".inhoud");
  doos.innerHTML = `<p class="laden">Zoekt en schrijft…</p>`;
  const t0 = performance.now();
  let r, data;
  try {
    r = await fetch("/api/vraag", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ vraag, model: kaart.dataset.model }) });
    data = await r.json().catch(() => ({}));
  } catch {
    doos.innerHTML = `<p class="fout">Geen verbinding. Je vraag blijft staan; probeer opnieuw als je weer online bent.</p>`;
    return;
  }
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
  const bronnen = d.bronnen.map(b => `<li id="b-${b.id}" class="bron" data-id="${b.id}">
      <button class="kop" aria-expanded="false"><span class="ref">${nr.get(b.id)}</span> ${esc(b.titel)} <span class="klein">${esc(b.uitgever)} · ${maand(b.datum)} · p. ${b.pagina}</span></button>
      ${b.oud ? `<p class="oud">Deze bron is ouder dan drie jaar: kijk na of de regel nog geldt.</p>` : ""}
      <blockquote hidden>${esc(b.tekst)}<br><a href="${esc(b.url)}#page=${b.pagina}" rel="noopener">Open de pdf op pagina ${b.pagina}</a></blockquote>
    </li>`).join("");
  const kal = d.kalender ? `<li id="b-K" class="bron"><button class="kop" aria-expanded="false"><span class="ref">K</span> Uitrijkalender <span class="klein">${esc(d.kalender.bron)} · p. ${d.kalender.pagina}</span></button>
      <blockquote hidden>${esc(d.kalender.uitleg)} (${esc(d.kalender.van)} t.e.m. ${esc(d.kalender.tot)})<br><a href="${esc(d.kalender.url)}#page=${d.kalender.pagina}" rel="noopener">Open de pdf op pagina ${d.kalender.pagina}</a></blockquote></li>` : "";
  doos.innerHTML = `<p class="antwoord">${zinnen || "Geen antwoord."}</p>
    <ol class="bronnen">${bronnen}${kal}</ol>
    <details class="stappen"><summary>${d.stappen.length} stappen · ${sec} s</summary><ol>${stappen}</ol></details>`;
  doos.querySelectorAll("button.ref").forEach(b => b.addEventListener("click", () => open(doos, b.dataset.ref)));
  doos.querySelectorAll(".bron .kop").forEach(k => k.addEventListener("click", () => open(doos, k.closest(".bron").id.slice(2), true)));
}

function open(doos, id, wissel) {
  const li = doos.querySelector(`#b-${id}`);
  if (!li) return;
  const bq = li.querySelector("blockquote"), k = li.querySelector(".kop");
  const nu = wissel ? bq.hidden : true;
  bq.hidden = !nu; k.setAttribute("aria-expanded", nu);
  if (nu && !wissel) li.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

// --- De lijst documenten -----------------------------------------------------
fetch("bronnen.json").then(r => r.json()).then(lijst => {
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

$("#versie").textContent = VERSIE;
