// Roothood: "Fynd nära dig" från SLU Artdatabankens artobservationer (Species Observation System, bl.a. Artportalen).
// Nyckeln ligger i Supabase-hemligheten ARTDATABANKEN_SOS_KEY, inte i appen.
// GET ?name=<vetenskapligt namn>&lat=..&lon=..[&km=10]
// Svar: { taxonId, km, years, count, latest: { date, place, km } | null }
import { createClient } from "npm:@supabase/supabase-js@2.45.0";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};
const SOS = "https://api.artdatabanken.se/species-observation-system/v1";
const YEARS = 10;
const cache = new Map<string, { t: number; v: unknown }>();
const taxa = new Map<string, number | null>();

function dist(a: number, b: number, c: number, d: number) {
  const kx = 111.32 * Math.cos(a * Math.PI / 180);
  return Math.hypot((d - b) * kx, (c - a) * 111.32);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  const json = (body: unknown, status = 200, maxAge = 3600) =>
    new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": `public, max-age=${maxAge}` } });
  try {
    const key = Deno.env.get("ARTDATABANKEN_SOS_KEY");
    if (!key) return json({ error: "ARTDATABANKEN_SOS_KEY saknas i hemligheterna" }, 500, 0);
    const u = new URL(req.url), name = (u.searchParams.get("name") || "").trim().slice(0, 120);
    const lat = +(u.searchParams.get("lat") || ""), lon = +(u.searchParams.get("lon") || ""), km = Math.min(50, Math.max(1, +(u.searchParams.get("km") || 10)));
    if (!name || !Number.isFinite(lat) || !Number.isFinite(lon)) return json({ error: "name, lat och lon behövs" }, 400, 0);

    // Dyntaxa-id från vår egen tabell (dyntaxa_audit), som byggdes när svenska namn och status hämtades
    let taxonId = taxa.get(name);
    if (taxonId === undefined) {
      const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
      const { data } = await sb.from("dyntaxa_audit").select("taxon_id").eq("latin_name", name).eq("found", true).maybeSingle();
      taxonId = data && data.taxon_id ? +data.taxon_id : null;
      taxa.set(name, taxonId);
    }
    if (!taxonId) return json({ taxonId: null, count: null }, 200, 86400);

    // Ruta på ca 2 km så att grannar delar cache, och positionen som skickas vidare är avrundad
    const qa = Math.round(lat * 50) / 50, qo = Math.round(lon * 50) / 50, ck = `${taxonId}|${qa}|${qo}|${km}`;
    const c = cache.get(ck);
    if (c && Date.now() - c.t < 864e5) return json(c.v);

    const from = new Date(Date.now() - YEARS * 365.25 * 864e5).toISOString().slice(0, 10);
    const filter = {
      taxon: { ids: [taxonId], includeUnderlyingTaxa: true },
      geographics: { geometries: [{ type: "point", coordinates: [qo, qa] }], maxDistanceFromPoint: km * 1000, considerObservationAccuracy: false },
      date: { startDate: from, dateFilterType: "OverlappingStartDateAndEndDate" },
      output: { fields: ["event.startDate", "location.decimalLatitude", "location.decimalLongitude", "location.locality", "location.municipality"] },
    };
    const r = await fetch(`${SOS}/Observations/Search?skip=0&take=1&sortBy=event.startDate&sortOrder=Desc`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Ocp-Apim-Subscription-Key": key, "X-Api-Version": "1.5" },
      body: JSON.stringify(filter),
    });
    const txt = await r.text();
    if (!r.ok) return json({ error: "sos " + r.status, detail: txt.slice(0, 300) }, 502, 0);
    const j = JSON.parse(txt), rec = (j.records || [])[0];
    let latest = null;
    if (rec) {
      const L = rec.location || {}, la = +L.decimalLatitude, lo = +L.decimalLongitude;
      const mun = L.municipality && (L.municipality.name || L.municipality);
      latest = {
        date: String((rec.event || {}).startDate || "").slice(0, 10) || null,
        place: L.locality ? [...new Set(String(L.locality).split(/,\s*/).filter((x) => x && !/^[A-ZÅÄÖ][a-zåäö]?$/.test(x)))].slice(0, 2).join(", ") : (typeof mun === "string" ? mun : null),
        km: Number.isFinite(la) && Number.isFinite(lo) ? Math.round(dist(lat, lon, la, lo) * 10) / 10 : null,
      };
    }
    const out = { taxonId, km, years: YEARS, count: typeof j.totalCount === "number" ? j.totalCount : null, latest, source: "SLU Artdatabanken" };
    cache.set(ck, { t: Date.now(), v: out });
    if (cache.size > 5000) cache.clear();
    return json(out);
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 502, 0);
  }
});
