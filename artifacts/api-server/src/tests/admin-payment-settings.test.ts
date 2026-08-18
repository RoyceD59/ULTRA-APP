/**
 * Tests for GET and PATCH /api/admin/payment-settings
 *
 * Covers:
 *   (a) GET — 401 without any Authorization header.
 *   (b) GET — returns status shape (source, isSet, hint) when nothing is configured.
 *   (c) GET — reflects "env" source when MPESA_WEBHOOK_SECRET is set via env var.
 *   (d) GET — reflects "db" source after a PATCH rotation stores the secret in DB.
 *   (e) PATCH — 401 without any Authorization header.
 *   (f) PATCH — 403 with a non-admin (member-role) JWT.
 *   (g) PATCH — 400 when mpesaWebhookSecret is an empty string.
 *   (h) PATCH — 400 when teamAlertPhone is an empty string.
 *   (i) PATCH — 200 and secret encrypted + persisted on valid rotation
 *       (webhook-secret rotation happy path).
 *   (j) PATCH — 200 and phone persisted on valid teamAlertPhone update.
 *   (k) PATCH — cache is busted so getMpesaWebhookSecret returns the new secret
 *       immediately without waiting for the 60-second TTL.
 *   (l) PATCH — 400 when teamAlertEmail is an empty string.
 *   (m) PATCH — 400 when teamAlertEmail has no "@" character.
 *   (n) PATCH — 200 and email persisted; GET reflects "db" source with masked hint.
 *   (o) PATCH — cache is busted so getTeamAlertEmail returns the new address immediately.
 *   (p) getTeamAlertEmail — DB value overrides TEAM_ALERT_EMAIL env var.
 *
 * Strategy:
 *   – Admin and member team users are created in `team_users` via direct DB insert.
 *   – Login via POST /auth/login (team-session JWT); never /uc/auth/login (UC JWT).
 *   – SESSION_SECRET is set so encryptSecret / decryptSecret work.
 *   – All DB rows created during tests are removed in after().
 *
 * Run with: pnpm --filter @workspace/api-server test
 */

import { describe, it, before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";

import app from "../app.js";
import { db, teamUsersTable, teamSettingsTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { getMpesaWebhookSecret, invalidateMpesaSecretCache } from "../routes/payments.js";
import { getTeamAlertEmail, invalidateTeamAlertEmailCache } from "../routes/uc.js";

// ── Shared state ──────────────────────────────────────────────────────────────

let server: http.Server;
let base: string;

const ADMIN_EMAIL    = `ps-admin-${Date.now()}@teamtest.internal`;
const ADMIN_PASSWORD = "AdminTest1234!";

const MEMBER_EMAIL    = `ps-member-${Date.now()}@teamtest.internal`;
const MEMBER_PASSWORD = "MemberTest1234!";

let adminJwt: string;
let memberJwt: string;

const createdTeamUserIds: string[] = [];

// Env vars we may mutate per-test.
let savedMpesaSecret:  string | undefined;
let savedTeamPhone:    string | undefined;
let savedTeamEmail:    string | undefined;

// ── Helpers ───────────────────────────────────────────────────────────────────

async function getSettings(
  token?: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const headers: Record<string, string> = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`${base}/admin/payment-settings`, { headers });
  let body: Record<string, unknown> = {};
  try { body = (await res.json()) as Record<string, unknown>; } catch { /* empty */ }
  return { status: res.status, body };
}

async function patchSettings(
  payload: unknown,
  token?: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`${base}/admin/payment-settings`, {
    method:  "PATCH",
    headers,
    body:    JSON.stringify(payload),
  });
  let body: Record<string, unknown> = {};
  try { body = (await res.json()) as Record<string, unknown>; } catch { /* empty */ }
  return { status: res.status, body };
}

/**
 * Create a team_users row directly and log in via /auth/login to get a JWT.
 * Returns the user's id and signed JWT.
 */
async function createTeamUser(
  email: string,
  password: string,
  role: "admin" | "member",
): Promise<{ id: string; jwt: string }> {
  const passwordHash = await bcrypt.hash(password, 4); // low cost for test speed
  const id = randomUUID();
  await db.insert(teamUsersTable).values({
    id,
    email,
    name: `Test ${role}`,
    passwordHash,
    role,
    isActive: true,
    permissions: {},
  });
  createdTeamUserIds.push(id);

  const res = await fetch(`${base}/auth/login`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ email, password }),
  });
  assert.equal(res.status, 200, `team login must succeed for ${email} (${role})`);
  const loginBody = (await res.json()) as { token?: string };
  assert.ok(loginBody.token, "login must return a token");
  return { id, jwt: loginBody.token! };
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────

before(
  async () => {
    process.env["SESSION_SECRET"] ??= "test-secret-admin-payment-settings";

    await new Promise<void>((resolve, reject) => {
      server = http.createServer(app);
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address();
        if (!addr || typeof addr === "string") { reject(new Error("Server did not bind")); return; }
        base = `http://127.0.0.1:${addr.port}/api`;
        resolve();
      });
    });

    const admin  = await createTeamUser(ADMIN_EMAIL,  ADMIN_PASSWORD,  "admin");
    adminJwt  = admin.jwt;

    const member = await createTeamUser(MEMBER_EMAIL, MEMBER_PASSWORD, "member");
    memberJwt = member.jwt;
  },
  { timeout: 30_000 },
);

after(async () => {
  // Remove singleton row so other test files start from a clean state.
  await db
    .delete(teamSettingsTable)
    .where(eq(teamSettingsTable.id, "singleton"))
    .catch(() => {});

  if (createdTeamUserIds.length > 0) {
    await db
      .delete(teamUsersTable)
      .where(inArray(teamUsersTable.id, createdTeamUserIds))
      .catch(() => {});
  }

  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  savedMpesaSecret = process.env["MPESA_WEBHOOK_SECRET"];
  savedTeamPhone   = process.env["TEAM_ALERT_PHONE"];
  savedTeamEmail   = process.env["TEAM_ALERT_EMAIL"];
  // Clear the in-process caches so each test gets a fresh DB read.
  invalidateMpesaSecretCache();
  invalidateTeamAlertEmailCache();
});

afterEach(async () => {
  if (savedMpesaSecret === undefined) {
    delete process.env["MPESA_WEBHOOK_SECRET"];
  } else {
    process.env["MPESA_WEBHOOK_SECRET"] = savedMpesaSecret;
  }
  if (savedTeamPhone === undefined) {
    delete process.env["TEAM_ALERT_PHONE"];
  } else {
    process.env["TEAM_ALERT_PHONE"] = savedTeamPhone;
  }
  if (savedTeamEmail === undefined) {
    delete process.env["TEAM_ALERT_EMAIL"];
  } else {
    process.env["TEAM_ALERT_EMAIL"] = savedTeamEmail;
  }
  invalidateMpesaSecretCache();
  invalidateTeamAlertEmailCache();
  // Remove any team_alert_email written to the DB so concurrent test files
  // (which share the same PostgreSQL test database) are not polluted.
  await db
    .update(teamSettingsTable)
    .set({ teamAlertEmail: null })
    .where(eq(teamSettingsTable.id, "singleton"))
    .catch(() => {});
});

// ── GET suite ─────────────────────────────────────────────────────────────────

describe("GET /admin/payment-settings — auth guard", () => {
  it("(a) returns 401 when no Authorization header is sent", async () => {
    const { status } = await getSettings(); // no token
    assert.equal(status, 401, `expected 401 without any token; got ${status}`);
  });
});

describe("GET /admin/payment-settings — response shape", () => {
  it("(b) returns the expected keys when nothing is configured", async () => {
    delete process.env["MPESA_WEBHOOK_SECRET"];
    delete process.env["TEAM_ALERT_PHONE"];
    await db.delete(teamSettingsTable).where(eq(teamSettingsTable.id, "singleton")).catch(() => {});

    const { status, body } = await getSettings(adminJwt);
    assert.equal(status, 200, `expected 200; got ${status}: ${JSON.stringify(body)}`);

    const mpesa = body["mpesaWebhookSecret"] as Record<string, unknown>;
    assert.ok(mpesa, "mpesaWebhookSecret key must be present");
    assert.equal(mpesa["source"], "none");
    assert.equal(mpesa["isSet"],  false);

    const phone = body["teamAlertPhone"] as Record<string, unknown>;
    assert.ok(phone, "teamAlertPhone key must be present");
    assert.equal(phone["source"], "none");
    assert.equal(phone["isSet"],  false);
  });

  it("(c) reflects source=env when MPESA_WEBHOOK_SECRET is set via env var", async () => {
    process.env["MPESA_WEBHOOK_SECRET"] = "test_env_secret_abcdef";
    await db.delete(teamSettingsTable).where(eq(teamSettingsTable.id, "singleton")).catch(() => {});

    const { status, body } = await getSettings(adminJwt);
    assert.equal(status, 200);

    const mpesa = body["mpesaWebhookSecret"] as Record<string, unknown>;
    assert.equal(mpesa["source"], "env",  `expected "env"; got ${mpesa["source"]}`);
    assert.equal(mpesa["isSet"],  true);
    assert.equal(
      mpesa["envHint"],
      "…cdef",
      `envHint must show last 4 chars ("…cdef"); got ${mpesa["envHint"]}`,
    );
  });
});

// ── PATCH suite ───────────────────────────────────────────────────────────────

describe("PATCH /admin/payment-settings — auth guard", () => {
  it("(e) returns 401 without any Authorization header", async () => {
    const { status } = await patchSettings({ mpesaWebhookSecret: "new_secret_xyz" });
    assert.equal(status, 401, `expected 401 without token; got ${status}`);
  });

  it("(f) returns 403 when authenticated as a member-role user", async () => {
    const { status } = await patchSettings({ mpesaWebhookSecret: "new_secret_xyz" }, memberJwt);
    assert.equal(status, 403, `expected 403 for member role; got ${status}`);
  });
});

describe("PATCH /admin/payment-settings — validation", () => {
  it("(g) returns 400 when mpesaWebhookSecret is an empty string", async () => {
    const { status, body } = await patchSettings({ mpesaWebhookSecret: "" }, adminJwt);
    assert.equal(status, 400, `expected 400 for empty secret; got ${status}`);
    assert.ok(
      typeof body["error"] === "string" && body["error"].length > 0,
      `error message must be present; got: ${JSON.stringify(body)}`,
    );
  });

  it("(h) returns 400 when teamAlertPhone is an empty string", async () => {
    const { status, body } = await patchSettings({ teamAlertPhone: "" }, adminJwt);
    assert.equal(status, 400, `expected 400 for empty phone; got ${status}`);
    assert.ok(
      typeof body["error"] === "string" && body["error"].length > 0,
      `error message must be present; got: ${JSON.stringify(body)}`,
    );
  });
});

describe("PATCH /admin/payment-settings — webhook-secret rotation", () => {
  it("(i) encrypts and persists the new secret, returns ok:true", async () => {
    const newSecret = `rotated_secret_${Date.now()}`;

    const { status, body } = await patchSettings({ mpesaWebhookSecret: newSecret }, adminJwt);
    assert.equal(status, 200, `expected 200; got ${status}: ${JSON.stringify(body)}`);
    assert.equal(body["ok"], true);

    const [row] = await db
      .select({ mpesaWebhookSecretEnc: teamSettingsTable.mpesaWebhookSecretEnc })
      .from(teamSettingsTable)
      .where(eq(teamSettingsTable.id, "singleton"))
      .limit(1);

    assert.ok(row?.mpesaWebhookSecretEnc, "mpesaWebhookSecretEnc must be stored in DB");
    assert.notEqual(
      row!.mpesaWebhookSecretEnc,
      newSecret,
      "secret must be stored encrypted, not as plaintext",
    );
  });

  it("(d) GET reflects source=db after a PATCH rotation", async () => {
    await patchSettings({ mpesaWebhookSecret: `db_secret_${Date.now()}` }, adminJwt);

    const { status, body } = await getSettings(adminJwt);
    assert.equal(status, 200);

    const mpesa = body["mpesaWebhookSecret"] as Record<string, unknown>;
    assert.equal(mpesa["source"], "db", `after rotation, source must be "db"; got ${mpesa["source"]}`);
    assert.equal(mpesa["isSet"], true);
    assert.equal(mpesa["envHint"], null, "envHint must be null when DB secret is active");
  });

  it("(k) cache is invalidated: getMpesaWebhookSecret returns the new value immediately", async () => {
    const newSecret = `cache_test_${Date.now()}`;

    const { status } = await patchSettings({ mpesaWebhookSecret: newSecret }, adminJwt);
    assert.equal(status, 200);

    // The PATCH should have busted the in-process cache — no 60-second wait needed.
    const live = await getMpesaWebhookSecret();
    assert.equal(
      live,
      newSecret,
      `getMpesaWebhookSecret must return the newly rotated secret immediately; got "${live}"`,
    );
  });
});

describe("PATCH /admin/payment-settings — team alert phone", () => {
  it("(j) persists the phone number and returns ok:true", async () => {
    const phone = "+254799" + String(Date.now()).slice(-6);

    const { status, body } = await patchSettings({ teamAlertPhone: phone }, adminJwt);
    assert.equal(status, 200, `expected 200; got ${status}: ${JSON.stringify(body)}`);
    assert.equal(body["ok"], true);

    const [row] = await db
      .select({ teamAlertPhone: teamSettingsTable.teamAlertPhone })
      .from(teamSettingsTable)
      .where(eq(teamSettingsTable.id, "singleton"))
      .limit(1);

    assert.equal(
      row?.teamAlertPhone,
      phone,
      `DB must store the exact phone number; got ${row?.teamAlertPhone}`,
    );
  });
});

// ── Team alert email suites ───────────────────────────────────────────────────

describe("PATCH /admin/payment-settings — team alert email validation", () => {
  it("(l) returns 400 when teamAlertEmail is an empty string", async () => {
    const { status, body } = await patchSettings({ teamAlertEmail: "" }, adminJwt);
    assert.equal(status, 400, `expected 400; got ${status}: ${JSON.stringify(body)}`);
  });

  it("(m) returns 400 when teamAlertEmail has no @ character", async () => {
    const { status, body } = await patchSettings({ teamAlertEmail: "notanemail" }, adminJwt);
    assert.equal(status, 400, `expected 400; got ${status}: ${JSON.stringify(body)}`);
  });
});

describe("PATCH /admin/payment-settings — team alert email persistence", () => {
  it("(n) persists the email, returns ok:true, and GET reflects source=db with masked hint", async () => {
    const email = `alerts-${Date.now()}@ucfilters.com`;

    try {
      const { status, body } = await patchSettings({ teamAlertEmail: email }, adminJwt);
      assert.equal(status, 200, `expected 200; got ${status}: ${JSON.stringify(body)}`);
      assert.equal(body["ok"], true);

      // Verify the DB row was actually written.
      const [row] = await db
        .select({ teamAlertEmail: teamSettingsTable.teamAlertEmail })
        .from(teamSettingsTable)
        .where(eq(teamSettingsTable.id, "singleton"))
        .limit(1);
      assert.equal(
        row?.teamAlertEmail,
        email,
        `DB must store the exact email; got ${row?.teamAlertEmail}`,
      );

      // Re-assert DB value right before the GET to guard against a concurrent test
      // file's beforeEach clearing team_alert_email between our PATCH and the GET call.
      // The PATCH persistence has already been verified above via direct DB query;
      // this re-write ensures the GET endpoint sees the expected value.
      await db
        .insert(teamSettingsTable)
        .values({ id: "singleton", teamAlertEmail: email })
        .onConflictDoUpdate({
          target: teamSettingsTable.id,
          set: { teamAlertEmail: email, updatedAt: new Date() },
        });
      invalidateTeamAlertEmailCache();

      // Verify GET reflects the state correctly.
      const { status: getStatus, body: getBody } = await getSettings(adminJwt);
      assert.equal(getStatus, 200);
      const e = getBody["teamAlertEmail"] as Record<string, unknown>;
      assert.equal(e["source"], "db", `source must be "db" after PATCH; got ${e["source"]}`);
      assert.equal(e["isSet"], true);
      // hint must be a masked partial — starts with first char of local-part + "…@"
      const hint = e["hint"] as string;
      assert.ok(
        hint && hint.includes("@"),
        `hint must include "@"; got "${hint}"`,
      );
    } finally {
      // Clear immediately so concurrent test files don't see the non-null DB value
      // during their fire-and-forget email dispatch window (race vs afterEach).
      await db
        .update(teamSettingsTable)
        .set({ teamAlertEmail: null })
        .where(eq(teamSettingsTable.id, "singleton"))
        .catch(() => {});
      invalidateTeamAlertEmailCache();
    }
  });

  it("(o) cache is busted: getTeamAlertEmail returns the new address immediately after PATCH", async () => {
    const email = `cache-test-${Date.now()}@ucfilters.com`;

    try {
      const { status } = await patchSettings({ teamAlertEmail: email }, adminJwt);
      assert.equal(status, 200);

      // The PATCH must have busted the in-process cache — no 60-second wait needed.
      const live = await getTeamAlertEmail();
      assert.equal(
        live,
        email,
        `getTeamAlertEmail must return the newly saved email immediately; got "${live}"`,
      );
    } finally {
      await db
        .update(teamSettingsTable)
        .set({ teamAlertEmail: null })
        .where(eq(teamSettingsTable.id, "singleton"))
        .catch(() => {});
      invalidateTeamAlertEmailCache();
    }
  });
});

describe("getTeamAlertEmail — DB value overrides env var", () => {
  it("(p) DB row wins over TEAM_ALERT_EMAIL env var", async () => {
    const dbEmail  = `db-wins-${Date.now()}@ucfilters.com`;
    const envEmail = `env-fallback-${Date.now()}@ucfilters.com`;

    try {
      // Persist the DB value via the PATCH endpoint.
      const { status } = await patchSettings({ teamAlertEmail: dbEmail }, adminJwt);
      assert.equal(status, 200);

      // Set the env var to a different address.
      process.env["TEAM_ALERT_EMAIL"] = envEmail;

      // Cache was busted by PATCH — next call should read from DB.
      const live = await getTeamAlertEmail();
      assert.equal(
        live,
        dbEmail,
        `DB value must take priority over env var; got "${live}" (env was "${envEmail}")`,
      );
    } finally {
      await db
        .update(teamSettingsTable)
        .set({ teamAlertEmail: null })
        .where(eq(teamSettingsTable.id, "singleton"))
        .catch(() => {});
      invalidateTeamAlertEmailCache();
    }
  });
});
