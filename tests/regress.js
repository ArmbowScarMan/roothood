// Roothood regressionstest. Kör efter varje ändring:
//   node tests/regress.js <sökväg till demo-index.html>
// Exempel: node tests/regress.js /tmp/.../site16/index.html
// Kräver Playwright (require('playwright')) och att index.html är en demo-build (utan nycklar).
// Testet startar en lokal server själv och stänger den efter körning.
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const file = process.argv[2];
if (!file || !fs.existsSync(file)) { console.error('Ange sökväg till demo index.html'); process.exit(2); }
const dir = path.dirname(path.resolve(file));
const fails = [];
const ok = (name, cond, info = '') => { console.log((cond ? 'OK   ' : 'FAIL ') + name + (info ? ' — ' + info : '')); if (!cond) fails.push(name); };

// 1. Syntax och dubbla deklarationer i huvudskriptet
const html = fs.readFileSync(file, 'utf8');
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
const main = scripts.reduce((a, b) => (b.length > a.length ? b : a), '');
const tmp = path.join(require('os').tmpdir(), 'rh-regress-' + process.pid + '.js');
fs.writeFileSync(tmp, main);
let syn = true; try { execSync('node --check ' + tmp, { stdio: 'pipe' }); } catch (e) { syn = false; }
ok('Syntax (node --check)', syn);
const dupes = execSync(`grep -oE "^(async )?function [A-Za-z0-9_]+" ${tmp} | sort | uniq -d; grep -oE "^const [A-Za-z0-9_]+" ${tmp} | sort | uniq -d`).toString().trim();
ok('Inga dubbla funktioner eller const', dupes === '', dupes);
fs.unlinkSync(tmp);

// 2. Versionen i koden matchar senaste raden i ändringsloggen
const ver = (html.match(/const APP_VERSION = '([\d.]+)'/) || [])[1];
const logVer = (html.match(/const NEWS = \[\s*\['([\d.]+)'/) || [])[1];
ok('APP_VERSION matchar ändringsloggen', ver && ver === logVer, `${ver} / ${logVer}`);

// Lokal server
const server = http.createServer((req, res) => {
  const p = path.join(dir, decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html');
  fs.readFile(p.endsWith('/') ? p + 'index.html' : p, (err, data) => {
    if (err) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': p.endsWith('.js') ? 'text/javascript' : p.endsWith('.html') ? 'text/html' : 'application/octet-stream' });
    res.end(data);
  });
});

(async () => {
  await new Promise(r => server.listen(0, r));
  const url = `http://localhost:${server.address().port}/index.html`;
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(url); await page.waitForTimeout(1500);

  const tabs = ['Hem', 'Utforska', 'Samling', 'Gemenskap', 'Profil'];
  for (const t of tabs) {
    const btn = page.locator('nav button', { hasText: t }).first();
    if (await btn.count()) { await btn.click().catch(() => {}); await page.waitForTimeout(700); }
    const r = await page.evaluate(() => {
      const txt = document.body.innerText;
      const raw = /<svg|<i class=|" ="|&lt;/.test(txt);
      const overflow = document.documentElement.scrollWidth > window.innerWidth;
      let small = 0, unlabeled = 0;
      for (const el of document.querySelectorAll('button,a,[role=button]')) {
        const b = el.getBoundingClientRect(); if (!b.width || !b.height) continue;
        if (b.width < 24 || b.height < 24) small++;
        if (!((el.getAttribute('aria-label') || el.innerText || el.title || '').trim())) unlabeled++;
      }
      return { raw, overflow, small, unlabeled };
    });
    ok(`Flik ${t}: ingen rå SVG/HTML i texten`, !r.raw);
    ok(`Flik ${t}: ingen horisontell scroll`, !r.overflow);
    ok(`Flik ${t}: inga träffytor under 24 px`, r.small === 0, `${r.small} st`);
    ok(`Flik ${t}: alla knappar har etikett`, r.unlabeled === 0, `${r.unlabeled} st`);
  }
  ok('Inga JavaScript-fel under körningen', errors.length === 0, errors.slice(0, 3).join(' | '));

  // 3. Offline: appen ska starta från sparad kopia och visa bannern
  const octx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const op = await octx.newPage();
  await op.goto(url); await op.waitForTimeout(2500);
  const swOk = await op.evaluate(() => navigator.serviceWorker.ready.then(() => true).catch(() => false));
  ok('Service worker är aktiv', swOk);
  await octx.setOffline(true);
  await op.reload().catch(() => {}); await op.waitForTimeout(1500);
  const off = await op.evaluate(() => ({ kids: document.querySelector('#app') ? document.querySelector('#app').children.length : 0, banner: !document.getElementById('offline').hidden }));
  ok('Offline: appen startar från sparad kopia', off.kids > 0, `${off.kids} element`);
  ok('Offline: banner visas', off.banner);
  await octx.setOffline(false);
  await op.waitForTimeout(800);
  const back = await op.evaluate(() => document.getElementById('offline').hidden);
  ok('Online igen: banner döljs', back === true);
  await octx.close();

  // 4b. Kontoreset: förra användarens data ska rensas vid utloggning
  const resetOk = await page.evaluate(() => {
    S.friends = [{ id: 'x', display_name: 'Test' }]; S.inbox = [{ other: 'x' }]; S.notifs = [{ t: 'friend' }]; S.blocks = ['x']; S.follows = ['x'];
    resetUserState();
    return S.friends === null && S.inbox === null && S.notifs.length === 0 && S.blocks.length === 0 && S.follows.length === 0 && S.user === null;
  });
  ok('Kontoreset: förra användarens vänner, meddelanden och notiser rensas', resetOk);

  // 4c. Små buggar: ogiltigt datum, ljusbehov och snooze
  const bugsOk = await page.evaluate(() => {
    const today0 = today();
    return since('inte ett datum') === null && since(today0) === 0 && lightClass({ light_level: 2, light_text: 'Skugga' }) === 2;
  });
  ok('Buggar: ogiltigt datum ger okänt, ljusbehov följer light_level', bugsOk);

  // 4a. XSS: ett elakt namn i en onclick ska inte kunna köra kod
  const xssOk = await page.evaluate(() => {
    window.__PWN = undefined;
    const payload = "x');window.__PWN=1;//";
    const d = document.createElement('div');
    d.innerHTML = `<button onclick="window.__hit=[${jsArg(payload)},${jsArg(payload)}]">t</button>`;
    document.body.appendChild(d);
    d.querySelector('button').click();
    const ok = window.__PWN === undefined && Array.isArray(window.__hit) && window.__hit[0] === payload;
    d.remove();
    return ok;
  });
  ok('XSS: elakt namn i onclick körs inte som kod', xssOk);

  // 4. Ingen nyckel i demo-buildet ska exponeras
  ok('Demo-build innehåller ingen projektnyckel', !html.includes('lboomcqxksqahkugpxew'));

  await browser.close();
  server.close();
  console.log(fails.length ? `\n${fails.length} test misslyckades` : '\nAlla tester gick igenom');
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
