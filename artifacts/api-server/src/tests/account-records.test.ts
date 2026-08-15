/**
 * Durable account-records folder tests.
 *
 * Verifies:
 *   1. A successful email/password registration appends a sanitized record
 *      to accounts.jsonl — with NO password material of any kind.
 *   2. The one-time backfill writes records for pre-existing accounts,
 *      skips accounts already recorded, and is marker-guarded (second run
 *      is a no-op).
 *
 * Run with: pnpm --filter @workspace/api-server test
 * Uses the isolated per-run test database (see run.ts); account records are
 * pointed at a throwaway temp dir via UC_ACCOUNTS_DATA_DIR, which must be
 * set BEFORE the account-records module is imported.
 */
import { describe, it, before, after, mock } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Point the records folder at a temp dir BEFORE importing app/lib modules.
const dataDir = await mkdtemp(join(tmpdir(), "uc-account-records-"));
process.env["UC_ACCOUNTS_DATA_DIR"] = dataDir;
process.env["SESSION_SECRET"] ??= "test-secret-for-account-records-tests";

const { default: app } = await import("../app.js");
const { backfillAccountRecords, _ioSeams } = await import("../lib/account-records.js");
const { db, ucUsersTable } = await import("@workspace/db");

let server: http.Server;
before(async () => {
  await new Promise<void>((resolve, reject) => {
    server = app.listen(0, "127.0.0.1", (err?: Error) => (err ? reject(err) : resolve()));
  });
});
after(async () => {
  await new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve()));
  await rm(dataDir, { recursive: true, force: true });
});

async function post(path: string, body: unknown): Promise<{ status: number; body: Record<string, unknown> }> {
  const addr = server.address() as { port: number };
  const res = await fetch(`http://127.0.0.1:${addr.port}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() as Record<string, unknown> };
}

async function readRecords(): Promise<Record<string, unknown>[]> {
  const file = join(dataDir, "accounts.jsonl");
  if (!existsSync(file)) return [];
  const raw = await readFile(file, "utf8");
  return raw.split("\n").filter(l => l.trim()).map(l => JSON.parse(l) as Record<string, unknown>);
}

/** No key may look like password material, and the secret value must be absent. */
function assertNoPasswordMaterial(rec: Record<string, unknown>, secret: string): void {
  for (const key of Object.keys(rec)) {
    assert.ok(!/password|hash/i.test(key), `record key "${key}" must not carry password material`);
  }
  assert.ok(!JSON.stringify(rec).includes(secret), "record must not contain the raw secret value");
}

describe("Durable account records", () => {
  it("appends a sanitized record on successful registration", async () => {
    const { status, body } = await post("/api/uc/auth/register", {
      email: "records-reg@test.com",
      phone: "+254712345001",
      password: "hunter22",
      firstName: "Rec",
      lastName: "Ords",
    });
    assert.equal(status, 200);
    assert.ok(body["token"], "registration should still issue a session");

    // The folder append is fire-and-forget — give it a moment.
    await new Promise(r => setTimeout(r, 300));

    const records = await readRecords();
    const rec = records.find(r => r["email"] === "records-reg@test.com");
    assert.ok(rec, "registration record must land in accounts.jsonl");
    assert.equal(rec["firstName"], "Rec");
    assert.equal(rec["phone"], "+254712345001");
    assert.equal(rec["authProvider"], "password");
    assert.equal(rec["source"], "registration");
    assert.equal(rec["dbPersisted"], true);
    assert.equal(typeof rec["id"], "number");

    // NEVER any password material. (`authProvider: "password"` is a legitimate
    // VALUE, so check the keys and the secret values — not a raw substring.)
    assertNoPasswordMaterial(rec!, "hunter22");
  });

  it("backfills pre-existing accounts once, without duplicates", async () => {
    // Seed an account directly in the DB (simulating a pre-existing user
    // registered before the records folder existed).
    const [seeded] = await db.insert(ucUsersTable).values({
      email: "records-backfill@test.com",
      passwordHash: "$2a$10$abcdefghijklmnopqrstuv",
      phone: "+254712345002",
      firstName: "Back",
      lastName: "Fill",
    }).returning();

    await backfillAccountRecords();

    const afterFirst = await readRecords();
    const backfilled = afterFirst.filter(r => r["email"] === "records-backfill@test.com");
    assert.equal(backfilled.length, 1, "backfill must record the pre-existing account exactly once");
    assert.equal(backfilled[0]!["source"], "backfill");
    assert.equal(backfilled[0]!["id"], seeded!.id);
    assertNoPasswordMaterial(backfilled[0]!, "$2a$10$abcdefghijklmnopqrstuv");

    // Accounts already recorded at registration time must not be duplicated.
    const regDupes = afterFirst.filter(r => r["email"] === "records-reg@test.com");
    assert.equal(regDupes.length, 1, "already-recorded registration must not be re-backfilled");

    // Marker-guarded: a second run is a no-op even if new users appear.
    await db.insert(ucUsersTable).values({
      email: "records-after-marker@test.com",
      passwordHash: "$2a$10$abcdefghijklmnopqrstuv",
      phone: "+254712345003",
      firstName: "After",
      lastName: "Marker",
    });
    await backfillAccountRecords();
    const afterSecond = await readRecords();
    assert.equal(afterSecond.length, afterFirst.length, "second backfill run must be a no-op (marker)");
  });

  it("returns 409 with a 'forgot password' hint when the email already exists on retry", async () => {
    // First registration — must succeed.
    const { status: firstStatus } = await post("/api/uc/auth/register", {
      email: "conflict-retry@test.com",
      phone: "+254712345088",
      password: "initial-pass-1",
      firstName: "Con",
      lastName: "Flict",
    });
    assert.equal(firstStatus, 200, "initial registration must succeed");

    // Retry with the same email (simulating a customer whose 503 was followed by a DB recovery).
    const { status, body } = await post("/api/uc/auth/register", {
      email: "conflict-retry@test.com",
      phone: "+254712345088",
      password: "retry-pass-2",
      firstName: "Con",
      lastName: "Flict",
    });

    assert.equal(status, 409, `expected 409 conflict but got ${status}`);
    assert.ok(!body["token"], "409 response must not issue a session token");

    // The error message must guide the customer toward password reset.
    const errorMsg = String(body["error"] ?? "");
    assert.ok(
      errorMsg.toLowerCase().includes("forgot password") || errorMsg.toLowerCase().includes("forgot_password"),
      `409 error must mention 'Forgot password'; got: ${errorMsg}`,
    );

    // The hint field must be present so clients can show the correct CTA.
    assert.equal(body["hint"], "forgot_password", "409 response must include hint: 'forgot_password'");
  });

  it("returns 503 with no token and writes a dbPersisted:false folder record when the DB insert fails", async () => {
    // Simulate a DB outage by making db.insert throw for the duration of this test.
    // ES module singletons mean the route handler sees the same db object we imported.
    const insertMock = mock.method(db, "insert", () => {
      throw new Error("DB_DOWN_SIMULATION");
    });

    try {
      const { status, body } = await post("/api/uc/auth/register", {
        email: "db-fail-reg@test.com",
        phone: "+254712345099",
        password: "safe-pass-123",
        firstName: "Db",
        lastName: "Fail",
      });

      // Must be 503 with the "safely recorded" message and absolutely no session token.
      assert.equal(status, 503, `expected 503 but got ${status}`);
      assert.ok(!body["token"], "503 response must NOT contain a session token");
      assert.ok(
        typeof body["error"] === "string" && body["error"].includes("safely recorded"),
        `error must mention 'safely recorded'; got: ${String(body["error"])}`,
      );

      // The critical recordAccountRegistration call is awaited by the route before
      // responding, so the file is already written by the time we read it here.
      const records = await readRecords();
      const rec = records.find(r => r["email"] === "db-fail-reg@test.com");
      assert.ok(rec, "a folder record must be written even when the DB insert fails");
      assert.equal(rec!["dbPersisted"], false, "dbPersisted must be false when DB insert failed");
      assert.equal(rec!["source"], "registration", "source must be 'registration'");
      assert.equal(rec!["id"], null, "id must be null when the DB insert never completed");

      // No password material — neither the key names nor the raw secret.
      assertNoPasswordMaterial(rec!, "safe-pass-123");
    } finally {
      insertMock.mock.restore();
    }
  });

  it("returns 503 with a 'contact us' message and emits an error log when both DB insert and folder write fail", async () => {
    // Simulate disk full / permission denied by replacing _ioSeams.appendFile.
    // _ioSeams is a plain mutable object exported from account-records.ts — the
    // only reliable way to inject failures without patching ES module namespace
    // bindings, which are non-configurable and cannot be overwritten at runtime.
    const realAppendFile = _ioSeams.appendFile;
    _ioSeams.appendFile = async () => {
      throw Object.assign(new Error("ENOSPC: no space left on device"), { code: "ENOSPC" });
    };

    const insertMock = mock.method(db, "insert", () => {
      throw new Error("DB_DOWN_SIMULATION");
    });

    try {
      const { status, body } = await post("/api/uc/auth/register", {
        email: "dual-fail@test.com",
        phone: "+254712345097",
        password: "pass-dual-fail",
        firstName: "Dual",
        lastName: "Fail",
      });

      // Must still be a 503, not a 500 or an unhandled rejection.
      assert.equal(status, 503, `expected 503 but got ${status}`);
      assert.ok(!body["token"], "503 response must NOT contain a session token");

      // Error message must NOT claim the details were safely recorded (they weren't).
      const errorMsg = String(body["error"] ?? "");
      assert.ok(errorMsg.length > 0, "response must include an error message");
      assert.ok(
        !errorMsg.includes("safely recorded"),
        `error must NOT claim details were safely recorded; got: ${errorMsg}`,
      );
      // Must tell the customer to contact support / us directly.
      assert.ok(
        errorMsg.includes("contact") || errorMsg.includes("not recorded"),
        `error should indicate the customer needs to contact support; got: ${errorMsg}`,
      );
    } finally {
      insertMock.mock.restore();
      _ioSeams.appendFile = realAppendFile;
    }
  });
});
