/**
 * Scheduler-level stock alerts, including unmanaged WooCommerce stock and
 * the 24-hour per-product quiet period.
 */
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { db, ucLowStockAlertsTable } from "@workspace/db";
import { inArray } from "drizzle-orm";

import { runLowStockAlert } from "../lib/scheduler.js";

const now = new Date("2026-09-12T04:30:00.000Z");
const emptyHistory = async () => new Set<number>();
const noRecord = async () => {};

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

describe("runLowStockAlert — database coordination", () => {
  // Dedicated product IDs; the test wrapper creates an isolated database.
  const ids = [1764600030, 1764600031, 1764600032, 1764600033, 1764600034, 1764600035];
  after(async () => {
    await db.delete(ucLowStockAlertsTable).where(inArray(ucLowStockAlertsTable.productId, ids));
  });

  it("allows only one overlapping run to send and persists its quiet period", { timeout: 10_000 }, async () => {
    const enteredSend = deferred();
    const finishSend = deferred();
    let sendCount = 0;
    let fetchCount = 0;
    const deps = {
      isWcConfigured: () => true,
      threshold: 5,
      now,
      fetchProducts: async () => {
        fetchCount++;
        return [{ id: ids[0]!, name: "Concurrent stock", stock_quantity: 2, stock_status: "instock" }];
      },
      sendEmail: async () => {
        sendCount++;
        enteredSend.resolve();
        await finishSend.promise;
        return true;
      },
    };
    const first = runLowStockAlert(deps);
    try {
      await enteredSend.promise;
      const second = await runLowStockAlert(deps);
      assert.deepEqual(second, { outOfStock: 0, lowStock: 0, emailed: false });
      assert.equal(sendCount, 1);
      assert.equal(fetchCount, 1, "contender must skip before doing provider work");
    } finally {
      finishSend.resolve();
      await first;
    }
    assert.equal((await first).emailed, true);
    assert.equal((await runLowStockAlert(deps)).emailed, false);
    assert.equal(sendCount, 1, "next run must observe the committed history");
    const [row] = await db.select().from(ucLowStockAlertsTable)
      .where(inArray(ucLowStockAlertsTable.productId, [ids[0]!]));
    assert.equal(row?.alertedAt.toISOString(), now.toISOString());
  });

  for (const throws of [false, true]) {
    it(`releases the claim after ${throws ? "a thrown" : "a rejected"} send so a later run can retry`,
      { timeout: 10_000 }, async () => {
        const enteredSend = deferred();
        const finishSend = deferred();
        let attempts = 0;
        const productId = ids[throws ? 2 : 1]!;
        const deps = {
          isWcConfigured: () => true,
          threshold: 5,
          now,
          fetchProducts: async () => [
            { id: productId, name: "Retry stock", stock_quantity: 0, stock_status: "outofstock" },
          ],
          sendEmail: async () => {
            attempts++;
            if (attempts > 1) return true;
            enteredSend.resolve();
            await finishSend.promise;
            if (throws) throw new Error("provider unavailable");
            return false;
          },
        };
        const first = runLowStockAlert(deps);
        // Attach the rejection handler before releasing the provider barrier.
        const settled = throws
          ? assert.rejects(first, /provider unavailable/)
          : first.then((result) => { assert.equal(result.emailed, false); });
        try {
          await enteredSend.promise;
          assert.equal((await runLowStockAlert(deps)).emailed, false);
          assert.equal(attempts, 1);
        } finally {
          finishSend.resolve();
          await settled;
        }
        const history = await db.select().from(ucLowStockAlertsTable)
          .where(inArray(ucLowStockAlertsTable.productId, [productId]));
        assert.equal(history.length, 0, "failed delivery must not start a quiet period");
        assert.equal((await runLowStockAlert(deps)).emailed, true);
        assert.equal(attempts, 2);
      });
  }

  for (const throws of [false, true]) {
    it(`does not advance expired history after ${throws ? "a thrown" : "a rejected"} scheduled delivery`,
      async () => {
        const productId = ids[throws ? 5 : 4]!;
        const expiredAt = new Date(now.getTime() - 48 * 60 * 60 * 1_000);
        await db.insert(ucLowStockAlertsTable).values({ productId, alertedAt: expiredAt });
        let attempts = 0;
        const deps = {
          isWcConfigured: () => true,
          threshold: 5,
          now,
          fetchProducts: async () => [
            { id: productId, name: "Expired history", stock_quantity: 0, stock_status: "outofstock" },
          ],
          sendEmail: async () => {
            attempts++;
            if (throws) throw new Error("provider unavailable");
            return false;
          },
        };
        if (throws) await assert.rejects(runLowStockAlert(deps), /provider unavailable/);
        else assert.equal((await runLowStockAlert(deps)).emailed, false);
        const [unchanged] = await db.select().from(ucLowStockAlertsTable)
          .where(inArray(ucLowStockAlertsTable.productId, [productId]));
        assert.equal(unchanged?.alertedAt.toISOString(), expiredAt.toISOString());
        assert.equal((await runLowStockAlert({
          ...deps, sendEmail: async () => { attempts++; return true; },
        })).emailed, true);
        assert.equal(attempts, 2);
        const [recorded] = await db.select().from(ucLowStockAlertsTable)
          .where(inArray(ucLowStockAlertsTable.productId, [productId]));
        assert.equal(recorded?.alertedAt.toISOString(), now.toISOString());
      });
  }

  it("releases the claim after a failed history lookup without sending", async () => {
    let attempts = 0;
    const deps = {
      isWcConfigured: () => true,
      threshold: 5,
      now,
      fetchProducts: async () => [
        { id: ids[3]!, name: "History failure", stock_quantity: 1, stock_status: "instock" },
      ],
      sendEmail: async () => { attempts++; return true; },
    };
    assert.equal((await runLowStockAlert({
      ...deps,
      getRecentlyAlertedProductIds: async () => { throw new Error("history unavailable"); },
    })).emailed, false);
    assert.equal(attempts, 0);
    assert.equal((await runLowStockAlert(deps)).emailed, true);
    assert.equal(attempts, 1);
  });
});

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