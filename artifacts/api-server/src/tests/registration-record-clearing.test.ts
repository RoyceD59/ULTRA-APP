import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { appendFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import request from "supertest";

const dataDir = await mkdtemp(join(tmpdir(), "uc-selected-records-"));
process.env.UC_ACCOUNTS_DATA_DIR = dataDir;
const {
  _ioSeams, clearSelectedRegistrationRecords, listUnsyncedRegistrations,
  recordAccountRegistration, resolveUnsyncedRegistration,
} = await import("../lib/account-records.js");
const { db, teamUsersTable, ucUsersTable } = await import("@workspace/db");
const { eq } = await import("drizzle-orm");
const { issueToken } = await import("../lib/jwt.js");
const { default: app } = await import("../app.js");
const path = "/api/admin/unsynced-registrations/clear-selected";
const ledger = join(dataDir, "accounts.jsonl");
const adminId = randomUUID();
const memberId = randomUUID();
let customerId: number;
let adminToken: string;
let memberToken: string;
const email = `retained-customer-${randomUUID()}@example.test`;
const at = "2026-10-17T12:00:00.000Z";

function fixture(label: string, values: Record<string, unknown> = {}) {
  return {
    id: null, firstName: "Fixture", lastName: label, email: `${label}@example.test`,
    phone: "+254700000001", authProvider: "password", createdAt: at,
    recordedAt: at, source: "registration", dbPersisted: false, ...values,
  };
}
async function seed(...rows: ReturnType<typeof fixture>[]) {
  await appendFile(ledger, rows.map((row) => JSON.stringify(row)).join("\n") + "\n");
}
function clear(recordKeys: string[], confirm: unknown = true, token = adminToken) {
  return request(app).post(path).set("Authorization", `Bearer ${token}`).send({ confirm, recordKeys });
}
before(async () => {
  for (const [id, role] of [[adminId, "admin"], [memberId, "member"]] as const) {
    await db.insert(teamUsersTable).values({ id, email: `${id}@example.test`, name: "Clearing fixture", passwordHash: "unused-fixture-hash", role, isActive: true });
  }
  const claims = (id: string, role: string) => issueToken({ id, email: `${id}@example.test`, type: "team-session", role, exp: Math.floor(Date.now() / 1000) + 3600 });
  adminToken = claims(adminId, "admin"); memberToken = claims(memberId, "member");
  const [customer] = await db.insert(ucUsersTable).values({ email, firstName: "Retained", lastName: "Customer", phone: "+254700000099", passwordHash: "unused-fixture-hash" }).returning({ id: ucUsersTable.id });
  customerId = customer!.id;
});
beforeEach(async () => { await writeFile(ledger, "", "utf8"); });
after(async () => {
  await db.delete(teamUsersTable).where(eq(teamUsersTable.id, adminId));
  await db.delete(teamUsersTable).where(eq(teamUsersTable.id, memberId));
  if (customerId) await db.delete(ucUsersTable).where(eq(ucUsersTable.id, customerId));
  await rm(dataDir, { recursive: true, force: true });
});

describe("Selected registration clearing", () => {
  it("clears selected resolved and unresolved records, retains other records and the linked customer unchanged", async () => {
    const rows = [
      fixture("pending"),
      fixture("blocked", { recoveryStatus: "blocked", recoveryReason: "email_conflict" }),
      fixture("resolved", { email, id: customerId, dbPersisted: true, recoveryStatus: "resolved" }),
      fixture("contacted", { followUpStatus: "resolved" }),
      fixture("ordinary-backup", { email, id: customerId, dbPersisted: true }),
    ];
    await seed(...rows);
    const before = await db.select().from(ucUsersTable).where(eq(ucUsersTable.id, customerId));
    const listed = await request(app).get("/api/admin/unsynced-registrations").set("Authorization", `Bearer ${adminToken}`);
    assert.equal(listed.status, 200);
    const records = listed.body.records as Array<{ lastName: string; recordKey: string }>;
    assert.equal(records.some((record) => record.lastName === "ordinary-backup"), false);
    const keys = records.filter((record) => record.lastName !== "blocked").map((record) => record.recordKey);
    assert.equal(keys.length, 3);
    assert.ok(keys.every((key) => /^[a-f0-9]{64}$/.test(key)));
    const result = await clear(keys);
    assert.equal(result.status, 200); assert.deepEqual(result.body, { cleared: 3 });
    const remaining = (await readFile(ledger, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
    assert.deepEqual(remaining.map((record) => record.lastName), ["blocked", "ordinary-backup"]);
    assert.deepEqual(await db.select().from(ucUsersTable).where(eq(ucUsersTable.id, customerId)), before);
  });

  it("distinguishes records sharing the same email and timestamp", async () => {
    await seed(fixture("same", { phone: "+254700000001" }), fixture("same", { phone: "+254700000002" }));
    const records = await listUnsyncedRegistrations();
    assert.notEqual(records[0]!.recordKey, records[1]!.recordKey);
    assert.equal((await clear([records[0]!.recordKey])).status, 200);
    const remaining = await listUnsyncedRegistrations();
    assert.equal(remaining.length, 1); assert.equal(remaining[0]!.phone, "+254700000002");
  });

  it("refuses all selected deletions when any record changed or disappeared", async () => {
    await seed(fixture("changed"), fixture("untouched"));
    const records = await listUnsyncedRegistrations();
    await resolveUnsyncedRegistration(records[0]!.email, at);
    const before = await readFile(ledger, "utf8");
    const result = await clear(records.map((record) => record.recordKey));
    assert.equal(result.status, 409); assert.equal(result.body.code, "SELECTION_CHANGED");
    assert.equal(await readFile(ledger, "utf8"), before);
    assert.equal((await clear([records[1]!.recordKey, "0".repeat(64)])).status, 409);
    assert.equal(await readFile(ledger, "utf8"), before);
  });

  it("requires explicit confirmation, bounded unique keys, and valid key format", async () => {
    await seed(fixture("validation"));
    const [record] = await listUnsyncedRegistrations();
    const before = await readFile(ledger, "utf8");
    for (const [keys, confirm] of [
      [[record!.recordKey], false], [[record!.recordKey], "true"], [[], true],
      [[record!.recordKey, record!.recordKey], true], [["not-a-key"], true],
      [Array.from({ length: 101 }, (_, index) => index.toString(16).padStart(64, "0")), true],
    ] as Array<[string[], unknown]>) {
      const result = await clear(keys, confirm);
      assert.equal(result.status, 400); assert.equal(await readFile(ledger, "utf8"), before);
    }
  });

  it("preserves malformed and unselected lines verbatim", async () => {
    await seed(fixture("selected"));
    const [record] = await listUnsyncedRegistrations();
    const retained = 'not-json-but-retain-this-line\n  { \"unknown\": \"legacy format\" }  \n';
    await appendFile(ledger, retained);
    assert.equal(await clearSelectedRegistrationRecords([record!.recordKey]), 1);
    assert.equal(await readFile(ledger, "utf8"), retained);
  });

  it("fails closed for duplicate indistinguishable records instead of clearing both", async () => {
    const row = fixture("duplicate");
    await seed(row, row);
    const [record] = await listUnsyncedRegistrations();
    const before = await readFile(ledger, "utf8");
    assert.equal((await clear([record!.recordKey])).status, 409);
    assert.equal(await readFile(ledger, "utf8"), before);
  });

  it("retains original data and returns a safe error when atomic replacement fails", async () => {
    await seed(fixture("write-failure"));
    const [record] = await listUnsyncedRegistrations();
    const before = await readFile(ledger, "utf8");
    const rename = _ioSeams.rename;
    _ioSeams.rename = async () => { throw new Error("fixture-private-path /not-for-client"); };
    try {
      const result = await clear([record!.recordKey]);
      assert.equal(result.status, 500);
      assert.equal(result.body.code, "REGISTRATION_CLEAR_FAILED");
      assert.equal(JSON.stringify(result.body).includes("/not-for-client"), false);
      assert.equal(await readFile(ledger, "utf8"), before);
    } finally { _ioSeams.rename = rename; }
  });

  it("serializes with registration appends so a concurrent record is not lost", async () => {
    await seed(fixture("clear-concurrent"));
    const [record] = await listUnsyncedRegistrations();
    await Promise.all([
      clearSelectedRegistrationRecords([record!.recordKey]),
      recordAccountRegistration({ id: null, firstName: "Concurrent", lastName: "Retained", email: "append-concurrent@example.test", phone: "+254700000003", authProvider: "password", source: "registration", dbPersisted: false }, { critical: true }),
    ]);
    const remaining = await listUnsyncedRegistrations();
    assert.equal(remaining.length, 1); assert.equal(remaining[0]!.email, "append-concurrent@example.test");
  });

  it("requires a live administrator and leaves the ledger untouched for unauthorized requests", async () => {
    await seed(fixture("authorization"));
    const [record] = await listUnsyncedRegistrations();
    const before = await readFile(ledger, "utf8");
    assert.equal((await request(app).post(path).send({ confirm: true, recordKeys: [record!.recordKey] })).status, 401);
    assert.equal((await clear([record!.recordKey], true, memberToken)).status, 403);
    await db.update(teamUsersTable).set({ role: "member" }).where(eq(teamUsersTable.id, adminId));
    try { assert.equal((await clear([record!.recordKey])).status, 403); }
    finally { await db.update(teamUsersTable).set({ role: "admin" }).where(eq(teamUsersTable.id, adminId)); }
    await db.update(teamUsersTable).set({ isActive: false }).where(eq(teamUsersTable.id, adminId));
    try { assert.equal((await clear([record!.recordKey])).status, 403); }
    finally { await db.update(teamUsersTable).set({ isActive: true }).where(eq(teamUsersTable.id, adminId)); }
    assert.equal(await readFile(ledger, "utf8"), before);
  });
});
