// Testar rum med fri form (vinkelrum): geometri, rita hörn för hörn, fönster på de nya väggarna, gå-läget och att vanliga rum fungerar som förut.
// Kör: node tests/friform.js <sökväg till demo-index.html>
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const dir = path.dirname(path.resolve(process.argv[2] || 'index.html'));
const srv = http.createServer((q, r) => { const p = path.join(dir, q.url.split('?')[0].replace(/^\/+/, '') || 'index.html'); fs.readFile(p, (e, d) => { if (e) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'content-type': p.endsWith('.html') ? 'text/html' : p.endsWith('.js') ? 'text/javascript' : 'application/octet-stream' }); r.end(d); }); });
(async () => {
  await new Promise(r => srv.listen(0, r));
  const b = await chromium.launch(), pg = await b.newPage({ viewport: { width: 390, height: 844 } }); const errs = []; pg.on('pageerror', e => errs.push(e.message));
  await pg.goto(`http://localhost:${srv.address().port}/index.html`); await pg.waitForTimeout(1500);
  const out = await pg.evaluate(() => {
    const oldH = S.home, oldP = S.hplan, oldT = T3, res = {};
    // L-format rum: 6 m brett upptill, 3 m brett nedtill, 5 m djupt
    const L = [[0, 0], [6, 0], [6, 3], [3, 3], [3, 5], [0, 5]];
    try {
      S.home = [{ id: 'L', name: 'L-rum', pts: L.map(q => [...q]), rect: bboxOf(L), wins: [] }]; S.hplan = {};
      const r = S.home[0];
      res.sidor = sidesOf(r).map(s => sk(r, s)).join('') === 'trbrbl';
      res.langd = sidesOf(r).map(s => sideLen(r, s)).join(',') === '6,3,3,2,3,5';
      res.inne = roomAt(1, 4) === r && roomAt(5, 1) === r;
      res.hacket = roomAt(4.5, 4) === null;
      res.poly = roomPoly(r).length === 6 && wallPieces(r).length === 6;
      res.mitten = (c => inPoly(c[0], c[1], L))(roomInner(r));
      // tidyPts: lägger till hörnet som saknas, vänder moturs till medurs och stoppar korsande väggar
      res.stang = JSON.stringify(tidyPts([[0, 0], [6, 0], [6, 3], [3, 3], [3, 5], [0, 5]])) === JSON.stringify(L);
      res.vand = JSON.stringify(tidyPts(L.slice().reverse())) === JSON.stringify(L);
      res.saknat = (q => q && q.length === 6)(tidyPts([[0, 0], [6, 0], [6, 3], [3, 3], [3, 5]]));
      res.kors = tidyPts([[0, 0], [4, 0], [4, 2], [1, 2], [1, -1], [0, -1]]) === null;
      // fönster mot öster på den inre väggen (x = 3, y 3–5) och mot söder på den korta undre väggen (y = 3, x 3–6)
      PL().mode = 'win'; PL().wkind = 'win'; addWin({ x: 3.05, y: 4 }); addWin({ x: 4.5, y: 3.05 });
      const ws = r.wins.map(w => w.s + ':' + winDir(sk(r, w.s))).sort().join(',');
      res.fonster = ws === 'e2:S,e3:O';
      res.dirs = (r.dirs || []).join(',') === 'O,S';
      const seg = wallSeg(r, r.wins.find(w => w.s === 'e3')); res.fonsterPlats = seg[0] === 3 && seg[1] >= 3 && seg[3] <= 5;
      // gå-läget: väggarna i hacket stoppar
      const blk = walkBlockers(0), go = (x, z, yaw, n) => { T3 = { walk: { x, z, yaw, pitch: 0, fl: 0, blk } }; for (let i = 0; i < n; i++) walkStep(0.05, 0); return T3.walk; };
      res.gaOst = (w => w.x < 3 && w.x > 2.4)(go(1, 4.5, Math.PI / 2, 80));
      res.gaSyd = (w => w.z < 3 && w.z > 2.4)(go(5, 1, 0, 80)) || (w => w.z < 3 && w.z > 2.4)(go(5, 1, Math.PI, 80));
      // möbel i hacket räknas inte som inne i rummet
      res.mobel = !furnInRoom(r, { x: 4.5, y: 4, t: 'sofa' }) && furnInRoom(r, { x: 1, y: 4, t: 'sofa' });
      // flytta rummet: hörnen följer med
      roomShift(r, 1, 2); res.flytta = r.pts[0][0] === 1 && r.pts[0][1] === 2 && r.rect.x === 1 && r.rect.y === 2; roomShift(r, -1, -2);
      // rita hörn för hörn
      S.tool = 'house'; S.hview = 'plan'; const P = PL(); P.mode = 'room'; P.roomDraw = 'free'; P.free = []; P.z = 30;
      [[0, 0], [6, 0.2], [6, 3], [3, 3], [3, 5], [0, 5]].forEach(([x, y]) => freeTap({ x, y }));
      res.las = JSON.stringify(P.free) === JSON.stringify(L);
      freeTap({ x: 0.1, y: 0.1 });
      res.ritad = !!(S.rf && S.rf.pts && S.rf.pts.length === 6 && S.modal);
      S.modal = null;
      // vanliga rum som förut
      const R = { id: 'R', name: 'R', rect: { x: 10, y: 0, w: 4, h: 3 }, wins: [] }; S.home.push(R);
      res.rektangel = sidesOf(R).join('') === 'trbl' && sideLen(R, 't') === 4 && sideLen(R, 'l') === 3 && roomAt(12, 1) === R && JSON.stringify(wallSeg(R, { s: 'b', p: 1, l: 1 })) === '[11,3,12,3]';
    } catch (e) { res.fel = e.message; } finally { S.home = oldH; S.hplan = oldP; T3 = oldT; S.modal = null; }
    return res;
  });
  const ok = Object.entries(out).every(([k, v]) => v === true) && !errs.length;
  console.log(JSON.stringify(out)); console.log(ok ? 'OK: rum med fri form fungerar i ritning, fönster och gå-läget' : 'FAIL ' + Object.entries(out).filter(([k, v]) => v !== true).map(([k, v]) => k + '=' + v).join(', ') + ' ' + errs.join(' | '));
  await b.close(); srv.close(); process.exitCode = ok ? 0 : 1;
})();
