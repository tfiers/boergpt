// Toont één pagina van een bron-pdf in de pagina zelf, met de aangehaalde tekst gemarkeerd.
// De pdf komt via /pdf/<nr>.pdf (public/_redirects) van de eigen site; pdf.js laadt pas bij de eerste tik.
let pdfjs;
const pdfs = new Map();
const gewoon = t => t.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, " ").trim();

export async function toonPagina(doos, pad, nr, tekst) {
  pdfjs ??= await import("./vendor/pdfjs/pdf.min.mjs").then(m => {
    m.GlobalWorkerOptions.workerSrc = "vendor/pdfjs/pdf.worker.min.mjs";
    return m;
  });
  if (!pdfs.has(pad)) pdfs.set(pad, pdfjs.getDocument({ url: pad, isEvalSupported: false }).promise);
  const pdf = await pdfs.get(pad);
  const pagina = await pdf.getPage(nr);
  const breed = doos.clientWidth || 320;
  const vp = pagina.getViewport({ scale: breed / pagina.getViewport({ scale: 1 }).width });
  // Scherp genoeg om in te zoomen: een tik maakt de pagina twee keer zo breed.
  const dpr = Math.min(window.devicePixelRatio || 1, 2) * 2;
  const doek = document.createElement("canvas");
  doek.width = Math.round(vp.width * dpr); doek.height = Math.round(vp.height * dpr);
  doek.style.width = `${vp.width}px`; doek.style.height = `${vp.height}px`;
  const ctx = doek.getContext("2d");
  ctx.scale(dpr, dpr);
  await pagina.render({ canvasContext: ctx, viewport: vp }).promise;

  // Markeer de tekstregels van de pagina die in het aangehaalde stukje staan.
  const zoek = gewoon(tekst);
  const inhoud = await pagina.getTextContent();
  ctx.fillStyle = "rgba(255, 210, 0, 0.35)";
  let eerste = null;
  for (const it of inhoud.items) {
    const s = gewoon(it.str || "");
    if (s.length < 6 || !zoek.includes(s)) continue;
    const [, , c, d, e, f] = pdfjs.Util.transform(vp.transform, it.transform);
    const hoog = Math.hypot(c, d), x = e, y = f - hoog;
    ctx.fillRect(x, y, it.width * vp.scale, hoog * 1.15);
    eerste ??= y;
  }
  doek.title = "Tik om in of uit te zoomen";
  doek.addEventListener("click", () => {
    const groot = doos.classList.toggle("groot");
    if (groot && eerste !== null) doos.scrollLeft = 0, doos.scrollTop = eerste * 2 - 40;
  });
  doos.replaceChildren(doek);
  return eerste;
}
