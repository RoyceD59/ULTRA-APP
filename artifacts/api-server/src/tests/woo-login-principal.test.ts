/**
 * Regression tests for WooCommerce login principal identity.
 *
 * Previously the Woo success path minted every JWT with a hardcoded `id: 1`,
 * collapsing all Woo-authenticated users into one principal — and colliding
 * with uc_users serial id 1 (identity confusion / potential privilege
 * escalation via the DB-anchored admin check).
 *
 * Woo authentication is now retired. Password customers retain distinct,
 * stable database identities without any request to a configured Woo host;
 * ordinary customer sessions cannot acquire administration through provenance.
 *
 * Run with: pnpm --filter @workspace/api-server test
 */
import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { eq, inArray } from "drizzle-orm";
import { db, ucUsersTable } from "@workspace/db";
import bcryptjs from "bcryptjs";
import { authLimiter } from "../lib/rate-limiters.js";
import { verifyToken } from "../lib/jwt.js";

// ── Stub WordPress JWT endpoint ──────────────────────────────────────────────
// Mimics the wp-json/jwt-auth/v1/token response shape; echoes the username
// back as user_email like the real plugin does.
let wooStub: http.Server;
let server: http.Server;
const suffix = `${Date.now()}-${process.pid}`;
const wooEmails = {
  alice: `woo-alice-${suffix}@example.com`,
  bob: `woo-bob-${suffix}@example.com`,
  stable: `woo-stable-${suffix}@example.com`,
  nonadmin: `woo-nonadmin-${suffix}@example.com`,
  profile: `woo-profile-${suffix}@example.com`,
  password: `woo-password-${suffix}@example.com`,
};
let wooRequests = 0;
const originalWcBaseUrl = process.env["WC_BASE_URL"];

beforeEach(() => {
  authLimiter.resetKey("127.0.0.1");
  wooRequests = 0;
});

before(async () => {
  process.env["SESSION_SECRET"] ??= "test-secret-for-woo-principal-tests";
  const passwordHash = await bcryptjs.hash("woo-account-password",4);
  await db.insert(ucUsersTable).values(Object.entries(wooEmails)
    .filter(([name]) => name !== "password")
    .map(([,email]) => ({email,passwordHash,firstName:"Local",lastName:"Customer",authProvider:"password"})));

  wooStub = http.createServer((req, res) => {
    if (req.method === "POST" && req.url === "/wp-json/jwt-auth/v1/token") {
      wooRequests += 1;
      let raw = "";
      req.on("data", c => { raw += c; });
      req.on("end", () => {
        const body = JSON.parse(raw) as { username?: string };
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({
          token: "stub-wc-token",
          user_email: body.username ?? "",
          user_nicename: "stub",
          user_display_name: "Stub Customer",
        }));
      });
      return;
    }
    res.statusCode = 404;
    res.end("{}");
  });
  await new Promise<void>((resolve, reject) => {
    wooStub.listen(0, "127.0.0.1", (err?: Error) => (err ? reject(err) : resolve()));
  });
  const stubAddr = wooStub.address() as { port: number };
  process.env["WC_BASE_URL"] = `http://127.0.0.1:${stubAddr.port}`;

  const { default: app } = await import("../app.js");
  await new Promise<void>((resolve, reject) => {
    server = app.listen(0, "127.0.0.1", (err?: Error) => (err ? reject(err) : resolve()));
  });
});

after(async () => {
  if (originalWcBaseUrl === undefined) delete process.env["WC_BASE_URL"];
  else process.env["WC_BASE_URL"] = originalWcBaseUrl;
  await db.delete(ucUsersTable).where(inArray(ucUsersTable.email, [
    ...Object.values(wooEmails),
  ]));
  await new Promise<void>((resolve, reject) => server.close(e => (e ? reject(e) : resolve())));
  await new Promise<void>((resolve, reject) => wooStub.close(e => (e ? reject(e) : resolve())));
});

// ── Helpers ──────────────────────────────────────────────────────────────────
async function apiFetch(
  path: string,
  init: RequestInit = {}
): Promise<{ status: number; body: unknown }> {
  const addr = server.address() as { port: number };
  const res = await fetch(`http://localhost:${addr.port}${path}`, init);
  let body: unknown;
  try { body = await res.json(); } catch { body = null; }
  return { status: res.status, body };
}

async function wooLogin(email: string): Promise<{ token: string; user: { id: number; email: string } }> {
  const r = await apiFetch("/api/uc/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "woo-account-password" }),
  });
  assert.equal(r.status, 200, `database password login should succeed, got ${r.status}`);
  assert.equal(wooRequests,0,"configured retired Woo host must not be contacted");
  return r.body as { token: string; user: { id: number; email: string } };
}

// ── Tests ────────────────────────────────────────────────────────────────────
describe("App-owned principal identity with retired Woo credentials configured", () => {
  it("rejects a Woo password for an existing password account without changing its identity", async () => {
    const password = "companion-only-password";
    const [account] = await db.insert(ucUsersTable).values({
      email: wooEmails.password,
      passwordHash: await bcryptjs.hash(password, 10),
      firstName: "Password",
      lastName: "Customer",
      authProvider: "password",
    }).returning();
    assert.ok(account);

    const denied = await apiFetch("/api/uc/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: wooEmails.password, password: "woo-account-password" }),
    });
    assert.equal(denied.status, 401);
    assert.equal((denied.body as { token?: string }).token, undefined);
    assert.equal(wooRequests, 0, "a password mismatch must not fall back to Woo");
    const [unchanged] = await db.select().from(ucUsersTable)
      .where(eq(ucUsersTable.email, wooEmails.password));
    assert.deepEqual(unchanged, account, "denied login must not mutate the account");

    const accepted = await apiFetch("/api/uc/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: wooEmails.password, password }),
    });
    assert.equal(accepted.status, 200);
    const body = accepted.body as { token: string; user: { id: number } };
    assert.equal(body.user.id, account.id);
    assert.equal(verifyToken(`Bearer ${body.token}`)?.id, account.id);
    assert.equal(wooRequests, 0);
  });

  it("issues distinct database-backed Companion identities to password customers", async () => {
    const a = await wooLogin(wooEmails.alice);
    const b = await wooLogin(wooEmails.bob);
    assert.notEqual(a.user.id, b.user.id, "distinct users must not share a principal id");
    assert.ok(a.user.id > 0 && a.user.id < 1_000_000_000);
    assert.ok(b.user.id > 0 && b.user.id < 1_000_000_000);
  });

  it("gives the same password customer the same principal id across logins", async () => {
    const first = await wooLogin(wooEmails.stable);
    const second = await wooLogin(wooEmails.stable);
    assert.equal(first.user.id, second.user.id, "principal id must be stable per email");
    assert.equal(wooRequests, 0, "password login must not consult retired Woo credentials");
    const rows = await db.select().from(ucUsersTable)
      .where(eq(ucUsersTable.email, wooEmails.stable));
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.id, first.user.id);
    assert.equal(rows[0]!.authProvider, "password");
    assert.equal(rows[0]!.clerkUserId, null);
    for (const login of [first, second]) {
      const claims = verifyToken(`Bearer ${login.token}`);
      assert.equal(claims?.id, first.user.id);
      assert.notEqual(claims?.src, "woo");
    }
  });

  it("denies an ordinary password customer on /uc/admin/* routes", async () => {
    const { token } = await wooLogin(wooEmails.nonadmin);
    const r = await apiFetch("/api/uc/admin/products/1/media", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ url: "/objects/uploads/does-not-matter", kind: "photo" }),
    });
    assert.ok(
      r.status === 401 || r.status === 403,
      `admin route must deny Woo principals, got ${r.status}`
    );
  });

  it("never reports isAdmin: true for an ordinary password customer", async () => {
    const { token } = await wooLogin(wooEmails.profile);
    const r = await apiFetch("/api/uc/customer/profile", {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(r.status, 200);
    const profile = r.body as { isAdmin?: boolean };
    assert.notEqual(profile.isAdmin, true, "Woo principal must never resolve as admin");
  });

  it("lets a password customer explicitly create and then read a stable QR token", async () => {
    const { token, user } = await wooLogin(wooEmails.alice);
    const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
    const first = await apiFetch("/api/uc/customer/rewards", {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(first.status, 200);
    assert.equal((first.body as { qrToken: string | null }).qrToken, null, "a read must not issue credentials");
    const inspected = await apiFetch("/api/uc/customer/rewards/qr/validate", {
      method: "POST", headers, body: JSON.stringify({ qrToken: null }),
    });
    assert.equal(inspected.status, 200);
    assert.equal((inspected.body as { userId: number }).userId, user.id);
    const recovered = await apiFetch("/api/uc/customer/rewards/qr/rotate", {
      method: "POST", headers,
      body: JSON.stringify({ expectedVersion: (inspected.body as { version: string | null }).version }),
    });
    assert.equal(recovered.status, 200);
    const qrToken = (recovered.body as { qrToken: string; userId: number }).qrToken;
    assert.equal((recovered.body as { userId: number }).userId, user.id);
    assert.match(qrToken, /^[A-Za-z0-9_-]{43}$/);

    const repeat = await wooLogin(wooEmails.alice);
    assert.equal(repeat.user.id, user.id);
    const second = await apiFetch("/api/uc/customer/rewards", {
      headers: { Authorization: `Bearer ${repeat.token}` },
    });
    assert.equal(second.status, 200);
    assert.equal((second.body as { qrToken: string }).qrToken, qrToken);
  });
});
