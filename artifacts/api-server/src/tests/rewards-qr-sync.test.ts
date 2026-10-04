import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { randomUUID, randomBytes } from "node:crypto";
import { db, pool, ucUsersTable, ucRewardsLedgerTable, ucRegisteredFiltersTable, ucWaterImpactLedgerTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import app from "../app.js";
import { issueToken } from "../lib/jwt.js";
import { hashQrToken } from "../lib/rewards-qr.js";
import bcrypt from "bcryptjs";

const realFetch = globalThis.fetch;
type Account = typeof ucUsersTable.$inferSelect;
let server: http.Server, base: string, admin: Account, accounts: Account[];
const ids: number[] = [];
const tag = randomUUID();
function headers(user: Account, overrides: Record<string, unknown> = {}) {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${issueToken({ id: user.id, email: user.email, credentialVersion: user.credentialVersion, ...overrides })}`,
  };
}
async function call(path: string, user: Account, body?: unknown, overrides: Record<string, unknown> = {}) {
  const response = await realFetch(`${base}/api${path}`, {
    method: body === undefined ? "GET" : "POST", headers: headers(user, overrides),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() as any, cache: response.headers.get("cache-control") };
}
async function inspect(user: Account, qrToken: string | null = null) {
  return call("/uc/customer/rewards/qr/validate", user, { qrToken });
}
async function recover(user: Account, version: string | null) {
  return call("/uc/customer/rewards/qr/rotate", user, { expectedVersion: version });
}
async function resolve(user: Account, token: string) {
  return call("/uc/admin/rewards/resolve", user, { lookup: `uc-rewards:v1:${token}` });
}

describe("account QR synchronization across Companion and ProjectHub", () => {
  before(async () => {
    // Harness supplies an isolated DATABASE_URL; never run this file directly.
    assert.match(new URL(process.env.DATABASE_URL!).pathname, /test_api_/);
    process.env.SESSION_SECRET ??= "qr-sync-test-key";
    const rows = await db.insert(ucUsersTable).values([
      { email: `qr-admin-${tag}@test.invalid`, firstName: "QRAdmin", passwordHash: "!fixture", isAdmin: true },
      { email: `qr-password-${tag}@test.invalid`, firstName: "Password", passwordHash: await bcrypt.hash("qr-fixture-password", 4), authProvider: "password" },
      { email: `qr-woo-${tag}@test.invalid`, firstName: "Woo", passwordHash: "!woocommerce-no-password", authProvider: "woocommerce" },
      { email: `qr-social-${tag}@test.invalid`, firstName: "Social", passwordHash: "!social-login-no-password", authProvider: "social", clerkUserId: `qr-clerk-${tag}` },
      { email: `qr-legacy-${tag}@test.invalid`, firstName: "Legacy", passwordHash: "!fixture" },
    ]).returning();
    admin = rows[0]!;
    accounts = rows.slice(1);
    ids.push(...rows.map(row => row.id));
    server = http.createServer(app);
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });
  after(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()));
    await db.delete(ucWaterImpactLedgerTable).where(inArray(ucWaterImpactLedgerTable.userId, ids));
    await db.delete(ucRegisteredFiltersTable).where(inArray(ucRegisteredFiltersTable.userId, ids));
    await db.delete(ucRewardsLedgerTable).where(inArray(ucRewardsLedgerTable.userId, ids));
    await db.delete(ucUsersTable).where(inArray(ucUsersTable.id, ids));
  });

  it("read-only first load never issues tokens for any canonical auth-provider account", async () => {
    for (const user of accounts) {
      const first = await call("/uc/customer/rewards", user);
      assert.equal(first.status, 200);
      assert.equal(first.body.qrToken, null);
      const state = await inspect(user);
      assert.equal(state.body.status, "missing");
      assert.equal(state.cache, "no-store");
      const [stored] = await db.select().from(ucUsersTable).where(eq(ucUsersTable.id, user.id));
      assert.equal(stored!.rewardsQrHash, null);
    }
  });
  it("a password sign-in keeps the canonical QR account identity", async () => {
    const user = accounts[0]!;
    const login = await realFetch(`${base}/api/uc/auth/login`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: user.email, password: "qr-fixture-password" }),
    });
    assert.equal(login.status, 200);
    const credentials = await login.json() as { token: string; user: { id: number } };
    assert.equal(credentials.user.id, user.id);
    const qr = await realFetch(`${base}/api/uc/customer/rewards/qr/validate`, {
      method: "POST", headers: { Authorization: `Bearer ${credentials.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ qrToken: null }),
    });
    assert.equal((await qr.json() as { userId: number }).userId, user.id);
  });
  it("simultaneous first issuance converges, and every provider's full QR resolves to its own customer", async () => {
    for (const user of accounts) {
      const requests = await Promise.all(Array.from({ length: 5 }, () => recover(user, null)));
      assert.ok(requests.every(result => result.status === 200));
      assert.equal(new Set(requests.map(result => result.body.qrToken)).size, 1);
      const token = requests[0]!.body.qrToken;
      assert.match(token, /^[A-Za-z0-9_-]{43}$/);
      assert.equal(requests[0]!.body.userId, user.id);
      const staff = await resolve(admin, token);
      assert.equal(staff.status, 200);
      assert.equal(staff.body.customer.id, user.id);
      const current = await inspect(user, token);
      assert.equal(current.body.valid, true);
      // A second device needs no stored plaintext and does not rotate.
      assert.equal((await inspect(user)).body.qrToken, token);
      assert.equal((await call("/uc/customer/rewards", user)).body.qrToken, token);
      const [stored] = await db.select().from(ucUsersTable).where(eq(ucUsersTable.id, user.id));
      assert.equal(stored!.rewardsQrHash, hashQrToken(token));
      assert.notEqual(stored!.rewardsQrNonce, token);
      assert.ok(!JSON.stringify(stored).includes(token));
    }
  });
  it("validates legacy hash-only tokens without rotating, but offers deliberate recovery if storage is lost", async () => {
    const user = accounts[3]!;
    const token = randomBytes(32).toString("base64url");
    await db.update(ucUsersTable).set({ rewardsQrHash: hashQrToken(token), rewardsQrNonce: null }).where(eq(ucUsersTable.id, user.id));
    const valid = await inspect(user, token);
    assert.equal(valid.body.valid, true);
    assert.equal(valid.body.qrToken, null);
    assert.equal((await resolve(admin, token)).body.customer.id, user.id);
    const lost = await inspect(user);
    assert.equal(lost.body.valid, false);
    assert.equal(lost.body.status, "active");
    assert.equal((await recover(user, lost.body.version)).status, 200);
    assert.equal((await resolve(admin, token)).status, 404);
  });
  it("revocation overrides local candidates and all read refreshes; concurrent recovery creates one replacement", async () => {
    const user = accounts[0]!;
    const previous = (await inspect(user)).body;
    const revoked = await call("/uc/admin/rewards/qr/revoke", admin, { lookup: `uc-rewards:v1:${previous.qrToken}` });
    assert.equal(revoked.status, 200);
    const state = await inspect(user, previous.qrToken);
    assert.equal(state.body.valid, false);
    assert.equal(state.body.status, "revoked");
    assert.equal(state.body.qrToken, null);
    await Promise.all(Array.from({ length: 4 }, () => call("/uc/customer/rewards", user)));
    assert.equal((await inspect(user)).body.status, "revoked");
    assert.equal((await resolve(admin, previous.qrToken)).status, 404);
    const recovery = await Promise.all(Array.from({ length: 4 }, () => recover(user, state.body.version)));
    assert.equal(new Set(recovery.map(result => result.body.qrToken)).size, 1);
    assert.notEqual(recovery[0]!.body.qrToken, previous.qrToken);
    assert.equal((await resolve(admin, recovery[0]!.body.qrToken)).body.customer.id, user.id);
  });
  it("cross-device explicit rotation invalidates the old token; a stale recovery cannot rotate twice", async () => {
    const user = accounts[1]!;
    const previous = (await inspect(user)).body;
    const updated = await recover(user, previous.version);
    const stale = await recover(user, previous.version);
    assert.equal(stale.body.qrToken, updated.body.qrToken);
    const reread = await inspect(user, previous.qrToken);
    assert.equal(reread.body.valid, false);
    assert.equal(reread.body.qrToken, updated.body.qrToken);
    assert.equal((await resolve(admin, previous.qrToken)).status, 404);
  });
  it("rejects malformed/full-payload candidates, stale sessions, missing users, cross-account candidates and non-admin scans", async () => {
    const user = accounts[0]!;
    const other = accounts[1]!;
    const token = (await inspect(user)).body.qrToken;
    assert.equal((await inspect(other, token)).body.valid, false);
    assert.notEqual((await inspect(other, token)).body.qrToken, token);
    assert.equal((await inspect(user, "corrupt")).status, 400);
    assert.equal((await inspect(user, `uc-rewards:v1:${token}`)).status, 400);
    assert.equal((await call("/uc/customer/rewards/qr/rotate", user, {})).status, 400);
    assert.equal((await call("/uc/customer/rewards/qr/validate", user, { qrToken: null }, { exp: 1 })).status, 401);
    assert.equal((await call("/uc/customer/rewards/qr/validate", user, { qrToken: null }, { credentialVersion: 999 })).status, 401);
    assert.equal((await call("/uc/customer/rewards/qr/validate", user, { qrToken: null }, { id: 999999998 })).status, 401);
    assert.equal((await resolve(user, token)).status, 401);
    const response = await realFetch(`${base}/api/uc/customer/rewards/qr/validate`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ qrToken: token }),
    });
    assert.equal(response.status, 401);
  });
  it("shows the same ledger balance and personal impact in customer rewards and staff QR resolution", async () => {
    const user = accounts[2]!;
    await db.insert(ucRewardsLedgerTable).values([
      { userId: user.id, points: 1200, eventType: "manual", reason: "QR fixture award", refId: tag, grantedBy: "fixture" },
      { userId: user.id, points: -200, eventType: "redemption", reason: "QR fixture redemption", refId: `${tag}-redeem`, grantedBy: "fixture" },
    ]);
    const [filter] = await db.insert(ucRegisteredFiltersTable).values({
      userId: user.id, productId: 99001, productName: "QR fixture filter", ratedCapacityLitres: 150, activatedAt: new Date(), source: "legacy",
    }).returning();
    await db.insert(ucWaterImpactLedgerTable).values({
      userId: user.id, registeredFilterId: filter!.id, litres: 25, reason: "QR fixture refill", actor: "fixture", idempotencyKey: tag,
    });
    const token = (await inspect(user)).body.qrToken;
    const customer = await call("/uc/customer/rewards", user);
    const staff = await resolve(admin, token);
    assert.equal(customer.body.balance, 1000);
    assert.equal(staff.body.balance, customer.body.balance);
    assert.equal(staff.body.lifetimeRedeemed, customer.body.lifetimeRedeemed);
    assert.deepEqual(staff.body.impact, customer.body.impact);
    assert.equal(customer.body.impact.totalLitres, 25);
    const award = await call("/uc/admin/rewards/grant", admin, {
      lookup: `uc-rewards:v1:${token}`, points: 125, reason: "QR fixture staff award", grantedBy: "fixture",
    });
    assert.equal(award.status, 201);
    const refill = await call("/uc/admin/rewards/impact", admin, {
      lookup: `uc-rewards:v1:${token}`, registeredFilterId: filter!.id, litres: 10,
      reason: "QR fixture staff refill", idempotencyKey: `${tag}-staff`,
    });
    assert.equal(refill.status, 201);
    const refreshed = await call("/uc/customer/rewards", user);
    const reread = await call("/uc/customer/rewards", user);
    const staffRefreshed = await resolve(admin, token);
    assert.equal(refreshed.body.balance, 1125);
    assert.equal(refreshed.body.impact.totalLitres, 35);
    assert.deepEqual(reread.body, refreshed.body);
    assert.equal(staffRefreshed.body.balance, refreshed.body.balance);
    assert.deepEqual(staffRefreshed.body.impact, refreshed.body.impact);
  });
  it("deleted accounts cannot validate, recover, or resolve a previously working code", async () => {
    const user = accounts[3]!;
    const token = (await inspect(user)).body.qrToken;
    await pool.query("UPDATE uc_users SET deleted_at=now() WHERE id=$1", [user.id]);
    assert.equal((await inspect(user, token)).status, 401);
    assert.equal((await recover(user, null)).status, 401);
    assert.equal((await resolve(admin, token)).status, 404);
  });
});