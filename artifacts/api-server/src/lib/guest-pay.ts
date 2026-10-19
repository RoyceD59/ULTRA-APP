import { createHash, createHmac, randomBytes } from "node:crypto";
import { pool } from "@workspace/db";
import { serverPricedLines } from "../routes/uc.js";
import { paymentMocksAllowed, paymentProviderConfigured } from "./payment-configuration.js";

export const GUEST_PAY_DDL = `CREATE TABLE IF NOT EXISTS uc_guest_pay_links (
  id serial PRIMARY KEY,
  order_id integer NOT NULL REFERENCES uc_orders(id) ON DELETE CASCADE,
  generation text NOT NULL,
  token_hash text NOT NULL,
  expires_at timestamptz NOT NULL DEFAULT (now()+interval '72 hours'),
  revoked_at timestamptz,
  opened_at timestamptz,
  paid_event_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uc_guest_pay_links_token_hash_unique ON uc_guest_pay_links(token_hash);
CREATE UNIQUE INDEX IF NOT EXISTS uc_guest_pay_active_order ON uc_guest_pay_links(order_id) WHERE revoked_at IS NULL;`;

export function hashPayToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}
function deriveToken(order: any, generation: string) {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("Payment sharing is not configured");
  // Retry-safe PRF, domain-separated from sessions. Only a hash is stored.
  // The random generation is NOT a bearer credential without the server key.
  return createHmac("sha256", secret).update(`uc-guest-pay:v1:${order.checkout_claim_id}:${generation}`).digest("base64url");
}
export function guestPayOrigin() {
  const url = new URL(process.env.UC_GUEST_PAY_PUBLIC_ORIGIN || process.env.PUBLIC_WEB_CANONICAL_ORIGIN || "");
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new Error("An HTTPS public payment origin is required");
  }
  return url.origin;
}
export function guestProviderAvailable(method: string) {
  return (method !== "stripe" || process.env.STRIPE_ENABLED !== "false") &&
    (paymentProviderConfigured(method) || paymentMocksAllowed());
}
export function payLinkState(order: any, link: any, now = Date.now()) {
  if (!order || !link) return "invalid";
  if (order.status === "cancelled" || order.checkout_state === "cancelled") return "cancelled";
  if (link.revoked_at) return "replaced";
  if (new Date(link.expires_at).getTime() <= now) return "expired";
  if (order.payment_confirmed_at) return order.checkout_state === "confirmed" ? "paid" : "pending";
  if (order.status !== "pending" || order.checkout_state !== "payment_pending" ||
      order.checkout_snapshot?.paymentNotStarted !== true || order.payment_reference) return "pending";
  return "ready";
}
export async function issuePayLink(order: any) {
  const origin = guestPayOrigin();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    order = (await client.query("SELECT * FROM uc_orders WHERE id=$1 FOR UPDATE", [order.id])).rows[0];
    if (!order || order.status !== "pending" || order.payment_confirmed_at || order.payment_reference ||
        order.checkout_state !== "payment_pending" || !order.checkout_snapshot?.paymentNotStarted ||
        !["paystack", "mpesa", "stripe"].includes(order.payment_method)) throw new Error("This order cannot be shared for payment");
    let link = (await client.query("SELECT * FROM uc_guest_pay_links WHERE order_id=$1 AND revoked_at IS NULL", [order.id])).rows[0];
    if (link && new Date(link.expires_at).getTime() <= Date.now()) {
      throw new Error("This payment link expired. Safely retire this checkout and accept a refreshed order.");
    }
    if (!link) {
      const generation = randomBytes(32).toString("hex");
      const token = deriveToken(order, generation);
      link = (await client.query(`INSERT INTO uc_guest_pay_links(order_id,generation,token_hash)
        VALUES($1,$2,$3) RETURNING *`, [order.id, generation, hashPayToken(token)])).rows[0];
    }
    const token = deriveToken(order, link.generation);
    if (hashPayToken(token) !== link.token_hash) throw new Error("Sharing key changed. Revoke and refresh this link.");
    await client.query("COMMIT");
    return { token, url: `${origin}/pay/${token}`, expiresAt: link.expires_at, orderId: order.id,
      summary: await guestPaySummary(order, link) };
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}
export async function resolvePayLink(token: unknown) {
  if (typeof token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const link = (await pool.query("SELECT * FROM uc_guest_pay_links WHERE token_hash=$1", [hashPayToken(token)])).rows[0];
  if (!link) return null;
  const order = (await pool.query("SELECT * FROM uc_orders WHERE id=$1", [link.order_id])).rows[0];
  if (!order?.checkout_snapshot || !["paystack", "mpesa", "stripe"].includes(order.payment_method)) return null;
  const account = (await pool.query("SELECT id FROM uc_users WHERE id=$1 AND deleted_at IS NULL", [Number(order.user_id)])).rows[0];
  return account ? { order, link } : null;
}
export async function revalidatePayOrder(order: any) {
  const { input, pricing } = order.checkout_snapshot;
  const lines = await serverPricedLines(input.lineItems);
  // Benefits were atomically reserved at save time and stay valid for recovery.
  // Do not re-consume/requote their last available use or treat expiry as release.
  if (!lines || lines.length !== pricing.lines.length ||
      lines.some((line: any, index: number) => {
        const saved = pricing.lines[index];
        return line.productId !== saved.productId || line.quantity !== saved.quantity ||
          (line.variationId ?? null) !== (saved.variationId ?? null) ||
          (line.childSku ?? null) !== (saved.childSku ?? null) || Math.abs(line.subtotal - saved.subtotal) > 0.001;
      })) return false;
  const uses = pricing.promotion ? await pool.query(`SELECT id FROM uc_promotion_uses
    WHERE user_id=$1 AND operation='checkout' AND operation_ref=$2`, [Number(order.user_id), String(order.id)]) : null;
  if (uses && !uses.rows[0]) return false;
  if (order.referral_benefit_id) {
    const benefit = await pool.query("SELECT id FROM uc_referral_benefits WHERE id=$1 AND used_order_id=$2 AND status='used'", [order.referral_benefit_id, order.id]);
    if (!benefit.rows[0]) return false;
  }
  return Math.abs(Number(order.total) - pricing.total) < 0.001;
}
/** Explicit privacy allowlist; never spread order/snapshot/address here. */
export async function guestPaySummary(order: any, link: any, forcedState?: string) {
  const state = forcedState || payLinkState(order, link);
  if (["invalid", "expired", "cancelled", "replaced"].includes(state)) return { state };
  const rows = await pool.query("SELECT name,quantity,total,child_sku,variant_label FROM uc_order_items WHERE order_id=$1 ORDER BY id", [order.id]);
  return { state,
    buyerFirstName: /^[\p{L}\p{M}'’-]{1,50}$/u.test(String(order.shipping_address?.firstName || "").trim().split(/\s+/)[0]!)
      ? String(order.shipping_address.firstName).trim().split(/\s+/)[0] : "",
    deliveryArea: String(order.shipping_address?.city || ""),
    fulfillment: order.checkout_snapshot.pricing.fulfillment,
    total: Number(order.total), currency: "KES",
    items: rows.rows.map((i, index) => ({ name: i.name, quantity: i.quantity, total: Number(i.total),
      sku: i.child_sku || order.checkout_snapshot.pricing.lines[index]?.sku || "",
      size: order.checkout_snapshot.pricing.lines[index]?.size || "", variant: i.variant_label || "" })),
    methods: Object.fromEntries(["paystack", "mpesa", "stripe"].map(m => [m,
      state === "ready" && order.payment_method === m && guestProviderAvailable(m)])),
    ...(state === "pending" && order.checkout_snapshot.provider ? {
      resumeUrl: order.checkout_snapshot.provider.authorizationUrl || order.checkout_snapshot.provider.sessionUrl || null,
    } : {}),
    ...(state === "paid" ? { verified: true, transactionId: `UC-${order.id}` } : {}),
  };
}
