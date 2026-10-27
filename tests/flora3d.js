const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
// Bygger alla växttyper och alla växter i databasen i 3D med en kontrollerande ersättare för Three.js.
// Kör: node tests/flora3d.js <sökväg till demo-index.html>
const dir = path.dirname(path.resolve(process.argv[2] || 'index.html'));
const srv = http.createServer((q, r) => { const p = path.join(dir, q.url.split('?')[0].replace(/^\/+/, '') || 'index.html'); fs.readFile(p, (e, d) => { if (e) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'content-type': p.endsWith('.html') ? 'text/html' : 'text/javascript' }); r.end(d); }); });
(async () => {
  await new Promise(r => srv.listen(0, r));
  const b = await chromium.launch(), pg = await b.newPage(); const errs = []; pg.on('pageerror', e => errs.push(e.message));
  await pg.goto(`http://localhost:${srv.address().port}/index.html`); await pg.waitForTimeout(1500);
  const res = await pg.evaluate(() => {
    class V3 { constructor() { this.x = 0; this.y = 0; this.z = 0; } set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; } }
    let nObj = 0, nInst = 0, nInstances = 0;
    class Obj { constructor() { nObj++; this.position = new V3(); this.rotation = { x: 0, y: 0, z: 0, set(x, y, z, o) { this.x = x; this.y = y; this.z = z; this.order = o; return this; } }; this.scale = new V3().set(1, 1, 1); this.children = []; this.matrix = {}; }
      add(c) { if (!c) throw new Error('add(undefined)'); this.children.push(c); } updateMatrix() { for (const v of [this.position.x, this.position.y, this.position.z, this.rotation.x, this.rotation.y, this.rotation.z, this.scale.x, this.scale.y, this.scale.z]) if (!isFinite(v)) throw new Error('NaN i position/rotation/skala'); } }
    class Attr { constructor(n) { this.a = new Float32Array(n * 3); this.count = n; } getX(i) { return this.a[i * 3]; } getY(i) { return this.a[i * 3 + 1]; } setXYZ(i, x, y, z) { if (![x, y, z].every(isFinite)) throw new Error('NaN i geometri'); this.a.set([x, y, z], i * 3); } }
    class Geo { translate() { return this; } computeVertexNormals() {} }
    class PlaneGeometry extends Geo { constructor(w, h, sw, sh) { super(); const at = new Attr((sw + 1) * (sh + 1)); let k = 0; for (let j = 0; j <= sh; j++) for (let i = 0; i <= sw; i++) at.setXYZ(k++, -w / 2 + w * i / sw, h / 2 - h * j / sh, 0); this.attributes = { position: at }; } }
    const THREE = { Group: Obj, Object3D: Obj, Mesh: class extends Obj { constructor(g, m) { super(); if (!g || !m) throw new Error('Mesh utan geometri/material'); this.geometry = g; this.material = m; } },
      InstancedMesh: class extends Obj { constructor(g, m, n) { super(); nInst++; nInstances += n; this.n = n; this.instanceMatrix = {}; if (!n) throw new Error('InstancedMesh med 0'); } setMatrixAt(i) { if (i >= this.n) throw new Error('index utanför'); } },
      PlaneGeometry, SphereGeometry: Geo, CylinderGeometry: Geo, ConeGeometry: Geo, BoxGeometry: Geo, TorusGeometry: Geo, CircleGeometry: Geo,
      MeshStandardMaterial: class { constructor(o) { Object.assign(this, o); } }, CanvasTexture: class { constructor(c) { this.image = c; } }, DoubleSide: 2, SRGBColorSpace: 'srgb' };
    const M = (c, o) => new THREE.MeshStandardMaterial(Object.assign({ color: c }, o || {}));
    const out = { ok: 0, fail: [], kinds: {} };
    const kinds = ['perenn', 'sommar', 'krydda', 'gron', 'rot', 'blad', 'marktack', 'buske', 'ros', 'bar', 'lov', 'frukt', 'bjork', 'gran', 'tall', 'lok', 'svard', 'solros', 'gras', 'ormbunke', 'klatter'];
    const realSeas = S.sea3;
    for (const sz of ['Sommar', 'Vår', 'Höst', 'Vinter']) for (const lo of [false, true]) {
      S.sea3 = sz; S.low3d = lo;
      for (const k of kinds) for (const shp of [undefined, 'simple', 'daisy', 'cup', 'star', 'spike', 'umbel', 'ball']) {
        try { veg3d(THREE, M, k, 0.9, 0.5, 7, 120, { fshape: shp, fcenter: shp === 'daisy' ? 'droop' : undefined, flower: '#E56A93' }); out.ok++; } catch (e) { out.fail.push(`${sz}/${lo}/${k}/${shp}: ${e.message}`); }
      }
      for (const p of S.plants) { try { plant3d(p, THREE, M); out.ok++; const o = opt3d(p); if (o.fshape) out.kinds[o.fshape] = (out.kinds[o.fshape] || 0) + 1; } catch (e) { out.fail.push(`${sz}/${lo}/${p.swedish_name}: ${e.message}`); } }
    }
    // Inomhusväxter: alla växter i databasen och några typiska namn, frisk och sjuk, båda kvalitetslägena
    const names = ['Phalaenopsis', 'Sansevieria trifasciata', 'Zamioculcas zamiifolia', 'Howea forsteriana', 'Nephrolepis exaltata', 'Asplenium nidus', 'Epipremnum aureum', 'Chlorophytum comosum', 'Tradescantia zebrina', 'Monstera deliciosa', 'Spathiphyllum', 'Anthurium andraeanum', 'Ficus benjamina', 'Ficus elastica', 'Dracaena marginata', 'Citrus limon', 'Saintpaulia', 'Cyclamen persicum', 'Gerbera', 'Hibiscus rosa-sinensis', 'Peperomia', 'Opuntia', 'Echeveria'];
    out.indoor = { ok: 0, nya: 0 };
    for (const lo of [false, true]) { S.low3d = lo;
      for (const p of S.plants.concat(names.map((n, i) => ({ id: 9000 + i, latin_name: n, swedish_name: n, category: /Phalaenopsis/.test(n) ? 'Orkidé' : 'Krukväxt' })))) for (const okv of [true, false]) {
        try { const before = nInst; indoor3d(THREE, M, p, okv, 11); out.indoor.ok++; if (nInst > before) out.indoor.nya++; } catch (e) { out.fail.push(`inne/${lo}/${p.swedish_name}: ${e.message}`); } } }
    S.sea3 = realSeas; S.low3d = false;
    // jämför antal objekt per perenn sommartid
    S.sea3 = 'Sommar'; nObj = 0; nInst = 0; nInstances = 0; veg3d(THREE, M, 'perenn', 0.9, 0.5, 7, 120, { fshape: 'daisy', flower: '#E56A93' }); out.perennNy = { objekt: nObj, instancedMeshes: nInst, delar: nInstances };
    S.low3d = true; nObj = 0; veg3d(THREE, M, 'perenn', 0.9, 0.5, 7, 120, { fshape: 'daisy', flower: '#E56A93' }); out.perennLag = { objekt: nObj }; S.low3d = false; S.sea3 = realSeas;
    out.plants = S.plants.length; out.fail = out.fail.slice(0, 10); return out;
  });
  console.log(JSON.stringify(res, null, 1)); console.log('pageerrors', errs.slice(0, 3));
  const bad = res.fail.length || errs.length; console.log(bad ? 'FAIL: 3D-växter' : 'OK: alla 3D-växter byggs utan fel'); process.exitCode = bad ? 1 : 0;
  await b.close(); srv.close();
})();
