// Roothood: startar en Stripe Checkout för Roothood Pro med 7 dagars provperiod (en gång per konto).
// Med rabattkoden ROOTHOOD29 (hemlighet PRO_CODE) används rabatterat pris: 29 kr/mån eller 299 kr/år.
// Hemligheter i Supabase: STRIPE_SECRET_KEY, PRO_CODE, STRIPE_PRICE_MONTH, STRIPE_PRICE_YEAR,
// STRIPE_PRICE_MONTH_CODE, STRIPE_PRICE_YEAR_CODE, SUPABASE_SERVICE_ROLE_KEY.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const APP_URL = "https://armbowscarman.github.io/roothood/";
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

export async function stripe(path: string, params: Record<string, string>) {
  const r = await fetch("https://api.stripe.com/v1" + path, {
    method: "POST",
    headers: { Authorization: "Bearer " + Deno.env.get("STRIPE_SECRET_KEY"), "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j?.error?.message || "STRIPE_ERROR");
  return j;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  try {
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer /, "");
    const { data: u } = await sb.auth.getUser(token);
    if (!u?.user) return json({ error: "NOT_LOGGED_IN" }, 401);

    const { plan, code } = await req.json();
    if (plan !== "month" && plan !== "year") return json({ error: "BAD_PLAN" }, 400);

    const useCode = !!code && String(code).trim().toUpperCase() === (Deno.env.get("PRO_CODE") || "").toUpperCase();
    if (code && !useCode) return json({ error: "BAD_CODE" }, 400);
    const price = useCode
      ? Deno.env.get(plan === "month" ? "STRIPE_PRICE_MONTH_CODE" : "STRIPE_PRICE_YEAR_CODE")
      : Deno.env.get(plan === "month" ? "STRIPE_PRICE_MONTH" : "STRIPE_PRICE_YEAR");
    if (!price) return json({ error: "PRICE_MISSING" }, 500);

    const { data: prof } = await sb.from("profiles").select("stripe_customer_id, pro_trial_used").eq("id", u.user.id).single();
    let customer = prof?.stripe_customer_id as string | null;
    if (!customer) {
      const c = await stripe("/customers", { email: u.user.email!, "metadata[user_id]": u.user.id });
      customer = c.id;
      await sb.from("profiles").update({ stripe_customer_id: customer }).eq("id", u.user.id);
    }

    const params: Record<string, string> = {
      mode: "subscription",
      customer: customer!,
      "line_items[0][price]": price,
      "line_items[0][quantity]": "1",
      payment_method_collection: "always",
      client_reference_id: u.user.id,
      success_url: APP_URL + "?pro=ok",
      cancel_url: APP_URL + "?pro=avbruten",
      "subscription_data[metadata][user_id]": u.user.id,
      "subscription_data[metadata][plan]": plan,
    };
    if (!prof?.pro_trial_used) params["subscription_data[trial_period_days]"] = "7";

    const s = await stripe("/checkout/sessions", params);
    return json({ url: s.url });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
