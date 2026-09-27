/**
 * Integration coverage for the customer rewards balance.
 *
 * The balance shown in the app must be the arithmetic total of that customer's
 * ledger rows, and an account without ledger entries must start at zero.
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import bcryptjs from "bcryptjs";
import { eq, inArray } from "drizzle-orm";

import { db, ucRewardConversionTable, ucRewardsLedgerTable, ucUsersTable } from "@workspace/db";
import { issueToken } from "../lib/jwt.js";

let server: http.Server;
let userWithRewardsId: number;
let userWithoutRewardsId: number;
let userWithRewardsEmail: string;
let userWithoutRewardsEmail: string;

async function getRewards(userId: number, email: string): Promise<{
  status: number;
  body: { balance?: number; lifetimeRedeemed?: number };
}> {
  const address = server.address() as { port: number };
  const token = issueToken({
    id: userId,
    email,
    firstName: "Balance",
    lastName: "Tester",
  });
  const response = await fetch(
    `http://localhost:${address.port}/api/uc/customer/rewards`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  return {
    status: response.status,
    body: await response.json() as { balance?: number },
  };
}

async function redeemRewards(userId: number, email: string, idempotencyKey: string) {
  const address = server.address() as { port: number };
  const token = issueToken({ id: userId, email, firstName: "Balance", lastName: "Tester" });
  const response = await fetch(`http://localhost:${address.port}/api/uc/customer/rewards/redeem`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ points: 1000, idempotencyKey }),
  });
  return { status: response.status, body: await response.json() as { newBalance?: number; lifetimeRedeemed?: number; repeated?: boolean } };
}

async function getAdminBalances(userId: number, email: string) {
  const address = server.address() as { port: number };
  const token = issueToken({ id: userId, email, firstName: "Balance", lastName: "Tester" });
  const response = await fetch(`http://localhost:${address.port}/api/uc/admin/rewards/balances`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return { status: response.status, body: await response.json() as {
    lifetimeRedeemed?: number;
    customers?: Array<{ userId: number; balance: number; lifetimeRedeemed: number }>;
  } };
}

before(async () => {
  process.env["SESSION_SECRET"] ??= "test-secret-rewards-balance";

  const suffix = `${Date.now()}-${process.pid}`;
  userWithRewardsEmail = `rewards-balance-ledger-${suffix}@uctest.internal`;
  userWithoutRewardsEmail = `rewards-balance-empty-${suffix}@uctest.internal`;
  const passwordHash = await bcryptjs.hash("TestPass1!", 4);

  const users = await db
    .insert(ucUsersTable)
    .values([
      {
        email: userWithRewardsEmail,
        passwordHash,
        firstName: "Ledger",
        lastName: "Balance",
      },
      {
        email: userWithoutRewardsEmail,
        passwordHash,
        firstName: "Empty",
        lastName: "Balance",
      },
    ])
    .returning({ id: ucUsersTable.id, email: ucUsersTable.email });

  userWithRewardsId = users.find((user) => user.email === userWithRewardsEmail)!.id;
  userWithoutRewardsId = users.find((user) => user.email === userWithoutRewardsEmail)!.id;

  await db.insert(ucRewardsLedgerTable).values([
    {
      userId: userWithRewardsId,
      points: 50,
      reason: "Filter replacement reward — replace30 cycle one",
      eventType: "filter-replacement",
      refId: `${userWithRewardsId}:99881:1000:replace30`,
    },
    {
      userId: userWithRewardsId,
      points: 50,
      reason: "Filter replacement reward — replace30 cycle two",
      eventType: "filter-replacement",
      refId: `${userWithRewardsId}:99881:2000:replace30`,
    },
    {
      userId: userWithRewardsId,
      points: 50,
      reason: "Filter replacement reward — replace15 cycle two",
      eventType: "filter-replacement",
      refId: `${userWithRewardsId}:99881:2000:replace15`,
    },
  ]);
  await db.update(ucUsersTable).set({ isAdmin: true }).where(eq(ucUsersTable.id, userWithRewardsId));

  const { default: app } = await import("../app.js");
  await new Promise<void>((resolve, reject) => {
    server = app.listen(0, "127.0.0.1", (error?: Error) =>
      error ? reject(error) : resolve(),
    );
  });
});

after(async () => {
  await db
    .delete(ucRewardsLedgerTable)
    .where(inArray(ucRewardsLedgerTable.userId, [userWithRewardsId, userWithoutRewardsId]));
  await db
    .delete(ucUsersTable)
    .where(inArray(ucUsersTable.id, [userWithRewardsId, userWithoutRewardsId]));
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
});

describe("GET /uc/customer/rewards balance", () => {
  it("returns the sum of two replace30 and one replace15 ledger rows", async () => {
    const result = await getRewards(userWithRewardsId, userWithRewardsEmail);

    assert.equal(result.status, 200);
    assert.equal(result.body.balance, 150);
    assert.equal(result.body.lifetimeRedeemed, 0);
  });

  it("returns zero for a user with no ledger rows", async () => {
    const result = await getRewards(userWithoutRewardsId, userWithoutRewardsEmail);

    assert.equal(result.status, 200);
    assert.equal(result.body.balance, 0);
    assert.equal(result.body.lifetimeRedeemed, 0);

    const rows = await db
      .select({ id: ucRewardsLedgerTable.id })
      .from(ucRewardsLedgerTable)
      .where(eq(ucRewardsLedgerTable.userId, userWithoutRewardsId));
    assert.equal(rows.length, 0);
  });

  it("deducts once on redemption and reports per-user and organization lifetime redeemed totals", async () => {
    const [previousConversion] = await db
      .select()
      .from(ucRewardConversionTable)
      .where(eq(ucRewardConversionTable.id, "singleton"))
      .limit(1);
    await db
      .insert(ucRewardConversionTable)
      .values({
        id: "singleton",
        mode: previousConversion?.mode ?? "kes",
        value: previousConversion?.value ?? "100",
        active: true,
      })
      .onConflictDoUpdate({
        target: ucRewardConversionTable.id,
        set: { active: true },
      });

    try {
    const before = await getAdminBalances(userWithRewardsId, userWithRewardsEmail);
    assert.equal(before.status, 200);
    const organizationBefore = before.body.lifetimeRedeemed ?? 0;
    await db.insert(ucRewardsLedgerTable).values({
      userId: userWithRewardsId, points: 2000, reason: "Redemption test credit", eventType: "manual",
      refId: `${userWithRewardsId}:redemption-test-credit`,
    });

    const first = await redeemRewards(userWithRewardsId, userWithRewardsEmail, "redemption-reporting-retry");
    assert.equal(first.status, 201);
    assert.equal(first.body.newBalance, 1150);
    assert.equal(first.body.lifetimeRedeemed, 1000);
    assert.equal(first.body.repeated, false);

    const retry = await redeemRewards(userWithRewardsId, userWithRewardsEmail, "redemption-reporting-retry");
    assert.equal(retry.status, 200);
    assert.equal(retry.body.newBalance, 1150);
    assert.equal(retry.body.lifetimeRedeemed, 1000);
    assert.equal(retry.body.repeated, true);

    const customer = await getRewards(userWithRewardsId, userWithRewardsEmail);
    assert.equal(customer.body.balance, 1150);
    assert.equal(customer.body.lifetimeRedeemed, 1000);
    const redemptions = await db.select({ id: ucRewardsLedgerTable.id }).from(ucRewardsLedgerTable)
      .where(eq(ucRewardsLedgerTable.refId, "customer-redeem:redemption-reporting-retry"));
    assert.equal(redemptions.length, 1);

    const after = await getAdminBalances(userWithRewardsId, userWithRewardsEmail);
    assert.equal(after.status, 200);
    assert.equal(after.body.lifetimeRedeemed, organizationBefore + 1000);
    const user = after.body.customers?.find((row) => row.userId === userWithRewardsId);
    assert.equal(user?.balance, 1150);
    assert.equal(user?.lifetimeRedeemed, 1000);
    } finally {
      if (previousConversion) {
        await db
          .update(ucRewardConversionTable)
          .set({ active: previousConversion.active })
          .where(eq(ucRewardConversionTable.id, "singleton"));
      } else {
        await db
          .delete(ucRewardConversionTable)
          .where(eq(ucRewardConversionTable.id, "singleton"));
      }
    }
  });
});