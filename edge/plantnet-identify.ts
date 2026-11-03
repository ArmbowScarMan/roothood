// Roothood: artbestämning via Pl@ntNet. Nyckeln ligger i Supabase-hemligheter (PLANTNET_KEY), inte i appen.
// Bara inloggade användare får anropa funktionen. Upp till 5 bilder per fråga, med en del (blad, blomma ...) per bild.
import { createClient } from "npm:@supabase/supabase-js@2.45.0";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
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
  return new Response(await r.text(), {
    status: r.status,
    headers: { ...CORS, "Content-Type": r.headers.get("content-type") || "application/json" },
  });
});
