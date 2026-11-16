// De papierwerk-agent: hij zoekt met hetzelfde gereedschap als BoerGPT, maar schrijft
// geen antwoord. Hij vult een fiche voor één perceel in, met bij elk veld zijn bron.
// Het blijft een concept: de boer kijkt elk veld na voor hij er iets mee doet.
import { GEREEDSCHAP } from "./agent.mjs";

export const VELDEN = {
  uitrijperiode: "Wanneer mag deze meststof op dit perceel uitgereden worden?",
  op_datum: "Mag het op de geplande datum? Zo nee, vanaf wanneer wel?",
  stikstof: "Hoeveel stikstof mag er hoogstens op, voor deze teelt?",
  fosfor: "Hoeveel fosfor mag er hoogstens op, voor deze fosfaatklasse?",
  vanggewas: "Moet er na de teelt een vanggewas komen, en tot wanneer moet het blijven staan?",
  ecoregelingen: "Welke ecoregelingen of steun kunnen bij dit perceel passen?",
  nakijken: "Wat moet de boer zelf nog nakijken, en waar?",
};

export const GRONDEN = ["grasland", "akkerland"];
export const MESTSOORTEN = { 1: "stalmest of champost", 2: "drijfmest", 3: "kunstmest" };
export const KLASSEN = ["I", "II", "III", "IV", "weet ik niet"];

const vandaag = () => new Date().toLocaleDateString("nl-BE", { timeZone: "Europe/Brussels", day: "numeric", month: "long", year: "numeric" });

const OPDRACHT = () => `Je helpt een boer in Vlaanderen met papierwerk. Vandaag is het ${vandaag()}.
Je vult een fiche in voor één perceel, alleen uit wat je gereedschap teruggeeft: de documenten (mestregels van de VLM, GLB-subsidies, het Mestdecreet, praktijkgidsen, ILVO-onderzoek) en de uitrijkalender.
- Zoek eerst, per veld van de fiche wat je nodig hebt. Gebruik de uitrijkalender voor de uitrijperiode en de geplande datum.
- Vul daarna de fiche in met vul_fiche. Elk veld is 1 tot 3 korte zinnen en eindigt met zijn bron: [S123] voor stukje 123, [K] voor de uitrijkalender. Gebruik alleen nummers die je echt kreeg.
- Vond je iets niet, schrijf dan in dat veld: "Niet gevonden in mijn documenten." Gok nooit een getal.
- Het is een concept. Zet in "nakijken" wat de boer zelf moet nagaan (bv. de eigen fosfaatklasse, de gebiedstypes, de huidige regel bij de Mestbank).`;

const FORMULIER = {
  naam: "vul_fiche",
  uitleg: "Vul de fiche voor dit perceel in. Roep dit één keer aan, als je genoeg gezocht hebt.",
  velden: Object.fromEntries(Object.entries(VELDEN).map(([k, uitleg]) => [k, { type: "string", description: uitleg }])),
  verplicht: Object.keys(VELDEN),
};

export const FICHE = { opdracht: OPDRACHT, gereedschap: GEREEDSCHAP, formulier: FORMULIER };

// Zet de velden van het formulier om in de vraag aan het model. Geeft null terug als iets niet klopt.
export function perceelVraag(p) {
  const teelt = String(p?.teelt || "").trim();
  const datum = String(p?.datum || "");
  const ha = Number(p?.oppervlakte);
  if (teelt.length < 2 || teelt.length > 60) return null;
  if (!GRONDEN.includes(p?.grond) || !MESTSOORTEN[p?.mest] || !KLASSEN.includes(p?.klasse)) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(datum) || !(ha > 0 && ha < 1000)) return null;
  const d = new Date(datum).toLocaleDateString("nl-BE", { day: "numeric", month: "long", year: "numeric" });
  return `Perceel: ${ha} ha ${p.grond}, teelt ${teelt}, fosfaatklasse ${p.klasse}.
Ik wil ${MESTSOORTEN[p.mest]} uitrijden (uitrijkalender type ${p.mest}) op ${d} (MM-DD ${datum.slice(5)}).
Vul de fiche in.`;
}
