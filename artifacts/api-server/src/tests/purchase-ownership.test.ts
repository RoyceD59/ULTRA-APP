import test from "node:test";
import assert from "node:assert/strict";
import { appPurchaseOwnedBy, storePurchaseOwnedBy } from "../lib/purchase-ownership.js";

const normal = (value: string) => value.trim().toLowerCase();
const phones = (a: unknown, b: unknown) =>
  String(a ?? "").replace(/\D/g, "").slice(-9) === String(b ?? "").replace(/\D/g, "").slice(-9);

test("app receipt cannot be claimed by another authenticated account even with its phone", () => {
  assert.equal(appPurchaseOwnedBy(22, "11", "+254700123456", "0700123456", phones), false);
  assert.equal(appPurchaseOwnedBy(11, "11", "+254700123456", "0700123456", phones), true);
});

test("store receipt requires both matching purchase phone and billing email", () => {
  assert.equal(storePurchaseOwnedBy("owner@uc.test", "other@uc.test", "+254700123456", "", "0700123456", normal, phones), false);
  assert.equal(storePurchaseOwnedBy("owner@uc.test", "OWNER@UC.TEST", "+254700123456", "", "0700123456", normal, phones), true);
});