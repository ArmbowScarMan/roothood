// Roothood: artbestämning via Pl@ntNet. Nyckeln ligger i Supabase-hemligheter (PLANTNET_KEY), inte i appen.
// Bara inloggade användare får anropa funktionen. Upp till 5 bilder per fråga, med en del (blad, blomma ...) per bild.
// Gräns per användare och dag (UTC):
// - Under gratisperioden (hemligheten IDENTIFY_FREE_ALL saknas eller inte är "0") gäller IDENTIFY_DAILY_MAX (20) för alla, så att ingen tar hela Pl@ntNets gratiskvot (500 per dag).
// - När gratisperioden slutar: sätt IDENTIFY_FREE_ALL=0 samtidigt som PRO_FREE = false i appen. Då får användare utan Pro IDENTIFY_FREE_MAX (3) per dag och Pro-användare obegränsat.
import { createClient } from "npm:@supabase/supabase-js@2.45.0";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const DAILY_MAX = parseInt(Deno.env.get("IDENTIFY_DAILY_MAX") || "20");
const FREE_MAX = parseInt(Deno.env.get("IDENTIFY_FREE_MAX") || "3");
const FREE_ALL = (Deno.env.get("IDENTIFY_FREE_ALL") ?? "1") !== "0";
const ORGANS = new Set(["auto", "leaf", "flower", "fruit", "bark"]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

  const key = Deno.env.get("PLANTNET_KEY");
  if (!key) return json({ error: "PLANTNET_KEY saknas i hemligheterna" }, 500);

  // Kontrollera att anropet kommer från en inloggad användare
  const auth = req.headers.get("authorization") || "";
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: auth } },
  });
  const { data: u } = await sb.auth.getUser();
  if (!u || !u.user) return json({ error: "Logga in för att identifiera växter" }, 401);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  let limit: number | null = DAILY_MAX, pro = false;
  if (!FREE_ALL) {
    const { data: pr } = await admin.from("profiles").select("is_pro,pro_until").eq("id", u.user.id).maybeSingle();
    pro = !!(pr && pr.is_pro && (!pr.pro_until || new Date(pr.pro_until) > new Date()));
    limit = pro ? null : FREE_MAX;
  }
  if (limit !== null) {
    const { data: used } = await admin.rpc("identify_count", { p_user: u.user.id });
    if (typeof used === "number" && used >= limit) return json({ error: "Dagens gräns är nådd", limit, pro_hint: !FREE_ALL && !pro }, 429);
  }

  const inc = await req.formData();
  const images = inc.getAll("images").slice(0, 5);
  if (!images.length) return json({ error: "Ingen bild" }, 400);
  const organs = inc.getAll("organs").map(String);
  const out = new FormData();
  images.forEach((f, i) => {
    out.append("images", f as File, `foto${i}.jpg`);
    const o = organs[i] || organs[0] || "auto";
    out.append("organs", ORGANS.has(o) ? o : "auto");
  });

  const url = `https://my-api.plantnet.org/v2/identify/all?api-key=${encodeURIComponent(key)}&lang=sv&nb-results=5&include-related-images=true`;
  const r = await fetch(url, { method: "POST", body: out });
  if (r.ok) await admin.rpc("identify_add", { p_user: u.user.id });
  return new Response(await r.text(), {
    status: r.status,
    headers: { ...CORS, "Content-Type": r.headers.get("content-type") || "application/json" },
  });
});
