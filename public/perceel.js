// De perceelfiche: één perceel in, een ingevulde fiche uit, met de bron bij elk veld.
// Elk veld heeft een vinkje "nagekeken": de fiche is pas af als de boer alles nakeek.
import { $, esc, haal, laden, refs, nummers, stappenHtml, bronnenHtml, volgVersie } from "./bron.js";

volgVersie(4);

const VELDEN = {
  uitrijperiode: "Uitrijperiode",
  op_datum: "Op de geplande datum",
  stikstof: "Stikstof, hoogstens",
  fosfor: "Fosfor, hoogstens",
  vanggewas: "Vanggewas",
  ecoregelingen: "Ecoregelingen en steun",
  nakijken: "Zelf nog nakijken",
};

// --- Wat je invult, blijft staan ------------------------------------------------
const form = $("#perceel");
try {
  const oud = JSON.parse(localStorage.getItem("perceel") || "{}");
  for (const [k, v] of Object.entries(oud)) if (form.elements[k] && k !== "model") form.elements[k].value = v;
} catch {}
if (!form.elements.datum.value) form.elements.datum.value = new Date().toISOString().slice(0, 10);
form.addEventListener("input", () => {
  try { localStorage.setItem("perceel", JSON.stringify(Object.fromEntries(new FormData(form)))); $("#bewaard").textContent = "bewaard op dit toestel"; } catch {}
});

form.addEventListener("submit", async e => {
  e.preventDefault();
  const p = Object.fromEntries(new FormData(form));
  p.oppervlakte = Number(String(p.oppervlakte).replace(",", "."));
  const doos = $("#fiche");
  doos.hidden = false;
  doos.scrollIntoView({ block: "start" });
  const knop = $("#stel"); knop.disabled = true;
  const stop = laden(doos, "Zoekt en vult in", "Een fiche vraagt meer zoekwerk dan één vraag: reken op een halve minuut.");
  const t0 = performance.now();
  const d = await haal(doos, "/api/perceel", p, stop);
  knop.disabled = false;
  if (d) toon(doos, d, Math.round((performance.now() - t0) / 100) / 10);
});

function toon(doos, d, sec) {
  const nr = nummers(d), b = bronnenHtml(d, nr);
  doos.innerHTML = `<p class="concept"><b>Concept.</b> Een taalmodel vulde dit in. Kijk elk veld na in zijn bron voor je er iets mee doet, en vink het dan aan.</p>
    <h2>Fiche <span class="klein">${esc(d.model)}</span></h2>${d.vervanger ? `<p class="bewaard">${esc(d.vervanger)}</p>` : ""}
    <dl class="velden">${Object.entries(VELDEN).map(([k, naam]) => `<div class="veld">
      <dt>${naam}</dt>
      <dd>${refs(d.formulier[k] || "", d, nr) || "Niet ingevuld."}</dd>
      <label class="nagekeken"><input type="checkbox" data-veld="${k}"> nagekeken</label>
    </div>`).join("")}</dl>
    <p class="klein" id="stand"></p>
    <div class="rij"><button type="button" class="kopieer">Kopieer de fiche</button></div>
    <h3>Bronnen</h3>${b.html}${stappenHtml(d, sec)}`;
  b.koppel(doos);
  const vinkjes = [...doos.querySelectorAll(".nagekeken input")];
  const stand = () => {
    const n = vinkjes.filter(v => v.checked).length;
    $("#stand").textContent = n === vinkjes.length ? "Alle velden nagekeken." : `${n} van ${vinkjes.length} velden nagekeken.`;
    vinkjes.forEach(v => v.closest(".veld").classList.toggle("ok", v.checked));
  };
  vinkjes.forEach(v => v.addEventListener("change", stand));
  stand();
  doos.querySelector(".kopieer").addEventListener("click", async e => {
    // In platte tekst, met de titel en pagina van elke bron in plaats van het nummer.
    const bron = id => { const s = d.bronnen.find(x => x.id === +id); return s ? ` (${s.titel}, p. ${s.pagina})` : ""; };
    const tekst = `${d.vraag}\n\n${Object.entries(VELDEN).map(([k, naam]) =>
      `${naam}: ${(d.formulier[k] || "").replace(/\s*\[S(\d+)\]/g, (_, id) => bron(id)).replace(/\s*\[K\]/g, d.kalender ? ` (uitrijkalender, ${d.kalender.bron})` : "")}`).join("\n")}\n\nConcept van BoerGPT: nakijken voor gebruik.`;
    try { await navigator.clipboard.writeText(tekst); e.target.textContent = "Gekopieerd ✓"; }
    catch { e.target.textContent = "Kopiëren lukt hier niet"; }
  });
}
