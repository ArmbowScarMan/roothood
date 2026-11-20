// Testar "Visa för vän": knappen finns på en egen växt, bara vänner kan väljas, och meddelandet innehåller växtens namn.
// Kör: node tests/visa-for-van.js <sökväg till demo-index.html>
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const dir = path.dirname(path.resolve(process.argv[2] || 'index.html'));
const srv = http.createServer((q, r) => { const p = path.join(dir, q.url.split('?')[0].replace(/^\/+/, '') || 'index.html'); fs.readFile(p, (e, d) => { if (e) { r.writeHead(404); return r.end(); } r.writeHead(200); r.end(d); }); });
(async () => {
  await new Promise(r => srv.listen(0, r));
  const b = await chromium.launch(), pg = await (await b.newContext({ viewport: { width: 390, height: 844 } })).newPage(); const errs = []; pg.on('pageerror', e => errs.push(e.message));
  await pg.goto(`http://localhost:${srv.address().port}/index.html`); await pg.waitForTimeout(1500);
  const out = {};
  await pg.evaluate(async () => { api.myFriends = async () => [{ id: 'vän-1', display_name: 'Testvän' }]; S.friends = null; const m = S.mine[0]; openPlant(m.plant_id, m.id); });
  await pg.waitForTimeout(500);
  out.knappFinns = await pg.evaluate(() => !!document.querySelector('button[onclick^="shareOpen("]'));
  await pg.evaluate(() => { S.friends = null; document.querySelector('button[onclick^="shareOpen("]').click(); }); await pg.waitForTimeout(600);
  out.fonsterOppet = await pg.evaluate(() => S.modal === 'shareplant' && /Visa för vän/.test($('#ov').innerText));
  out.skickaAvstangd = await pg.evaluate(() => { const b = $('#ov .formbtn'); return !!b && b.disabled; });
  const fr = await pg.evaluate(() => (S.friends || []).length);
  out.harVanner = fr > 0;
  if (fr > 0) {
    await pg.evaluate(() => $('#ov .chips2 button').click()); await pg.waitForTimeout(300);
    out.skickaPaslagen = await pg.evaluate(() => { const b = $('#ov .formbtn'); return !!b && !b.disabled; });
    await pg.fill('#shrt', 'Titta vilken fin!');
    const mname = await pg.evaluate(() => S.mine.find(x => x.id === S.shr.id).name);
    const toId = await pg.evaluate(() => S.shr.to);
    await pg.evaluate(() => $('#ov .formbtn').click()); await pg.waitForTimeout(700);
    out.stangd = await pg.evaluate(() => S.modal === null);
    const th = await pg.evaluate(id => api.thread(id), toId);
    const last = th[th.length - 1] || {};
    out.meddelandeSkickat = !!last.mine && last.body.includes('Titta vilken fin!') && last.body.includes('[[v:' + encodeURIComponent(mname));
    out.utanBild = last.photo_url == null;
  }
  const ok = Object.values(out).every(v => v === true) && !errs.length;
  console.log(JSON.stringify(out)); console.log(ok ? 'OK: Visa för vän fungerar' : 'FAIL ' + errs.join(' | '));
  await b.close(); srv.close(); process.exitCode = ok ? 0 : 1;
})();
