// Navigeringstest (tillbaka-knappen). Kör: node tests/navigering.js <sökväg till demo-index.html>
const { chromium } = require('playwright'); const http = require('http'); const fs = require('fs'); const path = require('path');
const root = path.dirname(path.resolve(process.argv[2] || '/tmp/claude-0/t3/index.html')); const T = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2' };
const srv = http.createServer((q, r) => { const p = path.join(root, decodeURIComponent(q.url.split('?')[0]).replace(/\/$/, '/index.html')); fs.readFile(p, (e, d) => { if (e) { r.writeHead(404); r.end(); return; } r.writeHead(200, { 'content-type': T[path.extname(p)] || 'application/octet-stream' }); r.end(d); }); }).listen(8766);
const URL0 = 'http://localhost:8766/';
let fails = 0; const ok = (c, m) => { console.log((c ? 'OK   ' : 'FEL  ') + m); if (!c) fails++; };
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
  await ctx.route(u => !String(u).startsWith('http://localhost'), r => r.abort());
  const pg = await ctx.newPage(); const errs = []; pg.on('pageerror', e => errs.push(e.message));
  const st = () => pg.evaluate(() => ({ url: location.href, hash: location.hash, tab: S.tab, tool: S.tool, sel: S.sel, modal: S.modal || null, d: (history.state || {}).d, len: ($('#main') || {}).innerHTML ? $('#main').innerHTML.length : 0 }));
  const wait = (ms = 250) => pg.waitForTimeout(ms);
  const back = async () => { await pg.goBack({ waitUntil: 'commit' }).catch(() => {}); await wait(300); };
  const fresh = async (q = '') => { await pg.goto('about:blank'); await pg.goto(URL0 + q, { waitUntil: 'load' }); await pg.waitForFunction(() => typeof S !== 'undefined' && !S.loading); await wait(500); await pg.evaluate(() => { S.modal = null; render(); }); await wait(); };
  const pid = async () => pg.evaluate(() => S.plants[5].id);

  // 1
  await fresh(); let id = await pid();
  await pg.evaluate(id => openPlant(id), id); await wait(); let s = await st(); ok(s.sel === id && s.hash === '#v/' + id, '1a Hem -> öppna växt: ' + s.hash);
  await back(); s = await st(); ok(s.tab === 'home' && !s.sel && s.url.startsWith(URL0) && s.len > 100, '1b tillbaka -> Hem, appen kvar: ' + s.hash);
  // 2
  await pg.evaluate(id => openPlant(id), id); await wait(); await pg.evaluate(() => openModal('fb')); await wait(); s = await st(); ok(s.modal === 'fb', '2a ruta öppen ovanpå växten');
  await back(); s = await st(); ok(!s.modal && s.sel === id, '2b tillbaka stänger bara rutan, växten kvar: ' + s.hash);
  await pg.evaluate(() => openModal('fb')); await wait(); await pg.evaluate(() => closeModal()); await wait(400); s = await st(); ok(!s.modal && s.sel === id, '2c ruta stängd med knappen, växten kvar');
  await back(); s = await st(); ok(s.tab === 'home' && !s.sel, '2d sen tillbaka -> Hem (historiken stämmer efter knapp-stängning): ' + s.hash);
  // 3
  await fresh(); s = await st(); ok(s.d === 0, '3a Hem är första posten (d=0)');
  await back(); s = await st().catch(() => ({ url: 'about:blank' })); ok(s.url === 'about:blank', '3b tillbaka från Hem lämnar appen: ' + s.url);
  // 4
  await fresh(); id = await pid();
  await pg.evaluate(() => go('mine')); await wait(); await pg.evaluate(() => openTool('db')); await wait(); await pg.evaluate(id => openPlant(id), id); await wait();
  s = await st(); ok(s.sel === id && s.tool === 'db', '4a Hem -> Samling -> växtdatabas -> växt: ' + s.hash);
  await back(); s = await st(); ok(s.tool === 'db' && !s.sel, '4b tillbaka -> växtdatabasen: ' + s.hash);
  await back(); s = await st(); ok(s.tab === 'mine' && !s.sel && !s.tool, '4c tillbaka -> Samling: ' + s.hash);
  await back(); s = await st(); ok(s.tab === 'home' && s.url.startsWith(URL0), '4d tillbaka -> Hem: ' + s.hash);
  // 5
  await fresh(); id = await pid();
  await pg.evaluate(() => go('mine')); await wait(); await pg.evaluate(id => openPlant(id), id); await wait();
  await pg.reload({ waitUntil: 'load' }); await pg.waitForFunction(() => typeof S !== 'undefined' && !S.loading); await wait(600); await pg.evaluate(() => { if (S.modal === 'news' || S.modal) { S.modal = null; render(); } }); await wait();
  s = await st(); ok(s.sel === id, '5a omladdning djupt inne: kvar på växten: ' + s.hash);
  await back(); s = await st(); ok(s.tab === 'mine' && !s.sel, '5b tillbaka efter omladdning -> Samling: ' + s.hash);
  // 6
  await fresh('?tab=mine'); s = await st(); ok(s.tab === 'mine', '6a djuplänk ?tab=mine öppnar Samling: ' + s.hash);
  await back(); s = await st(); ok(s.tab === 'home' && s.url.startsWith(URL0), '6b tillbaka -> Start i stället för att stänga: ' + s.hash);
  // 7
  await fresh(); id = await pid();
  await pg.evaluate(() => go('mine')); await wait(); await pg.evaluate(() => go('comm')); await wait(); await pg.evaluate(() => openTool('db')); await wait(); await pg.evaluate(id => openPlant(id), id); await wait();
  await pg.evaluate(() => { history.back(); history.back(); history.back(); }); await wait(900); s = await st();
  ok(s.tab === 'mine' && !s.tool && !s.sel && s.len > 100, '7 tre snabba tillbaka -> Samling, inte en tom vy: ' + s.hash + ' len ' + s.len);
  // 8
  await fresh(); await pg.evaluate(() => go('mine')); await wait(); await pg.evaluate(() => go('comm')); await wait();
  await back(); s = await st(); ok(s.tab === 'mine', '8a Gemenskap -> Samling: ' + s.hash);
  await back(); s = await st(); ok(s.tab === 'home', '8b Samling -> Hem: ' + s.hash);
  // 9 pilen i appen
  await fresh(); id = await pid(); await pg.evaluate(() => go('mine')); await wait(); await pg.evaluate(id => openPlant(id), id); await wait();
  await pg.evaluate(() => navBack()); await wait(400); s = await st(); ok(s.tab === 'mine' && !s.sel, '9 tillbaka-pilen i appen -> Samling: ' + s.hash);
  // 10 nyhetsrutan vid start: tillbaka stänger den, appen ligger kvar
  await pg.goto('about:blank'); await pg.evaluate(() => localStorage.clear()).catch(() => {}); await pg.goto(URL0, { waitUntil: 'load' }); await pg.waitForFunction(() => typeof S !== 'undefined' && !S.loading); await wait(800);
  s = await st(); const hadModal = !!s.modal;
  await back(); s = await st().catch(() => ({ url: 'about:blank' })); ok(hadModal ? (!s.modal && s.url.startsWith(URL0)) : true, '10 ruta vid start + tillbaka: rutan stängs, appen kvar (ruta fanns: ' + hadModal + ')');
  // 11 omladdning med ruta öppen
  await fresh(); id = await pid(); await pg.evaluate(id => openPlant(id), id); await wait(); await pg.evaluate(() => openModal('fb')); await wait();
  await pg.reload({ waitUntil: 'load' }); await pg.waitForFunction(() => typeof S !== 'undefined' && !S.loading); await wait(600); await pg.evaluate(() => { S.modal = null; render(); }); await wait();
  s = await st(); ok(s.sel === id && s.url.startsWith(URL0), '11a omladdning med ruta öppen: växten visas: ' + s.hash);
  await back(); await back(); s = await st().catch(() => ({ url: 'about:blank' })); ok(s.url.startsWith(URL0) && s.tab === 'home' && !s.sel, '11b sen tillbaka tar dig till Hem: ' + s.hash);
  ok(errs.length === 0, 'inga JS-fel ' + errs.slice(0, 2).join(' | '));
  console.log(fails ? fails + ' fel' : 'Alla navigeringstester gick igenom');
  await b.close(); srv.close();
})();
