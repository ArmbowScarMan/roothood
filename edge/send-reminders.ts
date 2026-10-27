// Roothood: skickar vattningspåminnelser som notiser till mobilen.
// Körs varje hel timme av databasen (cron) och när man trycker "Skicka testnotis" i appen.
// Varje mobil får sin notis den timme användaren valt (notify_hour, svensk tid), högst en gång per dag.
// Notisen tar hänsyn till vädret på användarens ort (Open-Meteo): värme, frost och kraftigt regn.
import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const VAPID_PUBLIC_KEY = "BLVqcUJiPOjVTvIMsEJ9LysWBYCiCofjDTgKPvp1RHjC9f1T1UF1AbhGEMCjD6y3SQKa9uKfhQ6YNPMHeW9FCOE";
const APP_URL = "https://armbowscarman.github.io/roothood/";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

type Wx = { maxToday: number; maxTomorrow: number; minTonight: number; rain: number };

function namesText(names: string[]) {
  if (names.length === 1) return names[0];
  if (names.length <= 3) return names.slice(0, -1).join(", ") + " och " + names[names.length - 1];
  return names.slice(0, 2).join(", ") + " och " + (names.length - 2) + " växter till";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const privateKey = Deno.env.get("VAPID_PRIVATE_KEY");
  if (!privateKey) return json({ error: "Hemligheten VAPID_PRIVATE_KEY saknas" }, 500);
  webpush.setVapidDetails(APP_URL, VAPID_PUBLIC_KEY, privateKey);

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });

  // Vem anropar? Databasens morgonkörning (hemlig nyckel) eller en inloggad användare (testnotis).
  const cronSecret = Deno.env.get("CRON_SECRET");
  const isCron = !!cronSecret && req.headers.get("x-cron-secret") === cronSecret;
  let onlyUser: string | null = null;
  if (!isCron) {
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const { data, error } = await db.auth.getUser(token);
    if (error || !data?.user) return json({ error: "Du behöver vara inloggad" }, 401);
    onlyUser = data.user.id;
  }

  // Direkta notiser: nytt meddelande, vänförfrågan eller accepterad vän (kommer från databasen).
  let body: { event?: string; to?: string; from?: string; text?: string } = {};
  try { body = await req.json(); } catch (_) { /* tom kropp */ }
  if (isCron && body.event && body.to) {
    const { data: who } = await db.from("profiles").select("display_name").eq("id", body.from || "").maybeSingle();
    const name = who?.display_name || "Någon";
    let title = "Roothood", text = body.text || "", url = APP_URL + "?tool=notif", tag = "roothood-social";
    if (body.event === "message") { title = name; url = APP_URL + "?tool=msgs"; tag = "roothood-msg-" + (body.from || ""); }
    else if (body.event === "friend_req") { title = "Ny vänförfrågan 🌿"; text = name + " vill bli din vän" + (body.text ? ": " + body.text : ""); }
    else if (body.event === "friend_ok") { title = "Ny vän 🌱"; text = name + " accepterade din vänförfrågan"; }
    else return json({ error: "okänd händelse" }, 400);
    const { data: subs } = await db.from("push_subscriptions").select("id,endpoint,p256dh,auth").eq("user_id", body.to);
    let ok = 0;
    for (const s of subs || []) {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify({ title, body: text, url, tag, tool: url.split("tool=")[1] }), { TTL: 24 * 3600 });
        ok++;
      } catch (e) {
        const code = (e as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) await db.from("push_subscriptions").delete().eq("id", s.id);
      }
    }
    return json({ sent: ok });
  }

  let q = db.from("push_subscriptions").select("id,user_id,endpoint,p256dh,auth,notify_hour,last_sent");
  if (onlyUser) q = q.eq("user_id", onlyUser);
  const { data: subs, error: subErr } = await q;
  if (subErr) return json({ error: subErr.message }, 500);
  if (!subs || !subs.length) return json({ sent: 0, removed: 0 });

  // Vilka växter behöver vattnas idag (svensk tid)?
  const users = [...new Set(subs.map((s) => s.user_id))];
  const { data: ups, error: upErr } = await db
    .from("user_plants")
    .select("user_id,last_watered,remind,custom_name,custom_water_interval_days,plants(swedish_name,water_interval_days,category)")
    .in("user_id", users);
  if (upErr) return json({ error: upErr.message }, 500);
  const todayStr = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Stockholm" });
  const today = Date.parse(todayStr);
  const hourNow = Number(new Intl.DateTimeFormat("sv-SE", { hour: "numeric", hourCycle: "h23", timeZone: "Europe/Stockholm" }).format(new Date()));
  const due: Record<string, { name: string; out: boolean }[]> = {};
  const outdoor: Record<string, boolean> = {};
  for (const u of ups || []) {
    const p = u.plants as { swedish_name: string; water_interval_days: number | null; category?: string | null } | null;
    const out = /trädgård/i.test(p?.category || "");
    if (out) outdoor[u.user_id] = true;
    const interval = p ? p.water_interval_days : u.custom_water_interval_days;
    const name = p ? p.swedish_name : u.custom_name;
    if (!interval || !u.last_watered || u.remind === false) continue;
    const days = Math.round((today - Date.parse(u.last_watered)) / 864e5);
    if (days >= interval) (due[u.user_id] ||= []).push({ name, out });
  }

  // Väder på användarens ort. Hämtas bara för dem som ska få notis nu, en gång per ort.
  const { data: profs } = await db.from("profiles").select("id,city").in("id", users);
  const cityOf: Record<string, string> = {};
  for (const p of profs || []) if (p.city && String(p.city).trim()) cityOf[p.id] = String(p.city).trim();
  const wxCache: Record<string, Wx | null> = {};
  async function wxFor(city: string): Promise<Wx | null> {
    const k = city.toLowerCase();
    if (k in wxCache) return wxCache[k];
    try {
      const g = await (await fetch("https://geocoding-api.open-meteo.com/v1/search?count=1&language=sv&countryCode=SE&name=" + encodeURIComponent(city))).json();
      const r = g?.results?.[0];
      if (!r) return (wxCache[k] = null);
      const f = await (await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${r.latitude}&longitude=${r.longitude}&daily=temperature_2m_max,temperature_2m_min,precipitation_sum&timezone=Europe%2FStockholm&forecast_days=2`)).json();
      const d = f?.daily;
      if (!d) return (wxCache[k] = null);
      return (wxCache[k] = { maxToday: d.temperature_2m_max[0], maxTomorrow: d.temperature_2m_max[1], minTonight: Math.min(d.temperature_2m_min[0], d.temperature_2m_min[1]), rain: d.precipitation_sum[0] ?? 0 });
    } catch (_) {
      return (wxCache[k] = null);
    }
  }
  // Ett väderråd per dag, det viktigaste först.
  function wxTip(w: Wx | null, out: boolean): { kind: string; text: string } | null {
    if (!w) return null;
    const hot = Math.max(w.maxToday ?? -99, w.maxTomorrow ?? -99);
    if (hot >= 27) return { kind: "heat", text: `Det blir varmt, upp till ${Math.round(hot)} °C. Vattna krukorna${out ? " ute" : ""} extra och dra för i söderfönster mitt på dagen.` };
    if (out && (w.minTonight ?? 99) <= 1) return { kind: "frost", text: `Risk för frost i natt (${Math.round(w.minTonight)} °C). Ta in frostkänsliga krukor eller täck dem.` };
    if (out && (w.rain ?? 0) >= 8) return { kind: "rain", text: `Det regnar ${Math.round(w.rain)} mm idag, så växterna ute behöver inget extra vatten.` };
    return null;
  }

  let sent = 0, removed = 0;
  for (const s of subs) {
    if (!onlyUser && ((s.notify_hour ?? 8) !== hourNow || s.last_sent === todayStr)) continue;
    const city = cityOf[s.user_id];
    const tip = city ? wxTip(await wxFor(city), !!outdoor[s.user_id]) : null;
    // Regnar det mycket behöver växterna ute inget extra vatten.
    const names = (due[s.user_id] || []).filter((x) => !(tip?.kind === "rain" && x.out)).map((x) => x.name);
    let title: string, body: string;
    if (onlyUser) {
      title = "Notiserna fungerar! 🌱";
      body = (names.length ? "Just nu behöver " + namesText(names) + " vattnas." : "Inga växter behöver vattnas just nu.") + (tip ? " " + tip.text : city ? " Inget särskilt väder i " + city + " just nu." : " Välj din ort i appen så får du väderråd.");
    } else {
      if (!names.length && !tip) continue;
      title = names.length ? "Dags att vattna 💧" : tip!.kind === "heat" ? "Varmt väder på väg ☀️" : tip!.kind === "frost" ? "Frostvarning ❄️" : "Regn idag 🌧️";
      body = [names.length ? namesText(names) + " behöver vatten idag." : "", tip ? tip.text : ""].filter(Boolean).join(" ");
    }
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        JSON.stringify({ title, body, url: APP_URL + "?tab=mine" }),
        { TTL: 12 * 3600 },
      );
      sent++;
      if (!onlyUser) await db.from("push_subscriptions").update({ last_sent: todayStr }).eq("id", s.id);
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) {
        await db.from("push_subscriptions").delete().eq("id", s.id);
        removed++;
      } else console.error("Kunde inte skicka", code, (e as Error).message);
    }
  }
  return json({ sent, removed });
});
