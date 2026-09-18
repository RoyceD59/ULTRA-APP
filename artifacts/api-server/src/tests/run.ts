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
 *
 * Signal handling
 * ───────────────
 * SIGTERM and SIGINT are caught so a force-stopped runner (CI timeout,
 * Ctrl-C, OOM killer sending SIGTERM) still drops the test database.
 * Both the normal path and the signal path share a single idempotent
 * cleanup promise, so the drop happens exactly once regardless of which
 * path wins the race.  SIGKILL cannot be caught; the 30-minute stale
 * cleanup on the next run handles that case.
 */

import { Pool } from "pg";
import { spawn, type ChildProcess } from "node:child_process";
import { readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

// ── 0. Require DATABASE_URL ───────────────────────────────────────────────────

const BASE_URL = process.env.DATABASE_URL;
if (!BASE_URL) {
  throw new Error("[test-setup] DATABASE_URL must be set before running tests.");
}

// ── State ─────────────────────────────────────────────────────────────────────
//
// TEST_DB is assigned once the database is created; it is the guard that tells
// cleanup whether a drop is needed.  activeChild tracks the running subprocess
// so signal handlers can forward the termination.  cleanupPromise is the
// shared, idempotent cleanup future — created once, awaited by both the normal
// path and signal handlers.

let TEST_DB = "";
let activeChild: ChildProcess | null = null;
let cleanupPromise: Promise<void> | null = null;

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Drop the test database.  No-op if TEST_DB is still empty. */
async function dropTestDatabase(): Promise<void> {
  if (!TEST_DB) return;
  const pool = new Pool({ connectionString: BASE_URL! });
  try {
    // FORCE terminates any connections a crashed worker may have left open.
    await pool.query(`DROP DATABASE IF EXISTS "${TEST_DB}" WITH (FORCE)`);
    console.log(`\n[test-setup] Test database "${TEST_DB}" dropped.`);
  } catch (err) {
    console.error("[test-setup] Failed to drop test database:", err);
  } finally {
    await pool.end();
  }
}

/**
 * Idempotent cleanup: the first caller creates the drop promise; every
 * subsequent caller (normal path or signal handler) awaits the same promise.
 * This guarantees the database is dropped exactly once.
 */
function ensureCleanup(): Promise<void> {
  if (!cleanupPromise) {
    cleanupPromise = dropTestDatabase();
  }
  return cleanupPromise;
}

/**
 * Spawn a child process and resolve with its exit code.
 * Stores the handle in activeChild so signal handlers can forward kills.
 */
function spawnAsync(
  cmd: string,
  args: string[],
  opts: {
    cwd: string;
    env: NodeJS.ProcessEnv;
    stdio: "inherit" | "pipe";
    input?: string;
  },
): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      env: opts.env,
      stdio: opts.stdio === "pipe" ? ["pipe", "pipe", "pipe"] : "inherit",
    });
    activeChild = child;

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    if (opts.stdio === "pipe") {
      if (opts.input !== undefined) {
        child.stdin?.write(opts.input);
        child.stdin?.end();
      }
      child.stdout?.on("data", (d: Buffer) => stdoutChunks.push(d));
      child.stderr?.on("data", (d: Buffer) => stderrChunks.push(d));
    }

    child.on("close", (code) => {
      activeChild = null;
      const exitCode = code ?? 1;
      if (opts.stdio === "pipe" && exitCode !== 0) {
        console.error(
          "[test-setup] Child process failed.\n",
          "stdout:", Buffer.concat(stdoutChunks).toString(),
          "\nstderr:", Buffer.concat(stderrChunks).toString(),
        );
      }
      resolve(exitCode);
    });
  });
}

// ── Signal handlers ───────────────────────────────────────────────────────────
//
// Registered before the database is created so the full lifecycle is protected.
// On SIGTERM or SIGINT:
//   1. Kill the active child (if any) — this unblocks any running spawnAsync.
//   2. Drop the test database via the shared, idempotent ensureCleanup().
//   3. Remove these listeners and re-raise the signal so the shell sees a
//      proper signal exit rather than exit code 0.
//
// After re-raising, the default handler terminates the process; any concurrent
// normal-path code that calls process.exit() is then a harmless no-op.

const handleSignal = async (signal: NodeJS.Signals): Promise<void> => {
  console.log(`\n[test-setup] Received ${signal} — dropping test database before exit…`);

  // Forward the signal to the child.  The child's exit fires the spawnAsync
  // "close" handler, which lets the main-flow await resolve naturally; by then
  // cleanupPromise will already be set, so the main flow's ensureCleanup() call
  // simply awaits the same promise and process.exit() is the tiebreaker.
  if (activeChild && !activeChild.killed) {
    activeChild.kill(signal);
    // Belt-and-suspenders hard kill if the child ignores the first signal.
    const hardKillTimer = setTimeout(() => {
      if (activeChild && !activeChild.killed) {
        activeChild.kill("SIGKILL");
      }
    }, 5_000);
    hardKillTimer.unref(); // don't keep the event loop alive
  }

  await ensureCleanup();

  // Re-raise with the default handler.
  process.off("SIGTERM", sigTermListener);
  process.off("SIGINT",  sigIntListener);
  process.kill(process.pid, signal);
};

const sigTermListener = (): void => { void handleSignal("SIGTERM"); };
const sigIntListener  = (): void => { void handleSignal("SIGINT"); };
process.on("SIGTERM", sigTermListener);
process.on("SIGINT",  sigIntListener);

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

TEST_DB = `test_api_${Date.now()}_${process.pid}`;
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

const pushExitCode = await spawnAsync("pnpm", ["run", "push-force"], {
  cwd: dbPkgDir,
  env: { ...process.env, DATABASE_URL: TEST_URL },
  stdio: "pipe",
  input: "y\n",
});

if (pushExitCode !== 0) {
  await ensureCleanup();
  process.exit(1);
}

console.log(`[test-setup] Database "${TEST_DB}" ready — running tests…\n`);

// ── 6. Run the test suite as a child process ──────────────────────────────────
//
// We pass DATABASE_URL=TEST_URL in the child's environment.  Every worker
// the node:test runner spawns inherits this variable, so @workspace/db always
// connects to the isolated database.

const testGlob = process.env["TEST_GLOB"];
// These suites deliberately replace process-wide seams (process.env and
// globalThis.fetch), while the referral suite shares account/settlement state.
// The default run executes ordinary files in one parallel phase, then these
// four files in a separate serial phase against the same isolated database.
const SHARED_STATE_FILES = [
  "dual-failure-alert",
  "reminder-concurrency",
  "reminder-rewards-credit",
  "referral-lifecycle",
];
const testNamePattern = process.env["TEST_NAME_PATTERN"];

const testCwd = fileURLToPath(new URL("../..", import.meta.url)); // artifacts/api-server

async function listTestFiles(directory: string, prefix = ""): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
    const absolutePath = `${directory}/${entry.name}`;
    if (entry.isDirectory()) {
      files.push(...await listTestFiles(absolutePath, relativePath));
    } else if (entry.isFile() && entry.name.endsWith(".test.ts")) {
      files.push(relativePath);
    }
  }
  return files.sort();
}

async function runTestPhase(
  phaseName: string,
  testFiles: string[],
  concurrency: number,
  fileCount = testFiles.length,
): Promise<number> {
  if (testFiles.length === 0) return 0;
  console.log(`[test-setup] Running ${phaseName} (${fileCount} file${fileCount === 1 ? "" : "s"})…\n`);
  return spawnAsync(
    "node",
    [
      "--import",
      "tsx/esm",
      "--test",
      "--test-force-exit",
      `--test-concurrency=${concurrency}`,
      ...(testNamePattern ? ["--test-name-pattern", testNamePattern] : []),
      ...testFiles,
    ],
    {
      cwd: testCwd,
      env: { ...process.env, DATABASE_URL: TEST_URL },
      stdio: "inherit",
    },
  );
}

let childExitCode: number;
if (testGlob) {
  // Explicit TEST_GLOB runs retain their historical single-phase behavior.
  const concurrency = SHARED_STATE_FILES.some((part) => testGlob.includes(part)) ? 1 : 32;
  childExitCode = await runTestPhase("focused tests", [testGlob], concurrency);
} else {
  const allTests = await listTestFiles(`${testCwd}/src/tests`);
  const sharedTests = allTests.filter((file) =>
    SHARED_STATE_FILES.some((part) => file.endsWith(`${part}.test.ts`)),
  );
  const ordinaryTests = allTests.filter((file) => !sharedTests.includes(file));
  // Keep each phase to one glob argument. Node's test CLI folds a large list
  // of positional paths into one invalid comma-separated glob, while brace
  // expansion handles the full suite reliably.
  const asGlob = (files: string[]): string => {
    const paths = files.map((file) => `src/tests/${file}`);
    return paths.length === 1 ? paths[0]! : `{${paths.join(",")}}`;
  };

  // Run both phases even if the first fails, so the final result reflects
  // failures from either phase and the shared-state suites still get coverage.
  const ordinaryExitCode = await runTestPhase(
    "ordinary tests",
    [asGlob(ordinaryTests)],
    32,
    ordinaryTests.length,
  );
  const sharedExitCode = await runTestPhase(
    "shared-state tests",
    [asGlob(sharedTests)],
    1,
    sharedTests.length,
  );
  childExitCode = ordinaryExitCode !== 0 ? ordinaryExitCode : sharedExitCode;
}

// ── 7. Drop the database unconditionally ─────────────────────────────────────
//
// ensureCleanup() is idempotent: if a signal handler already started (or
// finished) the drop, this call simply awaits the same promise.

await ensureCleanup();

process.exit(childExitCode);
