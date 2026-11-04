// Testar hopp och bunnyhop i gå-läget: hopp når en höjd och landar, vanlig gång ger normal fart, bunnyhop med styrning i luften ger mer fart, och väggar stoppar även i fart.
// Kör: node tests/hopp.js <sökväg till demo-index.html>
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const dir = path.dirname(path.resolve(process.argv[2] || 'index.html'));
const srv = http.createServer((q, r) => { const p = path.join(dir, q.url.split('?')[0].replace(/^\/+/, '') || 'index.html'); fs.readFile(p, (e, d) => { if (e) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'content-type': p.endsWith('.html') ? 'text/html' : 'text/javascript' }); r.end(d); }); });
(async () => {
  await new Promise(r => srv.listen(0, r));
  const b = await chromium.launch(), pg = await b.newPage(); const errs = []; pg.on('pageerror', e => errs.push(e.message));
  await pg.goto(`http://localhost:${srv.address().port}/index.html`); await pg.waitForTimeout(1500);
  const out = await pg.evaluate(() => {
    const oldH = S.home, oldP = S.hplan, oldT = T3;
    S.home = [{ id: 'a', name: 'A', rect: { x: 0, y: 0, w: 4, h: 3 }, wins: [] }];
    S.hplan = { furn: [] };
    const res = {}, blk = [[0, 0, 4, 0], [4, 0, 4, 3], [4, 3, 0, 3], [0, 3, 0, 0]];
    const mk = (x, z, yaw) => ({ x, z, yaw, pitch: 0, fl: 0, blk, vx: 0, vz: 0, vy: 0, jy: 0, g: true });
    const DT = 1 / 60;
    try {
      // Hopp: stiger och landar
      let w = mk(2, 1.5, 0), maxJy = 0, air = 0; walkPhys(w, DT, null, true);
      for (let i = 0; i < 90; i++) { walkPhys(w, DT, null, false); maxJy = Math.max(maxJy, w.jy); if (!w.g) air++; }
      res.hopp = maxJy > 0.5 && maxJy < 1.3 && w.g && w.jy === 0 && air > 20 && air < 60;
      res.maxHojd = +maxJy.toFixed(2); res.luftFrames = air;
      // Vanlig gång framåt: normal fart
      w = mk(1, 1.5, Math.PI / 2); for (let i = 0; i < 120; i++) walkPhys(w, DT, 'f', false);
      const gang = Math.hypot(w.vx, w.vz); res.gang = +gang.toFixed(2); res.gangOk = Math.abs(gang - 1.3) < 0.05;
      // Bunnyhop: hoppa hela tiden framåt, svänga och styra i luften
      const big = [[-40, -40, 40, -40], [40, -40, 40, 40], [40, 40, -40, 40], [-40, 40, -40, -40]];
      w = Object.assign(mk(0, 0, Math.PI / 2), { blk: big }); let top = 0;
      for (let i = 0; i < 300; i++) { const jump = true; const k = w.g ? 'f' : (i % 40 < 20 ? 'l' : 'r'); if (!w.g) w.yaw += (i % 40 < 20 ? -1 : 1) * 0.05; walkPhys(w, DT, k, jump); top = Math.max(top, Math.hypot(w.vx, w.vz)); }
      res.bunny = +top.toFixed(2); res.bunnyOk = top > 2.0 && top <= 4.01;
      // Väggen: full fart mot väggen i x-led, ska inte gå igenom
      w = mk(0.5, 1.5, Math.PI / 2); for (let i = 0; i < 300; i++) walkPhys(w, DT, i % 60 < 40 ? 'f' : null, i % 50 === 0);
      res.vagg = w.x < 4 - 0.2 && w.x > 0.5;
    } finally { S.home = oldH; S.hplan = oldP; T3 = oldT; }
    return res;
  });
  const ok = out.hopp && out.gangOk && out.bunnyOk && out.vagg && !errs.length;
  console.log(JSON.stringify(out), errs); console.log(ok ? 'OK: hopp, bunnyhop och väggar fungerar i gå-läget' : 'FAIL');
  await b.close(); srv.close(); process.exitCode = ok ? 0 : 1;
})();
