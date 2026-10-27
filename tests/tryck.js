// Testar att planritningen går att använda med bara tryck: flytta växt och rum, rita vägg med två tryck.
// Kör: node tests/tryck.js <sökväg till demo-index.html>
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const dir = path.dirname(path.resolve(process.argv[2] || 'index.html'));
const srv = http.createServer((q, r) => { const p = path.join(dir, q.url.split('?')[0].replace(/^\/+/, '') || 'index.html'); fs.readFile(p, (e, d) => { if (e) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'content-type': p.endsWith('.html') ? 'text/html' : 'text/javascript' }); r.end(d); }); });
(async () => {
  await new Promise(r => srv.listen(0, r));
  const b = await chromium.launch(), pg = await (await b.newContext({ viewport: { width: 390, height: 844 } })).newPage(); const errs = []; pg.on('pageerror', e => errs.push(e.message));
  await pg.goto(`http://localhost:${srv.address().port}/index.html`); await pg.waitForTimeout(1500);
  // Ett rum 4 x 3 m och en växt i det
  await pg.evaluate(async () => { S.home = [{ id: 'rt', name: 'Testrum', type: 'Vardagsrum', rect: { x: 0, y: 0, w: 4, h: 3 }, dirs: ['S'], wins: [{ s: 'b', p: 1, l: 1.5 }] }]; S.hplan = {};
    const m = S.mine[0]; m.details = Object.assign({}, m.details || {}, { pos: { x: 1, y: 1 }, room: 'rt' }); await api.saveDetails(m.id, m.details); S.mine = await api.mine();
    S.hmode = 'adv'; S.hview = 'plan'; openHouse(); });
  await pg.waitForTimeout(700); await pg.evaluate(() => { PL().fit = false; PL().z = 40; PL().ox = 40; PL().oy = 60; renderPlan(); });
  const at = async (x, y) => { const p = await pg.evaluate(([x, y]) => { const r = $('#plan').getBoundingClientRect(), P = PL(); return [r.left + P.ox + x * P.z, r.top + P.oy + y * P.z]; }, [x, y]); await pg.mouse.click(p[0], p[1]); await pg.waitForTimeout(350); };
  const out = {};
  // Välj växten med ett tryck och tryck där den ska stå
  await at(1, 1); out.valdVaxt = await pg.evaluate(() => (PL().sel || {}).k === 'plant');
  await at(3, 2); out.vaxtFlyttad = await pg.evaluate(() => { const p = S.mine[0].details.pos; return Math.abs(p.x - 3) < 0.15 && Math.abs(p.y - 2) < 0.15; });
  // Klar, välj rummet och tryck utanför: rummet flyttas dit
  await pg.evaluate(() => { PL().sel = null; render(); }); await pg.waitForTimeout(300);
  await at(0.5, 2.6); out.valtRum = await pg.evaluate(() => (PL().sel || {}).k === 'room');
  await at(7.5, 1.5); out.rumFlyttat = await pg.evaluate(() => { const R = S.home[0].rect; return R.x > 5; });
  out.vaxtFoljerRum = await pg.evaluate(() => S.mine[0].details.pos.x > 6);
  // Vägg med två tryck
  await pg.evaluate(() => { PL().sel = null; planMode('win'); PL().wkind = 'wall'; render(); }); await pg.waitForTimeout(300);
  const before = await pg.evaluate(() => planWallsAll().length);
  await at(1, 6); out.startMarkerad = await pg.evaluate(() => !!PL().wstart);
  await at(4, 6); out.vaggRitad = await pg.evaluate(n => planWallsAll().length === n + 1, before);
  const ok = Object.values(out).every(v => v === true) && !errs.length;
  console.log(JSON.stringify(out)); console.log(ok ? 'OK: ritningen fungerar med bara tryck' : 'FAIL ' + errs.join(' | '));
  await b.close(); srv.close(); process.exitCode = ok ? 0 : 1;
})();
