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

describe("runLowStockAlert — unmanaged WooCommerce stock", () => {
  it("skips null-quantity in-stock products but reports explicit out-of-stock products", async () => {
    const emails: Array<{ subject: string; text: string }> = [];

    const result = await runLowStockAlert({
      isWcConfigured: () => true,
      threshold: 5,
      fetchProducts: async () => [
        {
          id: 1,
          name: "Unmanaged but in stock",
          sku: "UNMANAGED-IN",
          stock_quantity: null,
          stock_status: "instock",
        },
        {
          id: 2,
          name: "Unmanaged and out of stock",
          sku: "UNMANAGED-OUT",
          stock_quantity: null,
          stock_status: "outofstock",
        },
        {
          id: 3,
          name: "Managed low stock",
          sku: "MANAGED-LOW",
          stock_quantity: 3,
          stock_status: "instock",
        },
      ],
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

  it("does not send an alert when every product is in stock without managed quantities", async () => {
    let sendCount = 0;

    const result = await runLowStockAlert({
      isWcConfigured: () => true,
      threshold: 5,
      fetchProducts: async () => [{
        id: 10,
        name: "Made to order filter",
        stock_quantity: null,
        stock_status: "instock",
      }],
      sendEmail: async () => {
        sendCount += 1;
        return true;
      },
    });

    assert.deepEqual(result, { outOfStock: 0, lowStock: 0, emailed: false });
    assert.equal(sendCount, 0);
  });
});