import { pool } from "@workspace/db";
import { serverPricedLines } from "../routes/uc.js";
import { quotePromotion, type PromotionQuote } from "./reward-promotions.js";
import { validateCodeForDiscount } from "../routes/referrals.js";

export type Fulfillment = "collection" | "delivery";
export async function checkoutQuote(input: {
  lineItems: { productId: number; quantity: number; variationId?: number; childSku?: string }[];
  fulfillment: Fulfillment; code?: string; applyReferralDiscount?: boolean;
}, userId?: number) {
  if (input.fulfillment !== "collection" && input.fulfillment !== "delivery") throw new Error("Choose free collection or paid delivery");
  if (input.code !== undefined && typeof input.code !== "string") throw new Error("Enter a valid promotion or referral code");
  if (input.applyReferralDiscount !== undefined && typeof input.applyReferralDiscount !== "boolean") throw new Error("Referral selection must be true or false");
  const lines = await serverPricedLines(input.lineItems);
  if (!lines) throw new Error("Products or prices could not be verified. Refresh your basket and try again.");
  const subtotal = lines.reduce((sum, line) => sum + line.subtotal, 0);
  let promotion: PromotionQuote | null = null;
  let referralBenefitId: number | null = null;
  let discountAmount = 0;
  let discountPercent = 0;
  let label = "";
  const code = input.code?.trim().toUpperCase() ?? "";
  if (code || input.applyReferralDiscount) {
    if (!userId) throw new Error("Sign in to use a promotion or referral reward");
    if (code && input.applyReferralDiscount) throw new Error("Choose one promotion or referral reward");
    if (code) {
      promotion = await quotePromotion(code, "checkout", lines.map(l => l.productId), subtotal, lines, userId);
      if (promotion) {
        if (promotion.type === "free_shipping" && input.fulfillment !== "delivery") throw new Error("Free shipping applies only to delivery");
        discountAmount = Math.round(promotion.benefit * 100) / 100;
        discountPercent = promotion.effectMode === "percentage" ? promotion.effectValue : 0;
        label = promotion.type === "free_shipping" ? "Free shipping" : "Promotion";
      } else {
        // Only a real referral code may reach legacy referral validation.
        const ref = await pool.query("SELECT code FROM uc_referral_codes WHERE code=$1", [code]);
        const account = await pool.query("SELECT email FROM uc_users WHERE id=$1", [userId]);
        const valid = ref.rows[0] && await validateCodeForDiscount(code, account.rows[0]?.email ?? "");
        if (!valid || !valid.valid || valid.type !== "referral") throw new Error(valid?.label ?? "Code is inactive, expired, exhausted, or not eligible for this basket");
        discountPercent = valid.discountPercent;
        label = valid.label;
      }
    } else {
      const result = await pool.query(`SELECT id,discount_percent FROM uc_referral_benefits
        WHERE user_id=$1 AND kind='discount' AND status='available' ORDER BY created_at,id LIMIT 1`, [userId]);
      if (!result.rows[0]) throw new Error("No earned referral discount is available");
      referralBenefitId = Number(result.rows[0].id);
      discountPercent = Number(result.rows[0].discount_percent);
      label = "Your earned referral discount";
    }
    if (!promotion) discountAmount = Math.round(subtotal * discountPercent) / 100;
  }
  const delivery = input.fulfillment === "delivery" && promotion?.type !== "free_shipping" ? 500 : 0;
  return { lines, fulfillment: input.fulfillment, subtotal, delivery, discountAmount, discountPercent,
    total: Math.max(0, subtotal + delivery - discountAmount), promotion, referralBenefitId, code, label };
}

export async function claimReferralBenefit(client: { query: (sql: string, values?: unknown[]) => Promise<any> },
  benefitId: number | null, userId: number, orderId: number) {
  if (!benefitId) return;
  const result = await client.query(`UPDATE uc_referral_benefits SET status='used',used_order_id=$3,used_at=now()
    WHERE id=$1 AND user_id=$2 AND kind='discount' AND status='available' RETURNING id`, [benefitId, userId, orderId]);
  if (!result.rows[0]) throw new Error("Referral reward was already used; refresh checkout");
  await client.query("UPDATE uc_orders SET referral_benefit_id=$2 WHERE id=$1", [orderId, benefitId]);
}