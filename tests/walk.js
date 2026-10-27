// Testar gå-läget i 3D utan grafik: väggar och fönster stoppar, dörrar går att gå igenom, möbler stoppar, och man glider längs väggen.
// Kör: node tests/walk.js <sökväg till demo-index.html>
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
    // Rum A och B bredvid varandra. Dörr mellan dem (y 1–1.9), fönster mot norr i rum A, och en byrå i rum B.
    S.home = [{ id: 'a', name: 'A', rect: { x: 0, y: 0, w: 4, h: 3 }, wins: [{ s: 'r', p: 1, l: 0.9, k: 'door' }, { s: 't', p: 1, l: 1.5 }] }, { id: 'b', name: 'B', rect: { x: 4, y: 0, w: 4, h: 3 }, wins: [{ s: 'l', p: 1, l: 0.9, k: 'open', pair: 'p1' }] }];
    S.hplan = { furn: [{ id: 'd1', t: 'dresser', x: 6.5, y: 1.45, w: 0.8, h: 0.45, rot: 0 }] };
    const res = {};
    try {
      const blk = walkBlockers(0), go = (x, z, yaw, n, step) => { T3 = { walk: { x, z, yaw, pitch: 0, fl: 0, blk } }; for (let i = 0; i < n; i++) walkStep(step || 0.05, 0); return T3.walk; };
      res.vagg = (w => w.x < 4 - 0.2 && w.x > 3.5)(go(2, 0.4, Math.PI / 2, 80));          // mot väggen utan dörr: stannar strax före x = 4
      res.dorr = (w => w.x > 4.5)(go(2, 1.45, Math.PI / 2, 60));                          // genom dörren: hamnar i rum B
      res.fonster = (w => w.z > 0.2 && w.z < 0.6)(go(1.75, 1.5, Math.PI, 60));             // mot fönstret i norr: stannar
      res.mobel = (w => w.x < 6.5 - 0.4)(go(4.6, 1.45, Math.PI / 2, 80));                  // mot byrån: stannar framför den
      res.glider = (w => w.z < 0.5 && w.x > 2.5)(go(2, 0.6, Math.PI * 0.75, 60));          // snett mot väggen: glider längs den
      res.vrid = (() => { T3 = { walk: { x: 1, z: 1, yaw: 0, pitch: 0, fl: 0, blk } }; walkStep(0, 0.5); return Math.abs(T3.walk.yaw - 0.5) < 1e-9; })();
    } finally { S.home = oldH; S.hplan = oldP; T3 = oldT; }
    return res;
  });
  const ok = Object.values(out).every(v => v === true) && !errs.length;
  console.log(JSON.stringify(out)); console.log(ok ? 'OK: gå-läget stoppar vid väggar och möbler och går genom dörrar' : 'FAIL ' + errs.join(' | '));
  await b.close(); srv.close(); process.exitCode = ok ? 0 : 1;
})();
