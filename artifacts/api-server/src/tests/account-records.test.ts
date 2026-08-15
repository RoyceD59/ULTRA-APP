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
import { describe, it, before, after } from "node:test";
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
const { backfillAccountRecords } = await import("../lib/account-records.js");
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
});
