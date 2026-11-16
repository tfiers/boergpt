// Het blinde oordeel: één antwoord per scherm, twee vragen, elk oordeel meteen bewaard.
const $ = s => document.querySelector(s);
const esc = t => String(t).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const KLOPT = [["ja", "Ja"], ["half", "Half"], ["nee", "Nee"], ["weet niet", "Weet ik niet"]];
const BRON = [["ja", "Ja"], ["deels", "Deels"], ["nee", "Nee"], ["weet niet", "Weet ik niet"]];
const url = new URL(location.href);
const wie = url.searchParams.get("wie") || "", code = url.searchParams.get("code") || "";
let items = [], oordelen = new Map(), nu = 0;

function melding(tekst) { $("#melding").hidden = !tekst; $("#melding").textContent = tekst || ""; }

async function laad() {
  if (!wie || !code) return melding("Open de link die je kreeg: hij bevat je naam en je code.");
  let r, d;
  try { r = await fetch(`/api/oordeel?wie=${encodeURIComponent(wie)}&code=${encodeURIComponent(code)}`, { cache: "no-store" }); d = await r.json(); }
  catch { return melding("Geen verbinding. Ververs de pagina als je weer online bent."); }
  if (!r.ok) return melding(`${r.status}: ${d.fout || "er liep iets mis."}`);
  items = d.items;
  oordelen = new Map(d.oordelen.map(o => [o.item, o]));
  const open = items.findIndex(i => !oordelen.has(i.id));
  nu = open < 0 ? items.length : open;
  $("#balk").hidden = false;
  toon();
}

function knoppen(naam, opties, gekozen) {
  return `<div class="keuzes" role="radiogroup" data-veld="${naam}">${opties.map(([w, t]) =>
    `<button type="button" role="radio" aria-checked="${gekozen === w}" data-w="${w}">${t}</button>`).join("")}</div>`;
}

function toon() {
  $("#teller").textContent = `${Math.min(nu + 1, items.length)} van ${items.length} · ${oordelen.size} klaar`;
  $("#vorige").disabled = nu === 0;
  if (nu >= items.length) {
    $("#item").hidden = true; $("#klaar").hidden = false; $("#volgende").disabled = true;
    const open = items.filter(i => !oordelen.has(i.id)).length;
    $("#klaar").innerHTML = open
      ? `<h2>Bijna</h2><p>Nog ${open} antwoord${open > 1 ? "en" : ""} zonder oordeel. <button type="button" class="live" id="naareerste">Naar het eerste</button></p>`
      : `<h2>Klaar, dank je wel!</h2><p>Alle ${items.length} oordelen zijn bewaard. Je kunt er nog terug naartoe met ◀ Vorige.</p>`;
    $("#naareerste")?.addEventListener("click", () => { nu = items.findIndex(i => !oordelen.has(i.id)); toon(); });
    return;
  }
  $("#klaar").hidden = true; $("#item").hidden = false; $("#volgende").disabled = false;
  const it = items[nu], o = oordelen.get(it.id) || {};
  const nr = new Map(it.bronnen.map((b, i) => [b.id, i + 1]));
  const antwoord = esc(it.antwoord).replace(/\[S(\d+)\]/g, (_, id) => nr.has(+id) ? `<sup class="ref">${nr.get(+id)}</sup>` : "")
    .replace(/\[K\]/g, it.kalender ? `<sup class="ref">K</sup>` : "");
  $("#item").innerHTML = `
    <p class="klein">Vraag ${nu + 1}${it.herkomst ? ` · gesteld op ${esc(it.herkomst)}` : ""}</p>
    <h2 class="vraag">${esc(it.vraag)}</h2>
    <div class="antwoord">${antwoord}</div>
    ${it.bronnen.length || it.kalender ? `<details class="stukjes"><summary>Aangehaalde tekst (${it.bronnen.length + (it.kalender ? 1 : 0)})</summary><ol>${
      it.bronnen.map(b => `<li><b>${esc(b.titel)}</b>, p. ${b.pagina}<blockquote>${esc(b.tekst)}</blockquote></li>`).join("")}${
      it.kalender ? `<li value="0"><b>K: uitrijkalender van de VLM</b><blockquote>${esc(it.kalender)}</blockquote></li>` : ""}</ol></details>` : `<p class="klein">Geen tekst aangehaald.</p>`}
    <fieldset><legend>Klopt het antwoord?</legend>${knoppen("klopt", KLOPT, o.klopt)}</fieldset>
    <fieldset><legend>Staat wat het zegt in de aangehaalde tekst?</legend>${knoppen("bron", BRON, o.bron)}</fieldset>
    <label class="klein" for="opm">Opmerking (mag leeg)</label>
    <textarea id="opm" rows="2" maxlength="1000">${esc(o.opmerking || "")}</textarea>`;
  for (const groep of document.querySelectorAll(".keuzes")) groep.addEventListener("click", e => {
    const b = e.target.closest("button"); if (!b) return;
    groep.querySelectorAll("button").forEach(x => x.setAttribute("aria-checked", x === b));
    bewaar();
  });
  $("#opm").addEventListener("change", bewaar);
  window.scrollTo({ top: 0 });
}

async function bewaar() {
  const it = items[nu];
  const kies = v => document.querySelector(`[data-veld="${v}"] [aria-checked="true"]`)?.dataset.w;
  const o = { wie, code, item: it.id, klopt: kies("klopt"), bron: kies("bron"), opmerking: $("#opm").value.trim() };
  if (!o.klopt || !o.bron) return;
  try {
    const r = await fetch("/api/oordeel", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(o) });
    if (!r.ok) throw new Error(`${r.status}`);
    oordelen.set(it.id, o); melding("");
    $("#teller").textContent = `${nu + 1} van ${items.length} · ${oordelen.size} klaar`;
  } catch (e) { melding(`Niet bewaard (${e.message || "geen verbinding"}). Tik je keuze opnieuw als je weer online bent.`); }
}

$("#vorige").addEventListener("click", () => { if (nu > 0) { nu--; toon(); } });
$("#volgende").addEventListener("click", () => { nu++; toon(); });
laad();
