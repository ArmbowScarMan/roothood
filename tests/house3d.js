// Testar 3D-delar i Mitt hem utan riktig grafik: bord med ben, altan/gång som klipps bort under rum, och fönsterbrädor.
// Kör: node tests/house3d.js <sökväg till demo-index.html>
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const dir = path.dirname(path.resolve(process.argv[2] || 'index.html'));
const srv = http.createServer((q, r) => { const p = path.join(dir, q.url.split('?')[0].replace(/^\/+/, '') || 'index.html'); fs.readFile(p, (e, d) => { if (e) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'content-type': p.endsWith('.html') ? 'text/html' : 'text/javascript' }); r.end(d); }); });
(async () => {
  await new Promise(r => srv.listen(0, r));
  const b = await chromium.launch(), pg = await b.newPage(); const errs = []; pg.on('pageerror', e => errs.push(e.message));
  await pg.goto(`http://localhost:${srv.address().port}/index.html`); await pg.waitForTimeout(1500);
  const res = await pg.evaluate(() => {
    class V3 { constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; } set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; } }
    class Obj { constructor() { this.position = new V3(); this.rotation = { x: 0, y: 0, z: 0, set(x, y, z) { this.x = x; this.y = y; this.z = z; } }; this.scale = new V3(1, 1, 1); this.children = []; this.matrix = {}; } add(c) { this.children.push(c); } updateMatrix() { if (![this.position.x, this.position.y, this.position.z].every(isFinite)) throw new Error('NaN'); } }
    class Geo { constructor(...a) { this.args = a; } }
    const THREE = { Group: Obj, Object3D: Obj, Mesh: class extends Obj { constructor(g, m) { super(); this.geometry = g; this.material = m; } },
      InstancedMesh: class extends Obj { constructor(g, m, n) { super(); this.geometry = g; this.n = n; this.pos = []; this.instanceMatrix = {}; } setMatrixAt(i, m) { this.pos.push(i); } },
      BoxGeometry: Geo, CylinderGeometry: Geo, SphereGeometry: Geo, TorusGeometry: Geo, MeshStandardMaterial: class { constructor(o) { Object.assign(this, o); } } };
    const M = c => new THREE.MeshStandardMaterial({ color: c }), out = {};
    // Ett rum 4 x 3 m med ett fönster på nedre väggen
    const room = { id: 'rt', name: 'Testrum', rect: { x: 0, y: 0, w: 4, h: 3 }, dirs: ['S'], wins: [{ s: 'b', p: 1, l: 1.5 }] };
    const oldHome = S.home; S.home = [room];
    try {
      // Alla detaljerade möbler byggs utan fel och består av flera delar
      out.mobler = Object.keys(FURN3).every(t => { const g = new Obj(), F = FURN_M[t]; FURN3[t](kit3(THREE, M, g, 3), F[2], F[3], FH[t] || 0.8, { t }); return g.children.length >= 2; });
      // Smarta saker: sensorn i krukan, termometern på väggen, växtlampan ovanför växten
      { const oldP = S.hplan; S.hplan = { items: ['sensor', 'thermo', 'grow', 'plug', 'lamp', 'humid', 'speaker', 'pump'].map((t, i) => ({ id: 'i' + i, t, x: t === 'thermo' || t === 'plug' ? 0.4 : 2.1, y: 1.5 })) };
        const sc = new Obj(); devices3d(THREE, M, sc, [{ x: 2, z: 1.5, y: 0, fl: 0 }], () => 0); const P = sc.children.map(g => g.position);
        out.sensorIKruka = Math.hypot(P[0].x - 2, P[0].z - 1.5) < 0.1 && P[0].y > 0.15 && P[0].y < 0.4;
        out.termometerPaVagg = Math.abs(P[1].x - 0.08) < 0.01 && P[1].y > 1.2;
        out.lampaOverVaxt = Math.hypot(P[2].x - 2, P[2].z - 1.5) < 0.01 && P[2].y > 0.9;
        out.allaApparater = sc.children.length === 8 && sc.children.every(g => g.children.length >= 1); S.hplan = oldP; }
      // Bord med ben
      const added = []; furn3d({ t: 'dtable', x: 2, y: 1.5, w: 1.6, h: 0.9 }, THREE, M, o => added.push(o));
      out.bord = added.length === 1 && added[0].children.length === 5;   // skiva + 4 ben
      const rnd = []; furn3d({ t: 'round', x: 1, y: 1, w: 1 }, THREE, M, o => rnd.push(o)); out.runtBord = rnd.length === 1 && rnd[0].children.length === 3;
      // Altan som möbel, halvt in i rummet: bara delen utanför ritas
      const dk = []; const drew = furn3d({ t: 'deck', x: 4, y: 1.5, w: 4, h: 3 }, THREE, M, o => dk.push(o)); out.altanMobelKlipps = drew && dk.length === 1 && dk[0].n > 0 && dk[0].n < 2500;
      // Altan som yta (patio), delvis under rummet: inga plankor med mitten inne i rummet
      const sc = new Obj(), slab = () => { throw new Error('slab ska inte användas när ytan klipps'); }, shape = () => {};
      area3d({ t: 'patio', pts: [[2, 0.5], [7, 0.5], [7, 2.5], [2, 2.5]] }, THREE, M, sc, slab, shape, 0.005);
      const inside = sc.children.filter(m => m.position && m.position.x > 0.2 && m.position.x < 3.8 && m.position.z > 0.2 && m.position.z < 2.8 && m.position.y > 0.02);
      out.altanYtaKlipps = sc.children.length > 10 && inside.length === 0; out.altanDelar = sc.children.length;
      // Altan helt utanför: vanlig grund används
      let slabUsed = false; area3d({ t: 'patio', pts: [[6, 5], [8, 5], [8, 7], [6, 7]] }, THREE, M, new Obj(), () => { slabUsed = true; }, shape, 0.005); out.altanUtanforOrort = slabUsed;
      // Fönsterbräda: riktningen ska peka in i rummet
      // Burspråk: alla tre delarna får en bräda som pekar in i rummet
      const bayRoom = { id: 'rb', name: 'Burspråk', rect: { x: 0, y: 0, w: 4, h: 3 }, dirs: ['S'], wins: [], bays: [{ s: 'b', p: 1, l: 2, d: 0.6 }] };
      out.burspråk = baySegs(bayRoom, bayRoom.bays[0]).every(([q]) => { const b2 = sill3d(q, bayRoom), m3 = sillMesh3(THREE, M, q, bayRoom); return b2 && m3 && inPoly3(b2.mx + b2.nx * 0.3, b2.mz + b2.nz * 0.3, roomPoly(bayRoom)); });
      // En tv-bänk framför fönstret: ingen bräda. Utan möbel: bräda.
      { const oldPlan = S.hplan; const q = wallSeg(room, room.wins[0]); S.hplan = { furn: [{ id: 'tv1', t: 'tv', x: 1.75, y: 2.6, w: 1.6, h: 0.4, rot: 0 }] }; out.bradaBlockeras = sillMesh3(THREE, M, q, room) === null; S.hplan = {}; out.bradaUtanMobel = !!sillMesh3(THREE, M, q, room); S.hplan = oldPlan; }
      const sl = sill3d(wallSeg(room, room.wins[0]), room); const ix = sl.mx + sl.nx * 0.3, iz = sl.mz + sl.nz * 0.3; out.brada = !!sl && inPoly3(ix, iz, roomPoly(room));
    } finally { S.home = oldHome; }
    return out;
  });
  const ok = Object.entries(res).filter(([k]) => k !== 'altanDelar').every(([, v]) => v === true) && !errs.length;
  console.log(JSON.stringify(res)); console.log(ok ? 'OK: bord, altan och fönsterbrädor' : 'FAIL: ' + errs.join(' | '));
  await b.close(); srv.close(); process.exitCode = ok ? 0 : 1;
})();
