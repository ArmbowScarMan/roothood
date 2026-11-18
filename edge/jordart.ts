// Roothood: jordart på en plats från SGU:s öppna data "Jordarter 1:25 000–1:100 000" (CC0).
// GET ?lat=..&lon=..        -> { ok, cover, grund: {kod, namn}, yta: {kod, namn}|null, under: {...}|null, src }
// GET ?lat=..&lon=..&raw=1  -> rådata från SGU (för felsökning)
// SGU nås via OGC API Features. Svaren cachas i minnet per ruta (ca 20 m).

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};
const UA = { "User-Agent": "Roothood/1.0 (roothood.app@gmail.com)", Accept: "application/geo+json, application/json" };
const BASE = "https://api.sgu.se/oppnadata/jordarter25k-100k/ogc/features/v1";

const cache = new Map<string, { t: number; v: unknown }>();
const TTL = 7 * 24 * 3600 * 1000;

type Ring = number[][];
function inRing(x: number, y: number, r: Ring) {
  let inside = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, yi] = r[i], [xj, yj] = r[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function inPoly(x: number, y: number, rings: Ring[]) { if (!rings.length || !inRing(x, y, rings[0])) return false; for (let k = 1; k < rings.length; k++) if (inRing(x, y, rings[k])) return false; return true; }
function contains(geom: any, x: number, y: number) {
  if (!geom) return false;
  if (geom.type === "Polygon") return inPoly(x, y, geom.coordinates);
  if (geom.type === "MultiPolygon") return geom.coordinates.some((p: Ring[]) => inPoly(x, y, p));
  return false;
}

async function items(coll: string, lat: number, lon: number) {
  const d = 0.00004;
  const url = `${BASE}/collections/${coll}/items?f=json&limit=10&bbox=${lon - d},${lat - d},${lon + d},${lat + d}`;
  const r = await fetch(url, { headers: UA });
  if (!r.ok) throw new Error(coll + " " + r.status);
  const j = await r.json();
  return (j.features || []) as any[];
}
function pick(feats: any[], lat: number, lon: number) {
  const f = feats.find(f => contains(f.geometry, lon, lat)) || null;
  return f ? f.properties || {} : null;
}
const lbl = (p: any, k: string) => p ? { kod: p[k] ?? null, namn: p[k + "_tx"] ?? null } : null;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const json = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...CORS, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "public, max-age=86400" } });
  try {
    const u = new URL(req.url), lat = +(u.searchParams.get("lat") || ""), lon = +(u.searchParams.get("lon") || "");
    if (!(lat > 54 && lat < 70 && lon > 9 && lon < 25)) return json({ ok: false, error: "Platsen ligger inte i Sverige" }, 400);
    if (u.searchParams.get("raw")) {
      const coll = u.searchParams.get("coll");
      if (!coll) { const r = await fetch(`${BASE}/collections?f=json`, { headers: UA }); return json({ status: r.status, body: await r.json().catch(() => null) }); }
      const f = await items(coll, lat, lon);
      return json({ n: f.length, props: f.map(x => x.properties), geomTypes: f.map(x => x.geometry && x.geometry.type), hit: pick(f, lat, lon) });
    }
    const key = lat.toFixed(4) + "," + lon.toFixed(4);
    const c = cache.get(key); if (c && Date.now() - c.t < TTL) return json(c.v);
    const [g, y, o, und, tc] = await Promise.all(["grundlager", "ytlager", "oversta-ytlager", "underliggande-lager", "tackningskarta"].map(k => items(k, lat, lon).catch(() => [] as any[])));
    const v = {
      ok: true,
      cover: !!pick(tc, lat, lon),
      skala: (pick(tc, lat, lon) || {}).rek_skala || null,
      grund: lbl(pick(g, lat, lon), "jg2"),
      yta: lbl(pick(y, lat, lon), "jy1"),
      overst: lbl(pick(o, lat, lon), "jy0"),
      under: lbl(pick(und, lat, lon), "jd3"),
      src: "Jordarter 1:25 000–1:100 000, SGU (CC0)",
    };
    cache.set(key, { t: Date.now(), v }); if (cache.size > 5000) cache.clear();
    return json(v);
  } catch (e) {
    return json({ ok: false, error: String(e && (e as Error).message || e) }, 502);
  }
});
