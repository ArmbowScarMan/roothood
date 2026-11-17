// Roothood: styr användarens Philips Hue-lampor via Hues Remote API.
// Åtgärder (?action=): start (ger inloggningslänk), status (koppling och lampor), set (tänd/släck), sched (spara schema),
// disconnect (ta bort kopplingen) och tick (körs av databasen var 5:e minut och följer schemat).
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });
const HUE = "https://api.meethue.com";
type Link = { user_id: string; access_token: string; refresh_token: string; expires_at: string; app_key: string; light_id: string | null; light_name: string | null; sched_on: boolean; sched_start: string; sched_mins: number; last_state: boolean | null; last_error: string | null };

// deno-lint-ignore no-explicit-any
async function token(db: any, L: Link): Promise<string> {
  if (Date.parse(L.expires_at) - Date.now() > 3600e3) return L.access_token;
  const id = Deno.env.get("HUE_CLIENT_ID")!, sec = Deno.env.get("HUE_CLIENT_SECRET")!;
  const r = await fetch(HUE + "/v2/oauth2/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: "Basic " + btoa(id + ":" + sec) }, body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: L.refresh_token }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new Error("Kopplingen till Hue har gått ut. Koppla Hue igen.");
  L.access_token = j.access_token; L.refresh_token = j.refresh_token || L.refresh_token;
  L.expires_at = new Date(Date.now() + (+j.expires_in || 604800) * 1000).toISOString();
  await db.from("hue_links").update({ access_token: L.access_token, refresh_token: L.refresh_token, expires_at: L.expires_at, updated_at: new Date().toISOString() }).eq("user_id", L.user_id);
  return L.access_token;
}
// deno-lint-ignore no-explicit-any
async function clip(db: any, L: Link, path: string, init: RequestInit = {}) {
  const t = await token(db, L);
  const r = await fetch(HUE + "/route/clip/v2/resource" + path, { ...init, headers: { Authorization: "Bearer " + t, "hue-application-key": L.app_key, "Content-Type": "application/json" } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j.errors && j.errors[0] && j.errors[0].description) || "Hue svarade " + r.status);
  return j;
}
// Minuter efter midnatt i svensk tid
function nowMin() {
  const p = new Intl.DateTimeFormat("sv-SE", { hour: "numeric", minute: "numeric", hourCycle: "h23", timeZone: "Europe/Stockholm" }).formatToParts(new Date());
  return +p.find((x) => x.type === "hour")!.value * 60 + +p.find((x) => x.type === "minute")!.value;
}
function shouldBeOn(start: string, mins: number) {
  const [h, m] = (start || "07:00").split(":").map(Number), s = h * 60 + m, n = nowMin();
  const d = (n - s + 1440) % 1440;
  return d < Math.max(0, Math.min(1440, mins));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const u = new URL(req.url), action = u.searchParams.get("action") || "status";

  // Schemat: körs av databasen med den hemliga cron-nyckeln. Lampan ändras bara när schemat byter läge,
  // så att man fortfarande kan tända och släcka själv i Hue-appen.
  if (action === "tick") {
    const cs = Deno.env.get("CRON_SECRET");
    if (!cs || req.headers.get("x-cron-secret") !== cs) return json({ error: "inte tillåtet" }, 401);
    const { data } = await db.from("hue_links").select("*").eq("sched_on", true).not("light_id", "is", null);
    let changed = 0;
    for (const L of (data || []) as Link[]) {
      const want = shouldBeOn(L.sched_start, L.sched_mins);
      if (L.last_state === want) continue;
      try {
        await clip(db, L, "/light/" + L.light_id, { method: "PUT", body: JSON.stringify({ on: { on: want } }) });
        await db.from("hue_links").update({ last_state: want, last_error: null }).eq("user_id", L.user_id); changed++;
      } catch (e) { await db.from("hue_links").update({ last_error: String((e as Error).message || e).slice(0, 200) }).eq("user_id", L.user_id); }
    }
    return json({ checked: (data || []).length, changed });
  }

  const tok = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const { data: au } = await db.auth.getUser(tok);
  const uid = au && au.user ? au.user.id : null;
  if (!uid) return json({ error: "Du behöver vara inloggad" }, 401);
  let body: Record<string, unknown> = {};
  if (req.method === "POST") { try { body = await req.json(); } catch (_) { /* tom */ } }

  try {
    if (action === "start") {
      const id = Deno.env.get("HUE_CLIENT_ID");
      if (!id) return json({ error: "Hue är inte inställt på servern än" }, 500);
      const state = crypto.randomUUID().replace(/-/g, "");
      await db.from("hue_states").delete().lt("created_at", new Date(Date.now() - 3600e3).toISOString());
      await db.from("hue_states").insert({ state, user_id: uid });
      return json({ url: HUE + "/v2/oauth2/authorize?" + new URLSearchParams({ client_id: id, response_type: "code", state }) });
    }
    const { data: L } = await db.from("hue_links").select("*").eq("user_id", uid).maybeSingle();
    if (action === "disconnect") { await db.from("hue_links").delete().eq("user_id", uid); return json({ ok: true }); }
    if (!L) return json({ connected: false });
    const link = L as Link;
    if (action === "status") {
      const j = await clip(db, link, "/light");
      const lights = (j.data || []).map((x: { id: string; metadata?: { name?: string }; on?: { on?: boolean } }) => ({ id: x.id, name: (x.metadata && x.metadata.name) || "Lampa", on: !!(x.on && x.on.on) })).sort((a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, "sv"));
      return json({ connected: true, lights, sched: { on: link.sched_on, light: link.light_id, start: link.sched_start, mins: link.sched_mins, error: link.last_error } });
    }
    if (action === "set") {
      const lid = String(body.light || ""), on = !!body.on;
      if (!/^[0-9a-f-]{36}$/.test(lid)) return json({ error: "Okänd lampa" }, 400);
      await clip(db, link, "/light/" + lid, { method: "PUT", body: JSON.stringify({ on: { on } }) });
      return json({ ok: true });
    }
    if (action === "sched") {
      const lid = body.light ? String(body.light) : null, start = String(body.start || "07:00"), mins = Math.round(+(body.mins || 0)), on = !!body.on;
      if (lid && !/^[0-9a-f-]{36}$/.test(lid)) return json({ error: "Okänd lampa" }, 400);
      if (!/^\d{2}:\d{2}$/.test(start) || !(mins >= 0 && mins <= 1440)) return json({ error: "Ogiltig tid" }, 400);
      await db.from("hue_links").update({ light_id: lid, light_name: body.name ? String(body.name).slice(0, 80) : null, sched_on: on && !!lid, sched_start: start, sched_mins: mins, last_state: null, last_error: null, updated_at: new Date().toISOString() }).eq("user_id", uid);
      return json({ ok: true });
    }
    return json({ error: "okänd åtgärd" }, 400);
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 502);
  }
});
