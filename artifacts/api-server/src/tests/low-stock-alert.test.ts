/**
 * Scheduler-level regression tests for WooCommerce stock semantics.
 *
 * WooCommerce sends stock_quantity: null for products that do not have stock
 * management enabled. The daily alert must not treat those in-stock products as
 * a zero-quantity incident, while still reporting an explicit outofstock status.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { runLowStockAlert } from "../lib/scheduler.js";

describe("runLowStockAlert — daily alert behavior", () => {
  it("does not email when WooCommerce is unreachable", async () => {
    let sendCount = 0;

    const result = await runLowStockAlert({
      isWcConfigured: () => true,
      threshold: 5,
      fetchProducts: async () => [
        { id: 30, name: "Needs retry", stock_quantity: 1, stock_status: "instock" },
      ],
      getRecentlyAlertedProductIds: async () => new Set(),
      sendEmail: async () => false,
      recordAlertedProductIds: async () => {
        recordCount += 1;
      },
    });

    const now = new Date("2026-09-12T04:30:00.000Z");

    let recordCount = 0;

    assert.deepEqual(result, { outOfStock: 1, lowStock: 1, emailed: true });
    assert.equal(emails.length, 1);
    assert.match(emails[0]!.subject, /1 out of stock, 1 low stock/);
    assert.match(emails[0]!.text, /Unmanaged and out of stock/);
    assert.match(emails[0]!.text, /quantity not managed/);
    assert.match(emails[0]!.text, /Managed low stock/);
    assert.doesNotMatch(emails[0]!.text, /Unmanaged but in stock/);
  });

  it("does not send an alert when every product is in stock without managed quantities", async () => {
    let sendCount = 0;

    const result = await runLowStockAlert({
      isWcConfigured: () => true,
      threshold: 5,
      fetchProducts: async () => [
        { id: 30, name: "Needs retry", stock_quantity: 1, stock_status: "instock" },
      ],
      getRecentlyAlertedProductIds: async () => new Set(),
      sendEmail: async () => false,
      recordAlertedProductIds: async () => {
        recordCount += 1;
      },
    });

    const now = new Date("2026-09-12T04:30:00.000Z");

    let recordCount = 0;

    assert.deepEqual(result, { outOfStock: 1, lowStock: 1, emailed: true });
    assert.deepEqual(emails.map((email) => email.subject), [
      "📦 Stock alert: 1 out of stock, 1 low stock",
    ]);
    assert.match(emails[0]!.text, /2 products need restocking \(threshold: ≤ 5 units\)\./);
    assert.match(emails[0]!.text, /OUT OF STOCK \(1 product\):/);
    assert.match(emails[0]!.text, /Empty Filter \(SKU EMPTY-30\) — qty: 0/);
    assert.match(emails[0]!.text, /LOW STOCK — 5 units or fewer \(1 product\):/);
    assert.match(emails[0]!.text, /Threshold Filter \(SKU LOW-31\) — qty: 5/);
  });
});

describe("runLowStockAlert — unmanaged WooCommerce stock", () => {
  it("skips null-quantity in-stock products but reports explicit out-of-stock products", async () => {
    const emails: Array<{ subject: string; text: string }> = [];

    const result = await runLowStockAlert({
      isWcConfigured: () => true,
      threshold: 5,
      fetchProducts: async () => [
        { id: 30, name: "Needs retry", stock_quantity: 1, stock_status: "instock" },
      ],
      getRecentlyAlertedProductIds: async () => new Set(),
      sendEmail: async () => false,
      recordAlertedProductIds: async () => {
        recordCount += 1;
      },
    });

    const now = new Date("2026-09-12T04:30:00.000Z");

    let recordCount = 0;

    assert.deepEqual(result, { outOfStock: 1, lowStock: 1, emailed: true });
    assert.deepEqual(emails.map((email) => email.subject), [
      "📦 Stock alert: 1 out of stock, 1 low stock",
    ]);
    assert.match(emails[0]!.text, /2 products need restocking \(threshold: ≤ 5 units\)\./);
    assert.match(emails[0]!.text, /OUT OF STOCK \(1 product\):/);
    assert.match(emails[0]!.text, /Empty Filter \(SKU EMPTY-30\) — qty: 0/);
    assert.match(emails[0]!.text, /LOW STOCK — 5 units or fewer \(1 product\):/);
    assert.match(emails[0]!.text, /Threshold Filter \(SKU LOW-31\) — qty: 5/);
  });
});

describe("runLowStockAlert — unmanaged WooCommerce stock", () => {
  it("skips null-quantity in-stock products but reports explicit out-of-stock products", async () => {
    const emails: Array<{ subject: string; text: string }> = [];

    const result = await runLowStockAlert({
      isWcConfigured: () => true,
      threshold: 5,
      fetchProducts: async () => [
        { id: 30, name: "Needs retry", stock_quantity: 1, stock_status: "instock" },
      ],
      getRecentlyAlertedProductIds: async () => new Set(),
      sendEmail: async () => false,
      recordAlertedProductIds: async () => {
        recordCount += 1;
      },
    });

    const now = new Date("2026-09-12T04:30:00.000Z");

    let recordCount = 0;

    assert.deepEqual(result, { outOfStock: 1, lowStock: 1, emailed: true });
    assert.equal(emails.length, 1);
    assert.match(emails[0]!.subject, /1 out of stock, 1 low stock/);
    assert.match(emails[0]!.text, /Unmanaged and out of stock/);
    assert.match(emails[0]!.text, /quantity not managed/);
    assert.match(emails[0]!.text, /Managed low stock/);
    assert.doesNotMatch(emails[0]!.text, /Unmanaged but in stock/);
  });

  it("does not send an alert when every product is in stock without managed quantities", async () => {
    let sendCount = 0;

    const result = await runLowStockAlert({
      isWcConfigured: () => true,
      threshold: 5,
      fetchProducts: async () => [
        { id: 30, name: "Needs retry", stock_quantity: 1, stock_status: "instock" },
      ],
      getRecentlyAlertedProductIds: async () => new Set(),
      sendEmail: async () => false,
      recordAlertedProductIds: async () => {
        recordCount += 1;
      },
    });

    const now = new Date("2026-09-12T04:30:00.000Z");

    let recordCount = 0;

    assert.deepEqual(result, { outOfStock: 0, lowStock: 1, emailed: false });
    assert.equal(recordCount, 0);
  });
});

    let observedCutoff: Date | undefined;

    let recorded: { productIds: number[]; alertedAt: Date } | undefined;

    let emailText = "";
