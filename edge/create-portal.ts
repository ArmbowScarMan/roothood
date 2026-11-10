// Roothood: skickar användaren till Stripes kundportal, där prenumerationen sägs upp.
// Uppsägning gäller till sista betalda period. Ingen återbetalning för påbörjad period.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const APP_URL = "https://armbowscarman.github.io/roothood/";
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  try {
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer /, "");
    const { data: u } = await sb.auth.getUser(token);
    if (!u?.user) return json({ error: "NOT_LOGGED_IN" }, 401);
    const { data: prof } = await sb.from("profiles").select("stripe_customer_id").eq("id", u.user.id).single();
    if (!prof?.stripe_customer_id) return json({ error: "NO_CUSTOMER" }, 400);
    const r = await fetch("https://api.stripe.com/v1/billing_portal/sessions", {
      method: "POST",
      headers: { Authorization: "Bearer " + Deno.env.get("STRIPE_SECRET_KEY"), "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ customer: prof.stripe_customer_id, return_url: APP_URL }),
    });
    const j = await r.json();
    if (!r.ok) return json({ error: j?.error?.message || "STRIPE_ERROR" }, 500);
    return json({ url: j.url });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
