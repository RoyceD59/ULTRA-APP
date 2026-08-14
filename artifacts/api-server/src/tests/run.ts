/**
 * Test runner wrapper — isolates all tests from the live dev database.
 *
 * Usage (via package.json "test" script):
 *   node --import tsx/esm src/tests/run.ts
 *
 * What it does
 * ────────────
 * 1. Creates one isolated PostgreSQL schema for this entire test run
 *    (named  test_api_<timestamp>_<pid>  so concurrent runs don't clash).
 * 2. Drops leftover schemas from earlier crashed runs (>1 h old).
 * 3. Runs `drizzle-kit push --force` once to create all tables there.
 * 4. Spawns the real test command as a child process with DATABASE_URL
 *    pointed at the isolated schema — the child and its worker threads
 *    inherit the variable and never touch the live database.
 * 5. Drops the schema unconditionally after the child exits.
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

// ── 1. Admin pool (connects to live DB, only for schema management) ───────────

const adminPool = new Pool({ connectionString: BASE_URL });

// ── 2. Drop stale schemas from earlier crashed runs ───────────────────────────

try {
  const { rows } = await adminPool.query<{ schema_name: string }>(
    `SELECT schema_name
       FROM information_schema.schemata
      WHERE schema_name LIKE 'test_api_%'`,
  );

  for (const { schema_name } of rows) {
    // Name format: test_api_<timestamp>_<pid>
    const parts = schema_name.split("_");
    const ts = parseInt(parts[2] ?? "0", 10);
    const THIRTY_MINUTES = 30 * 60 * 1_000;
    if (!isNaN(ts) && Date.now() - ts > THIRTY_MINUTES) {
      await adminPool.query(`DROP SCHEMA IF EXISTS "${schema_name}" CASCADE`);
      console.log(`[test-setup] Dropped stale schema: ${schema_name}`);
    }
  }
} catch (err) {
  console.warn("[test-setup] Could not clean stale test schemas:", err);
}

// ── 3. Create the isolated schema for this run ────────────────────────────────

const SCHEMA = `test_api_${Date.now()}_${process.pid}`;
await adminPool.query(`CREATE SCHEMA "${SCHEMA}"`);
await adminPool.end();

// ── 4. Build the test DATABASE_URL with search_path → isolated schema ─────────
//
// The libpq `options` URI parameter sets runtime parameters per connection.
// Every pg.Pool opened from this URL operates in SCHEMA, so all Drizzle
// table references resolve there instead of the live "public" schema.

const TEST_URL =
  BASE_URL + (BASE_URL.includes("?") ? "&" : "?") +
  `options=-c%20search_path%3D${SCHEMA}`;

// ── 5. Populate the schema with all tables via drizzle-kit push ───────────────
//
// push-force runs drizzle-kit push --force against TEST_URL, creating every
// table defined in lib/db/src/schema/ inside SCHEMA.  We only do this once
// for the whole suite (not per-worker), so it's fast.

const dbPkgDir = fileURLToPath(new URL("../../../../lib/db", import.meta.url));

console.log(`[test-setup] Pushing schema to "${SCHEMA}"…`);
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
  await dropSchema();
  process.exit(1);
}

console.log(`[test-setup] Schema "${SCHEMA}" ready — running tests…\n`);

// ── 6. Run the test suite as a child process ──────────────────────────────────
//
// We pass DATABASE_URL=TEST_URL in the child's environment.  Every worker
// the node:test runner spawns inherits this variable, so @workspace/db always
// connects to the isolated schema.
//
// execSync with a shell so the glob in the test pattern is expanded by sh.

let childExitCode = 0;
try {
  execSync(
    "node --import tsx/esm --test 'src/tests/**/*.test.ts'",
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

// ── 7. Drop the schema unconditionally ───────────────────────────────────────

await dropSchema();

process.exit(childExitCode);

// ── Helpers ───────────────────────────────────────────────────────────────────

async function dropSchema(): Promise<void> {
  const pool = new Pool({ connectionString: BASE_URL });
  try {
    await pool.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
    console.log(`\n[test-setup] Test schema "${SCHEMA}" dropped.`);
  } catch (err) {
    console.error("[test-setup] Failed to drop test schema:", err);
  } finally {
    await pool.end();
  }
}
