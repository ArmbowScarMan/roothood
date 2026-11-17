// Roothood: tar emot svaret från Philips Hue efter inloggningen (OAuth2), byter koden mot nycklar,
// skapar en appnyckel mot användarens brygga och skickar tillbaka användaren till appen.
// Anropas av webbläsaren, därför utan Supabase-inloggning (verify_jwt av). Användaren känns igen via state.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const APP_URL = "https://armbowscarman.github.io/roothood/";
const back = (q: string) => new Response(null, { status: 302, headers: { Location: APP_URL + "?tool=smart&hue=" + q } });

Deno.serve(async (req) => {
  const u = new URL(req.url), code = u.searchParams.get("code"), state = u.searchParams.get("state");
  if (!code || !state) return back(u.searchParams.get("error") ? "nej" : "fel");
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const { data: st } = await db.from("hue_states").select("user_id,created_at").eq("state", state).maybeSingle();
  await db.from("hue_states").delete().eq("state", state);
  if (!st || Date.now() - Date.parse(st.created_at) > 15 * 60e3) return back("gammal");
  try {
    const id = Deno.env.get("HUE_CLIENT_ID")!, sec = Deno.env.get("HUE_CLIENT_SECRET")!;
    const tr = await fetch("https://api.meethue.com/v2/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: "Basic " + btoa(id + ":" + sec) },
      body: new URLSearchParams({ grant_type: "authorization_code", code }),
    });
    const tj = await tr.json().catch(() => ({}));
    if (!tr.ok || !tj.access_token) { console.error("hue token", tr.status, JSON.stringify(tj).slice(0, 300)); return back("fel"); }
    const H = { Authorization: "Bearer " + tj.access_token, "Content-Type": "application/json" };
    // Tryck på bryggans knapp på distans och skapa en appnyckel (gäller tills användaren tar bort den)
    await fetch("https://api.meethue.com/route/api/0/config", { method: "PUT", headers: H, body: JSON.stringify({ linkbutton: true }) });
    const kr = await fetch("https://api.meethue.com/route/api", { method: "POST", headers: H, body: JSON.stringify({ devicetype: "roothood#app" }) });
    const kj = await kr.json().catch(() => null);
    const key = Array.isArray(kj) && kj[0] && kj[0].success ? kj[0].success.username : null;
    if (!key) { console.error("hue key", kr.status, JSON.stringify(kj).slice(0, 300)); return back("brygga"); }
    await db.from("hue_links").upsert({
      user_id: st.user_id, access_token: tj.access_token, refresh_token: tj.refresh_token,
      expires_at: new Date(Date.now() + (+tj.expires_in || 604800) * 1000).toISOString(),
      app_key: key, last_error: null, updated_at: new Date().toISOString(),
    });
    return back("ok");
  } catch (e) {
    console.error("hue-auth", e);
    return back("fel");
  }
});
