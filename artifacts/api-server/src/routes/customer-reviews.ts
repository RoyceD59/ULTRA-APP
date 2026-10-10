import { Router, type Request, type Response } from "express";
import type { PoolClient } from "pg";
import { pool } from "@workspace/db";
import { isAdminRequest } from "../lib/adminAuth.js";
import { verifyToken } from "../lib/jwt.js";
import { ratingSentiment, disagreement, REVIEW_ANALYSIS_VERSION, SENTIMENTS } from "../lib/review-classifier.js";
import { REVIEW_ELIGIBLE } from "../lib/review-analysis-worker.js";
import { wcFetchArray } from "./uc.js";
import { logger } from "../lib/logger.js";

const router = Router();
async function requireReviewsAdmin(req: Request, res: Response) {
  if (await isAdminRequest(req.headers.authorization)) return true;
  res.status(verifyToken(req.headers.authorization) ? 403 : 401).json({ error: "Administrator access required" });
  return false;
}
export const reviewCatalogue = {
  resolve: async (ids: number[]): Promise<Map<number, string>> => {
    const labels = new Map<number, string>();
    const signal = AbortSignal.timeout(5_000);
    // One catalogue call per batch, never one per review. Labels may be missing
    // during an upstream outage; the review log itself remains available.
    for (let start = 0; start < ids.length; start += 100) {
      if (signal.aborted) break;
      const products = await wcFetchArray("/products", {
        include: ids.slice(start, start + 100).join(","), per_page: "100",
      }, signal);
      if (!products) break;
      for (const p of products) if (typeof p.name === "string") labels.set(Number(p.id), p.name.replace(/<[^>]*>/g, ""));
    }
    return labels;
  },
};
const STATUSES = ["pending", "processing", "completed", "failed", "unavailable"];
const RATING_SQL = `CASE WHEN r.rating>=4 THEN 'Positive' WHEN r.rating=3 THEN 'Neutral' ELSE 'Negative' END`;
const DISAGREEMENT_SQL = `(r.analysis->>'status'='completed' AND (
  (r.rating>=4 AND r.analysis->>'category'='Negative') OR (r.rating<=2 AND r.analysis->>'category'='Positive')))`;

/** Strict query parser shared with tests. SQL values are always parameterized. */
export function parseReviewQuery(query: Record<string, unknown>) {
  const values: unknown[] = [];
  const where: string[] = [];
  const param = (value: unknown) => { values.push(value); return `$${values.length}`; };
  const scalar = (key: string) => {
    if (query[key] === undefined || query[key] === "") return undefined;
    if (typeof query[key] !== "string") throw new Error(`Invalid ${key}`);
    return query[key] as string;
  };
  const number = (key: string, fallback: number, max: number) => {
    const raw = scalar(key);
    if (raw === undefined) return fallback;
    if (!/^[1-9]\d*$/.test(raw) || Number(raw) > max) throw new Error(`Invalid ${key}`);
    return Number(raw);
  };
  const page = number("page", 1, 100_000), limit = number("limit", 20, 50);
  const productId = scalar("productId");
  if (productId) where.push(`r.product_id=${param(number("productId", 0, 2_147_483_647))}`);
  const rating = scalar("rating");
  if (rating) where.push(`r.rating=${param(number("rating", 0, 5))}`);
  const ratingFilter = scalar("ratingSentiment");
  if (ratingFilter) {
    if (!["Positive", "Neutral", "Negative"].includes(ratingFilter)) throw new Error("Invalid ratingSentiment");
    where.push(`${RATING_SQL}=${param(ratingFilter)}`);
  }
  const ai = scalar("aiSentiment");
  if (ai) {
    if (!SENTIMENTS.includes(ai as typeof SENTIMENTS[number])) throw new Error("Invalid aiSentiment");
    where.push(`r.analysis->>'status'='completed' AND r.analysis->>'category'=${param(ai)}`);
  }
  const status = scalar("status");
  if (status) {
    if (!STATUSES.includes(status)) throw new Error("Invalid status");
    where.push(`r.analysis->>'status'=${param(status)}`);
  }
  const differing = scalar("disagreement");
  if (differing !== undefined) {
    if (!["true", "false"].includes(differing)) throw new Error("Invalid disagreement");
    where.push(`COALESCE(${DISAGREEMENT_SQL},false)=${param(differing === "true")}`);
  }
  const search = scalar("search");
  if (search) {
    if (search.length > 200) throw new Error("Search is too long");
    // Escape wildcards so search is literal substring matching.
    const p = param(`%${search.replace(/[\\%_]/g, "\\$&")}%`);
    where.push(`(r.title ILIKE ${p} OR r.body ILIKE ${p})`);
  }
  return { page, limit, values, where: where.length ? where.map(w => `(${w})`).join(" AND ") : "TRUE" };
}

router.get("/admin/customer-reviews", async (req, res) => {
  if (!await requireReviewsAdmin(req, res)) return;
  let filters: ReturnType<typeof parseReviewQuery>;
  try { filters = parseReviewQuery(req.query); }
  catch (error) { res.status(400).json({ error: (error as Error).message }); return; }
  let client: PoolClient | undefined;
  try {
    client = await pool.connect();
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const { where, values, page, limit } = filters;
    const rows = (await client.query(
      `SELECT r.id,r.product_id AS "productId",r.author_name AS "authorName",r.rating,r.title,r.body,r.media,
        r.created_at AS "createdAt",r.edited_at AS "editedAt",r.analysis
       FROM uc_reviews r WHERE ${where} ORDER BY r.created_at DESC,r.id DESC
       LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
      [...values, limit, (page - 1) * limit],
    )).rows;
    const groups = (await client.query(
      `SELECT ${RATING_SQL} AS rating,r.analysis->>'status' AS status,
        CASE WHEN r.analysis->>'status'='completed' THEN r.analysis->>'category' END AS ai,
        COALESCE(${DISAGREEMENT_SQL},false) AS disagreement,count(*)::int AS count
       FROM uc_reviews r WHERE ${where} GROUP BY 1,2,3,4`, values,
    )).rows;
    const products = (await client.query(`SELECT DISTINCT product_id AS id FROM uc_reviews ORDER BY product_id`)).rows;
    await client.query("COMMIT");
    // Do not reserve database capacity while waiting for the catalogue.
    client.release(); client = undefined;
    const counts = {
      rating: { Positive: 0, Neutral: 0, Negative: 0 } as Record<string, number>,
      ai: { Positive: 0, Neutral: 0, Negative: 0, Mixed: 0 } as Record<string, number>,
      status: { pending: 0, processing: 0, completed: 0, failed: 0, unavailable: 0 } as Record<string, number>,
      disagreements: 0,
    };
    let total = 0;
    for (const g of groups) {
      total += g.count;
      counts.rating[g.rating] += g.count;
      if (g.ai && g.ai in counts.ai) counts.ai[g.ai] += g.count;
      if (g.status in counts.status) counts.status[g.status] += g.count;
      if (g.disagreement) counts.disagreements += g.count;
    }
    const names = await reviewCatalogue.resolve(products.map(p => p.id)).catch(() => new Map<number, string>());
    const name = (id: number) => names.get(id) || `Product #${id}`;
    res.json({ page, limit, total, counts,
      products: products.map(p => ({ id: p.id, name: name(p.id) })),
      reviews: rows.map(r => ({
        ...r, productName: name(r.productId), ratingSentiment: ratingSentiment(r.rating),
        disagreement: r.analysis.status === "completed" && disagreement(r.rating, r.analysis.category),
        // Lease/fingerprint/retry internals need not be exposed even to staff.
        analysis: {
          status: r.analysis.status, category: r.analysis.category,
          explanation: r.analysis.explanation, themes: r.analysis.themes,
          analyzedAt: r.analysis.analyzedAt, error: r.analysis.error,
        },
      })),
    });
  } catch {
    await client?.query("ROLLBACK").catch(() => undefined);
    logger.warn("Customer review log unavailable");
    res.status(503).json({ error: "Customer reviews temporarily unavailable" });
  } finally { client?.release(); }
});

router.post("/admin/customer-reviews/:id/retry", async (req, res) => {
  if (!await requireReviewsAdmin(req, res)) return;
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id < 1 || id > 2_147_483_647) { res.status(400).json({ error: "Invalid review id" }); return; }
  try {
    const result = await pool.query(
      `UPDATE uc_reviews r SET analysis=json_build_object('status','pending','version',$2::int)
       WHERE r.id=$1 AND ${REVIEW_ELIGIBLE}
       AND r.analysis->>'status' IN ('failed','unavailable')
       RETURNING id`, [id, REVIEW_ANALYSIS_VERSION],
    );
    if (!result.rows.length) { res.status(409).json({ error: "Review is not eligible for retry; refresh its current status" }); return; }
    res.json({ ok: true });
  } catch { res.status(503).json({ error: "Could not retry analysis" }); }
});
export default router;