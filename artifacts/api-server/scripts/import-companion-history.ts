import { readFile, stat } from "node:fs/promises";
import { pool } from "@workspace/db";
import { importCompanionHistory, type HistoryImportBundle } from "../src/lib/companion-history-import.js";

// Run only against an existing initialized schema. Even preview does not run
// DDL. Use a protected operator export, not a file committed to this repository.
const args = process.argv.slice(2);
const file = args.find(a => a.startsWith("--input="))?.slice(8);
const apply = args.includes("--apply");
try {
  if (!file || args.some(a => !a.startsWith("--input=") &&
      !["--apply", "--preview", "--approved-production-import"].includes(a))) {
    throw new Error("Usage: pnpm exec tsx scripts/import-companion-history.ts --input=/protected/export.json --preview");
  }
  if (apply && !["development", "test"].includes(process.env.NODE_ENV ?? "") &&
      !args.includes("--approved-production-import")) throw new Error("Production/unknown-environment import requires separate explicit operational approval.");
  const info = await stat(file);
  if (!info.isFile() || info.size > 20 * 1024 * 1024) throw new Error("Provide a bounded reviewed JSON export (maximum 20 MiB).");
  const bundle = JSON.parse(await readFile(file, "utf8")) as HistoryImportBundle;
  const counts = await importCompanionHistory(bundle, apply);
  process.stdout.write(`${JSON.stringify({ mode: apply ? "apply" : "preview", ...counts })}\n`);
} catch {
  // Never print raw exports, contacts, DB errors or credential-bearing URLs.
  process.stderr.write("Import rejected. Check the reviewed format, ownership conflicts, schema readiness and explicit environment approval. No partial import was committed.\n");
  process.exitCode = 1;
} finally { await pool.end(); }
