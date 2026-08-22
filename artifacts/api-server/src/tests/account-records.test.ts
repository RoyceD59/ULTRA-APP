import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { appendFile, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import bcryptjs from "bcryptjs";

const dataDir = await mkdtemp(join(tmpdir(), "uc-account-records-"));
process.env.UC_ACCOUNTS_DATA_DIR = dataDir;
const { _ioSeams, listUnsyncedRegistrations, retryUnsyncedRegistration } = await import("../lib/account-records.js");
const { db, ucUsersTable } = await import("@workspace/db");
const { eq } = await import("drizzle-orm");

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
    const [freshRow] = await db.select({ passwordHash: ucUsersTable.passwordHash }).from(ucUsersTable).where(eq(ucUsersTable.email, fresh));
    assert.equal(await bcryptjs.compare(recovered.tempPassword!, freshRow!.passwordHash), true);
    assert.equal((await lines()).find((line) => line.email === fresh)?.dbPersisted, true);

    const originalHash = await bcryptjs.hash("CustomerPass1!", 4);
    await db.insert(ucUsersTable).values({ email: existing, passwordHash: originalHash, firstName: "E", lastName: "X", phone: "" });
    await seed(existing, at);
    const reconciled = await retryUnsyncedRegistration(existing, at);
    const [existingRow] = await db.select({ passwordHash: ucUsersTable.passwordHash }).from(ucUsersTable).where(eq(ucUsersTable.email, existing));
    assert.equal(reconciled.tempPassword, undefined);
    assert.equal(await bcryptjs.compare("CustomerPass1!", existingRow!.passwordHash), true);
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
});
