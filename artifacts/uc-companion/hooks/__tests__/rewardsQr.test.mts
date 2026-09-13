import assert from "node:assert/strict";
import test from "node:test";
import { buildRewardsQrPayload } from "../../lib/rewardsQr.ts";

test("rewards QR payload contains only the opaque server token", () => {
  const token = "vYcEoZCdkj-Qr_Token";
  const payload = buildRewardsQrPayload(token);
  assert.equal(payload, "uc-rewards:v1:vYcEoZCdkj-Qr_Token");
  assert.equal(payload.includes("254"), false);
  assert.equal(payload.includes("42"), false);
});

test("rewards QR payload rejects missing tokens", () => {
  assert.throws(() => buildRewardsQrPayload("  "), /token/i);
});