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
  source: "registration" | "social-registration" | "woocommerce-login" | "backfill";
  /** False when the DB insert failed and the folder is the only record. */
  dbPersisted: boolean;
  /** Latest reconciliation state, retained for staff visibility. */
  recoveryStatus?: "pending" | "blocked" | "resolved" | "retryable";
  /** Why staff intervention is required, if a recovery is blocked. */
  recoveryReason?: "email_conflict" | "phone_conflict" | "invalid_phone";
  recoveryAttempts?: number;
  lastRecoveryAttemptAt?: string;
  /** Database account selected by an administrator during recovery. */
  targetAccountId?: number;
  /** Administrator (or the boot reconciler) that completed recovery. */
  resolvedBy?: string;
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
  authProvider: "password" | "social" | "woocommerce";
  createdAt?: Date | string | null;
  source: "registration" | "social-registration" | "woocommerce-login";
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
  options: {
    originalPhone?: string;
    correctedEmail?: string;
    correctedPhone?: string;
    targetAccountId?: number;
    createAccount?: boolean;
    resolvedBy?: string;
  } = {},
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
    const hasOriginalPhone = options.originalPhone !== undefined;
    const normalizedOriginalPhone = hasOriginalPhone ? normalizePhone(options.originalPhone ?? "") : null;
    if (!normalizedEmail && !normalizedOriginalPhone) {
      throw new Error("An original ledger email or phone is required");
    }
    const normalizedCorrectedEmail = normalizeEmail(options.correctedEmail ?? email);
    const normalizedCorrectedPhone = options.correctedPhone === undefined
      ? null
      : normalizePhone(options.correctedPhone);
    const hasCorrectedPhone = options.correctedPhone !== undefined;
    const createAccount = options.createAccount === true;
    if (hasOriginalPhone && !normalizedOriginalPhone) {
      throw new Error("A valid original phone is required");
    }
    if ((hasCorrectedPhone && !normalizedCorrectedPhone)) {
      throw new Error("A valid corrected phone is required");
    }
    if (createAccount && !normalizedCorrectedPhone) {
      throw new Error("A valid corrected phone is required when creating an account");
    }
    if (options.targetAccountId !== undefined && (!Number.isInteger(options.targetAccountId) || options.targetAccountId <= 0)) {
      throw new Error("A valid target account is required");
    }
    if (normalizedEmail) {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${"uc-email:" + normalizedEmail}))`);
    }
    if (normalizedCorrectedEmail) {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${"uc-email:" + normalizedCorrectedEmail}))`);
    }
    if (normalizedOriginalPhone) {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${"uc-phone:" + normalizedOriginalPhone}))`);
    }
    if (normalizedCorrectedPhone) {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${"uc-phone:" + normalizedCorrectedPhone}))`);
    }
    if (options.targetAccountId !== undefined) {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${"uc-account:" + options.targetAccountId}))`);
    }
    const target = (await readAllRecords()).find((record) =>
      (!normalizedEmail || normalizeEmail(record.email) === normalizedEmail) &&
      (!normalizedOriginalPhone || normalizePhone(record.phone) === normalizedOriginalPhone) &&
      record.recordedAt === recordedAt
    );
    if (!target) throw new Error(`No folder record found for email=${email} recordedAt=${recordedAt}`);

    const normalizedPhone = normalizePhone(target.phone);
    const attemptedAt = new Date().toISOString();
    const updateRecord = async (
      patch: Partial<AccountRecord>,
    ): Promise<void> => {
      const updated = (await readAllRecords()).map((record) =>
        (!normalizedEmail || normalizeEmail(record.email) === normalizedEmail) &&
        (!normalizedOriginalPhone || normalizePhone(record.phone) === normalizedOriginalPhone) &&
        record.recordedAt === recordedAt
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

    if (!normalizedPhone && !normalizedCorrectedPhone) {
      await updateRecord({ recoveryStatus: "blocked", recoveryReason: "invalid_phone" });
      return { inserted: false, alreadyExists: false, id: null, status: "blocked", reason: "invalid_phone" };
    }
    const recoveryPhone = normalizedCorrectedPhone ?? normalizedPhone;
    if (!recoveryPhone) {
      await updateRecord({ recoveryStatus: "blocked", recoveryReason: "invalid_phone" });
      return { inserted: false, alreadyExists: false, id: null, status: "blocked", reason: "invalid_phone" };
    }

    const [emailMatch] = normalizedCorrectedEmail ? await tx.select({
      id: ucUsersTable.id,
      phone: ucUsersTable.phone,
      email: ucUsersTable.email,
    }).from(ucUsersTable)
      .where(and(eq(ucUsersTable.email, normalizedCorrectedEmail), isNull(ucUsersTable.deletedAt))).limit(1) : [];
    const [phoneMatch] = recoveryPhone ? await tx.select({
      id: ucUsersTable.id,
      email: ucUsersTable.email,
    }).from(ucUsersTable)
      .where(and(eq(ucUsersTable.phone, recoveryPhone), isNull(ucUsersTable.deletedAt))).limit(1) : [];

    const selectedAccount = options.targetAccountId === undefined
      ? undefined
      : (await tx.select({
          id: ucUsersTable.id,
          email: ucUsersTable.email,
          phone: ucUsersTable.phone,
        }).from(ucUsersTable)
          .where(and(eq(ucUsersTable.id, options.targetAccountId), isNull(ucUsersTable.deletedAt)))
          .for("update")
          .limit(1))[0];
    if (options.targetAccountId !== undefined && !selectedAccount) {
      await updateRecord({ recoveryStatus: "blocked", recoveryReason: "email_conflict" });
      return { inserted: false, alreadyExists: false, id: null, status: "blocked", reason: "email_conflict" };
    }
    const effectiveCorrectedEmail = normalizedCorrectedEmail || (selectedAccount ? normalizeEmail(selectedAccount.email) : "");
    if (!effectiveCorrectedEmail) {
      throw new Error("A valid corrected email is required when creating an account");
    }
    // A selected account must own every corrected identity supplied by the
    // operator. This prevents a typo from linking a ledger row to the wrong
    // customer, while allowing the account's other contact to be omitted.
    if (selectedAccount && (
      normalizeEmail(selectedAccount.email) !== effectiveCorrectedEmail ||
      (hasCorrectedPhone && selectedAccount.phone !== recoveryPhone)
    )) {
      await updateRecord({ recoveryStatus: "blocked", recoveryReason: "email_conflict" });
      return { inserted: false, alreadyExists: false, id: null, status: "blocked", reason: "email_conflict" };
    }

    // A matching email and phone represents the same registration that reached
    // the DB before its durable-folder marker could be rewritten.
    if (emailMatch && (!selectedAccount || emailMatch.id !== selectedAccount.id)) {
      if (emailMatch.phone !== recoveryPhone) {
        await updateRecord({ recoveryStatus: "blocked", recoveryReason: "email_conflict" });
        return { inserted: false, alreadyExists: false, id: null, status: "blocked", reason: "email_conflict" };
      }
      await updateRecord({
        dbPersisted: true,
        id: target.id ?? emailMatch.id,
        email: effectiveCorrectedEmail,
        phone: recoveryPhone,
        recoveryStatus: "resolved",
        recoveryReason: undefined,
        targetAccountId: emailMatch.id,
        resolvedBy: options.resolvedBy ?? "system",
        resolvedAt: new Date().toISOString(),
      });
      return { inserted: false, alreadyExists: true, id: emailMatch.id, status: "synced" };
    }
    if (phoneMatch && (!selectedAccount || phoneMatch.id !== selectedAccount.id)) {
      await updateRecord({ recoveryStatus: "blocked", recoveryReason: "phone_conflict" });
      return { inserted: false, alreadyExists: false, id: null, status: "blocked", reason: "phone_conflict" };
    }

    if (selectedAccount) {
      await updateRecord({
        dbPersisted: true,
        id: target.id ?? selectedAccount.id,
        email: effectiveCorrectedEmail,
        phone: recoveryPhone,
        recoveryStatus: "resolved",
        recoveryReason: undefined,
        targetAccountId: selectedAccount.id,
        resolvedBy: options.resolvedBy ?? "system",
        resolvedAt: new Date().toISOString(),
      });
      return { inserted: false, alreadyExists: true, id: selectedAccount.id, status: "synced" };
    }
    if (!createAccount && options.targetAccountId === undefined && (emailMatch || phoneMatch)) {
      // Legacy retry behavior reconciles an exact existing identity. A
      // corrected identity that belongs to an account must be explicitly
      // selected by the administrator instead.
      await updateRecord({ recoveryStatus: "blocked", recoveryReason: emailMatch ? "email_conflict" : "phone_conflict" });
      return {
        inserted: false, alreadyExists: false, id: null, status: "blocked",
        reason: emailMatch ? "email_conflict" : "phone_conflict",
      };
    }

    let dbId: number | null = null;
    let inserted = false;
    let tempPassword: string | undefined;
    const passwordHash = target.authProvider === "password"
      ? await (async () => { tempPassword = randomBytes(12).toString("hex"); return bcryptjs.hash(tempPassword, 10); })()
      : await bcryptjs.hash(randomBytes(16).toString("hex"), 10);
    const [created] = await tx.insert(ucUsersTable).values({
      email: effectiveCorrectedEmail, passwordHash, phone: recoveryPhone, firstName: target.firstName,
      lastName: target.lastName, authProvider: target.authProvider, createdAt: new Date(target.createdAt),
      // A recovered password account receives a one-time credential, not a
      // normal permanent password. Keep the handoff finite and invalidate any
      // pre-existing credential version semantics from the account creation.
      ...(target.authProvider === "password" ? {
        mustChangePassword: true,
        temporaryPasswordExpiresAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
        credentialVersion: 1,
      } : {}),
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
      email: effectiveCorrectedEmail,
      phone: recoveryPhone,
      recoveryStatus: "resolved",
      recoveryReason: undefined,
      targetAccountId: dbId ?? undefined,
      resolvedBy: options.resolvedBy ?? "system",
      resolvedAt: new Date().toISOString(),
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
  try {
    const rows = await db.select({ email: ucUsersTable.email }).from(ucUsersTable);
    const persisted = new Set(rows.map((row) => normalizeEmail(row.email)));
    // Keep every folder-only row, plus any row carrying an explicit recovery
    // state (including a database-persisted resolution) visible for audit.
    // Ordinary successfully persisted registration backups remain hidden.
    return all.filter((record) =>
      !record.dbPersisted
      || record.recoveryStatus !== undefined
      || !persisted.has(normalizeEmail(record.email))
    );
  } catch {
    // A database outage must not hide persisted recovery audit rows. They are
    // still actionable/visible until the explicit clear operation rewrites the
    // ledger, even though ordinary persisted registration backups stay hidden.
    return all.filter((record) =>
      !record.dbPersisted
      || record.recoveryStatus !== undefined
      || record.followUpStatus === "resolved"
    );
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

/**
 * Remove only rows whose recovery was both persisted to the database and
 * explicitly resolved. Contacted/follow-up rows and every unresolved or
 * blocked row remain in the ledger for audit.
 */
export async function clearResolvedRegistrations(): Promise<number> {
  return withWriteLock(async () => {
    const records = await readAllRecords();
    const retained = records.filter((record) =>
      !(record.dbPersisted && record.recoveryStatus === "resolved")
    );
    const cleared = records.length - retained.length;
    if (cleared > 0) await writeRecordsAtomically(retained);
    return cleared;
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
