/**
 * Tests for runLifespanAuditAlert (daily 05:00 UTC scheduler job).
 *
 * Covers:
 *   (a) Skips silently when WooCommerce credentials are absent
 *   (b) Aborts (no email, no rows) when the store is unreachable (fetch null)
 *   (c) Emails newly flagged products and records them in uc_lifespan_alerts
 *   (d) No repeat email for products already alerted
 *   (e) Failed email send → products NOT recorded, retried next run
 *   (f) Trackable / exempt products are not flagged at all
 *
 * Uses injectable fetchProducts + sendEmail deps — never hits the live store
 * or Resend. DB rows created are deleted in the after() hook.
 */

import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { runLifespanAuditAlert } from "../lib/scheduler.js";
import { db, ucLifespanAlertsTable } from "@workspace/db";
import { inArray } from "drizzle-orm";

// Unique high product IDs so we never collide with real audit rows.
const IDS = [9911001, 9911002, 9911003];

function wcProduct(id: number, opts: { lifespan?: number; price?: string; name?: string } = {}) {
  return {
    id,
    name: opts.name ?? `Test Filter ${id}`,
    sku: `TEST-${id}`,
    price: opts.price ?? "4500",
    categories: [{ name: "Water Filters" }],
    meta_data: opts.lifespan
      ? [{ key: "filter_lifespan_days", value: String(opts.lifespan) }]
      : [],
  } as Record<string, unknown>;
}

async function cleanup() {
  await db.delete(ucLifespanAlertsTable).where(inArray(ucLifespanAlertsTable.productId, IDS));
}

describe("runLifespanAuditAlert", () => {
  let savedKey: string | undefined;
  let savedSecret: string | undefined;

  before(async () => {
    savedKey = process.env["WC_CONSUMER_KEY"];
    savedSecret = process.env["WC_CONSUMER_SECRET"];
    await cleanup();
  });

  beforeEach(() => {
    process.env["WC_CONSUMER_KEY"] = "test-key";
    process.env["WC_CONSUMER_SECRET"] = "test-secret";
  });

  after(async () => {
    if (savedKey === undefined) delete process.env["WC_CONSUMER_KEY"];
    else process.env["WC_CONSUMER_KEY"] = savedKey;
    if (savedSecret === undefined) delete process.env["WC_CONSUMER_SECRET"];
    else process.env["WC_CONSUMER_SECRET"] = savedSecret;
    await cleanup();
  });

  it("skips silently when WooCommerce credentials are absent", async () => {
    delete process.env["WC_CONSUMER_KEY"];
    delete process.env["WC_CONSUMER_SECRET"];
    let fetched = false;
    let emailed = false;
    const result = await runLifespanAuditAlert({
      fetchProducts: async () => { fetched = true; return []; },
      sendEmail: async () => { emailed = true; return true; },
    });
    assert.deepEqual(result, { flagged: 0, newlyAlerted: 0, emailed: false });
    assert.equal(fetched, false, "must not hit the store without credentials");
    assert.equal(emailed, false);
  });

  it("aborts without emailing or recording when the store is unreachable", async () => {
    let emailed = false;
    const result = await runLifespanAuditAlert({
      fetchProducts: async () => null,
      sendEmail: async () => { emailed = true; return true; },
    });
    assert.deepEqual(result, { flagged: 0, newlyAlerted: 0, emailed: false });
    assert.equal(emailed, false);
  });

  it("does not flag trackable products", async () => {
    let emailed = false;
    const result = await runLifespanAuditAlert({
      fetchProducts: async () => [wcProduct(IDS[0]!, { lifespan: 90 })],
      sendEmail: async () => { emailed = true; return true; },
    });
    assert.deepEqual(result, { flagged: 0, newlyAlerted: 0, emailed: false });
    assert.equal(emailed, false);
  });

  it("emails newly flagged products and records them; no repeat on second run", async () => {
    const sentEmails: { subject: string; text: string }[] = [];
    const deps = {
      fetchProducts: async () => [
        wcProduct(IDS[0]!),
        wcProduct(IDS[1]!, { name: "Another Filter" }),
      ],
      sendEmail: async (e: { subject: string; text: string }) => {
        sentEmails.push({ subject: e.subject, text: e.text });
        return true;
      },
    };

    const first = await runLifespanAuditAlert(deps);
    assert.equal(first.flagged, 2);
    assert.equal(first.newlyAlerted, 2);
    assert.equal(first.emailed, true);
    assert.equal(sentEmails.length, 1);
    assert.match(sentEmails[0]!.text, /Test Filter 9911001/);
    assert.match(sentEmails[0]!.text, /Another Filter/);

    const rows = await db
      .select()
      .from(ucLifespanAlertsTable)
      .where(inArray(ucLifespanAlertsTable.productId, IDS));
    assert.equal(rows.length, 2, "both products recorded as alerted");

    // Second run — same products still flagged, but no new email
    const second = await runLifespanAuditAlert(deps);
    assert.equal(second.flagged, 2);
    assert.equal(second.newlyAlerted, 0);
    assert.equal(second.emailed, false);
    assert.equal(sentEmails.length, 1, "no repeat email");
  });

  it("only emails the new product when a fresh one appears later", async () => {
    const sentEmails: string[] = [];
    const result = await runLifespanAuditAlert({
      fetchProducts: async () => [
        wcProduct(IDS[0]!), // already alerted in previous test
        wcProduct(IDS[2]!, { name: "Brand New Filter" }),
      ],
      sendEmail: async (e: { text: string }) => { sentEmails.push(e.text); return true; },
    });
    assert.equal(result.flagged, 2);
    assert.equal(result.newlyAlerted, 1);
    assert.equal(result.emailed, true);
    assert.match(sentEmails[0]!, /Brand New Filter/);
    assert.doesNotMatch(sentEmails[0]!, /Test Filter 9911001/);
  });

  it("re-alerts when a fixed product loses its lifespan meta again", async () => {
    await cleanup();
    const sentEmails: string[] = [];
    const sendEmail = async (e: { text: string }) => { sentEmails.push(e.text); return true; };

    // 1. Product missing lifespan → alerted and recorded
    const first = await runLifespanAuditAlert({
      fetchProducts: async () => [wcProduct(IDS[0]!)],
      sendEmail,
    });
    assert.equal(first.emailed, true);
    assert.equal(sentEmails.length, 1);
    assert.doesNotMatch(sentEmails[0]!, /regressed/, "first alert must not be marked as a repeat");

    // 2. Team fixes the product → audit clean, dedupe row marked resolved
    //    (kept for history, not deleted)
    const fixed = await runLifespanAuditAlert({
      fetchProducts: async () => [wcProduct(IDS[0]!, { lifespan: 90 })],
      sendEmail,
    });
    assert.deepEqual(fixed, { flagged: 0, newlyAlerted: 0, emailed: false });
    let rows = await db
      .select()
      .from(ucLifespanAlertsTable)
      .where(inArray(ucLifespanAlertsTable.productId, IDS));
    assert.equal(rows.length, 1, "resolved product's row must be kept for history");
    assert.notEqual(rows[0]!.resolvedAt, null, "resolved row must have resolvedAt set");
    assert.equal(rows[0]!.alertCount, 1);

    // 3. Meta disappears again → re-alerted, flagged as a repeat offender
    const regressed = await runLifespanAuditAlert({
      fetchProducts: async () => [wcProduct(IDS[0]!)],
      sendEmail,
    });
    assert.equal(regressed.newlyAlerted, 1);
    assert.equal(regressed.emailed, true);
    assert.equal(sentEmails.length, 2, "regression must trigger a second email");
    assert.match(
      sentEmails[1]!,
      /Test Filter 9911001.*\(regressed — alerted 1 time before\)/,
      "re-alert email must flag the product as a repeat offender",
    );

    rows = await db
      .select()
      .from(ucLifespanAlertsTable)
      .where(inArray(ucLifespanAlertsTable.productId, IDS));
    assert.equal(rows[0]!.alertCount, 2, "alertCount must increment on regression");
    assert.equal(rows[0]!.resolvedAt, null, "resolvedAt must be cleared on regression");

    // 4. And dedupe still works after the re-alert
    const again = await runLifespanAuditAlert({
      fetchProducts: async () => [wcProduct(IDS[0]!)],
      sendEmail,
    });
    assert.equal(again.emailed, false);
    assert.equal(sentEmails.length, 2, "no repeat email while still flagged");

    // 5. Second regression cycle → count keeps growing, plural wording
    await runLifespanAuditAlert({
      fetchProducts: async () => [wcProduct(IDS[0]!, { lifespan: 90 })],
      sendEmail,
    });
    const regressedAgain = await runLifespanAuditAlert({
      fetchProducts: async () => [wcProduct(IDS[0]!)],
      sendEmail,
    });
    assert.equal(regressedAgain.emailed, true);
    assert.equal(sentEmails.length, 3);
    assert.match(sentEmails[2]!, /\(regressed — alerted 2 times before\)/);
    rows = await db
      .select()
      .from(ucLifespanAlertsTable)
      .where(inArray(ucLifespanAlertsTable.productId, IDS));
    assert.equal(rows[0]!.alertCount, 3);
    await cleanup();
  });

  it("does not record products when the email send fails, so it retries next run", async () => {
    await cleanup();
    const deps = {
      fetchProducts: async () => [wcProduct(IDS[0]!)],
    };
    const failed = await runLifespanAuditAlert({ ...deps, sendEmail: async () => false });
    assert.equal(failed.emailed, false);
    assert.equal(failed.newlyAlerted, 0);
    const rows = await db
      .select()
      .from(ucLifespanAlertsTable)
      .where(inArray(ucLifespanAlertsTable.productId, IDS));
    assert.equal(rows.length, 0, "failed send must not mark products alerted");

    // Next run with a working sender retries successfully
    const retry = await runLifespanAuditAlert({ ...deps, sendEmail: async () => true });
    assert.equal(retry.emailed, true);
    assert.equal(retry.newlyAlerted, 1);
  });
});
