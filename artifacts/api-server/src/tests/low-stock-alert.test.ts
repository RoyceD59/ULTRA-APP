/**
 * Scheduler-level stock alerts, including unmanaged WooCommerce stock and
 * the 24-hour per-product quiet period.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { runLowStockAlert } from "../lib/scheduler.js";

const now = new Date("2026-09-12T04:30:00.000Z");
const emptyHistory = async () => new Set<number>();
const noRecord = async () => {};

describe("runLowStockAlert — daily alert behavior", () => {
  it("does not email when WooCommerce is unreachable", async () => {
    let sendCount = 0;
    const result = await runLowStockAlert({
      isWcConfigured: () => true,
      threshold: 5,
      fetchProducts: async () => null,
      getRecentlyAlertedProductIds: emptyHistory,
      recordAlertedProductIds: noRecord,
      sendEmail: async () => { sendCount++; return true; },
    });
    assert.deepEqual(result, { outOfStock: 0, lowStock: 0, emailed: false });
    assert.equal(sendCount, 0);
  });

  it("does not email when every product is above the threshold", async () => {
    let sendCount = 0;
    const result = await runLowStockAlert({
      isWcConfigured: () => true,
      threshold: 5,
      fetchProducts: async () => [
        { id: 20, name: "Healthy stock filter", stock_quantity: 6, stock_status: "instock" },
      ],
      getRecentlyAlertedProductIds: emptyHistory,
      recordAlertedProductIds: noRecord,
      sendEmail: async () => { sendCount++; return true; },
    });
    assert.deepEqual(result, { outOfStock: 0, lowStock: 0, emailed: false });
    assert.equal(sendCount, 0);
  });

  it("emails the correct subject and body for products at or below the threshold", async () => {
    const emails: Array<{ subject: string; text: string }> = [];
    const result = await runLowStockAlert({
      isWcConfigured: () => true,
      threshold: 5,
      now,
      fetchProducts: async () => [
        { id: 30, name: "Empty Filter", sku: "EMPTY-30", stock_quantity: 0,
          stock_status: "outofstock", permalink: "https://shop.example.com/products/empty-filter" },
        { id: 31, name: "Threshold Filter", sku: "LOW-31", stock_quantity: 5,
          stock_status: "instock", permalink: "https://shop.example.com/products/threshold-filter" },
      ],
      getRecentlyAlertedProductIds: emptyHistory,
      recordAlertedProductIds: noRecord,
      sendEmail: async (email) => {
        emails.push({ subject: email.subject, text: email.text });
        return true;
      },
    });
    assert.deepEqual(result, { outOfStock: 1, lowStock: 1, emailed: true });
    assert.deepEqual(emails.map((email) => email.subject), ["📦 Stock alert: 1 out of stock, 1 low stock"]);
    assert.match(emails[0]!.text, /2 products need restocking \(threshold: ≤ 5 units\)\./);
    assert.match(emails[0]!.text, /OUT OF STOCK \(1 product\):/);
    assert.match(emails[0]!.text, /Empty Filter \(SKU EMPTY-30\) — qty: 0/);
    assert.match(emails[0]!.text, /LOW STOCK — 5 units or fewer \(1 product\):/);
    assert.match(emails[0]!.text, /Threshold Filter \(SKU LOW-31\) — qty: 5/);
  });
});

describe("runLowStockAlert — unmanaged WooCommerce stock", () => {
  it("skips unmanaged in-stock products but reports explicit out-of-stock products", async () => {
    const emails: Array<{ subject: string; text: string }> = [];
    const result = await runLowStockAlert({
      isWcConfigured: () => true,
      threshold: 5,
      fetchProducts: async () => [
        { id: 1, name: "Unmanaged but in stock", stock_quantity: null, stock_status: "instock" },
        { id: 2, name: "Unmanaged and out of stock", stock_quantity: null, stock_status: "outofstock" },
        { id: 3, name: "Managed low stock", stock_quantity: 3, stock_status: "instock" },
      ],
      getRecentlyAlertedProductIds: emptyHistory,
      recordAlertedProductIds: noRecord,
      sendEmail: async (email) => {
        emails.push({ subject: email.subject, text: email.text });
        return true;
      },
    });
    assert.deepEqual(result, { outOfStock: 1, lowStock: 1, emailed: true });
    assert.equal(emails.length, 1);
    assert.match(emails[0]!.subject, /1 out of stock, 1 low stock/);
    assert.match(emails[0]!.text, /Unmanaged and out of stock/);
    assert.match(emails[0]!.text, /quantity not managed/);
    assert.match(emails[0]!.text, /Managed low stock/);
    assert.doesNotMatch(emails[0]!.text, /Unmanaged but in stock/);
  });

  it("does not alert for only unmanaged in-stock products", async () => {
    let sendCount = 0;
    const result = await runLowStockAlert({
      isWcConfigured: () => true,
      threshold: 5,
      fetchProducts: async () => [
        { id: 10, name: "Made to order filter", stock_quantity: null, stock_status: "instock" },
      ],
      getRecentlyAlertedProductIds: emptyHistory,
      recordAlertedProductIds: noRecord,
      sendEmail: async () => { sendCount++; return true; },
    });
    assert.deepEqual(result, { outOfStock: 0, lowStock: 0, emailed: false });
    assert.equal(sendCount, 0);
  });
});

describe("runLowStockAlert — 24-hour quiet period", () => {
  const products = [
    { id: 30, name: "Already alerted", stock_quantity: 0, stock_status: "outofstock" },
    { id: 31, name: "Newly low", stock_quantity: 3, stock_status: "instock" },
  ];

  it("excludes recently alerted products and records only successfully emailed ones", async () => {
    let lookup: { ids: number[]; cutoff: Date } | undefined;
    let recorded: { ids: number[]; at: Date } | undefined;
    let emailText = "";
    const result = await runLowStockAlert({
      isWcConfigured: () => true,
      threshold: 5,
      now,
      fetchProducts: async () => products,
      getRecentlyAlertedProductIds: async (ids, cutoff) => {
        lookup = { ids, cutoff };
        return new Set([30]);
      },
      recordAlertedProductIds: async (ids, at) => { recorded = { ids, at }; },
      sendEmail: async (email) => { emailText = email.text; return true; },
    });
    assert.deepEqual(lookup?.ids, [30, 31]);
    assert.equal(lookup?.cutoff.toISOString(), "2026-09-11T04:30:00.000Z");
    assert.deepEqual(result, { outOfStock: 0, lowStock: 1, emailed: true });
    assert.doesNotMatch(emailText, /Already alerted/);
    assert.match(emailText, /Newly low/);
    assert.deepEqual(recorded, { ids: [31], at: now });
  });

  it("does not record an alert when email delivery fails, allowing a retry", async () => {
    let recordCount = 0;
    const result = await runLowStockAlert({
      isWcConfigured: () => true,
      threshold: 5,
      now,
      fetchProducts: async () => products,
      getRecentlyAlertedProductIds: emptyHistory,
      recordAlertedProductIds: async () => { recordCount++; },
      sendEmail: async () => false,
    });
    assert.deepEqual(result, { outOfStock: 1, lowStock: 1, emailed: false });
    assert.equal(recordCount, 0);
  });
});