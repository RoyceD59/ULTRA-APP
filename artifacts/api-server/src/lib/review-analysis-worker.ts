import { randomUUID } from "node:crypto";
import { pool } from "@workspace/db";
import { batchProcess } from "@workspace/integrations-anthropic-ai";
import { classifyReview, reviewFingerprint, REVIEW_ANALYSIS_VERSION, type ReviewGenerator } from "./review-classifier.js";
import { logger } from "./logger.js";

export const REVIEW_BATCH_SIZE = 4;
const MAX_ATTEMPTS = 3;
const LEASE_MS = 60_000; // longer than the enforced provider deadline
// Deleted placeholders and deleted DB-linked identities are never eligible.
export const REVIEW_ELIGIBLE = `r.author_name <> '[deleted customer]' AND r.body <> '[deleted customer]'
  AND NOT EXISTS (SELECT 1 FROM uc_users u WHERE u.id::text=r.user_id AND u.deleted_at IS NOT NULL)`;

export async function processReviewBatch(options: { generator?: ReviewGenerator; ids?: number[]; timeoutMs?: number } = {}) {
  const token = randomUUID();
  // A single statement atomically claims at most four rows across all replicas.
  const claimed = await pool.query(
    `WITH due AS (
      SELECT r.id FROM uc_reviews r WHERE ${REVIEW_ELIGIBLE}
      AND ($4::int[] IS NULL OR r.id=ANY($4))
      AND (
        (COALESCE((r.analysis->>'version')::int,0) <> $1 AND r.analysis->>'status' <> 'processing')
        OR (r.analysis->>'status'='pending' AND COALESCE((r.analysis->>'nextAttemptAt')::timestamptz,now())<=now())
        OR (r.analysis->>'status'='processing' AND COALESCE((r.analysis->>'leaseUntil')::timestamptz,now())<=now())
      )
      ORDER BY r.created_at,r.id FOR UPDATE SKIP LOCKED LIMIT ${REVIEW_BATCH_SIZE}
    )
    UPDATE uc_reviews r SET analysis=json_build_object(
      'status','processing','version',$1::int,'revision',r.text_revision,'lease',$2::text,
      'leaseUntil',now()+($3::int * interval '1 millisecond'),
      'attempts',CASE WHEN (r.analysis->>'version')::int=$1 THEN COALESCE((r.analysis->>'attempts')::int,0)+1 ELSE 1 END)
    FROM due WHERE r.id=due.id RETURNING r.id,r.title,r.body,r.text_revision,r.analysis`,
    [REVIEW_ANALYSIS_VERSION, token, LEASE_MS, options.ids ?? null],
  );
  await batchProcess(claimed.rows, async (row) => {
    const attempts = Number(row.analysis.attempts);
    let result: Record<string, unknown>;
    if (attempts > MAX_ATTEMPTS) {
      result = { status: "failed", error: "Analysis interrupted repeatedly. Administrator retry available." };
    } else {
      try {
        const assessment = await classifyReview(row.title, row.body, options.generator, options.timeoutMs);
        result = { status: "completed", ...assessment, analyzedAt: new Date().toISOString() };
      } catch {
        // Never persist provider errors: they can contain request/response text.
        result = {
          status: attempts >= MAX_ATTEMPTS ? "failed" : "pending",
          error: "Automated assessment unavailable. Retry scheduled or administrator retry available.",
          nextAttemptAt: new Date(Date.now() + 60_000 * 2 ** (attempts - 1)).toISOString(),
        };
      }
    }
    const analysis = { ...result, attempts, version: REVIEW_ANALYSIS_VERSION,
      revision: row.text_revision, fingerprint: reviewFingerprint(row.title, row.body) };
    // CAS: revisions AND lease tokens prevent obsolete/edit/reclaimed work
    // from committing. The live identity check closes the deletion window.
    await pool.query(
      `UPDATE uc_reviews r SET analysis=$4::json WHERE r.id=$1 AND r.text_revision=$2
       AND r.analysis->>'lease'=$3 AND r.analysis->>'status'='processing'
       AND (r.analysis->>'leaseUntil')::timestamptz > now() AND ${REVIEW_ELIGIBLE}`,
      [row.id, row.text_revision, token, JSON.stringify(analysis)],
    );
  }, { concurrency: 2, retries: 0 });
  return claimed.rows.length;
}

export function startReviewAnalysisWorker() {
  if (process.env.NODE_ENV === "test" || process.env.PREVIEW_SAFE_MODE === "1") return;
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try { await processReviewBatch(); }
    catch { logger.warn("Customer review analysis batch unavailable"); }
    finally { busy = false; }
  };
  void tick();
  const timer = setInterval(() => void tick(), 15_000);
  timer.unref();
}