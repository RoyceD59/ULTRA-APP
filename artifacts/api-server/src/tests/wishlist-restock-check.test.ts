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

import { db, ucWishlistTable } from "@workspace/db";
import { checkWishlistRestocks } from "../lib/scheduler.js";

// ── Test fixtures ────────────────────────────────────────────────────────────

const TEST_PRODUCT_ID = 887701;
const USER_A = "wishlist-restock-user-a";
const USER_B = "wishlist-restock-user-b";

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
    });
    assert.deepEqual(result, { notified: 0, reset: 0 });
    assert.equal(pushCalls.length, 0);
  });

  it("notifies every pending wishlist row exactly once when the product is back in stock", async () => {
    const result = await checkWishlistRestocks({
      isWcConfigured: () => true,
      fetchStockStatus: async (productId) => (productId === TEST_PRODUCT_ID ? "instock" : null),
      sendPush: stubSendPush,
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
    });

    assert.equal(result.notified, 0, "no rows are pending — all already notified this cycle");
    assert.equal(pushCalls.length, 0, "push must not fire again for an already-notified cycle");
  });

  it("resets notifiedRestockAt for all previously-notified rows when the product goes out of stock", async () => {
    const result = await checkWishlistRestocks({
      isWcConfigured: () => true,
      fetchStockStatus: async () => "outofstock",
      sendPush: stubSendPush,
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
    });
    assert.deepEqual(result, { notified: 0, reset: 0 });
  });

  it("notifies again exactly once per row on the next restock cycle after a reset", async () => {
    const result = await checkWishlistRestocks({
      isWcConfigured: () => true,
      fetchStockStatus: async () => "instock",
      sendPush: stubSendPush,
    });

    assert.equal(result.notified, 2, "the reset cycle must re-arm notifications");
    assert.equal(pushCalls.length, 2, "exactly one notification per row on the new cycle");

    const stamps = await notifiedAtByUser();
    assert.ok(stamps[USER_A] instanceof Date);
    assert.ok(stamps[USER_B] instanceof Date);
  });
});
