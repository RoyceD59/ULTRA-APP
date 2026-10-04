export function quoteMatchesCheckout(
  quote: { fulfillment?: string; lines?: { productId: number; quantity: number }[]; code?: string; promotion?: { code: string }; referralBenefitId?: number | null } | null,
  input: { lineItems: { productId: number; quantity: number }[]; fulfillment: string | null; code?: string; applyReferralDiscount: boolean },
) {
  if (!quote || quote.fulfillment !== input.fulfillment || !quote.lines) return false;
  const linesKey = (lines: { productId: number; quantity: number }[]) => JSON.stringify(
    lines.map(line => ({productId:line.productId,quantity:line.quantity})).sort((a,b)=>a.productId-b.productId));
  if (linesKey(quote.lines) !== linesKey(input.lineItems)) return false;
  const code = input.code?.trim().toUpperCase() ?? "";
  if (input.applyReferralDiscount) return !!quote.referralBenefitId && !code;
  return !quote.referralBenefitId && (quote.promotion?.code ?? quote.code ?? "").trim().toUpperCase() === code;
}