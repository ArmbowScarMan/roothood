const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
// Testar enkelt läge i Mitt hem: guiden skapar rum med ritning och fönster, placerar växten och döljer bottenmenyn i avancerat läge.
// Kör: node tests/enkelt.js <sökväg till demo-index.html>
const dir = path.dirname(path.resolve(process.argv[2] || 'index.html'));
const srv = http.createServer((q, r) => { const p = path.join(dir, q.url.split('?')[0].replace(/^\/+/, '') || 'index.html'); fs.readFile(p, (e, d) => { if (e) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'content-type': p.endsWith('.html') ? 'text/html' : 'text/javascript' }); r.end(d); }); });
(async () => {
  await new Promise(r => srv.listen(0, r));
  const b = await chromium.launch(), ctx = await b.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'light' }), pg = await ctx.newPage(); const errs = []; pg.on('pageerror', e => errs.push(e.message));
  await pg.goto(`http://localhost:${srv.address().port}/index.html`); await pg.waitForTimeout(1500);
  const shot = async () => { await pg.waitForTimeout(200); };
  await pg.evaluate(() => { S.home = []; S.hplan = {}; S.hmode = 'simple'; openHouse(); }); await shot('0-start');
  await pg.evaluate(() => wzStart()); await shot('1-rum');
  await pg.evaluate(() => { wzTpl(1); wzNext(); }); await shot('2-fonster');
  await pg.evaluate(() => { wzSet('dir', 'S'); wzNext(); }); await shot('3-ljus');
  await pg.evaluate(() => { wzSet('light', 'Mycket ljust'); wzNext(); }); await shot('4-vaxter');
  const res = await pg.evaluate(async () => { if (S.mine[0]) { wzPlant(S.mine[0].id); wzHang(S.mine[0].id); }
    // resten av rummen: Sovrum norr, Kök öster, Badrum utan riktning, Hall utan riktning
    const dirs = { Sovrum: 'N', Kök: 'O' }; wzNext();
    while (S.wz) { const n = wzName(); if (S.wz.step === 2) { if (dirs[n]) wzSet('dir', dirs[n]); } wzNext(); await new Promise(r => setTimeout(r, 30)); if (S.busy) await new Promise(r => setTimeout(r, 600)); }
    return { rooms: S.home.map(r => ({ n: r.name, dirs: r.dirs, rect: r.rect, wins: (r.wins || []).length, light: r.lightPick })), p0: S.mine[0] && S.mine[0].details };
  });
  await shot('5-klart');
  await pg.evaluate(() => setHMode('adv', 'plan')); await pg.waitForTimeout(800); await shot('6-plan');
  await pg.evaluate(() => { PL().more = true; render(); }); await shot('7-mer');
  const nav = await pg.evaluate(() => getComputedStyle(document.querySelector('nav')).display);
  const R = n => res.rooms.find(r => r.n === n) || {};
  const ok = res.rooms.length === 5 && res.rooms.every(r => r.rect) && R('Vardagsrum').wins === 1 && R('Kök').wins === 1 && R('Hall').wins === 0 && res.p0 && res.p0.place === 'Ampel' && res.p0.pos && nav === 'none' && !errs.length;
  console.log(ok ? 'OK: enkelt läge skapar rum, fönster och växtplats' : 'FAIL: ' + JSON.stringify({ rooms: res.rooms.length, nav, errs }));
  process.exitCode = ok ? 0 : 1;
  await b.close(); srv.close();
})();
