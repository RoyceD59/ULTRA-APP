/**
 * Test runner wrapper — isolates all tests from the live dev database.
 *
 * Usage (via package.json "test" script):
 *   node --import tsx/esm src/tests/run.ts
 *
 * Optional: TEST_GLOB limits the run to a subset of test files, e.g.
 *   TEST_GLOB='src/tests/orders-*.test.ts' pnpm test
 *
 * What it does
 * ────────────
 * 1. Creates one isolated PostgreSQL DATABASE for this entire test run
 *    (named  test_api_<timestamp>_<pid>  so concurrent runs don't clash).
 *    A separate database (rather than a schema inside the live database) is
 *    required because drizzle-kit push always introspects/diffs the "public"
 *    schema of whatever database it connects to — pointing it at a fresh
 *    database makes it simply create every table, with no diff against the
 *    live dev tables.
 * 2. Drops leftover test databases from earlier crashed runs (>30 min old).
 * 3. Runs `drizzle-kit push --force` once to create all tables there.
 * 4. Spawns the real test command as a child process with DATABASE_URL
 *    pointed at the isolated database — the child and its worker threads
 *    inherit the variable and never touch the live database.
 * 5. Drops the database unconditionally after the child exits.
 * 6. Exits with the child's exit code so CI sees the correct result.
 */

import pg from "pg";
import { execFileSync, execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const { Pool } = pg;

// ── 0. Require DATABASE_URL ───────────────────────────────────────────────────

const BASE_URL = process.env.DATABASE_URL;
if (!BASE_URL) {
  throw new Error("[test-setup] DATABASE_URL must be set before running tests.");
}

// ── 1. Admin pool (connects to live DB, only for database management) ─────────

const adminPool = new Pool({ connectionString: BASE_URL });

// ── 2. Drop stale test databases from earlier crashed runs ────────────────────

try {
  const { rows } = await adminPool.query<{ datname: string }>(
    // ~ is a regex match: anchored, digits only — unlike LIKE, where "_" is a
    // single-character wildcard that could match unrelated database names.
    String.raw`SELECT datname FROM pg_database WHERE datname ~ '^test_api_\d+_\d+$'`,
  );

  for (const { datname } of rows) {
    // Name format: test_api_<timestamp>_<pid>.  Re-validate in JS before
    // interpolating into DROP DATABASE — never drop a name we didn't generate.
    const match = /^test_api_(\d+)_\d+$/.exec(datname);
    if (!match) continue;
    const ts = parseInt(match[1]!, 10);
    const THIRTY_MINUTES = 30 * 60 * 1_000;
    if (!isNaN(ts) && Date.now() - ts > THIRTY_MINUTES) {
      await adminPool.query(`DROP DATABASE IF EXISTS "${datname}" WITH (FORCE)`);
      console.log(`[test-setup] Dropped stale test database: ${datname}`);
    }
  }
} catch (err) {
  console.warn("[test-setup] Could not clean stale test databases:", err);
}

// ── 3. Create the isolated database for this run ──────────────────────────────

const TEST_DB = `test_api_${Date.now()}_${process.pid}`;
await adminPool.query(`CREATE DATABASE "${TEST_DB}"`);
await adminPool.end();

// ── 4. Build the test DATABASE_URL pointing at the isolated database ──────────

const testUrl = new URL(BASE_URL);
testUrl.pathname = `/${TEST_DB}`;
const TEST_URL = testUrl.toString();

// ── 5. Populate the database with all tables via drizzle-kit push ─────────────
//
// push-force runs drizzle-kit push --force against TEST_URL. The new database
// is empty, so drizzle-kit generates plain CREATE TABLE statements for every
// table defined in lib/db/src/schema/.  We only do this once for the whole
// suite (not per-worker), so it's fast.

const dbPkgDir = fileURLToPath(new URL("../../../../lib/db", import.meta.url));

console.log(`[test-setup] Pushing schema to database "${TEST_DB}"…`);
try {
  execFileSync("pnpm", ["run", "push-force"], {
    cwd: dbPkgDir,
    env: { ...process.env, DATABASE_URL: TEST_URL },
    stdio: ["pipe", "pipe", "pipe"],
    input: "y\n",
  });
} catch (err) {
  const e = err as { stdout?: Buffer; stderr?: Buffer };
  console.error(
    "[test-setup] drizzle-kit push failed.\n",
    "stdout:", e.stdout?.toString() ?? "",
    "\nstderr:", e.stderr?.toString() ?? "",
  );
  await dropTestDatabase();
  process.exit(1);
}

console.log(`[test-setup] Database "${TEST_DB}" ready — running tests…\n`);

// ── 6. Run the test suite as a child process ──────────────────────────────────
//
// We pass DATABASE_URL=TEST_URL in the child's environment.  Every worker
// the node:test runner spawns inherits this variable, so @workspace/db always
// connects to the isolated database.
//
// execSync with a shell so the glob in the test pattern is expanded by sh.

let childExitCode = 0;
try {
  execSync(
    `node --import tsx/esm --test '${process.env["TEST_GLOB"] ?? "src/tests/**/*.test.ts"}'`,
    {
      cwd: fileURLToPath(new URL("../..", import.meta.url)), // artifacts/api-server
      env: { ...process.env, DATABASE_URL: TEST_URL },
      stdio: "inherit",
    },
  );
} catch (err) {
  // execSync throws when the child exits with a non-zero code.
  childExitCode = (err as { status?: number }).status ?? 1;
}

// ── 7. Drop the database unconditionally ─────────────────────────────────────

await dropTestDatabase();

process.exit(childExitCode);

// ── Helpers ───────────────────────────────────────────────────────────────────

async function dropTestDatabase(): Promise<void> {
  const pool = new Pool({ connectionString: BASE_URL });
  try {
    // FORCE terminates any connection a crashed worker may have left open.
    await pool.query(`DROP DATABASE IF EXISTS "${TEST_DB}" WITH (FORCE)`);
    console.log(`\n[test-setup] Test database "${TEST_DB}" dropped.`);
  } catch (err) {
    console.error("[test-setup] Failed to drop test database:", err);
  } finally {
    await pool.end();
  }
}
