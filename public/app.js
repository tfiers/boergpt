// BoerGPT: stelt de vraag aan beide modellen tegelijk en toont
// elk antwoord met zijn stappen en bronnen.
import { $, esc, maand, STAPEL, bronLijst, haal, laden, refs, nummers, stappenHtml, bronnenHtml, volgVersie } from "./bron.js";

volgVersie(3);   // hoger bij elke versie die bezoekers merken; public/versies.json zegt wat er veranderde

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

async function vraagAan(kaart, vraag, live = false) {
  const doos = kaart.querySelector(".inhoud"), model = kaart.dataset.model;
  const stop = laden(doos, "Zoekt en schrijft", model === "open" ? "Het open model wacht op zijn aanbieder (Groq, of Cloudflare als Groq te druk is)." : "");
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
  const data = await haal(doos, "/api/vraag", { vraag, model }, stop);
  if (!data) return;
  // Antwoordde het open model in Claude's plaats, dan zegt de kop dat ook.
  const naam = kaart.querySelector("[data-naam]");
  naam.dataset.vast ??= naam.textContent;
  naam.textContent = data.vervanger ? "nu niet beschikbaar" : naam.dataset.vast;
  toon(doos, data, Math.round((performance.now() - t0) / 100) / 10);
}

function toon(doos, d, sec) {
  const nr = nummers(d), b = bronnenHtml(d, nr);
  doos.innerHTML = `${d.vervanger ? `<p class="bewaard">${esc(d.vervanger)}</p>` : ""}<p class="antwoord">${refs(d.antwoord, d, nr) || "Geen antwoord."}</p>${b.html}${stappenHtml(d, sec)}`;
  b.koppel(doos);
}

// --- De lijst documenten -----------------------------------------------------
bronLijst.then(lijst => {
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

// --- Welk model? Een balk per model: hoe vaak het antwoord klopt (test/vergelijk.mjs) ---
fetch("modellen.json").then(r => r.json()).then(rijen => {
  const komma = n => String(n).replace(".", ",");
  $("#modellen .balken").innerHTML = rijen.map(m => `<li>
    <p><b>${esc(m.model)}</b>${m.open ? ` <span class="open">open</span>` : ""} <span class="klein">via ${esc(m.via)}</span></p>
    <div class="balk-rij" title="${esc(m.model)}: klopt ${m.klopt}%"><span class="klopt" style="width:${m.klopt}%"></span></div>
    <p class="klein">klopt ${m.klopt}% · juiste bron ${m.bron}% · ${komma(m.seconden)} s per vraag · $ ${komma(m.kostPer1000.toFixed(2))} per 1000 vragen</p></li>`).join("");
  $("#modellen").hidden = false;
}).catch(() => {});

