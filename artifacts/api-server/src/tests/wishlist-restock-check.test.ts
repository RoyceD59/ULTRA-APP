/**
 * Tests for checkWishlistRestocks() — the scheduler job that notifies
 * wishlisted users when a WooCommerce product comes back in stock.
 *
 * Covers:
 *   1. A product transitioning out-of-stock -> in-stock triggers exactly one
 *      push notification per pending wishlist row, and stamps notifiedRestockAt.
 *   2. Re-running the check while still in stock does NOT re-notify (idempotent).
 *   3. When the product goes back out of stock, notifiedRestockAt is reset to
 *      null for every previously-notified row (and only those rows).
 *   4. After the reset, the next in-stock cycle notifies again exactly once —
 *      confirming the reset correctly re-arms the next cycle.
 *   5. WC-not-configured short-circuits without touching the DB or push.
 *
 * Strategy: inject fetchStockStatus / sendPush / isWcConfigured (the seams
 * added to checkWishlistRestocks) so no live WooCommerce or Expo I/O happens.
 * Real wishlist rows are inserted/cleaned up against the isolated test DB.
 */
import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { eq, inArray } from "drizzle-orm";

import { db, ucRestockDemandAlertsTable, ucWishlistTable } from "@workspace/db";
import { checkWishlistRestocks } from "../lib/scheduler.js";
import { checkRestockDemandForProduct } from "../lib/wishlist-demand.js";

// ── Test fixtures ────────────────────────────────────────────────────────────

const TEST_PRODUCT_ID = 887701;
const USER_A = "wishlist-restock-user-a";
const USER_B = "wishlist-restock-user-b";
const DEMAND_PRODUCT_ID = 887702;
const DEMAND_USERS = [
  "wishlist-demand-user-a",
  "wishlist-demand-user-b",
  "wishlist-demand-user-c",
  "wishlist-demand-user-d",
];

interface PushCall {
  userId: string;
  title: string;
  body: string;
}

let pushCalls: PushCall[] = [];

function stubSendPush(
  userId: string,
  title: string,
  body: string,
  _data?: Record<string, unknown>,
  _category?: string,
): void {
  pushCalls.push({ userId, title, body });
}

async function seedWishlistRows(): Promise<void> {
  await db.insert(ucWishlistTable).values([
    { userId: USER_A, productId: TEST_PRODUCT_ID, productName: "Restock Test Filter" },
    { userId: USER_B, productId: TEST_PRODUCT_ID, productName: "Restock Test Filter" },
  ]);
}

async function notifiedAtByUser(): Promise<Record<string, Date | null>> {
  const rows = await db
    .select({ userId: ucWishlistTable.userId, notifiedRestockAt: ucWishlistTable.notifiedRestockAt })
    .from(ucWishlistTable)
    .where(eq(ucWishlistTable.productId, TEST_PRODUCT_ID));
  const out: Record<string, Date | null> = {};
  for (const r of rows) out[r.userId] = r.notifiedRestockAt;
  return out;
}

before(async () => {
  await db.delete(ucWishlistTable).where(inArray(ucWishlistTable.userId, [USER_A, USER_B]));
  await seedWishlistRows();
});

after(async () => {
  await db.delete(ucWishlistTable).where(inArray(ucWishlistTable.userId, [USER_A, USER_B]));
});

beforeEach(() => {
  pushCalls = [];
});

describe("checkWishlistRestocks", () => {
  it("skips entirely when WooCommerce credentials are not configured", async () => {
    const result = await checkWishlistRestocks({
      isWcConfigured: () => false,
      fetchStockStatus: async () => { throw new Error("must not be called"); },
      sendPush: stubSendPush,
      demandThreshold: 10_000,
    });
    assert.deepEqual(result, { notified: 0, reset: 0 });
    assert.equal(pushCalls.length, 0);
  });

  it("notifies every pending wishlist row exactly once when the product is back in stock", async () => {
    const result = await checkWishlistRestocks({
      isWcConfigured: () => true,
      fetchStockStatus: async (productId) => (productId === TEST_PRODUCT_ID ? "instock" : null),
      sendPush: stubSendPush,
      demandThreshold: 10_000,
    });

    assert.equal(result.notified, 2, "both wishlist rows should be notified");
    assert.equal(result.reset, 0);
    assert.equal(pushCalls.length, 2, "push must fire exactly once per pending row");

    const notifiedUsers = pushCalls.map((c) => c.userId).sort();
    assert.deepEqual(notifiedUsers, [USER_A, USER_B].sort());
    for (const call of pushCalls) {
      assert.match(call.title, /Back in Stock/);
    }

    const stamps = await notifiedAtByUser();
    assert.ok(stamps[USER_A] instanceof Date, "USER_A notifiedRestockAt must be stamped");
    assert.ok(stamps[USER_B] instanceof Date, "USER_B notifiedRestockAt must be stamped");
  });

  it("does not re-notify on a second in-stock check (idempotent within the same cycle)", async () => {
    const result = await checkWishlistRestocks({
      isWcConfigured: () => true,
      fetchStockStatus: async () => "instock",
      sendPush: stubSendPush,
      demandThreshold: 10_000,
    });

    assert.equal(result.notified, 0, "no rows are pending — all already notified this cycle");
    assert.equal(pushCalls.length, 0, "push must not fire again for an already-notified cycle");
  });

  it("resets notifiedRestockAt for all previously-notified rows when the product goes out of stock", async () => {
    const result = await checkWishlistRestocks({
      isWcConfigured: () => true,
      fetchStockStatus: async () => "outofstock",
      sendPush: stubSendPush,
      demandThreshold: 10_000,
    });

    assert.equal(result.reset, 2, "both previously-notified rows must be reset");
    assert.equal(result.notified, 0);
    assert.equal(pushCalls.length, 0);

    const stamps = await notifiedAtByUser();
    assert.equal(stamps[USER_A], null, "USER_A notifiedRestockAt must be cleared");
    assert.equal(stamps[USER_B], null, "USER_B notifiedRestockAt must be cleared");
  });

  it("a second out-of-stock check is a no-op (nothing left to reset)", async () => {
    const result = await checkWishlistRestocks({
      isWcConfigured: () => true,
      fetchStockStatus: async () => "outofstock",
      sendPush: stubSendPush,
      demandThreshold: 10_000,
    });
    assert.deepEqual(result, { notified: 0, reset: 0 });
  });

  it("notifies again exactly once per row on the next restock cycle after a reset", async () => {
    const result = await checkWishlistRestocks({
      isWcConfigured: () => true,
      fetchStockStatus: async () => "instock",
      sendPush: stubSendPush,
      demandThreshold: 10_000,
    });

    assert.equal(result.notified, 2, "the reset cycle must re-arm notifications");
    assert.equal(pushCalls.length, 2, "exactly one notification per row on the new cycle");

    const stamps = await notifiedAtByUser();
    assert.ok(stamps[USER_A] instanceof Date);
    assert.ok(stamps[USER_B] instanceof Date);
  });
});

describe("checkWishlistRestocks — urgent restock demand alerts", () => {
  it("alerts once per threshold crossing and re-arms after demand falls below the threshold", async () => {
    const emails: Array<{ subject: string; text: string }> = [];
    const checkDemand = (stockStatus = "outofstock") =>
      checkWishlistRestocks({
        isWcConfigured: () => true,
        fetchStockStatus: async (productId) =>
          productId === DEMAND_PRODUCT_ID ? stockStatus : null,
        sendPush: () => undefined,
        sendEmail: async (email) => {
          emails.push({ subject: email.subject, text: email.text });
          return true;
        },
        demandThreshold: 2,
        inventoryUrl: "https://projecthub.test/admin/inventory",
      });

    await db
      .delete(ucWishlistTable)
      .where(inArray(ucWishlistTable.userId, DEMAND_USERS));
    await db
      .delete(ucRestockDemandAlertsTable)
      .where(eq(ucRestockDemandAlertsTable.productId, DEMAND_PRODUCT_ID));

    try {
      await db.insert(ucWishlistTable).values([
        {
          userId: DEMAND_USERS[0]!,
          productId: DEMAND_PRODUCT_ID,
          productName: "Urgent Demand Filter",
        },
        {
          userId: DEMAND_USERS[1]!,
          productId: DEMAND_PRODUCT_ID,
          productName: "Urgent Demand Filter",
        },
      ]);

      await checkDemand();
      assert.equal(emails.length, 1, "crossing the threshold should send one alert");
      assert.match(emails[0]!.subject, /Urgent Demand Filter/);
      assert.match(emails[0]!.text, /2 waiting customers/);
      assert.match(emails[0]!.text, /https:\/\/projecthub\.test\/admin\/inventory/);

      let [demandState] = await db
        .select()
        .from(ucRestockDemandAlertsTable)
        .where(eq(ucRestockDemandAlertsTable.productId, DEMAND_PRODUCT_ID));
      assert.equal(demandState?.status, "sent");
      assert.ok(demandState?.alertedAt instanceof Date);

      await checkDemand();
      assert.equal(emails.length, 1, "a repeated check must not send a duplicate");

      await db.insert(ucWishlistTable).values([
        {
          userId: DEMAND_USERS[2]!,
          productId: DEMAND_PRODUCT_ID,
          productName: "Urgent Demand Filter",
        },
        {
          userId: DEMAND_USERS[3]!,
          productId: DEMAND_PRODUCT_ID,
          productName: "Urgent Demand Filter",
        },
      ]);
      await db
        .delete(ucWishlistTable)
        .where(inArray(ucWishlistTable.userId, [DEMAND_USERS[0]!, DEMAND_USERS[1]!]));
      await checkDemand();
      assert.equal(
        emails.length,
        1,
        "removing all original customers while urgent demand remains must not duplicate",
      );

      await db
        .delete(ucWishlistTable)
        .where(eq(ucWishlistTable.userId, DEMAND_USERS[3]!));
      await checkDemand();

      [demandState] = await db
        .select()
        .from(ucRestockDemandAlertsTable)
        .where(eq(ucRestockDemandAlertsTable.productId, DEMAND_PRODUCT_ID));
      assert.equal(demandState, undefined);

      await db.insert(ucWishlistTable).values({
        userId: DEMAND_USERS[0]!,
        productId: DEMAND_PRODUCT_ID,
        productName: "Urgent Demand Filter",
      });
      await checkDemand();
      assert.equal(emails.length, 2, "the next threshold crossing should alert again");

      await db
        .delete(ucWishlistTable)
        .where(inArray(ucWishlistTable.userId, DEMAND_USERS));
      await checkDemand();
      [demandState] = await db
        .select()
        .from(ucRestockDemandAlertsTable)
        .where(eq(ucRestockDemandAlertsTable.productId, DEMAND_PRODUCT_ID));
      assert.equal(demandState, undefined, "an empty waiting list should clear cycle state");

      await db.insert(ucWishlistTable).values([
        {
          userId: DEMAND_USERS[2]!,
          productId: DEMAND_PRODUCT_ID,
          productName: "Urgent Demand Filter",
        },
        {
          userId: DEMAND_USERS[3]!,
          productId: DEMAND_PRODUCT_ID,
          productName: "Urgent Demand Filter",
        },
      ]);
      await checkDemand();
      assert.equal(
        emails.length,
        3,
        "a new waiting list should produce a new threshold-crossing alert",
      );

      await checkDemand("instock");
      [demandState] = await db
        .select()
        .from(ucRestockDemandAlertsTable)
        .where(eq(ucRestockDemandAlertsTable.productId, DEMAND_PRODUCT_ID));
      assert.equal(demandState, undefined, "restocking should re-arm the next demand surge");
    } finally {
      await db
        .delete(ucWishlistTable)
        .where(inArray(ucWishlistTable.userId, DEMAND_USERS));
      await db
        .delete(ucRestockDemandAlertsTable)
        .where(eq(ucRestockDemandAlertsTable.productId, DEMAND_PRODUCT_ID));
    }
  });

  it("retries a failed delivery with the same provider idempotency key", async () => {
    await db
      .delete(ucWishlistTable)
      .where(inArray(ucWishlistTable.userId, DEMAND_USERS));
    await db
      .delete(ucRestockDemandAlertsTable)
      .where(eq(ucRestockDemandAlertsTable.productId, DEMAND_PRODUCT_ID));

    try {
      await db.insert(ucWishlistTable).values([
        {
          userId: DEMAND_USERS[0]!,
          productId: DEMAND_PRODUCT_ID,
          productName: "Retry Demand Filter",
        },
        {
          userId: DEMAND_USERS[1]!,
          productId: DEMAND_PRODUCT_ID,
          productName: "Retry Demand Filter",
        },
      ]);

      const idempotencyKeys: string[] = [];
      let shouldSucceed = false;
      const check = () => checkWishlistRestocks({
        isWcConfigured: () => true,
        fetchStockStatus: async (productId) =>
          productId === DEMAND_PRODUCT_ID ? "outofstock" : null,
        sendPush: () => undefined,
        sendEmail: async (email) => {
          idempotencyKeys.push(email.idempotencyKey ?? "");
          return shouldSucceed;
        },
        demandThreshold: 2,
        inventoryUrl: "https://projecthub.test/admin/inventory",
      });

      await check();
      shouldSucceed = true;
      await check();

      assert.equal(idempotencyKeys.length, 2);
      assert.equal(idempotencyKeys[0], idempotencyKeys[1]);
      const [state] = await db
        .select()
        .from(ucRestockDemandAlertsTable)
        .where(eq(ucRestockDemandAlertsTable.productId, DEMAND_PRODUCT_ID));
      assert.equal(state?.status, "sent");
    } finally {
      await db
        .delete(ucWishlistTable)
        .where(inArray(ucWishlistTable.userId, DEMAND_USERS));
      await db
        .delete(ucRestockDemandAlertsTable)
        .where(eq(ucRestockDemandAlertsTable.productId, DEMAND_PRODUCT_ID));
    }
  });

  it("retries a thrown delivery with the same provider idempotency key", async () => {
    await db.delete(ucWishlistTable).where(inArray(ucWishlistTable.userId, DEMAND_USERS));
    await db
      .delete(ucRestockDemandAlertsTable)
      .where(eq(ucRestockDemandAlertsTable.productId, DEMAND_PRODUCT_ID));

    try {
      await db.insert(ucWishlistTable).values([
        {
          userId: DEMAND_USERS[0]!,
          productId: DEMAND_PRODUCT_ID,
          productName: "Thrown Retry Demand Filter",
        },
        {
          userId: DEMAND_USERS[1]!,
          productId: DEMAND_PRODUCT_ID,
          productName: "Thrown Retry Demand Filter",
        },
      ]);

      const idempotencyKeys: string[] = [];
      let shouldThrow = true;
      const check = () => checkWishlistRestocks({
        isWcConfigured: () => true,
        fetchStockStatus: async (productId) =>
          productId === DEMAND_PRODUCT_ID ? "outofstock" : null,
        sendPush: () => undefined,
        sendEmail: async (email) => {
          idempotencyKeys.push(email.idempotencyKey ?? "");
          if (shouldThrow) throw new Error("simulated provider interruption");
          return true;
        },
        demandThreshold: 2,
        inventoryUrl: "https://projecthub.test/admin/inventory",
      });

      await check();
      shouldThrow = false;
      await check();

      assert.equal(idempotencyKeys.length, 2);
      assert.equal(idempotencyKeys[0], idempotencyKeys[1]);
      const [state] = await db
        .select()
        .from(ucRestockDemandAlertsTable)
        .where(eq(ucRestockDemandAlertsTable.productId, DEMAND_PRODUCT_ID));
      assert.equal(state?.status, "sent");
    } finally {
      await db.delete(ucWishlistTable).where(inArray(ucWishlistTable.userId, DEMAND_USERS));
      await db
        .delete(ucRestockDemandAlertsTable)
        .where(eq(ucRestockDemandAlertsTable.productId, DEMAND_PRODUCT_ID));
    }
  });

  it("aborts provider delivery before its claim lease expires", async () => {
    await db.delete(ucWishlistTable).where(inArray(ucWishlistTable.userId, DEMAND_USERS));
    await db
      .delete(ucRestockDemandAlertsTable)
      .where(eq(ucRestockDemandAlertsTable.productId, DEMAND_PRODUCT_ID));

    try {
      await db.insert(ucWishlistTable).values([
        {
          userId: DEMAND_USERS[0]!,
          productId: DEMAND_PRODUCT_ID,
          productName: "Bounded Delivery Demand Filter",
        },
        {
          userId: DEMAND_USERS[1]!,
          productId: DEMAND_PRODUCT_ID,
          productName: "Bounded Delivery Demand Filter",
        },
      ]);

      const idempotencyKeys: string[] = [];
      let aborted = false;
      const firstResult = await checkRestockDemandForProduct({
        productId: DEMAND_PRODUCT_ID,
        stockStatus: "outofstock",
        deps: {
          threshold: 2,
          getAlertEmail: async () => "purchasing@ucfilters-test.internal",
          inventoryUrl: "https://projecthub.test/admin/inventory",
          claimTtlMs: 100,
          emailTimeoutMs: 10,
          sendEmail: async (email) =>
            new Promise<boolean>((resolve) => {
              email.signal?.addEventListener("abort", () => {
                aborted = true;
                idempotencyKeys.push(email.idempotencyKey ?? "");
                resolve(false);
              }, { once: true });
            }),
        },
      });

      assert.equal(firstResult, "failed");
      assert.equal(aborted, true);

      const secondResult = await checkRestockDemandForProduct({
        productId: DEMAND_PRODUCT_ID,
        stockStatus: "outofstock",
        deps: {
          threshold: 2,
          getAlertEmail: async () => "purchasing@ucfilters-test.internal",
          inventoryUrl: "https://projecthub.test/admin/inventory",
          sendEmail: async (email) => {
            idempotencyKeys.push(email.idempotencyKey ?? "");
            return true;
          },
        },
      });

      assert.equal(secondResult, "alerted");
      assert.equal(idempotencyKeys.length, 2);
      assert.equal(
        idempotencyKeys[0],
        idempotencyKeys[1],
        "the bounded retry must retain the original provider key",
      );
    } finally {
      await db.delete(ucWishlistTable).where(inArray(ucWishlistTable.userId, DEMAND_USERS));
      await db
        .delete(ucRestockDemandAlertsTable)
        .where(eq(ucRestockDemandAlertsTable.productId, DEMAND_PRODUCT_ID));
    }
  });

  it("uses an atomic claim so concurrent checks send only one email", async () => {
    await db.delete(ucWishlistTable).where(inArray(ucWishlistTable.userId, DEMAND_USERS));
    await db
      .delete(ucRestockDemandAlertsTable)
      .where(eq(ucRestockDemandAlertsTable.productId, DEMAND_PRODUCT_ID));

    try {
      await db.insert(ucWishlistTable).values([
        {
          userId: DEMAND_USERS[0]!,
          productId: DEMAND_PRODUCT_ID,
          productName: "Concurrent Demand Filter",
        },
        {
          userId: DEMAND_USERS[1]!,
          productId: DEMAND_PRODUCT_ID,
          productName: "Concurrent Demand Filter",
        },
      ]);

      let sendCount = 0;
      let releaseSend!: () => void;
      const sendStarted = new Promise<void>((resolve) => {
        releaseSend = resolve;
      });
      let firstSendEntered!: () => void;
      const firstSend = new Promise<void>((resolve) => {
        firstSendEntered = resolve;
      });
      const check = () => checkWishlistRestocks({
        isWcConfigured: () => true,
        fetchStockStatus: async (productId) =>
          productId === DEMAND_PRODUCT_ID ? "outofstock" : null,
        sendPush: () => undefined,
        sendEmail: async () => {
          sendCount += 1;
          firstSendEntered();
          await sendStarted;
          return true;
        },
        demandThreshold: 2,
        inventoryUrl: "https://projecthub.test/admin/inventory",
      });

      const first = check();
      await firstSend;
      const second = check();
      await second;
      releaseSend();
      await first;

      assert.equal(sendCount, 1);
    } finally {
      await db.delete(ucWishlistTable).where(inArray(ucWishlistTable.userId, DEMAND_USERS));
      await db
        .delete(ucRestockDemandAlertsTable)
        .where(eq(ucRestockDemandAlertsTable.productId, DEMAND_PRODUCT_ID));
    }
  });

  it("keeps one claim when an immediate request overlaps a scheduler rearm", async () => {
    await db.delete(ucWishlistTable).where(inArray(ucWishlistTable.userId, DEMAND_USERS));
    await db
      .delete(ucRestockDemandAlertsTable)
      .where(eq(ucRestockDemandAlertsTable.productId, DEMAND_PRODUCT_ID));

    try {
      await db.insert(ucWishlistTable).values([
        {
          userId: DEMAND_USERS[0]!,
          productId: DEMAND_PRODUCT_ID,
          productName: "Request Scheduler Overlap Filter",
        },
        {
          userId: DEMAND_USERS[1]!,
          productId: DEMAND_PRODUCT_ID,
          productName: "Request Scheduler Overlap Filter",
        },
      ]);

      let sendCount = 0;
      let releaseSend!: () => void;
      const sendReleased = new Promise<void>((resolve) => {
        releaseSend = resolve;
      });
      let sendEntered!: () => void;
      const firstSendEntered = new Promise<void>((resolve) => {
        sendEntered = resolve;
      });
      const sendEmail = async () => {
        sendCount += 1;
        sendEntered();
        await sendReleased;
        return true;
      };

      const requestCheck = checkRestockDemandForProduct({
        productId: DEMAND_PRODUCT_ID,
        stockStatus: "outofstock",
        deps: {
          threshold: 2,
          sendEmail,
          getAlertEmail: async () => "purchasing@ucfilters-test.internal",
          inventoryUrl: "https://projecthub.test/admin/inventory",
        },
      });
      await firstSendEntered;

      const schedulerCheck = checkWishlistRestocks({
        isWcConfigured: () => true,
        fetchStockStatus: async (productId) =>
          productId === DEMAND_PRODUCT_ID ? "instock" : null,
        sendPush: () => undefined,
        sendEmail,
        demandThreshold: 2,
        inventoryUrl: "https://projecthub.test/admin/inventory",
      });
      await schedulerCheck;

      const overlappingRequest = await checkRestockDemandForProduct({
        productId: DEMAND_PRODUCT_ID,
        stockStatus: "outofstock",
        deps: {
          threshold: 2,
          sendEmail,
          getAlertEmail: async () => "purchasing@ucfilters-test.internal",
          inventoryUrl: "https://projecthub.test/admin/inventory",
        },
      });
      assert.equal(overlappingRequest, "unchanged");

      releaseSend();
      await requestCheck;

      assert.equal(sendCount, 1, "scheduler rearm must not open a second email claim");
      const [state] = await db
        .select()
        .from(ucRestockDemandAlertsTable)
        .where(eq(ucRestockDemandAlertsTable.productId, DEMAND_PRODUCT_ID));
      assert.equal(state, undefined, "the completed in-flight claim should finish rearming");
    } finally {
      await db.delete(ucWishlistTable).where(inArray(ucWishlistTable.userId, DEMAND_USERS));
      await db
        .delete(ucRestockDemandAlertsTable)
        .where(eq(ucRestockDemandAlertsTable.productId, DEMAND_PRODUCT_ID));
    }
  });

  it("reconciles when delivery completes between scheduler rearm statements", async () => {
    await db.delete(ucWishlistTable).where(inArray(ucWishlistTable.userId, DEMAND_USERS));
    await db
      .delete(ucRestockDemandAlertsTable)
      .where(eq(ucRestockDemandAlertsTable.productId, DEMAND_PRODUCT_ID));

    try {
      await db.insert(ucWishlistTable).values([
        {
          userId: DEMAND_USERS[0]!,
          productId: DEMAND_PRODUCT_ID,
          productName: "Rearm Completion Race Filter",
        },
        {
          userId: DEMAND_USERS[1]!,
          productId: DEMAND_PRODUCT_ID,
          productName: "Rearm Completion Race Filter",
        },
      ]);

      const idempotencyKeys: string[] = [];
      let releaseFirstSend!: () => void;
      const firstSendReleased = new Promise<void>((resolve) => {
        releaseFirstSend = resolve;
      });
      let firstSendEntered!: () => void;
      const firstSendStarted = new Promise<void>((resolve) => {
        firstSendEntered = resolve;
      });
      let sendCount = 0;
      const sendEmail = async (email: { idempotencyKey?: string }) => {
        sendCount += 1;
        idempotencyKeys.push(email.idempotencyKey ?? "");
        if (sendCount === 1) {
          firstSendEntered();
          await firstSendReleased;
        }
        return true;
      };

      const requestCheck = checkRestockDemandForProduct({
        productId: DEMAND_PRODUCT_ID,
        stockStatus: "outofstock",
        deps: {
          threshold: 2,
          sendEmail,
          getAlertEmail: async () => "purchasing@ucfilters-test.internal",
          inventoryUrl: "https://projecthub.test/admin/inventory",
        },
      });
      await firstSendStarted;

      let releaseRearm!: () => void;
      const rearmReleased = new Promise<void>((resolve) => {
        releaseRearm = resolve;
      });
      let rearmPaused!: () => void;
      const rearmReachedTransition = new Promise<void>((resolve) => {
        rearmPaused = resolve;
      });
      const schedulerCheck = checkWishlistRestocks({
        isWcConfigured: () => true,
        fetchStockStatus: async (productId) =>
          productId === DEMAND_PRODUCT_ID ? "instock" : null,
        sendPush: () => undefined,
        sendEmail,
        demandThreshold: 2,
        inventoryUrl: "https://projecthub.test/admin/inventory",
        beforeDemandRearmTransition: async () => {
          rearmPaused();
          await rearmReleased;
        },
      });
      await rearmReachedTransition;

      releaseFirstSend();
      await requestCheck;
      releaseRearm();
      await schedulerCheck;

      let [state] = await db
        .select()
        .from(ucRestockDemandAlertsTable)
        .where(eq(ucRestockDemandAlertsTable.productId, DEMAND_PRODUCT_ID));
      assert.equal(state, undefined, "scheduler must clear the claim completed during rearm");

      await checkRestockDemandForProduct({
        productId: DEMAND_PRODUCT_ID,
        stockStatus: "outofstock",
        deps: {
          threshold: 2,
          sendEmail,
          getAlertEmail: async () => "purchasing@ucfilters-test.internal",
          inventoryUrl: "https://projecthub.test/admin/inventory",
        },
      });

      assert.equal(sendCount, 2, "the next demand cycle must be able to alert");
      assert.notEqual(
        idempotencyKeys[0],
        idempotencyKeys[1],
        "a rearmed demand cycle must receive a new provider key",
      );
      [state] = await db
        .select()
        .from(ucRestockDemandAlertsTable)
        .where(eq(ucRestockDemandAlertsTable.productId, DEMAND_PRODUCT_ID));
      assert.equal(state?.status, "sent");
    } finally {
      await db.delete(ucWishlistTable).where(inArray(ucWishlistTable.userId, DEMAND_USERS));
      await db
        .delete(ucRestockDemandAlertsTable)
        .where(eq(ucRestockDemandAlertsTable.productId, DEMAND_PRODUCT_ID));
    }
  });
});
