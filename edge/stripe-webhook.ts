// Roothood: tar emot Stripes händelser för prenumerationer och uppdaterar Pro-status.
// Hemligheter i Supabase: STRIPE_WEBHOOK_SECRET (från Stripe-webhooken), SUPABASE_SERVICE_ROLE_KEY.
// Pro gäller tills pro_until (sista betalda period). Vid uppsägning ändras inget förrän perioden tar slut.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

async function verify(raw: string, header: string, secret: string): Promise<boolean> {
  const t = header.split(",").find((p) => p.startsWith("t="))?.slice(2);
  const sigs = header.split(",").filter((p) => p.startsWith("v1=")).map((p) => p.slice(3));
  if (!t || !sigs.length) return false;
  if (Math.abs(Date.now() / 1000 - Number(t)) > 300) return false;
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${t}.${raw}`));
  const hex = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return sigs.includes(hex);
}

Deno.serve(async (req) => {
  const raw = await req.text();
  const ok = await verify(raw, req.headers.get("stripe-signature") || "", Deno.env.get("STRIPE_WEBHOOK_SECRET") || "");
  if (!ok) return new Response("bad signature", { status: 400 });

  const ev = JSON.parse(raw);
  if (!String(ev.type).startsWith("customer.subscription.")) return new Response("ignored");

  const sub = ev.data.object;
  const uid = sub.metadata?.user_id;
  if (!uid) return new Response("no user_id");

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const active = sub.status === "trialing" || sub.status === "active";
  const patch: Record<string, unknown> = {
    is_pro: active,
    pro_until: active ? new Date(sub.current_period_end * 1000).toISOString() : null,
    pro_status: sub.status,
    pro_plan: sub.metadata?.plan || null,
    stripe_subscription_id: sub.id,
    stripe_customer_id: sub.customer,
  };
  if (sub.status === "trialing") patch.pro_trial_used = true;
  const { error } = await sb.from("profiles").update(patch).eq("id", uid);
  if (error) return new Response("db error", { status: 500 });
  return new Response("ok");
});
