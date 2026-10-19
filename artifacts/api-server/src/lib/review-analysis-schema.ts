import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { pool } from "@workspace/db";

/** One migration source for startup rollout and isolated test databases. */
export async function ensureReviewAnalysisSchema() {
  // Build copies this migration to dist; tsx reads the shared source.
  const path = import.meta.url.includes("/dist/")
    ? new URL("./0056_review_analysis.sql", import.meta.url)
    : new URL("../../../../lib/db/migrations/0056_review_analysis.sql", import.meta.url);
  await pool.query(await readFile(fileURLToPath(path), "utf8"));
}