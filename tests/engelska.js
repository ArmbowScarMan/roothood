// Roothood på engelska: går igenom flikar, verktyg och dialoger och letar efter svensk text som blivit kvar.
// Kör: node tests/engelska.js <sökväg till demo-index.html> [--lista]
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const file = process.argv[2], lista = process.argv.includes('--lista');
const dir = path.dirname(path.resolve(file));
const srv = http.createServer((q, r) => { const p = path.join(dir, decodeURIComponent(q.url.split('?')[0]).replace(/^\/+/, '') || 'index.html'); fs.readFile(p, (e, d) => { if (e) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'content-type': p.endsWith('.html') ? 'text/html' : 'text/javascript' }); r.end(d); }); });
(async () => {
  await new Promise(r => srv.listen(0, r));
  const url = `http://localhost:${srv.address().port}/index.html`;
  const b = await chromium.launch(), ctx = await b.newContext({ viewport: { width: 390, height: 844 } }), pg = await ctx.newPage();
  const errs = []; pg.on('pageerror', e => errs.push(e.message));
  await pg.addInitScript(() => { try { localStorage.setItem('gronska_lang', '"en"'); localStorage.setItem('gronska_welcomeDone', 'true'); } catch (e) {} });
  await pg.goto(url); await pg.waitForTimeout(1800);
  const found = new Map();
  const names = await pg.evaluate(() => new Set(S.plants.flatMap(p => [p.swedish_name, p.latin_name])).size);
  const scan = async (where) => { await pg.waitForTimeout(250); const list = await pg.evaluate(() => {
      const plantNames = new Set(S.plants.flatMap(p => [p.swedish_name, p.latin_name])), keys = new Set(Object.keys(window.EN_DICT || {})), out = [];
      const sw = /[åäöÅÄÖ]|\b(och|att|är|för|inte|med|som|din|ditt|dina|växt|växter|på|eller|kan|har|ingen|inga|alla|du|ett|det|den|till|från|när|om|Ja|Nej|Spara|Avbryt|Stäng|Klar|Lägg|Vattna|Rum|Kruka|Fönster|dagar|Hem|Samling|Utforska|Gemenskap|Profil|Logga|Sök|Skicka|Visa|Mer|Nästa|Tillbaka)\b/;
      const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, { acceptNode: n => /^(SCRIPT|STYLE)$/.test(n.parentNode.nodeName) || n.parentNode.closest('[data-notr]') ? 2 : 1 });
      let n; while ((n = w.nextNode())) { const t = n.data.replace(/\s+/g, ' ').trim(); if (!t || plantNames.has(t) || /'/.test(t)) continue; const el = n.parentNode; if (!el.getClientRects().length) continue; if (sw.test(t) || (keys.has(t) && EN_DICT[t] !== t)) out.push(t); }
      document.querySelectorAll('[placeholder],[aria-label]').forEach(el => { for (const a of ['placeholder', 'aria-label']) { const v = el.getAttribute(a); if (v && sw.test(v) && !plantNames.has(v)) out.push('@' + a + ': ' + v); } });
      return out; });
    list.forEach(t => { if (!found.has(t)) found.set(t, where); }); };
  const lang = await pg.evaluate(() => [LANG, document.documentElement.lang, TR.map ? TR.map.size : 0]);
  for (const t of ['Home', 'Collection', 'Community', 'Profile']) { const btn = pg.locator('nav button', { hasText: t }).first(); if (await btn.count()) { await btn.click().catch(() => {}); await scan('flik ' + t); } else found.set('(saknar flik ' + t + ')', 'nav'); }
  const tools = ['db', 'doc', 'experts', 'explore', 'house', 'inspo', 'nearby', 'news', 'notif', 'people', 'perma', 'pets', 'season', 'settings', 'smart', 'sow', 'msgs', 'id', 'light', 'compass'];
  for (const t of tools) { await pg.evaluate(t => { try { S.modal = null; S.tool = t; render(); } catch (e) {} }, t); await scan('verktyg ' + t); }
  await pg.evaluate(() => { S.tool = null; render(); });
  const pid = await pg.evaluate(() => S.plants[0].id);
  for (const m of [['pdet', pid], ['login'], ['pro'], ['add', ''], ['homecfg']]) { await pg.evaluate(m => { try { openModal(...m); } catch (e) {} }, m); await scan('dialog ' + m[0]); await pg.evaluate(() => { try { closeModal(); } catch (e) {} }); }
  const toastOk = await pg.evaluate(() => { toast('Rummet är sparat'); return document.getElementById('toast').textContent; });
  console.log('Språk:', lang.join(' / '), '· toast:', toastOk);
  if (lista) for (const [t, w] of found) console.log(`[${w}] ${t}`);
  console.log(`${found.size} svenska texter kvar på engelska`); console.log('JS-fel:', errs.slice(0, 3));
  const ok = lang[0] === 'en' && lang[2] > 1000 && toastOk === 'The room is saved' && !errs.length && found.size <= 25;
  console.log(ok ? 'OK: appen fungerar på engelska' : 'FAIL: engelska'); process.exitCode = ok ? 0 : 1;
  await b.close(); srv.close();
})();
