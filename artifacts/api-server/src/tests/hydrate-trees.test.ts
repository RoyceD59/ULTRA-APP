/**
 * Hydrate the Future shared trees: fill algorithm, persistence, privacy.
 * Run with: pnpm --filter @workspace/api-server test
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import bcrypt from "bcryptjs";
import app from "../app.js";
import {
  db, ucUsersTable, ucCanonicalPurchasesTable, ucHydrateTreeContributionsTable,
} from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { issueToken } from "../lib/jwt.js";
import {
  planAllocations, treeShareMinor, hydrateConfig, stageForPct, syncTreeContributions,
} from "../lib/hydrate-trees.js";

const CFG = { contributionRate: 0.03, treeShare: 0.5, treeCostMinor: 75_000 };

describe("planAllocations (pure)", () => {
  it("takes half of the 3% for trees", () => {
    assert.equal(treeShareMinor(1_222_000, CFG), 18_330); // KES 12,220 → KES 183.30
    assert.equal(treeShareMinor(66, CFG), 0);            // under one cent
  });

  it("fills one shared tree with several customers, oldest open tree first", () => {
    const { slices, newTrees } = planAllocations([], 1, [
      { purchaseId: 1, customerId: 10, totalMinor: 2_000_000 }, // 300.00
      { purchaseId: 2, customerId: 11, totalMinor: 2_000_000 }, // 300.00
      { purchaseId: 3, customerId: 12, totalMinor: 2_000_000 }, // 300.00 → 150 to tree 1, 150 to tree 2
    ], CFG);
    assert.deepEqual(newTrees, [1, 2]);
    assert.deepEqual(slices, [
      { purchaseId: 1, customerId: 10, treeNumber: 1, amountMinor: 30_000 },
      { purchaseId: 2, customerId: 11, treeNumber: 1, amountMinor: 30_000 },
      { purchaseId: 3, customerId: 12, treeNumber: 1, amountMinor: 15_000 },
      { purchaseId: 3, customerId: 12, treeNumber: 2, amountMinor: 15_000 },
    ]);
  });

  it("backfills a gap left by a reversal before opening a new tree", () => {
    const { slices, newTrees } = planAllocations(
      [{ treeNumber: 4, remainingMinor: 10_000 }, { treeNumber: 7, remainingMinor: 75_000 }], 8,
      [{ purchaseId: 9, customerId: 1, totalMinor: 1_000_000 }], CFG); // 150.00
    assert.deepEqual(newTrees, []);
    assert.deepEqual(slices.map(s => [s.treeNumber, s.amountMinor]), [[4, 10_000], [7, 5_000]]);
  });

  it("maps funding % to stages and reads env safely", () => {
    assert.deepEqual([0, 24, 25, 49, 50, 99, 100].map(stageForPct),
      ["seed", "seed", "sapling", "sapling", "growing", "growing", "funded"]);
    const c = hydrateConfig({ HYDRATE_TREE_COST_KES: "abc", HYDRATE_TREE_SHARE: "2", FOREST_TREES_PLANTED: "12" });
    assert.equal(c.treeCostMinor, 75_000);
    assert.equal(c.treeShare, 0.5);
    assert.equal(c.treesPlanted, 12);
    assert.equal(c.treesEstablished, null);
  });
});

describe("shared trees (database)", () => {
  let server: http.Server;
  let base: string;
  const ids: number[] = [];
  const purchaseIds: number[] = [];
  const emails: string[] = [];

  before(async () => {
    process.env.SESSION_SECRET ??= "hydrate-trees-test-secret";
    const suffix = `${Date.now()}-${process.pid}`;
    const passwordHash = await bcrypt.hash("Test1234!", 4);
    for (const name of ["a", "b"]) {
      const [u] = await db.insert(ucUsersTable).values({
        email: `hydrate-${name}-${suffix}@test.invalid`, passwordHash, firstName: "Tree", lastName: name,
      }).returning();
      ids.push(u!.id); emails.push(u!.email);
    }
    // Old dates so these are allocated ahead of other suites' purchases.
    for (const [i, customerId] of [[0, ids[0]!], [1, ids[1]!]] as const) {
      const [p] = await db.insert(ucCanonicalPurchasesTable).values({
        customerId, currency: "KES", total: "12220", totalMinor: 1_222_000,
        paymentStatus: "paid", sourceCreatedAt: new Date(Date.UTC(2001, 0, 1 + i)),
      }).returning();
      purchaseIds.push(p!.id);
    }
    // Unpaid purchase must never be allocated.
    const [pending] = await db.insert(ucCanonicalPurchasesTable).values({
      customerId: ids[0]!, currency: "KES", total: "50000", totalMinor: 5_000_000,
      paymentStatus: "pending", sourceCreatedAt: new Date(Date.UTC(2001, 0, 3)),
    }).returning();
    purchaseIds.push(pending!.id);
    await syncTreeContributions();

    server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;
  });

  after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await db.delete(ucHydrateTreeContributionsTable).where(inArray(ucHydrateTreeContributionsTable.canonicalPurchaseId, purchaseIds));
    await db.delete(ucCanonicalPurchasesTable).where(inArray(ucCanonicalPurchasesTable.id, purchaseIds));
    await db.delete(ucUsersTable).where(inArray(ucUsersTable.id, ids));
  });

  const auth = (i: number) => ({ Authorization: `Bearer ${issueToken({ id: ids[i]!, email: emails[i]! })}` });

  it("puts two customers' tree shares into persisted slices and skips unpaid purchases", async () => {
    const rows = await db.select().from(ucHydrateTreeContributionsTable)
      .where(inArray(ucHydrateTreeContributionsTable.canonicalPurchaseId, purchaseIds));
    assert.equal(rows.filter(r => r.canonicalPurchaseId === purchaseIds[2]).length, 0);
    for (const i of [0, 1]) {
      const mine = rows.filter(r => r.customerId === ids[i]);
      assert.equal(mine.reduce((s, r) => s + r.amountMinor, 0), 18_330);
    }
    // A second pass is idempotent.
    assert.deepEqual(await syncTreeContributions(), { allocated: 0, reversed: 0 });
    const concurrent = await Promise.all([syncTreeContributions(), syncTreeContributions(), syncTreeContributions()]);
    assert.ok(concurrent.every(r => r.allocated === 0 && r.reversed === 0));
  });

  it("rejects a team session even when its numeric ID collides with a customer", async () => {
    const response = await fetch(`${base}/uc/customer/tree`, {
      headers: { Authorization: `Bearer ${issueToken({ id: ids[0]!, email: emails[0]!, type: "team-session" })}` },
    });
    assert.equal(response.status, 401);
  });

  it("public forest GET and preflight are accessible without credentials; private tree is not", async () => {
    const origin = "https://forest.ucfilters.com";
    const response = await fetch(`${base}/uc/impact/forest`, { headers: { Origin: origin } });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Access-Control-Allow-Origin"), "*");
    assert.equal(response.headers.get("Access-Control-Allow-Credentials"), null);
    const options = await fetch(`${base}/uc/impact/forest`, {
      method: "OPTIONS", headers: { Origin: origin, "Access-Control-Request-Method": "GET" },
    });
    assert.equal(options.status, 204);
    assert.equal(options.headers.get("Access-Control-Allow-Origin"), "*");
    const privateResponse = await fetch(`${base}/uc/customer/tree`, { headers: { Origin: origin } });
    assert.equal(privateResponse.status, 401);
    assert.notEqual(privateResponse.headers.get("Access-Control-Allow-Origin"), "*");
  });

  it("shows the customer their own share and tree progress, but no co-funder data", async () => {
    const res = await fetch(`${base}/uc/customer/tree`, { headers: auth(0) });
    assert.equal(res.status, 200);
    const body = await res.json() as any;
    assert.equal(body.eligiblePurchasesKes, 12220);
    assert.equal(body.allocationKes, 366.6);
    assert.equal(body.treeShareKes, 183.3);
    assert.equal(body.cleanWaterKes, 183.3);
    assert.ok(body.tree);
    assert.ok(body.tree.yourShareKes > 0 && body.tree.yourShareKes <= 183.3);
    assert.ok(body.tree.fundedPct >= 0 && body.tree.fundedPct <= 100);
    const text = JSON.stringify(body);
    for (const leak of ["customerId", "customer_id", "members", "contributors", "coFunders", emails[1]!, "email"]) {
      assert.ok(!text.includes(leak), `response must not expose ${leak}`);
    }
    assert.equal((await fetch(`${base}/uc/customer/tree`)).status, 401);
  });

  it("reverses a slice when its purchase is no longer paid", async () => {
    await db.update(ucCanonicalPurchasesTable).set({ paymentStatus: "failed" })
      .where(eq(ucCanonicalPurchasesTable.id, purchaseIds[1]!));
    const r = await syncTreeContributions();
    assert.ok(r.reversed >= 1);
    const res = await fetch(`${base}/uc/customer/tree`, { headers: auth(1) });
    const body = await res.json() as any;
    assert.equal(body.eligiblePurchasesKes, 0);
    assert.equal(body.tree, null);
  });

  it("serves public forest totals readable from any origin", async () => {
    const res = await fetch(`${base}/uc/impact/forest`, { headers: { Origin: "https://forest.example.org" } });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("access-control-allow-origin"), "*");
    const body = await res.json() as any;
    assert.ok(body.appRevenueKes >= 12220);
    assert.equal(body.config.treeShare, 0.5);
    assert.equal(body.treeFundKes, body.cleanWaterKes);
    assert.ok(!JSON.stringify(body).includes("customer"));
  });
});
