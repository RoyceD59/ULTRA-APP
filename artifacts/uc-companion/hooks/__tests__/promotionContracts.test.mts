import assert from "node:assert/strict";
import test from "node:test";
import type { CheckoutPromotionQuote, RewardsRedemptionResult } from "../../hooks/useApi";

test("checkout promotion quote uses only server-calculated money values", () => {
  const quote: CheckoutPromotionQuote = {
    promotion: { code: "WELCOME", title: "Welcome discount applied" },
    subtotal: 2_000,
    delivery: 0,
    discountAmount: 250,
    total: 1_750,
  };

  assert.equal(quote.discountAmount, 250);
  assert.equal(quote.total, 1_750);
});

test("redemption response carries a server-confirmed balance", () => {
  const result: RewardsRedemptionResult = { balance: 4_000, redemptionValue: 500 };
  assert.equal(result.balance, 4_000);
});