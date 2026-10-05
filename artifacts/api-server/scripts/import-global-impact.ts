/**
 * Operator-only historical import. Run only with approval for the target DB.
 * Example: pnpm exec tsx scripts/import-global-impact.ts /verified/impact-override.json
 */
import { readFile } from "node:fs/promises";
import { pool } from "@workspace/db";
import { GLOBAL_IMPACT_DDL, importLegacyImpact } from "../src/lib/global-impact-store.js";
const filename = process.argv[2];
if (!filename || process.argv.length !== 3) throw new Error("Provide one verified legacy adjustment file; no defaults are assumed.");
try {
  const raw = await readFile(filename, "utf8");
  await pool.query(GLOBAL_IMPACT_DDL);
  const imported = await importLegacyImpact(raw);
  console.log(imported ? "Historical adjustments imported and audited." : "Shared adjustments already exist; historical file did not overwrite them.");
} finally { await pool.end(); }
