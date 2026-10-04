import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { appendFile, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomInt, randomUUID } from "node:crypto";
import bcryptjs from "bcryptjs";
import request from "supertest";

const dataDir = await mkdtemp(join(tmpdir(), "uc-account-records-"));
process.env.UC_ACCOUNTS_DATA_DIR = dataDir;
const {
  _ioSeams,
  clearResolvedRegistrations,
  listUnsyncedRegistrations,
  resolveUnsyncedRegistration,
  retryUnsyncedRegistration,
} = await import("../lib/account-records.js");
const { db, ucUsersTable } = await import("@workspace/db");
const { eq } = await import("drizzle-orm");
const { default: app } = await import("../app.js");

const now = () => new Date().toISOString();
const ledger = () => join(dataDir, "accounts.jsonl");
async function seed(email: string, recordedAt: string, values: Record<string, unknown> = {}) {
  await appendFile(ledger(), `${JSON.stringify({
    id: null, firstName: "Recovery", lastName: "Test", email, phone: "+254700000001",
    authProvider: "password", createdAt: recordedAt, recordedAt, source: "registration",
    dbPersisted: false, ...values,
  })}\n`);
}
async function lines() {
  return (await readFile(ledger(), "utf8")).split("\n").filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>);
}
after(async () => rm(dataDir, { recursive: true, force: true }));

describe("registration conflict recovery responses", () => {
  async function withActiveAccount(
    check: (account: { email: string; phone: string }) => Promise<void>,
  ) {
    const email = `registration-conflict-${randomUUID()}@test.internal`;
    const phone = `+2547${String(randomInt(100_000_000)).padStart(8, "0")}`;
    const [account] = await db.insert(ucUsersTable).values({
      email,
      phone,
      passwordHash: await bcryptjs.hash("OriginalPassword1!", 4),
      firstName: "Conflict",
      lastName: "Test",
      deletedAt: null,
    }).returning({ id: ucUsersTable.id });
    try {
      await check({ email, phone });
    } finally {
      await db.delete(ucUsersTable).where(eq(ucUsersTable.id, account!.id));
    }
  }

  it("returns 409 with the duplicate-email message and forgot-password hint for an active email", async () => {
    await withActiveAccount(async ({ email, phone }) => {
      const response = await request(app).post("/api/uc/auth/register").send({
        email,
        phone: `${phone.slice(0, -1)}${(Number(phone.at(-1)) + 1) % 10}`,
        password: "DifferentPassword1!",
        firstName: "Duplicate",
      });

      assert.equal(response.status, 409);
      assert.equal(
        response.body.error,
        "An account with this email already exists. If you recently tried to register and hit an error, your account was created — please use 'Forgot password' to set a new password and log in.",
      );
      assert.equal(response.body.hint, "forgot_password");
    });
  });

  it("returns 409 for a phone-only conflict without a forgot-password hint", async () => {
    await withActiveAccount(async ({ phone }) => {
      const response = await request(app).post("/api/uc/auth/register").send({
        email: `phone-conflict-${randomUUID()}@test.internal`,
        phone,
        password: "DifferentPassword1!",
        firstName: "Duplicate",
      });

      assert.equal(response.status, 409);
      assert.equal(
        response.body.error,
        "An active account already uses this phone number. Sign in to that account or use a different number.",
      );
      assert.equal(Object.hasOwn(response.body, "hint"), false);
    });
  });
});

describe("folder-only registration recovery", () => {
  it("lists only records needing recovery, including orphaned sync markers", async () => {
    const suffix = Date.now(), at = now(), concurrent = `concurrent-${suffix}@test.internal`, failing = `failing-${suffix}@test.internal`;
    const synced = `synced-${suffix}@test.internal`, unsynced = `unsynced-${suffix}@test.internal`, orphan = `orphan-${suffix}@test.internal`;
    await db.insert(ucUsersTable).values({ email: synced, passwordHash: await bcryptjs.hash("pass", 4), firstName: "S", lastName: "Y", phone: "" });
    await seed(synced, at, { dbPersisted: true });
    await seed(unsynced, at);
    await seed(orphan, at, { dbPersisted: true });
    const emails = (await listUnsyncedRegistrations()).map((record) => record.email);
    assert.ok(!emails.includes(synced));
    assert.ok(emails.includes(unsynced));
    assert.ok(emails.includes(orphan));
  });

  it("creates and syncs new accounts but never replaces an existing password", async () => {
    const suffix = Date.now(), at = now(), concurrent = `concurrent-${suffix}@test.internal`, failing = `failing-${suffix}@test.internal`;
    const fresh = `fresh-${suffix}@test.internal`, existing = `existing-${suffix}@test.internal`;
    await seed(fresh, at);
    const recovered = await retryUnsyncedRegistration(fresh, at);
    assert.equal(recovered.inserted, true);
    assert.ok(recovered.tempPassword);
    const [freshRow] = await db.select({
      passwordHash: ucUsersTable.passwordHash,
      mustChangePassword: ucUsersTable.mustChangePassword,
      temporaryPasswordExpiresAt: ucUsersTable.temporaryPasswordExpiresAt,
      credentialVersion: ucUsersTable.credentialVersion,
    }).from(ucUsersTable).where(eq(ucUsersTable.email, fresh));
    assert.equal(await bcryptjs.compare(recovered.tempPassword!, freshRow!.passwordHash), true);
    assert.equal(freshRow!.mustChangePassword, true);
    assert.equal(freshRow!.credentialVersion, 1);
    assert.ok(freshRow!.temporaryPasswordExpiresAt);
    assert.ok(freshRow!.temporaryPasswordExpiresAt!.getTime() > Date.now());
    assert.ok(freshRow!.temporaryPasswordExpiresAt!.getTime() <= Date.now() + 14 * 24 * 60 * 60 * 1000 + 1000);
    assert.equal((await lines()).find((line) => line.email === fresh)?.dbPersisted, true);

    const originalHash = await bcryptjs.hash("CustomerPass1!", 4);
    await db.insert(ucUsersTable).values({ email: existing, passwordHash: originalHash, firstName: "E", lastName: "X", phone: "" });
    await seed(existing, at);
    const reconciled = await retryUnsyncedRegistration(existing, at);
    const [existingRow] = await db.select({ passwordHash: ucUsersTable.passwordHash }).from(ucUsersTable).where(eq(ucUsersTable.email, existing));
    assert.equal(reconciled.tempPassword, undefined);
    assert.equal(await bcryptjs.compare("CustomerPass1!", existingRow!.passwordHash), true);
  });

  it("durably marks a folder-only registration as contacted and resolved", async () => {
    const at = now();
    const email = `resolved-${Date.now()}@test.internal`;
    await seed(email, at, { phone: "+254700000009" });

    const resolved = await resolveUnsyncedRegistration(email, at);
    assert.equal(resolved.followUpStatus, "resolved");
    assert.ok(resolved.resolvedAt);

    const listed = (await listUnsyncedRegistrations()).find(
      (record) => record.email === email && record.recordedAt === at,
    );
    assert.equal(listed?.followUpStatus, "resolved");
    assert.equal(listed?.resolvedAt, resolved.resolvedAt);
    assert.equal(listed?.dbPersisted, false);
  });

  it("serializes retries and rolls back the DB insert when atomic ledger replacement fails", async () => {
    const suffix = Date.now(), at = now(), concurrent = `concurrent-${suffix}@test.internal`, failing = `failing-${suffix}@test.internal`;
    // The earlier recovery test creates an account with the seed helper's
    // default phone. Use distinct identities here so phone conflict handling
    // does not mask the retry serialization behavior.
    await seed(concurrent, at, { phone: "+254700000002" });
    const [one, two] = await Promise.all([retryUnsyncedRegistration(concurrent, at), retryUnsyncedRegistration(concurrent, at)]);
    assert.equal(Number(one.inserted) + Number(two.inserted), 1);
    assert.equal(one.id, two.id);
    assert.equal(one.status, "synced");
    assert.equal(two.status, "synced");
    const winningPassword = one.tempPassword ?? two.tempPassword;
    assert.ok(winningPassword);

    await seed(failing, at, { phone: "+254700000003" });
    const realWrite = _ioSeams.writeFile;
    _ioSeams.writeFile = async (path, content, encoding) => {
      await realWrite(path, String(content).slice(0, 8), encoding);
      throw new Error("ENOSPC");
    };
    try {
      await assert.rejects(() => retryUnsyncedRegistration(failing, at), /ENOSPC/);
    } finally {
      _ioSeams.writeFile = realWrite;
    }
    // The failed transaction must not leak a recovered account, and the
    // durable record must remain eligible for a later retry.
    const [row] = await db.select({ id: ucUsersTable.id }).from(ucUsersTable).where(eq(ucUsersTable.email, failing));
    assert.equal(row, undefined);
    const failedRecord = (await lines()).find((line) => line.email === failing);
    assert.equal(failedRecord?.dbPersisted, false);
    assert.equal(failedRecord?.recoveryAttempts, undefined);
  });

  it("clears only database-persisted recovery resolutions", async () => {
    const suffix = Date.now();
    const persisted = `clear-persisted-${suffix}@test.internal`;
    const contacted = `clear-contacted-${suffix}@test.internal`;
    const at = now();
    // Keep the generated fixture within Kenya's 12-digit E.164 contract.
    await seed(persisted, at, { phone: `+254700${String(suffix).slice(-6)}` });
    await retryUnsyncedRegistration(persisted, at, {
      createAccount: true,
      correctedPhone: `+254700${String(suffix).slice(-6)}`,
      resolvedBy: "admin-test",
    });
    const contactedAt = now();
    await seed(contacted, contactedAt, { phone: "+254700000099" });
    await resolveUnsyncedRegistration(contacted, contactedAt);

    const eligibleBeforeClear = (await lines()).filter(
      (line) => line.dbPersisted === true && line.recoveryStatus === "resolved",
    ).length;
    assert.ok(
      (await listUnsyncedRegistrations()).some((line) => line.email === persisted),
      "database-persisted resolved recovery rows remain visible until clear",
    );
    const cleared = await clearResolvedRegistrations();
    assert.equal(cleared, eligibleBeforeClear);
    const records = await lines();
    assert.equal(records.some((line) => line.email === persisted), false);
    assert.equal(records.some((line) => line.email === contacted), true);
  });

  it("keeps persisted recovery audit rows visible when the database is unavailable", async () => {
    const email = `db-error-resolved-${Date.now()}@test.internal`;
    const at = now();
    await seed(email, at, {
      dbPersisted: true,
      recoveryStatus: "resolved",
      followUpStatus: "resolved",
      resolvedAt: at,
    });
    // The fallback must preserve explicit recovery/follow-up state without
    // treating every ordinary persisted registration backup as unsynced.
    const originalSelect = db.select.bind(db);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (db as any).select = () => { throw new Error("DB unavailable (test)"); };
    try {
      const visible = await listUnsyncedRegistrations();
      assert.ok(visible.some((line) => line.email === email));
    } finally {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (db as any).select = originalSelect;
    }
  });
});
