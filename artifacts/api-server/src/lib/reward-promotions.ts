import { pool } from "@workspace/db";

export type PromotionOperation = "checkout" | "redemption" | "award";
export type PromotionQuote = { id: number; code: string; type: string; effectMode: string; effectValue: number; benefit: number; subtotal: number; eligibleSubtotal: number; finalSubtotal: number };

/** Validate a promotion using DB time and product eligibility, never client totals. */
export async function quotePromotion(code: string, operation: PromotionOperation, productIds: number[], subtotal: number, lines?: { productId: number; subtotal: number }[]): Promise<PromotionQuote | null> {
  const result = await pool.query(
    `SELECT p.id,p.code,p.type,p.effect_mode,p.effect_value::text,
      EXISTS (SELECT 1 FROM uc_promotion_products pp WHERE pp.promotion_id=p.id) AS restricted,
       EXISTS (SELECT 1 FROM uc_promotion_products pp WHERE pp.promotion_id=p.id AND pp.product_id = ANY($2::int[])) AS eligible,
       COALESCE((SELECT array_agg(pp.product_id) FROM uc_promotion_products pp WHERE pp.promotion_id=p.id), '{}') AS eligible_products
     FROM uc_promotions p WHERE lower(p.code)=lower($1) AND p.active AND p.starts_at <= now()
       AND (p.ends_at IS NULL OR p.ends_at > now()) LIMIT 1`,
    [code.trim(), productIds],
  );
  const row = result.rows[0];
  if (!row || row.type !== (operation === "checkout" ? "checkout_discount" : operation === "redemption" ? "redemption_boost" : "bonus_points") ||
      (row.restricted && !row.eligible)) return null;
  const value = Number(row.effect_value);
  // Eligibility is evaluated against server-priced lines.  Callers that do
  // not have lines (non-checkout promotions) retain their supplied subtotal.
  const rawEligible = Array.isArray(row.eligible_products)
    ? row.eligible_products
    : String(row.eligible_products ?? "").replace(/[{}]/g, "").split(",").filter(Boolean);
  const eligibleIds = new Set(rawEligible.map(Number));
  const eligibleSubtotal = operation === "checkout" && row.restricted
    ? (lines ?? []).filter((line) => eligibleIds.has(line.productId)).reduce((sum, line) => sum + line.subtotal, 0)
    : subtotal;
  const benefit = row.effect_mode === "percentage"
    ? Math.max(0, Math.min(eligibleSubtotal, eligibleSubtotal * value / 100))
    : Math.max(0, Math.min(eligibleSubtotal, value));
  return { id: Number(row.id), code: row.code, type: row.type, effectMode: row.effect_mode, effectValue: value, benefit, subtotal, eligibleSubtotal, finalSubtotal: Math.max(0, subtotal - benefit) };
}

/** Atomically consume one eligible use; retrying the same customer key returns the original use. */
export async function consumePromotion(input: { quote: PromotionQuote; userId: number; operation: PromotionOperation; actor: string; idempotencyKey: string; operationRef?: string }) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await consumePromotionOnClient(client, input);
    await client.query("COMMIT"); return result;
  } catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; } finally { client.release(); }
}

/** Use this inside the caller's order transaction so order and use are indivisible. */
export async function consumePromotionOnClient(client: { query: (text: string, values?: unknown[]) => Promise<{ rows: any[] }> }, input: { quote: PromotionQuote; userId: number; operation: PromotionOperation; actor: string; idempotencyKey: string; operationRef?: string }) {
    await client.query("SELECT pg_advisory_xact_lock($1), pg_advisory_xact_lock($2)", [input.quote.id, input.userId]);
    const prior = await client.query(`SELECT * FROM uc_promotion_uses WHERE user_id=$1 AND idempotency_key=$2`, [input.userId, input.idempotencyKey]);
    if (prior.rows[0]) return { use: prior.rows[0], repeated: true };
    const limits = await client.query(`SELECT global_use_limit,per_user_use_limit FROM uc_promotions WHERE id=$1 AND active AND starts_at<=now() AND (ends_at IS NULL OR ends_at>now()) FOR UPDATE`, [input.quote.id]);
    if (!limits.rows[0]) throw Object.assign(new Error("Promotion is no longer active"), { code: "INVALID_PROMOTION" });
    const counts = await client.query(`SELECT count(*) FILTER (WHERE promotion_id=$1)::int AS global, count(*) FILTER (WHERE promotion_id=$1 AND user_id=$2)::int AS personal FROM uc_promotion_uses`, [input.quote.id, input.userId]);
    const lim = limits.rows[0], count = counts.rows[0];
    if ((lim.global_use_limit != null && Number(count.global) >= Number(lim.global_use_limit)) || (lim.per_user_use_limit != null && Number(count.personal) >= Number(lim.per_user_use_limit))) throw Object.assign(new Error("Promotion use limit reached"), { code: "PROMOTION_EXHAUSTED" });
    const snap = JSON.stringify({ type: input.quote.type, mode: input.quote.effectMode, value: input.quote.effectValue, benefit: input.quote.benefit });
    const inserted = await client.query(`INSERT INTO uc_promotion_uses (promotion_id,user_id,operation,operation_ref,actor,idempotency_key,effect_snapshot,benefit_amount) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`, [input.quote.id,input.userId,input.operation,input.operationRef ?? null,input.actor,input.idempotencyKey,snap,input.quote.benefit]);
    return { use: inserted.rows[0], repeated: false };
}