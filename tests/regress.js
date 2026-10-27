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
const logVer = (html.match(/\['([\d.]+)', 'Nu'/) || [])[1];
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

  const tabs = ['Hem', 'Utforska', 'Samling', 'Community', 'Profil'];
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

  // 3. Ingen nyckel i demo-buildet ska exponeras
  ok('Demo-build innehåller ingen projektnyckel', !html.includes('lboomcqxksqahkugpxew'));

  await browser.close();
  server.close();
  console.log(fails.length ? `\n${fails.length} test misslyckades` : '\nAlla tester gick igenom');
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
