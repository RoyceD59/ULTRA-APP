import assert from "node:assert/strict";
import test from "node:test";
import { buildRewardsQrPayload } from "../../lib/rewardsQr";

test("rewards QR payload carries the account ID and normalized phone", () => {
  assert.equal(
    buildRewardsQrPayload(123, " +254 700 123 456 "),
    "uc-rewards:123:+254 700 123 456",
  );
});

test("rewards QR payload supports accounts without a saved phone", () => {
  assert.equal(buildRewardsQrPayload("42", null), "uc-rewards:42:");
});

test("rewards QR payload rejects invalid account IDs", () => {
  assert.throws(() => buildRewardsQrPayload(0, "+254700123456"), /valid account ID/i);
});