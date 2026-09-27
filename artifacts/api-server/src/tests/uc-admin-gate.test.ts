/**
 * UC admin gate (lib/adminAuth.ts isAdminRequest) — provenance + team-session.
 *
 * Regression tests for the fix that let admins into UC Impact from ProjectHub:
 *   1. A Woo-authenticated user whose (Woo-verified) email is on
 *      UC_ADMIN_EMAILS passes admin endpoints.
 *   2. A Woo-authenticated user NOT on the allowlist is rejected.
 *   3. A dev ephemeral-login token is rejected EVEN IF its email is on the
 *      allowlist (it lacks the src:"woo" provenance claim).
 *   4. A ProjectHub team-session token with a live team_users admin row passes.
 *   5. A team-session token whose DB row is role:"member" is rejected even if
 *      the JWT itself claims role:"admin" (role re-verified against the DB).
 *   6. An inactive team admin and an unknown team id are rejected.
 *   7. DB outage during the team lookup fails closed (401).
 *   8. The impact-override endpoint honours the same gate.
 *
 * Run with: TEST_GLOB='src/tests/uc-admin-gate.test.ts' pnpm test
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { db, teamUsersTable } from "@workspace/db";
import { inArray } from "drizzle-orm";
import { issueToken } from "../lib/jwt.js";

const WOO_ADMIN    = "gate-admin@ucfilters.com";      // on UC_ADMIN_EMAILS
const WOO_NONADMIN = "gate-nonadmin@example.com";     // NOT on the list
const DEV_EMAIL    = "gate-devfallback@ucfilters.com"; // on the list, but Woo stub rejects it

const TEAM_ADMIN_ID    = "test-uc-gate-team-admin";
const TEAM_MEMBER_ID   = "test-uc-gate-team-member";
const TEAM_EDITOR_ID   = "test-uc-gate-team-editor";
const TEAM_INACTIVE_ID = "test-uc-gate-team-inactive";
const TEAM_IDS = [TEAM_ADMIN_ID, TEAM_MEMBER_ID, TEAM_EDITOR_ID, TEAM_INACTIVE_ID];

let wooStub: http.Server;
let server: http.Server;
let savedAdminEmails: string | undefined;

before(async () => {
  process.env["SESSION_SECRET"] ??= "test-secret-for-uc-admin-gate";
  savedAdminEmails = process.env["UC_ADMIN_EMAILS"];
  process.env["UC_ADMIN_EMAILS"] = ` ${WOO_ADMIN.toUpperCase()}, ${DEV_EMAIL} `;

  // Woo stub: issues a token for anyone EXCEPT the dev-fallback email, which
  // it rejects so the login route falls through to the ephemeral dev session.
  wooStub = http.createServer((req, res) => {
    if (req.method === "POST" && req.url === "/wp-json/jwt-auth/v1/token") {
      let raw = "";
      req.on("data", c => { raw += c; });
      req.on("end", () => {
        const body = JSON.parse(raw) as { username?: string };
        res.setHeader("Content-Type", "application/json");
        if (body.username === DEV_EMAIL) {
          res.statusCode = 403;
          res.end(JSON.stringify({ code: "[jwt_auth] invalid_credentials" }));
          return;
        }
        res.end(JSON.stringify({
          token: "stub-wc-token",
          user_email: body.username ?? "",
          user_display_name: "Gate Tester",
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

  // Seed team_users rows the gate must consult.
  await db.insert(teamUsersTable).values([
    { id: TEAM_ADMIN_ID,    email: "gate-team-admin@test.internal",    name: "Gate Admin",    passwordHash: "x", role: "admin",  isActive: true },
    { id: TEAM_MEMBER_ID,   email: "gate-team-member@test.internal",   name: "Gate Member",   passwordHash: "x", role: "member", isActive: true },
    { id: TEAM_EDITOR_ID,   email: "gate-team-editor@test.internal",   name: "Gate Editor",   passwordHash: "x", role: "member", isActive: true, permissions: { impact: "edit" } },
    { id: TEAM_INACTIVE_ID, email: "gate-team-inactive@test.internal", name: "Gate Inactive", passwordHash: "x", role: "admin",  isActive: false },
  ]);

  const { default: app } = await import("../app.js");
  await new Promise<void>((resolve, reject) => {
    server = app.listen(0, "127.0.0.1", (err?: Error) => (err ? reject(err) : resolve()));
  });
});

after(async () => {
  delete process.env["WC_BASE_URL"];
  if (savedAdminEmails !== undefined) process.env["UC_ADMIN_EMAILS"] = savedAdminEmails;
  else delete process.env["UC_ADMIN_EMAILS"];
  try { await db.delete(teamUsersTable).where(inArray(teamUsersTable.id, TEAM_IDS)); } catch { /* per-run DB */ }
  await new Promise<void>((resolve, reject) => server.close(e => (e ? reject(e) : resolve())));
  await new Promise<void>((resolve, reject) => wooStub.close(e => (e ? reject(e) : resolve())));
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

async function login(email: string): Promise<string> {
  const r = await apiFetch("/api/uc/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "gate-test-password" }),
  });
  assert.equal(r.status, 200, `login for ${email} should succeed, got ${r.status}`);
  return (r.body as { token: string }).token;
}

function teamToken(id: string, role: string, email = "gate@test.internal"): string {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  return issueToken({ id, email, name: "Gate", type: "team-session", role, exp });
}

function authed(token: string): RequestInit {
  return { headers: { Authorization: `Bearer ${token}` } };
}

/** Probe an admin-gated endpoint; returns the HTTP status. */
async function probeAdmin(token: string): Promise<number> {
  const r = await apiFetch("/api/uc/offline-clients", authed(token));
  return r.status;
}

async function probeUnsyncedRecovery(token: string): Promise<number> {
  const r = await apiFetch("/api/admin/unsynced-registrations", authed(token));
  return r.status;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("UC admin gate — WooCommerce provenance", () => {
  it("admits a Woo-authenticated user whose email is on UC_ADMIN_EMAILS", async () => {
    const token = await login(WOO_ADMIN);
    assert.equal(await probeAdmin(token), 200, "Woo admin must reach admin endpoints");
  });

  it("rejects a Woo-authenticated user NOT on the allowlist", async () => {
    const token = await login(WOO_NONADMIN);
    assert.equal(await probeAdmin(token), 401);
  });

  it("rejects a dev ephemeral token even when its email IS on the allowlist", async () => {
    // Woo stub refuses this email → login falls back to the dev ephemeral
    // session (no src:"woo" provenance). The gate must not trust its email.
    const token = await login(DEV_EMAIL);
    assert.equal(await probeAdmin(token), 401, "dev-fallback tokens must never reach admin");
  });
});

describe("UC admin gate — ProjectHub team sessions", () => {
  it("admits a team-session token whose team_users row is an active admin", async () => {
    assert.equal(await probeAdmin(teamToken(TEAM_ADMIN_ID, "admin")), 200);
  });

  it("rejects a team member even if the JWT falsely claims role:admin", async () => {
    // Role must be re-verified against the DB row, not trusted from claims.
    assert.equal(await probeAdmin(teamToken(TEAM_MEMBER_ID, "admin")), 401);
  });

  it("rejects a deactivated team admin", async () => {
    assert.equal(await probeAdmin(teamToken(TEAM_INACTIVE_ID, "admin")), 401);
  });

  it("rejects a team-session token with no matching team_users row (incl. legacy 'team')", async () => {
    assert.equal(await probeAdmin(teamToken("team", "admin")), 401);
    assert.equal(await probeAdmin(teamToken("no-such-user-id", "admin")), 401);
  });

  it("fails closed (401) when the team_users lookup throws", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const original = (db as any).select.bind(db);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (db as any).select = () => { throw new Error("DB unavailable (test)"); };
    try {
      assert.equal(await probeAdmin(teamToken(TEAM_ADMIN_ID, "admin")), 401);
    } finally {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (db as any).select = original;
    }
  });
});

describe("unsynced-registration admin routes use live team authority", () => {
  it("allows an active database admin even when the JWT role is stale", async () => {
    assert.equal(await probeUnsyncedRecovery(teamToken(TEAM_ADMIN_ID, "member")), 200);
  });

  it("rejects a member whose JWT falsely claims admin", async () => {
    assert.equal(await probeUnsyncedRecovery(teamToken(TEAM_MEMBER_ID, "admin")), 403);
  });

  it("rejects an admin after the live row is deactivated", async () => {
    await db.update(teamUsersTable)
      .set({ isActive: false })
      .where(inArray(teamUsersTable.id, [TEAM_ADMIN_ID]));
    try {
      assert.equal(await probeUnsyncedRecovery(teamToken(TEAM_ADMIN_ID, "admin")), 403);
    } finally {
      await db.update(teamUsersTable)
        .set({ isActive: true })
        .where(inArray(teamUsersTable.id, [TEAM_ADMIN_ID]));
    }
  });
});

describe("UC offline-client live edit permission", () => {
  it("allows exposed writes with edit access, then returns a specific 403 after access becomes view-only", async () => {
    const token = teamToken(TEAM_EDITOR_ID, "member");
    await db.update(teamUsersTable)
      .set({ permissions: { impact: "edit" } })
      .where(inArray(teamUsersTable.id, [TEAM_EDITOR_ID]));

    for (const [method, path, expectedStatus] of [
      ["POST", "/api/uc/offline-clients", 400],
      ["PUT", "/api/uc/offline-clients/1", 400],
      ["DELETE", "/api/uc/offline-clients/1", 404],
      ["POST", "/api/uc/impact/override", 400],
    ] as const) {
      const response = await apiFetch(path, {
        method,
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: method === "DELETE" ? undefined : JSON.stringify({ litresOffset: "invalid" }),
      });
      assert.equal(response.status, expectedStatus, `${method} ${path} should pass the edit gate`);
    }

    await db.update(teamUsersTable)
      .set({ permissions: { impact: "view" } })
      .where(inArray(teamUsersTable.id, [TEAM_EDITOR_ID]));

    for (const [method, path] of [
      ["POST", "/api/uc/offline-clients"],
      ["PUT", "/api/uc/offline-clients/1"],
      ["DELETE", "/api/uc/offline-clients/1"],
      ["POST", "/api/uc/impact/override"],
    ] as const) {
      const response = await apiFetch(path, {
        method,
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: method === "DELETE" ? undefined : JSON.stringify({}),
      });
      assert.equal(response.status, 403);
      assert.equal((response.body as { code?: string }).code, "IMPACT_EDIT_ACCESS_REQUIRED");
    }
  });
});

describe("UC admin gate — impact override honours the same gate", () => {
  // An invalid body proves gate passage without touching the override file:
  // gate failure → 401, gate passage → 400 validation error.
  const badBody = {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ litresOffset: "not-a-number" }),
  } as const;

  it("team admin passes the gate on POST /api/uc/impact/override", async () => {
    const r = await apiFetch("/api/uc/impact/override", {
      ...badBody,
      headers: { ...badBody.headers, Authorization: `Bearer ${teamToken(TEAM_ADMIN_ID, "admin")}` },
    });
    assert.equal(r.status, 400, "gate must pass (400 = body validation reached)");
  });

  it("Woo non-admin is rejected on POST /api/uc/impact/override", async () => {
    const token = await login(WOO_NONADMIN);
    const r = await apiFetch("/api/uc/impact/override", {
      ...badBody,
      headers: { ...badBody.headers, Authorization: `Bearer ${token}` },
    });
    assert.equal(r.status, 401);
  });
});
