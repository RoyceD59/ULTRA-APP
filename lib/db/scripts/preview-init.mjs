import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import pg from "pg";

const raw = process.env.DATABASE_URL;
let target;
try { target = new URL(raw); } catch { throw new Error("Preview database URL is missing"); }
if (process.env.PREVIEW_SAFE_MODE !== "1" || target.hostname !== "db" || target.pathname !== "/ultra_preview") {
  throw new Error("Preview schema initialization refuses a non-disposable database");
}

const here = path.dirname(fileURLToPath(import.meta.url));
const dbRoot = path.resolve(here, "..");
const command = spawnSync("pnpm", ["run", "push-force"], { cwd: dbRoot, env: process.env, stdio: "inherit" });
if (command.status !== 0) throw new Error(`Preview schema creation failed (${command.status ?? "unknown"})`);

const migration = await readFile(path.resolve(dbRoot, "migrations/0054_uc_refill_governance.sql"), "utf8");
const flagsMigration = await readFile(path.resolve(dbRoot, "migrations/0055_refill_preview_flags.sql"), "utf8");
const pool = new pg.Pool({ connectionString: raw });
try {
  await pool.query(migration);
  await pool.query(flagsMigration);
}
finally { await pool.end(); }
console.log("Disposable preview schema and governance migration ready");