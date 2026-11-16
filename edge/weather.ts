// Roothood: väder från SMHI:s öppna data (CC BY 4.0). Ersätter Open-Meteo, som kräver betald licens när appen har Pro.
// GET ?kind=fc&lat=..&lon=..        Prognos (SNOW1gv1) i samma form som appen använde från Open-Meteo: current, daily, hourly.cloud_cover
// GET ?kind=obs&lat=..&lon=..       Observationer från närmaste SMHI-station: nederbörd per dygn (ca 1 år), snödjup, regn/snö senaste veckan
// GET ?kind=cloud&lat=..&lon=..&ds=YYYY-MM-DD   Molnighet (%) per timme för ett datum (bara prognosdagar, annars null)
// Svaren cachas i minnet per ruta (ca 2 km) så att SMHI inte belastas i onödan.

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};
const UA = { "User-Agent": "Roothood/1.0 (roothood.app@gmail.com)" };
const TZ = "Europe/Stockholm";
const FC = "https://opendata-download-metfcst.smhi.se/api/category/snow1g/version/1/geotype/point";
const OBS = "https://opendata-download-metobs.smhi.se/api/version/1.0/parameter";
const MISSING = 9999;

const cache = new Map<string, { t: number; v: unknown }>();
async function cached<T>(key: string, ttl: number, fn: () => Promise<T>): Promise<T> {
  const c = cache.get(key);
  if (c && Date.now() - c.t < ttl) return c.v as T;
  const v = await fn();
  cache.set(key, { t: Date.now(), v });
  if (cache.size > 2000) { const old = [...cache.entries()].sort((a, b) => a[1].t - b[1].t).slice(0, 500); old.forEach(([k]) => cache.delete(k)); }
  return v;
}
async function getJson(url: string) {
  const r = await fetch(url, { headers: UA });
  if (!r.ok) throw new Error(url.split("/").slice(2, 3)[0] + " " + r.status);
  return r.json();
}

// Lokalt datum och timme i Sverige
const dateFmt = new Intl.DateTimeFormat("sv-SE", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" });
function local(ms: number) {
  const p = Object.fromEntries(dateFmt.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { d: `${p.year}-${p.month}-${p.day}`, h: +p.hour };
}

// Solhöjd i grader (enkel formel, räcker för att skilja dag och natt)
function sunElev(ms: number, lat: number, lon: number) {
  const d = ms / 864e5 - 10957.5, g = (357.529 + 0.98560028 * d) * Math.PI / 180, q = 280.459 + 0.98564736 * d;
  const L = (q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * Math.PI / 180, e = (23.439 - 3.6e-7 * d) * Math.PI / 180;
  const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L)), dec = Math.asin(Math.sin(e) * Math.sin(L));
  const gmst = (18.697374558 + 24.06570982441908 * d) % 24, ha = ((gmst * 15 + lon) * Math.PI / 180) - ra, la = lat * Math.PI / 180;
  return Math.asin(Math.sin(la) * Math.sin(dec) + Math.cos(la) * Math.cos(dec) * Math.cos(ha)) * 180 / Math.PI;
}

// SMHI:s vädersymbol (1–27) till WMO-kod som appen redan har texter och ikoner för. 68/69 = snöblandat regn.
const SYM: Record<number, number> = { 1: 0, 2: 1, 3: 2, 4: 2, 5: 3, 6: 3, 7: 45, 8: 80, 9: 81, 10: 82, 11: 95, 12: 68, 13: 69, 14: 69, 15: 85, 16: 85, 17: 86, 18: 61, 19: 63, 20: 65, 21: 95, 22: 68, 23: 69, 24: 69, 25: 71, 26: 73, 27: 75 };
// Vilken kod som väger tyngst för ett dygn (som Open-Meteo: det mest betydande vädret)
const RANK = (c: number) => c >= 95 ? 100 : c >= 71 && c <= 77 || c >= 85 ? 90 : c >= 61 && c <= 69 || c >= 80 ? 80 : c === 45 ? 20 : c;

type Entry = { t: number; s: number; d: Record<string, number> };
const val = (e: Entry, k: string) => { const v = e.d[k]; return v == null || v === MISSING ? null : v; };

async function forecast(lat: number, lon: number): Promise<Entry[]> {
  const j = await getJson(`${FC}/lon/${lon.toFixed(4)}/lat/${lat.toFixed(4)}/data.json`);
  return (j.timeSeries || []).map((x: any) => ({ t: Date.parse(x.time), s: Date.parse(x.intervalParametersStartTime || x.time), d: x.data || {} }));
}

function buildFc(E: Entry[], lat: number, lon: number) {
  const now = Date.now(), cur = E.find((e) => e.t >= now - 30 * 60e3) || E[0];
  const pct = (v: number | null) => v == null ? null : Math.round(v * 12.5);
  const current = cur ? {
    time: new Date(cur.t).toISOString(),
    temperature_2m: val(cur, "air_temperature"), relative_humidity_2m: val(cur, "relative_humidity"),
    precipitation: val(cur, "precipitation_amount_mean"), weather_code: SYM[val(cur, "symbol_code") || 0] ?? null,
    wind_speed_10m: val(cur, "wind_speed"), wind_gusts_10m: val(cur, "wind_speed_of_gust"), cloud_cover: pct(val(cur, "cloud_area_fraction")),
  } : {};
  const today = local(now).d, days: string[] = [], D: Record<string, any> = {};
  const day = (k: string) => { if (!D[k]) { D[k] = { tmax: -99, tmin: 99, p: 0, sn: 0, g: 0, code: -1, sun: 0 }; days.push(k); } return D[k]; };
  for (const e of E) {
    const L = local(e.t); if (L.d < today) continue;
    const o = day(L.d), ta = val(e, "air_temperature"), g = val(e, "wind_speed_of_gust"), sy = val(e, "symbol_code"), cc = val(e, "cloud_area_fraction");
    if (ta != null) { o.tmax = Math.max(o.tmax, ta); o.tmin = Math.min(o.tmin, ta); }
    if (g != null) o.g = Math.max(o.g, g);
    if (sy != null && SYM[sy] != null && (L.h >= 6 && L.h <= 21 || o.code < 0) && RANK(SYM[sy]) >= RANK(Math.max(o.code, 0))) o.code = SYM[sy];
    // Nederbörd gäller intervallet fram till tidpunkten, räknas till dygnet där intervallets mitt ligger
    const p = val(e, "precipitation_amount_mean");
    if (p != null && p > 0) { const m = day(local((e.s + e.t) / 2).d), fz = (val(e, "precipitation_frozen_part") || 0) / 100; m.p += p; m.sn += p * fz * 0.7; }
    // Uppskattad solskenstid: dagsljustimmar i intervallet gånger andelen klar himmel
    if (cc != null) { const hrs = Math.max(1, Math.round((e.t - e.s) / 36e5)); for (let i = 0; i < hrs; i++) { const tm = e.t - (i + 0.5) * 36e5; if (sunElev(tm, lat, lon) > 0) day(local(tm).d).sun += 3600 * Math.max(0, 1 - cc / 8); } }
  }
  const ks = days.filter((k) => k >= today).sort().slice(0, 7), r1 = (v: number) => Math.round(v * 10) / 10;
  const daily = {
    time: ks, weather_code: ks.map((k) => D[k].code < 0 ? null : D[k].code),
    temperature_2m_max: ks.map((k) => D[k].tmax > -99 ? D[k].tmax : null), temperature_2m_min: ks.map((k) => D[k].tmin < 99 ? D[k].tmin : null),
    precipitation_sum: ks.map((k) => r1(D[k].p)), snowfall_sum: ks.map((k) => r1(D[k].sn)), wind_gusts_10m_max: ks.map((k) => D[k].g),
    sunshine_duration: ks.map((k) => Math.round(D[k].sun)),
  };
  return { source: "SMHI", current, daily };
}

// Molnighet per timme (0–23 lokal tid) för ett datum, interpolerat mellan prognostiderna
function cloudDay(E: Entry[], ds: string) {
  const pts = E.map((e) => [e.t, val(e, "cloud_area_fraction")] as [number, number | null]).filter((x) => x[1] != null) as [number, number][];
  if (!pts.length) return null;
  const out: (number | null)[] = [];
  for (let h = 0; h < 24; h++) {
    // Hitta tidpunkten för lokal timme h det datumet (prova UTC-offset 1 och 2 timmar)
    const base = Date.parse(ds + "T" + String(h).padStart(2, "0") + ":00:00Z");
    let t = base - 36e5; if (local(t).h !== h) t = base - 72e5;
    if (t < pts[0][0] - 36e5 || t > pts[pts.length - 1][0]) { out.push(null); continue; }
    let i = pts.findIndex((p) => p[0] >= t); if (i < 0) { out.push(null); continue; }
    if (i === 0) { out.push(Math.round(pts[0][1] * 12.5)); continue; }
    const [t0, v0] = pts[i - 1], [t1, v1] = pts[i], f = (t - t0) / (t1 - t0);
    out.push(Math.round((v0 + (v1 - v0) * f) * 12.5));
  }
  return out.filter((v) => v != null).length >= 12 ? out : null;
}

// Närmaste aktiva station för en parameter (listan cachas ett dygn)
async function nearest(param: number, lat: number, lon: number, maxKm: number) {
  const list = await cached("st" + param, 864e5, async () => {
    const j = await getJson(`${OBS}/${param}.json`);
    return (j.station || []).filter((s: any) => s.active).map((s: any) => ({ key: s.key, name: s.name, lat: s.latitude, lon: s.longitude, to: s.to }));
  });
  const kx = 111.32 * Math.cos(lat * Math.PI / 180), fresh = Date.now() - 4 * 864e5;
  const c = list.filter((s: any) => s.to >= fresh).map((s: any) => ({ ...s, km: Math.hypot((s.lon - lon) * kx, (s.lat - lat) * 111.32) })).sort((a: any, b: any) => a.km - b.km);
  return c.length && c[0].km <= maxKm ? c.slice(0, 3) : [];
}
async function series(param: number, key: string, withArchive: boolean) {
  const D: Record<string, number> = {};
  if (withArchive) {
    try {
      const r = await fetch(`${OBS}/${param}/station/${key}/period/corrected-archive/data.csv`, { headers: UA });
      if (r.ok) { const from = new Date(Date.now() - 400 * 864e5).toISOString().slice(0, 10); for (const ln of (await r.text()).split("\n")) { const c = ln.split(";"); if (/^\d{4}-\d\d-\d\d$/.test(c[2] || "") && c[2] >= from && c[3] !== "") D[c[2]] = +c[3]; } }
    } catch (_) { /* arkivet är bara ett tillägg */ }
  }
  const j = await getJson(`${OBS}/${param}/station/${key}/period/latest-months/data.json`);
  for (const v of j.value || []) { const d = v.ref || new Date(v.date || v.from).toISOString().slice(0, 10); if (v.value != null && v.value !== "") D[d] = +v.value; }
  return D;
}
async function firstWith(param: number, lat: number, lon: number, maxKm: number, withArchive: boolean) {
  for (const s of await nearest(param, lat, lon, maxKm)) {
    try { const D = await series(param, s.key, withArchive); if (Object.keys(D).length) return { st: { name: s.name, km: Math.round(s.km) }, D }; } catch (_) { /* nästa station */ }
  }
  return null;
}

async function observations(lat: number, lon: number) {
  const [pr, tm, sd] = await Promise.all([firstWith(5, lat, lon, 50, true), firstWith(2, lat, lon, 50, false).catch(() => null), firstWith(8, lat, lon, 60, false).catch(() => null)]);
  const today = local(Date.now()).d, last7 = [...Array(7)].map((_, i) => new Date(Date.parse(today) - (i + 1) * 864e5).toISOString().slice(0, 10));
  let prec = 0, rain = 0, snow = 0, n = 0;
  if (pr) for (const d of last7) { const p = pr.D[d]; if (p == null) continue; n++; prec += p; const t = tm ? tm.D[d] : null; if (t != null && t <= 0) snow += p * 0.7; else rain += p; }
  const sdk = sd ? Object.keys(sd.D).sort().pop() : null, depth = sdk && sdk >= last7[1] ? Math.round(sd!.D[sdk] * 100) : null;
  const r1 = (v: number) => Math.round(v * 10) / 10, keys = pr ? Object.keys(pr.D).sort() : [];
  return {
    source: "SMHI",
    past: pr && n ? { prec: r1(prec), rain: r1(rain), snow: r1(snow), depth, soil: null } : (depth != null ? { prec: 0, rain: 0, snow: 0, depth, soil: null } : null),
    daily: pr ? { time: keys, precipitation_sum: keys.map((k) => pr.D[k]) } : null,
    station: pr ? pr.st : null,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  const json = (body: unknown, status = 200, maxAge = 600) =>
    new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": `public, max-age=${maxAge}` } });
  try {
    const u = new URL(req.url), kind = u.searchParams.get("kind") || "fc";
    const lat = +(u.searchParams.get("lat") || ""), lon = +(u.searchParams.get("lon") || "");
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return json({ error: "lat/lon saknas" }, 400, 0);
    // Rutnät ca 2 km, så att närliggande användare delar cache
    const qa = Math.round(lat * 50) / 50, qo = Math.round(lon * 50) / 50, cell = qa + "," + qo;
    if (kind === "fc" || kind === "cloud") {
      const E = await cached("fc" + cell, 30 * 60e3, () => forecast(qa, qo));
      if (kind === "cloud") { const ds = u.searchParams.get("ds") || ""; if (!/^\d{4}-\d\d-\d\d$/.test(ds)) return json({ error: "ds saknas" }, 400, 0); return json({ source: "SMHI", cloud_cover: cloudDay(E, ds) }, 200, 1800); }
      return json(buildFc(E, qa, qo), 200, 900);
    }
    if (kind === "obs") return json(await cached("obs" + cell, 3 * 36e5, () => observations(qa, qo)), 200, 3600);
    return json({ error: "okänd kind" }, 400, 0);
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 502, 0);
  }
});
