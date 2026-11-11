// Roothood: skickar vattningspåminnelser som notiser till mobilen.
// Körs varje hel timme av databasen (cron) och när man trycker "Skicka testnotis" i appen.
// Varje mobil får sin notis den timme användaren valt (notify_hour, svensk tid), högst en gång per dag.
// Notisen tar hänsyn till vädret på användarens ort (Open-Meteo): värme, frost, kraftigt regn, plötsligt köldfall på våren,
// stark sol och sträng kyla för växter vid fönster (fönstervakten), och skördeklara grödor från Såkalendern.
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

type Wx = { maxToday: number; maxTomorrow: number; minTonight: number; rain: number; uv: number; min3: number };

// ----- Fönstervakten (rena funktioner) -----
type WinPlant = { name: string; dirs: string[]; light: number };
function winNames(L: WinPlant[]) {
  const n = L.slice(0, 3).map((p) => p.name.toLowerCase());
  return n.join(", ") + (L.length > 3 ? " med flera" : "");
}
// Ett råd som bara gäller växter vid fönster, eller plötsligt köldfall på våren. null om inget behövs.
function windowTip(w: Wx, month: number, win: WinPlant[]): { kind: string; text: string } | null {
  if (month >= 3 && month <= 5 && w.maxToday >= 10 && w.min3 <= 3 && w.maxToday - w.min3 >= 8) {
    return { kind: "spring", text: `Plötsligt köldfall, ner till ${Math.round(w.min3)} °C. Ta in eller täck förkultiverade plantor och känsliga växter ute.` };
  }
  if (w.min3 <= -15) {
    const L = win.filter((p) => p.dirs.length);
    if (L.length) return { kind: "cold", text: `Sträng kyla, ${Math.round(w.min3)} °C. Flytta ${winNames(L)} en bit från fönsterglaset i natt, kalla rutor kan frysa bladen.` };
  }
  if (w.uv >= 6) {
    const L = win.filter((p) => p.dirs.some((d) => ["S", "SO", "SV", "V"].includes(d)) && p.light <= 2);
    if (L.length) return { kind: "uv", text: `Stark sol, UV-index ${Math.round(w.uv)}. Flytta ${winNames(L)} en bit från söderfönstret mitt på dagen eller dra för gardinen.` };
  }
  return null;
}
// Grödor som blir skördeklara idag, eller igår om gårdagens notis uteblev.
function harvestToday(items: { c?: string; d?: string }[], today: string, yesterday: string, lastSent: string | null): string[] {
  const out: string[] = [];
  for (const it of items || []) {
    if (!it || !it.c || !it.d) continue;
    if (it.d === today || (it.d === yesterday && lastSent !== yesterday)) if (!out.includes(it.c)) out.push(it.c);
  }
  return out;
}
// ----- slut -----

// Kort tips: första meningen, högst 100 tecken.
function shortTip(t: string) {
  const s = String(t).replace(/\s+/g, " ").trim();
  const m = s.match(/^.{20,100}?[.!?](?=\s|$)/);
  return m ? m[0] : s.slice(0, 100);
}

// Aktuell version och senaste nyheten, läst från den publicerade appen.
async function currentVersion(): Promise<{ v: string; note: string } | null> {
  try {
    const h = await (await fetch(APP_URL + "index.html", { cache: "no-store" })).text();
    const v = h.match(/const APP_VERSION = '([^']+)'/)?.[1];
    if (!v) return null;
    const note = h.match(/const NEWS = \[\s*\[\s*'[^']*',\s*'[^']*',\s*\[\s*'([^']*)'/)?.[1] || "";
    return { v, note };
  } catch (_) {
    return null;
  }
}

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
    // Mottagaren kan ha stängt av den här typen av notis under Notifikations-inställningar. Då skickas ingen.
    const notifKey = body.event === "message" ? "msg" : (body.event === "friend_req" || body.event === "friend_ok" || (body.event || "").startsWith("sit_")) ? "friend" : null;
    if (notifKey) { const { data: pr } = await db.from("profiles").select("notif_prefs").eq("id", body.to).maybeSingle(); if ((pr?.notif_prefs || {})[notifKey] === false) return json({ sent: 0, off: true }); }
    let title = "Roothood", text = body.text || "", url = APP_URL + "?tool=notif", tag = "roothood-social";
    if (body.event === "message") { title = name; url = APP_URL + "?tool=msgs"; tag = "roothood-msg-" + (body.from || ""); }
    else if (body.event === "friend_req") { title = "Ny vänförfrågan 🌿"; text = name + " vill bli din vän" + (body.text ? ": " + body.text : ""); }
    else if (body.event === "friend_ok") { title = "Ny vän 🌱"; text = name + " accepterade din vänförfrågan"; }
    // Växtpassning: förfrågan till passaren, svar och avslut till den andra
    else if (body.event === "sit_req") { title = "Växtpassning 🪴"; text = name + " ber dig passa sina växter" + (body.text ? " " + body.text : "") + ". Tryck för att svara."; }
    else if (body.event === "sit_ok") { title = "Växtpassning 🤝"; text = name + " passar dina växter"; }
    else if (body.event === "sit_no") { title = "Växtpassning"; text = name + " tackade nej till att passa dina växter"; }
    else if (body.event === "sit_end") { title = "Växtpassning"; text = name + " avslutade passningen"; }
    else if (body.event === "fb_bug") { title = "Ny felrapport 🐞"; text = name + ": " + (body.text || ""); url = APP_URL + "?tool=notif"; tag = "roothood-fb"; }
    else if (body.event === "fb_other") { title = "Nytt förslag 💡"; text = name + ": " + (body.text || ""); url = APP_URL + "?tool=notif"; tag = "roothood-fb"; }
    else if (body.event === "expert_q") { title = "Ny fråga till experten 🌿"; text = name + ": " + (body.text || ""); url = APP_URL + "?tool=notif"; tag = "roothood-xq"; }
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

  let q = db.from("push_subscriptions").select("id,user_id,endpoint,p256dh,auth,notify_hour,last_sent,last_version,pref_window,pref_harvest,harvest");
  if (onlyUser) q = q.eq("user_id", onlyUser);
  const { data: subs, error: subErr } = await q;
  if (subErr) return json({ error: subErr.message }, 500);
  if (!subs || !subs.length) return json({ sent: 0, removed: 0 });

  // Vilka växter behöver vattnas idag (svensk tid)?
  const users = [...new Set(subs.map((s) => s.user_id))];
  const { data: ups, error: upErr } = await db
    .from("user_plants")
    .select("user_id,last_watered,remind,custom_name,custom_water_interval_days,details,plants(swedish_name,water_interval_days,category,tips,light_level)")
    .in("user_id", users);
  if (upErr) return json({ error: upErr.message }, 500);
  const todayStr = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Stockholm" });
  const today = Date.parse(todayStr);
  const hourNow = Number(new Intl.DateTimeFormat("sv-SE", { hour: "numeric", hourCycle: "h23", timeZone: "Europe/Stockholm" }).format(new Date()));
  const monthNow = Number(todayStr.slice(5, 7));
  const yesterdayStr = new Date(today - 864e5).toISOString().slice(0, 10);
  const due: Record<string, { name: string; out: boolean }[]> = {};
  const outdoor: Record<string, boolean> = {};
  const mine: Record<string, { name: string; tips: string }[]> = {};
  // Rum och väderstreck per användare, och vilka växter som står i vilket rum
  const { data: homeRows } = await db.from("homes").select("user_id,rooms").in("user_id", users);
  const dirsOf: Record<string, Record<string, string[]>> = {};
  for (const h of homeRows || []) {
    const R = Array.isArray(h.rooms) ? h.rooms : (h.rooms as { rooms?: unknown[] } | null)?.rooms || [];
    for (const r of R as { id?: string; dirs?: string[] }[]) if (r && r.id) (dirsOf[h.user_id] ||= {})[r.id] = Array.isArray(r.dirs) ? r.dirs : [];
  }
  const winPlants: Record<string, WinPlant[]> = {};
  for (const u of ups || []) {
    const p = u.plants as { swedish_name: string; water_interval_days: number | null; category?: string | null; tips?: string | null; light_level?: number | null } | null;
    const out = /trädgård/i.test(p?.category || "");
    const room = (u.details as { room?: string } | null)?.room;
    if (room && !out && dirsOf[u.user_id]?.[room]) (winPlants[u.user_id] ||= []).push({ name: p ? p.swedish_name : (u.custom_name || "växt"), dirs: dirsOf[u.user_id][room], light: p?.light_level ?? 2 });
    if (out) outdoor[u.user_id] = true;
    const interval = p ? p.water_interval_days : u.custom_water_interval_days;
    const name = p ? p.swedish_name : u.custom_name;
    if (p && p.tips) (mine[u.user_id] ||= []).push({ name, tips: p.tips });
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
      const f = await (await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${r.latitude}&longitude=${r.longitude}&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,uv_index_max&timezone=Europe%2FStockholm&forecast_days=3`)).json();
      const d = f?.daily;
      if (!d) return (wxCache[k] = null);
      return (wxCache[k] = { maxToday: d.temperature_2m_max[0], maxTomorrow: d.temperature_2m_max[1], minTonight: Math.min(d.temperature_2m_min[0], d.temperature_2m_min[1]), rain: d.precipitation_sum[0] ?? 0, uv: Math.max(d.uv_index_max?.[0] ?? 0, d.uv_index_max?.[1] ?? 0), min3: Math.min(...d.temperature_2m_min.slice(0, 3)) });
    } catch (_) {
      return (wxCache[k] = null);
    }
  }
  // Ett väderråd per dag, det viktigaste först.
  function wxTip(w: Wx | null, out: boolean, win: WinPlant[], month: number, allowWin: boolean): { kind: string; text: string } | null {
    if (!w) return null;
    const hot = Math.max(w.maxToday ?? -99, w.maxTomorrow ?? -99);
    if (hot >= 27) return { kind: "heat", text: `Det blir varmt, upp till ${Math.round(hot)} °C. Vattna krukorna${out ? " ute" : ""} extra och dra för i söderfönster mitt på dagen.` };
    if (out && (w.minTonight ?? 99) <= 1) return { kind: "frost", text: `Risk för frost i natt (${Math.round(w.minTonight)} °C). Ta in frostkänsliga krukor eller täck dem.` };
    const wt = allowWin ? windowTip(w, month, win) : null;
    if (wt) return wt;
    if (out && (w.rain ?? 0) >= 8) return { kind: "rain", text: `Det regnar ${Math.round(w.rain)} mm idag, så växterna ute behöver inget extra vatten.` };
    return null;
  }

  // Ny version i appen: en notis per prenumerant och version. Nya prenumeranter får bara en markering.
  if (!onlyUser) {
    const ver = await currentVersion();
    if (ver) {
      // Mottagare som stängt av "Ny uppdatering" under Notifikations-inställningar får ingen notis
      const { data: upm } = await db.from("profiles").select("id,notif_prefs").in("id", users);
      const pmap: Record<string, Record<string, boolean>> = {};
      for (const x of upm || []) pmap[x.id] = (x.notif_prefs || {});
      for (const s of subs) {
        if (s.last_version === ver.v) continue;
        if (pmap[s.user_id]?.update === false) { await db.from("push_subscriptions").update({ last_version: ver.v }).eq("id", s.id); continue; }
        if (s.last_version == null) { await db.from("push_subscriptions").update({ last_version: ver.v }).eq("id", s.id); continue; }
        try {
          await webpush.sendNotification(
            { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
            JSON.stringify({ title: "Ny version: " + ver.v, body: ver.note || "Nya förbättringar i appen.", url: APP_URL, tag: "roothood-update" }),
            { TTL: 24 * 3600 },
          );
          await db.from("push_subscriptions").update({ last_version: ver.v }).eq("id", s.id);
          await db.from("notification_log").insert({ user_id: s.user_id, kind: "update" });
        } catch (e) {
          const code = (e as { statusCode?: number }).statusCode;
          if (code === 404 || code === 410) await db.from("push_subscriptions").delete().eq("id", s.id);
        }
      }
    }
  }

  let sent = 0, removed = 0;
  for (const s of subs) {
    if (!onlyUser && ((s.notify_hour ?? 8) !== hourNow || s.last_sent === todayStr)) continue;
    const city = cityOf[s.user_id];
    const wx = city ? await wxFor(city) : null;
    const tip = wxTip(wx, !!outdoor[s.user_id], winPlants[s.user_id] || [], monthNow, s.pref_window !== false);
    // Regnar det mycket behöver växterna ute inget extra vatten.
    const names = (due[s.user_id] || []).filter((x) => !(tip?.kind === "rain" && x.out)).map((x) => x.name);
    let title: string, body: string;
    if (onlyUser) {
      title = "Notiserna fungerar! 🌱";
      body = (names.length ? "Just nu behöver " + namesText(names) + " vattnas." : "Inga växter behöver vattnas just nu.") + (tip ? " " + tip.text : city ? " Inget särskilt väder i " + city + " just nu." : " Välj din ort i appen så får du väderråd.");
    } else {
      // Varje dag: vad som ska vattnas, väder på orten, ett tips om en av dina växter.
      const pl = mine[s.user_id] || [];
      const dayNo = Math.floor(today / 864e5);
      const pick = pl.length ? pl[dayNo % pl.length] : null;
      const plantTip = pick ? "Tips för " + pick.name + ": " + shortTip(pick.tips) : "";
      const where = city && wx ? "I " + city + " idag: högst " + Math.round(wx.maxToday) + " °C." : "";
      const harv = s.pref_harvest === false ? [] : harvestToday((s.harvest as { c?: string; d?: string }[]) || [], todayStr, yesterdayStr, s.last_sent);
      const tipTitle: Record<string, string> = { heat: "Varmt väder på väg ☀️", frost: "Frostvarning ❄️", rain: "Regn idag 🌧️", spring: "Köldfall på väg 🥶", cold: "Sträng kyla ❄️", uv: "Stark sol ☀️" };
      title = names.length ? "Dags att vattna 💧" : harv.length ? "Skördeklart 🧺" : tip ? (tipTitle[tip.kind] || "Dagens tips 🌿") : "Dagens tips 🌿";
      body = [names.length ? namesText(names) + " behöver vatten idag." : "", harv.length ? namesText(harv) + " är redo att skördas." : "", tip ? tip.text : "", where, plantTip].filter(Boolean).join(" ");
    }
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        JSON.stringify({ title, body, url: APP_URL + "?tab=mine" }),
        { TTL: 12 * 3600 },
      );
      sent++;
      await db.from("notification_log").insert({ user_id: s.user_id, kind: onlyUser ? "test" : "daily" });
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
