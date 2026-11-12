// Roothood: Skanna rummet (bara admin). Tar emot upp till 4 foton på väggar och ber Claude peka ut fönster och dörrar.
// Nyckeln ligger i Supabase-hemligheter (ANTHROPIC_API_KEY), inte i appen. Bara inloggade administratörer får anropa funktionen.
import { createClient } from "npm:@supabase/supabase-js@2.45.0";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const NAMES: Record<string, string> = { t: "övre väggen", r: "högra väggen", b: "nedre väggen", l: "vänstra väggen" };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) return json({ error: "ANTHROPIC_API_KEY saknas i hemligheterna" }, 500);

  const auth = req.headers.get("authorization") || "";
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } } });
  const { data: u } = await sb.auth.getUser();
  if (!u || !u.user) return json({ error: "Logga in" }, 401);
  const { data: role } = await sb.rpc("my_role");
  if (role !== "admin") return json({ error: "Bara admin" }, 403);

  let body: { images?: { wall: string; data: string }[] };
  try { body = await req.json(); } catch { return json({ error: "Ogiltigt anrop" }, 400); }
  const images = (body.images || []).filter((i) => NAMES[i.wall] && typeof i.data === "string" && i.data.length < 2_000_000).slice(0, 4);
  if (!images.length) return json({ error: "Inga foton" }, 400);

  const content: unknown[] = [];
  for (const im of images) {
    content.push({ type: "text", text: `Foto av ${NAMES[im.wall]} (${im.wall}).` });
    content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: im.data } });
  }
  content.push({
    type: "text",
    text: "Peka ut alla fönster och dörrar på varje vägg. Ange var de börjar och slutar sett från väggens vänstra kant till högra kant i bilden, som tal mellan 0 och 1. " +
      'Svara bara med JSON i exakt detta format, utan annan text: {"walls":{"t":[{"k":"window","from":0.1,"to":0.4}],"r":[],"b":[],"l":[]},"notes":"kort mening på svenska"}. ' +
      'k är "window" eller "door". Ta bara med väggar som har foto. Gissa inte om du är osäker.',
  });

  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: "claude-sonnet-5-5", max_tokens: 1500, messages: [{ role: "user", content }] }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) return json({ error: (j && j.error && j.error.message) || "AI-anropet misslyckades" }, 502);
  const text = ((j.content || []).find((c: { type: string }) => c.type === "text") || {}).text || "";
  const m = text.match(/\{[\s\S]*\}/);
  try { return json(JSON.parse(m ? m[0] : text)); } catch { return json({ error: "Kunde inte tolka svaret", raw: text.slice(0, 300) }, 502); }
});
