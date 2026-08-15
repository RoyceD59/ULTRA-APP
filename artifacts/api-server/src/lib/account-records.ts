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
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { db, ucUsersTable } from "@workspace/db";
import { logger } from "./logger";

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

async function appendRecord(record: AccountRecord): Promise<void> {
  await mkdir(ACCOUNT_DATA_DIR, { recursive: true });
  await appendFile(join(ACCOUNT_DATA_DIR, ACCOUNTS_FILE), JSON.stringify(record) + "\n", "utf8");
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
    email: input.email.toLowerCase().trim(),
    phone: input.phone,
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
  await writeFile(markerPath, `${new Date().toISOString()} backfilled=${written}\n`, "utf8");
  logger.info({ written, total: users.length }, "[account-records] one-time backfill complete");
}
