// Testar tak (sadel, pulpet, platt, dölj), innertak, rumsrutan och tempelmallen i riktig 3D.
// Kör: node tests/tak.js <demo-index.html> [sökväg till three.module.js]
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const dir = path.dirname(path.resolve(process.argv[2] || 'index.html')), SP = require('os').tmpdir() + '/', THREE_JS = process.argv[3] || '/tmp/claude-0/threejs/build/three.module.js';
const srv = http.createServer((q, r) => { const p = path.join(dir, q.url.split('?')[0].replace(/^\/+/, '') || 'index.html'); fs.readFile(p, (e, d) => { if (e) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'content-type': p.endsWith('.html') ? 'text/html' : p.endsWith('.js') ? 'text/javascript' : 'application/octet-stream' }); r.end(d); }); });
(async () => {
  await new Promise(r => srv.listen(0, r));
  const b = await chromium.launch(), pg = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 }); const errs = []; pg.on('pageerror', e => errs.push(e.message)); pg.on('console', m => { if (/Roothood/.test(m.text())) errs.push(m.text().slice(0, 200)); });
  await pg.route('**/three*/**', r => r.fulfill({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(THREE_JS) }));
  await pg.route(/wikipedia|wikimedia|unpkg|nominatim|open-meteo/, r => r.abort());
  await pg.addInitScript(() => { try { localStorage.setItem('gronska:slow3d', 'false'); } catch (e) {} });
  await pg.goto(`http://localhost:${srv.address().port}/index.html`); await pg.waitForFunction(() => typeof S !== 'undefined' && !S.loading); await pg.evaluate(() => { if (S.modal) closeModal(); });
  const count = () => pg.evaluate(() => { const o = { roof: 0, ceil: 0, furn: {} }; T3.scene.traverse(x => { if (x.userData && x.userData.roof) o.roof++; if (x.userData && x.userData.ceil) o.ceil++; }); return o; });
  const shot = async n => { await pg.evaluate(() => { cam3('iso'); }); await pg.waitForTimeout(1200); await pg.evaluate(() => { const c = document.querySelector('.coach3'); if (c) c.remove(); }); await pg.screenshot({ path: SP + n + '.png' }); };
  // hus med två rum, innertak och sadeltak
  await pg.evaluate(() => { S.pro = true; S.homeLoaded = true; S.home = [{ id: 'a', name: 'Vardagsrum', rect: { x: 0, y: 0, w: 6, h: 4 }, ceil: '#F7F5F0', wins: [{ s: 'b', p: 2, l: 1.5 }] }, { id: 'b', name: 'Kök', rect: { x: 6, y: 0, w: 4, h: 4 }, wins: [] }]; S.hplan = { roof: { t: 'gable', p: 30, e: 0.4, c: '#9C4A3A' } }; openHouse(); setHMode('adv', '3d'); });
  await pg.waitForFunction(() => typeof T3 !== 'undefined' && T3 && T3.scene && document.querySelector('#box3d canvas'), null, { timeout: 30000 });
  await pg.waitForTimeout(1500); const res = { gable: await count() }; await shot('tak_sadel');
  for (const t of ['shed', 'flat']) { await pg.evaluate(t => setRoof('t', t), t); res[t] = await count(); await shot('tak_' + t); }
  await pg.evaluate(() => { setRoof('t', 'gable'); S.v3roof = false; build3d(); }); res.dolt = await count(); await pg.evaluate(() => { S.v3roof = true; build3d(); });
  // rumsrutan och tempelrutan ritas utan fel
  res.rumsruta = await pg.evaluate(() => { editRoom('a'); const t = document.body.innerText; const ok = [/Innertak/.test(t), /Egyptiskt tempel/.test(t), S.modal]; closeModal(); return ok; });
  res.takruta = await pg.evaluate(() => { openModal('roof'); const ok = /Sadeltak/.test(document.querySelector('#ov').innerText); closeModal(); return ok; });
  // tempel
  await pg.evaluate(() => { openModal('temple'); templeTpl(); });
  await pg.waitForTimeout(4000);
  res.tempel = await pg.evaluate(() => ({ rum: S.home.filter(r => r.style === 'egypt').length, pelare: S.hplan.furn.filter(f => f.t === 'gpillar').length, pyramid: S.hplan.furn.some(f => f.t === 'pyramid'), sand: S.hplan.ground }));
  res.tempelTak = await count();
  res.vy = await pg.evaluate(() => [S.tool, S.hview]); await shot('tempel_snett');
  await pg.evaluate(() => { cam3('iso'); T3.st.el = 0.3; T3.st.az = 2.6; T3.st.dist *= 0.55; T3.dirty = true; }); await pg.waitForTimeout(1200); await pg.screenshot({ path: SP + 'tempel_lagt.png' });
  const ok = res.gable.roof === 1 && res.gable.ceil === 1 && res.shed.roof === 1 && res.flat.roof === 1 && res.dolt.roof === 0 && res.rumsruta[1] && res.takruta && res.tempel.rum === 2 && res.tempel.pelare === 12 && res.tempel.pyramid && res.tempelTak.roof >= 3 && !errs.length;
  console.log(JSON.stringify({ res, errs })); console.log(ok ? 'OK: tak, innertak och tempel byggs i 3D' : 'FAIL'); process.exitCode = ok ? 0 : 1;
  await b.close(); srv.close();
})();
