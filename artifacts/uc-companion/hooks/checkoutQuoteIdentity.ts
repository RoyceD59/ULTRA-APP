export function quoteMatchesCheckout(
  quote: { fulfillment?: string; lines?: { productId: number; quantity: number; variationId?: number; childSku?: string }[]; code?: string; promotion?: { code: string }; referralBenefitId?: number | null } | null,
  input: { lineItems: { productId: number; quantity: number; variationId?: number; childSku?: string }[]; fulfillment: string | null; code?: string; applyReferralDiscount: boolean },
) {
  if (!quote || quote.fulfillment !== input.fulfillment || !quote.lines) return false;
  const linesKey = (lines: { productId: number; quantity: number; variationId?: number; childSku?: string }[]) => JSON.stringify(
    lines.map(line => ({productId:line.productId,quantity:line.quantity,variationId:line.variationId || 0,childSku:line.childSku || ''}))
      .sort((a,b)=>a.productId-b.productId || a.variationId-b.variationId || a.childSku.localeCompare(b.childSku)));
  if (linesKey(quote.lines) !== linesKey(input.lineItems)) return false;
  const code = input.code?.trim().toUpperCase() ?? "";
  if (input.applyReferralDiscount) return !!quote.referralBenefitId && !code;
  return !quote.referralBenefitId && (quote.promotion?.code ?? quote.code ?? "").trim().toUpperCase() === code;
}

/** Display a verified quote's exact selected line, never its parent's first line. */
export function checkoutLineSubtotal(
  item: { id: number; quantity: number; price: number; variationId?: number; childSku?: string },
  quote: { lines?: { productId: number; quantity: number; subtotal: number; variationId?: number; childSku?: string }[] } | null,
  current: boolean,
) {
  const line = current ? quote?.lines?.find(l => l.productId === item.id &&
    (l.variationId || 0) === (item.variationId || 0) &&
    (l.childSku || '') === (item.childSku || '') && l.quantity === item.quantity) : undefined;
  return line?.subtotal ?? item.price * item.quantity;
}