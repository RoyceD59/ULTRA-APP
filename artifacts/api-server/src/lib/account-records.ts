/**
 * Durable folder-based account records.
 *
 * Every successful Ultra-Clear registration (email/password AND social
 * sign-up) is appended as one sanitized JSON line to `data/accounts.jsonl`
 * on the API server, so the team always has a durable record of registered
 * accounts even if the database is unavailable or a row is lost.
 *
 * SECURITY: records NEVER contain password material. Fields are copied
 * explicitly (allow-list) — request bodies or DB rows are never spread into
 * a record, so `password` / `passwordHash` can never leak into the folder.
 */
import { appendFile as _appendFile, mkdir, readFile, rename as _rename, unlink as _unlink, writeFile as _writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { db, ucUsersTable } from "@workspace/db";
import { and, eq, isNull, sql } from "drizzle-orm";
import bcryptjs from "bcryptjs";
import { logger } from "./logger";
import { normalizeEmail, normalizePhone } from "./customer-identity";

/**
 * Resolve the api-server `data/` directory across every execution mode:
 *  - production/dev bundle: module URL is `dist/index.mjs` → `../data`
 *  - tests via tsx:         module is  `src/lib/…`         → `../../data`
 * Prefers an existing directory; falls back to `../data` (created lazily).
 */
function resolveDataDir(): string {
  // Test seam: lets the test suite point records at a throwaway directory.
  const override = process.env["UC_ACCOUNTS_DATA_DIR"];
  if (override) return override;
  const here = dirname(fileURLToPath(import.meta.url));
  for (const rel of ["../data", "../../data"]) {
    const dir = join(here, rel);
    if (existsSync(dir)) return dir;
  }
  return join(here, "../data");
}

/** Absolute path of the durable data folder (shared with tickets/water-tests JSONL backups). */
export const ACCOUNT_DATA_DIR = resolveDataDir();

/**
 * IO seams object — wraps the fs/promises functions used in the hot path.
 * Tests may replace individual properties (e.g. `_ioSeams.appendFile`) to
 * simulate disk-full or permission-denied failures without mocking ES module
 * namespace bindings, which are non-configurable and cannot be patched.
 *
 * @internal — only intended for use by the test suite.
 */
export const _ioSeams = {
  appendFile: _appendFile,
  rename: _rename,
  unlink: _unlink,
  writeFile: _writeFile,
};

const ACCOUNTS_FILE = "accounts.jsonl";
const BACKFILL_MARKER = "accounts-backfill.done";

/** Sanitized account record — the ONLY shape ever written to the folder. */
export interface AccountRecord {
  /** uc_users serial id; null when the DB insert failed (record kept anyway). */
  id: number | null;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  /** "password" or "social". */
  authProvider: string;
  /** Account creation time (DB row when known, otherwise time of the attempt). */
  createdAt: string;
  /** When this line was written to the folder. */
  recordedAt: string;
  /** How the record got here. */
  source: "registration" | "social-registration" | "backfill";
  /** False when the DB insert failed and the folder is the only record. */
  dbPersisted: boolean;
  /** Latest reconciliation state, retained for staff visibility. */
  recoveryStatus?: "pending" | "blocked";
  /** Why staff intervention is required, if a recovery is blocked. */
  recoveryReason?: "email_conflict" | "phone_conflict" | "invalid_phone";
  recoveryAttempts?: number;
  lastRecoveryAttemptAt?: string;
  /** Staff follow-up state for folder-only registrations. */
  followUpStatus?: "resolved";
  /** When a team member marked the registration as contacted/resolved. */
  resolvedAt?: string;
  /** Present only for backfilled rows of erased accounts. */
  deletedAt?: string;
}

/** Input for a live registration record — explicit fields only. */
export interface AccountRecordInput {
  id: number | null;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  authProvider: "password" | "social";
  createdAt?: Date | string | null;
  source: "registration" | "social-registration";
  dbPersisted: boolean;
}

function toIso(v: Date | string | null | undefined): string {
  if (!v) return new Date().toISOString();
  return v instanceof Date ? v.toISOString() : new Date(v).toISOString();
}

let writeQueue: Promise<void> = Promise.resolve();
async function appendRecord(record: AccountRecord): Promise<void> {
  return withWriteLock(async () => {
    await mkdir(ACCOUNT_DATA_DIR, { recursive: true });
    await _ioSeams.appendFile(join(ACCOUNT_DATA_DIR, ACCOUNTS_FILE), JSON.stringify(record) + "\n", "utf8");
  });
}

/**
 * Append a sanitized record for a successful (or DB-failed) registration.
 *
 * Never throws when `critical` is false (fire-and-forget backup alongside a
 * persisted DB row). When `critical` is true (the DB insert failed and this
 * folder record is the ONLY trace of the registration) errors propagate so
 * the caller can report the failure instead of silently losing the account.
 */
export async function recordAccountRegistration(
  input: AccountRecordInput,
  opts: { critical?: boolean } = {},
): Promise<void> {
  const record: AccountRecord = {
    id: input.id,
    firstName: input.firstName,
    lastName: input.lastName,
    email: normalizeEmail(input.email),
    phone: normalizePhone(input.phone) ?? input.phone.trim(),
    authProvider: input.authProvider,
    createdAt: toIso(input.createdAt),
    recordedAt: new Date().toISOString(),
    source: input.source,
    dbPersisted: input.dbPersisted,
  };
  try {
    await appendRecord(record);
  } catch (err) {
    logger.error({ err, email: record.email }, "[account-records] append failed");
    if (opts.critical) throw err;
  }
}

/** Read the set of account ids already present in accounts.jsonl. */
async function existingRecordIds(): Promise<Set<number>> {
  const ids = new Set<number>();
  try {
    const raw = await readFile(join(ACCOUNT_DATA_DIR, ACCOUNTS_FILE), "utf8");
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      try {
        const parsed = JSON.parse(line) as { id?: unknown };
        if (typeof parsed.id === "number") ids.add(parsed.id);
      } catch { /* skip malformed line */ }
    }
  } catch { /* file does not exist yet */ }
  return ids;
}

/**
 * One-time backfill: write a sanitized record for every existing uc_users
 * account that is not yet in the folder. Guarded by a marker file so it runs
 * exactly once; if the DB is unavailable the marker is NOT written and the
 * backfill retries on the next server start. Safe to call on every boot.
 */
export async function backfillAccountRecords(): Promise<void> {
  const markerPath = join(ACCOUNT_DATA_DIR, BACKFILL_MARKER);
  if (existsSync(markerPath)) return;

  const users = await db.select().from(ucUsersTable);
  const already = await existingRecordIds();
  let written = 0;
  for (const u of users) {
    if (already.has(u.id)) continue;
    const record: AccountRecord = {
      id: u.id,
      firstName: u.firstName,
      lastName: u.lastName,
      email: u.email,
      phone: u.phone,
      authProvider: u.authProvider,
      createdAt: toIso(u.createdAt),
      recordedAt: new Date().toISOString(),
      source: "backfill",
      dbPersisted: true,
      ...(u.deletedAt ? { deletedAt: toIso(u.deletedAt) } : {}),
    };
    await appendRecord(record);
    written++;
  }
  await mkdir(ACCOUNT_DATA_DIR, { recursive: true });
  await _writeFile(markerPath, `${new Date().toISOString()} backfilled=${written}\n`, "utf8");
  logger.info({ written, total: users.length }, "[account-records] one-time backfill complete");
}

/** Read and parse all lines from accounts.jsonl; malformed lines are skipped. */
async function readAllRecords(): Promise<AccountRecord[]> {
  try {
    const raw = await readFile(join(ACCOUNT_DATA_DIR, ACCOUNTS_FILE), "utf8");
    return raw
      .split("\n")
      .filter((l) => l.trim())
      .flatMap((l) => {
        try {
          return [JSON.parse(l) as AccountRecord];
        } catch {
          return [];
        }
      });
  } catch {
    return [];
  }
}

async function writeRecordsAtomically(records: AccountRecord[]): Promise<void> {
  await mkdir(ACCOUNT_DATA_DIR, { recursive: true });
  const destination = join(ACCOUNT_DATA_DIR, ACCOUNTS_FILE);
  const temp = join(ACCOUNT_DATA_DIR, `.${ACCOUNTS_FILE}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`);
  try {
    await _ioSeams.writeFile(temp, records.map((record) => JSON.stringify(record)).join("\n") + "\n", "utf8");
    await _ioSeams.rename(temp, destination);
  } finally {
    await _ioSeams.unlink(temp).catch(() => undefined);
  }
}

/**
 * Attempt to create a uc_users row for a folder-only registration and, on
 * success (or email already exists), flip every matching folder record's
 * dbPersisted flag to true.
 *
 * Password handling:
 * - "password" auth: a cryptographically random 16-char temporary password is
 *   generated, hashed, and stored. The plaintext is returned ONCE in the
 *   response so the admin can relay it to the customer out-of-band. It is
 *   never logged or stored beyond this call.
 * - "social" auth: a random hash is stored (account is accessed via Clerk
 *   OAuth, not a password), so no temp password is needed or returned.
 *
 * @returns `{ inserted, alreadyExists, id, tempPassword? }` — tempPassword is
 *   present only when a new password-auth row was inserted.
 */
export async function retryUnsyncedRegistration(
  email: string,
  recordedAt: string,
): Promise<{
  inserted: boolean;
  alreadyExists: boolean;
  id: number | null;
  status: "synced" | "blocked";
  reason?: "email_conflict" | "phone_conflict" | "invalid_phone";
  tempPassword?: string;
}> {
  return withWriteLock(() => db.transaction(async (tx) => {
    const normalizedEmail = normalizeEmail(email);
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${"uc-email:" + normalizedEmail}))`);
    const target = (await readAllRecords()).find((record) =>
      normalizeEmail(record.email) === normalizedEmail && record.recordedAt === recordedAt
    );
    if (!target) throw new Error(`No folder record found for email=${email} recordedAt=${recordedAt}`);

    const normalizedPhone = normalizePhone(target.phone);
    const attemptedAt = new Date().toISOString();
    const updateRecord = async (
      patch: Partial<AccountRecord>,
    ): Promise<void> => {
      const updated = (await readAllRecords()).map((record) =>
        normalizeEmail(record.email) === normalizedEmail && record.recordedAt === recordedAt
          ? {
              ...record,
              ...patch,
              recoveryAttempts: (record.recoveryAttempts ?? 0) + 1,
              lastRecoveryAttemptAt: attemptedAt,
            }
          : record,
      );
      await writeRecordsAtomically(updated);
    };

    if (!normalizedPhone) {
      await updateRecord({ recoveryStatus: "blocked", recoveryReason: "invalid_phone" });
      return { inserted: false, alreadyExists: false, id: null, status: "blocked", reason: "invalid_phone" };
    }
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${"uc-phone:" + normalizedPhone}))`);

    const [emailMatch] = await tx.select({
      id: ucUsersTable.id,
      phone: ucUsersTable.phone,
    }).from(ucUsersTable)
      .where(and(eq(ucUsersTable.email, normalizedEmail), isNull(ucUsersTable.deletedAt))).limit(1);
    const [phoneMatch] = await tx.select({
      id: ucUsersTable.id,
      email: ucUsersTable.email,
    }).from(ucUsersTable)
      .where(and(eq(ucUsersTable.phone, normalizedPhone), isNull(ucUsersTable.deletedAt))).limit(1);

    // A matching email and phone represents the same registration that reached
    // the DB before its durable-folder marker could be rewritten.
    if (emailMatch) {
      if (emailMatch.phone !== normalizedPhone) {
        await updateRecord({ recoveryStatus: "blocked", recoveryReason: "email_conflict" });
        return { inserted: false, alreadyExists: false, id: null, status: "blocked", reason: "email_conflict" };
      }
      await updateRecord({
        dbPersisted: true,
        id: target.id ?? emailMatch.id,
        recoveryStatus: undefined,
        recoveryReason: undefined,
      });
      return { inserted: false, alreadyExists: true, id: emailMatch.id, status: "synced" };
    }
    if (phoneMatch) {
      await updateRecord({ recoveryStatus: "blocked", recoveryReason: "phone_conflict" });
      return { inserted: false, alreadyExists: false, id: null, status: "blocked", reason: "phone_conflict" };
    }

    let dbId: number | null = null;
    let inserted = false;
    let tempPassword: string | undefined;
    const passwordHash = target.authProvider === "password"
      ? await (async () => { tempPassword = randomBytes(12).toString("hex"); return bcryptjs.hash(tempPassword, 10); })()
      : await bcryptjs.hash(randomBytes(16).toString("hex"), 10);
    const [created] = await tx.insert(ucUsersTable).values({
      email: normalizedEmail, passwordHash, phone: normalizedPhone, firstName: target.firstName,
      lastName: target.lastName, authProvider: target.authProvider, createdAt: new Date(target.createdAt),
    }).onConflictDoNothing({ target: ucUsersTable.email }).returning({ id: ucUsersTable.id });
    if (created) {
      dbId = created.id;
      inserted = true;
    } else {
      // A concurrent registration won after the identity checks. Re-run staff
      // reconciliation later rather than guessing which account it belongs to.
      await updateRecord({ recoveryStatus: "blocked", recoveryReason: "email_conflict" });
      return { inserted: false, alreadyExists: false, id: null, status: "blocked", reason: "email_conflict" };
    }

    await updateRecord({
      dbPersisted: true,
      id: target.id ?? dbId,
      recoveryStatus: undefined,
      recoveryReason: undefined,
    });
    return { inserted, alreadyExists: !inserted, id: dbId, status: "synced", ...(tempPassword ? { tempPassword } : {}) };
  }));
}

/**
 * Best-effort boot reconciliation. It safely closes markers for registrations
 * that already exist in the DB and restores missing accounts with a fresh,
 * one-time server credential. Password-account customers can use the normal
 * reset-password flow after automatic recovery; no original password is ever
 * retained in the durable folder.
 */
export async function recoverUnsyncedRegistrations(limit = 25): Promise<{ attempted: number; synced: number; blocked: number }> {
  const records = (await listUnsyncedRegistrations()).slice(0, limit);
  let synced = 0;
  let blocked = 0;
  for (const record of records) {
    try {
      const result = await retryUnsyncedRegistration(record.email, record.recordedAt);
      if (result.status === "synced") synced++;
      else blocked++;
    } catch (err) {
      logger.warn({ err, email: record.email }, "[account-records] automatic social-account recovery failed");
    }
  }
  return { attempted: records.length, synced, blocked };
}

/** Return all folder records that were never persisted to the database. */
export async function listUnsyncedRegistrations(): Promise<AccountRecord[]> {
  const all = await readAllRecords();
  const explicit = all.filter((record) => !record.dbPersisted);
  try {
    const rows = await db.select({ email: ucUsersTable.email }).from(ucUsersTable);
    const persisted = new Set(rows.map((row) => normalizeEmail(row.email)));
    return all.filter((record) => !record.dbPersisted || !persisted.has(normalizeEmail(record.email)));
  } catch {
    return explicit;
  }
}

/** Mark one folder-only registration as contacted/resolved without claiming it reached the DB. */
export async function resolveUnsyncedRegistration(
  email: string,
  recordedAt: string,
): Promise<AccountRecord> {
  return withWriteLock(async () => {
    const normalizedEmail = normalizeEmail(email);
    let resolved: AccountRecord | undefined;
    const updated = (await readAllRecords()).map((record) => {
      if (normalizeEmail(record.email) !== normalizedEmail || record.recordedAt !== recordedAt) {
        return record;
      }
      resolved = {
        ...record,
        followUpStatus: "resolved",
        resolvedAt: record.resolvedAt ?? new Date().toISOString(),
      };
      return resolved;
    });
    if (!resolved) {
      throw new Error(`No folder record found for email=${email} recordedAt=${recordedAt}`);
    }
    await writeRecordsAtomically(updated);
    return resolved;
  });
}

function withWriteLock<T>(fn: () => Promise<T>): Promise<T> {
  const result = writeQueue.then(fn);
  // Keep the queue advancing regardless of success/failure.
  writeQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}
