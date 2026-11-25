// Layout check for BoerGPT's pages (public/): each page on each screen it is used on, in what it shows when
// things go well and when they go wrong.
//
//   node tools/layout_check.cjs [out-dir]      # exit 1 on a fault; screenshots in out-dir (default /tmp/boergpt-layout)
//
// It serves public/ as it is and answers the site's functions (/api/vraag, /api/perceel, /api/oordeel) as each
// state says: with the saved answers of public/voorbeelden.json, an error code, or no connection. It fails on: an
// error in the page; sideways scroll; what the state should show (an answer, an error message) not showing or
// running off the screen; and an explanation ("Hoe werkt het?", "Hoe goed is het?") not opening on top or not
// closing with ×, Esc or a tap beside it.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const PUBLIC = path.join(__dirname, '..', 'public');
const OUT = process.argv[2] || '/tmp/boergpt-layout';
const SCREENS = {
  phone: { width: 412, height: 915, touch: true },
  'phone-360': { width: 360, height: 740, touch: true },
  laptop: { width: 1440, height: 900, touch: false },
};

// A real answer for every made-up request: the first saved example, from both models.
const SAVED = JSON.parse(fs.readFileSync(path.join(PUBLIC, 'voorbeelden.json'), 'utf8'));
const EXAMPLE = Object.keys(SAVED).find((k) => k !== 'datum');
const ANSWER = SAVED[EXAMPLE].claude;
const ids = ANSWER.bronnen.map((b) => b.id);
const FICHE = { ...ANSWER, vraag: 'Silomaïs op akkerland, drijfmest, 2,5 ha', model: 'Claude Sonnet 5.5',
  formulier: Object.fromEntries(['uitrijperiode', 'op_datum', 'stikstof', 'fosfor', 'vanggewas', 'ecoregelingen', 'nakijken']
    .map((k, i) => [k, i % 3 === 2 ? 'Niet gevonden in mijn documenten.' : `Een ingevuld veld voor de test [S${ids[i % ids.length]}].`])) };
const ITEMS = { items: [0, 1].map((i) => ({ id: `t${i}`, vraag: EXAMPLE, herkomst: 'Landbouwleven', antwoord: ANSWER.antwoord,
  bronnen: ANSWER.bronnen, kalender: ANSWER.kalender ? 'Type 2 op grasland: niet van 1 november tot 15 januari.' : '' })), oordelen: [] };

// Each state: the page, how the functions answer (a number is a status; 0 is no connection), what to do, and
// what must then be on screen.
const QUESTION = async (p) => { await p.fill('#vraag', 'Hoeveel stikstof mag op wintertarwe?'); await p.click('#stel'); };
const PERCEEL = async (p) => {
  await p.fill('[name=teelt]', 'silomaïs');
  await p.fill('[name=oppervlakte]', '2,5');
  await p.click('#stel');
};
const STATES = {
  'vraag-leeg': { page: '/', must: ['#vraag', '.vb'], uitleg: true },
  'vraag-voorbeeld': { page: '/', act: async (p) => { await p.click('.vb'); await p.waitForSelector('.kaart[data-model=claude] .antwoord');
    await p.click('.kaart[data-model=claude] .antwoord button.ref'); }, must: ['.kaart[data-model=open] .antwoord', '.kaart[data-model=claude] blockquote:not([hidden])'] },
  'vraag-live': { page: '/', api: ANSWER, act: QUESTION, must: ['.kaart[data-model=open] .antwoord', '.kaart[data-model=claude] .antwoord'] },
  'vraag-429': { page: '/', api: 429, act: QUESTION, must: ['.kaart[data-model=open] .fout', '.kaart[data-model=claude] .fout'] },
  'vraag-502': { page: '/', api: 502, act: QUESTION, must: ['.kaart[data-model=open] .fout', '.kaart[data-model=claude] .fout'] },
  'vraag-offline': { page: '/', api: 0, act: QUESTION, must: ['.kaart[data-model=open] .fout', '.kaart[data-model=claude] .fout'] },
  'perceel-fiche': { page: '/perceel.html', api: FICHE, act: PERCEEL, must: ['#fiche .velden', '#fiche .kopieer'] },
  'perceel-429': { page: '/perceel.html', api: 429, act: PERCEEL, must: ['#fiche .fout'] },
  'perceel-offline': { page: '/perceel.html', api: 0, act: PERCEEL, must: ['#fiche .fout'] },
  'oordeel-items': { page: '/oordeel.html?wie=test&code=test', api: ITEMS,
    act: async (p) => { await p.click('[data-veld=klopt] [data-w=ja]'); await p.click('[data-veld=bron] [data-w=ja]'); }, must: ['#item .antwoord', '#balk'] },
  'oordeel-niet-bewaard': { page: '/oordeel.html?wie=test&code=test', api: ITEMS, post: 502,
    act: async (p) => { await p.click('[data-veld=klopt] [data-w=ja]'); await p.click('[data-veld=bron] [data-w=nee]'); }, must: ['#melding'] },
  'oordeel-401': { page: '/oordeel.html?wie=test&code=fout', api: 401, must: ['#melding'] },
  'oordeel-offline': { page: '/oordeel.html?wie=test&code=test', api: 0, must: ['#melding'] },
  'oordeel-geen-link': { page: '/oordeel.html', must: ['#melding'] },
};

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };

async function open(browser, screen, s) {
  const ctx = await browser.newContext({ viewport: { width: screen.width, height: screen.height }, hasTouch: screen.touch, isMobile: screen.touch, deviceScaleFactor: 1 });
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  await p.route('**/*', (r) => {
    const req = r.request(), u = new URL(req.url());
    if (u.host !== 'local.test') return r.abort();   // the visit counter on tomasfiers.net
    if (u.pathname.startsWith('/api/')) {
      const answer = req.method() === 'POST' && u.pathname === '/api/oordeel' ? (s.post ?? {}) : s.api;
      if (answer === 0) return r.abort('internetdisconnected');
      if (typeof answer === 'number') return r.fulfill({ status: answer, contentType: 'application/json', body: JSON.stringify({ fout: 'Een foutmelding van de server voor de test.' }) });
      return r.fulfill({ contentType: 'application/json', body: JSON.stringify(answer ?? {}) });
    }
    const file = path.join(PUBLIC, u.pathname === '/' ? 'index.html' : u.pathname);
    if (file.startsWith(PUBLIC) && fs.existsSync(file) && fs.statSync(file).isFile()) return r.fulfill({ path: file, contentType: TYPES[path.extname(file)] });
    return r.fulfill({ status: 404, body: '' });
  });
  await p.goto(`http://local.test${s.page}`);
  await p.waitForTimeout(200);
  return { ctx, p, errors };
}

// Each explanation behind a button (.q, "Hoe werkt het?" and "Hoe goed is het?"): it opens on top, inside the
// screen, and closes three ways.
async function uitleg(p) {
  const faults = [];
  const n = await p.locator('.q').count();
  for (let i = 0; i < n; i++) {
    const q = p.locator('.q').nth(i), name = await q.textContent(), id = await q.getAttribute('aria-controls');
    for (const way of ['×', 'Esc', 'beside']) {
      if (await p.evaluate((id) => !document.getElementById(id).hidden, id)) await p.keyboard.press('Escape');   // left open by a way that failed
      await q.click();
      const where = await p.evaluate((id) => {
        const pop = document.getElementById(id);
        if (pop.hidden) return 'does not open';
        const r = pop.getBoundingClientRect();
        if (r.left < 0 || r.right > innerWidth + 1) return 'runs off the screen';
        const top = document.elementFromPoint(r.left + r.width / 2, r.top + Math.min(r.height, innerHeight - r.top) / 2);
        return pop.contains(top) ? '' : 'something lies over it';
      }, id);
      if (where) { faults.push(`"${name}": ${where}`); break; }
      if (way === '×' && !(await p.click(`#${id} .x`, { timeout: 2000 }).then(() => true, () => false))) { faults.push(`"${name}": its × can't be tapped`); continue; }
      else if (way === 'Esc') await p.keyboard.press('Escape');
      else await p.mouse.click(2, 2);
      if (!(await p.evaluate((id) => document.getElementById(id).hidden, id))) faults.push(`"${name}" does not close with ${way}`);
    }
  }
  return faults;
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const faults = [];
  for (const [screenName, screen] of Object.entries(SCREENS)) {
    for (const [state, s] of Object.entries(STATES)) {
      const { ctx, p, errors } = await open(browser, screen, s);
      const where = `${screenName} · ${state}`;
      const found = [];
      try {
        if (s.act) await s.act(p);
        for (const sel of s.must) {
          const el = await p.waitForSelector(sel, { state: 'visible', timeout: 5000 }).catch(() => null);
          if (!el) { found.push(`${sel} does not show`); continue; }
          const box = await el.boundingBox();
          if (box && (box.x < 0 || box.x + box.width > screen.width + 1)) found.push(`${sel} runs off the screen`);
        }
      } catch (e) {
        found.push(`could not do what the state does: ${e.message.split('\n')[0]}`);
      }
      await p.waitForTimeout(100);
      const wide = await p.evaluate(() => document.documentElement.scrollWidth);
      if (wide > screen.width + 1) found.push(`sideways scroll (${wide} px on ${screen.width})`);
      await p.screenshot({ path: path.join(OUT, `${screenName}-${state}.png`), fullPage: true });
      if (s.uitleg) found.push(...await uitleg(p));
      found.unshift(...errors.map((e) => `error in the page: ${e}`));
      console.log(`${found.length ? 'FAIL' : 'ok  '} ${where}${found.map((f) => `\n     ${f}`).join('')}`);
      faults.push(...found.map((f) => `${where}: ${f}`));
      await ctx.close();
    }
  }
  await browser.close();
  console.log(`\n${faults.length} fault(s). Screenshots in ${OUT}`);
  process.exit(faults.length ? 1 : 0);
})();
