import { Router, type Request, type Response } from "express";
import { createHash, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, pool, teamUsersTable } from "@workspace/db";
import { isAdminRequest } from "../lib/adminAuth.js";
import { verifyToken } from "../lib/jwt.js";
import {
  appendArticleHistory,
  parseArticleUpload,
  queueBlogRun,
  readEditorialArticle,
  saveDraft,
  validateArticleInput,
} from "../lib/blog-editorial.js";

const router = Router();
const MAX_PAGE_SIZE = 20;

function sendPublished(res: Response, body: unknown): void {
  // Match the existing guide snapshot validator semantics. The client polls
  // every 30s; a 30s HTTP TTL keeps the combined
  // visible-page freshness budget within 60s without stale-while-revalidate.
  res.setHeader("Cache-Control", "public, max-age=30, must-revalidate");
  const json = JSON.stringify(body);
  const etag = `"${createHash("sha256").update(json).digest("hex")}"`;
  res.setHeader("ETag", etag);
  if (res.req.headers["if-none-match"] === etag) { res.status(304).end(); return; }
  res.type("json").send(json);
}

async function liveTeamActor(req: Request): Promise<string | null> {
  const claims = verifyToken(req.headers.authorization);
  if (!claims || claims.type !== "team-session" || typeof claims.id !== "string") return null;
  const [actor] = await db.select({ id: teamUsersTable.id, active: teamUsersTable.isActive })
    .from(teamUsersTable).where(eq(teamUsersTable.id, claims.id)).limit(1);
  return actor?.active ? actor.id : null;
}

function fail(res: Response, status: number, error: string): void {
  res.status(status).json({ error });
}

type Cursor = { publishedAt: string; id: string };
function decodeCursor(value: unknown): Cursor | null | "invalid" {
  if (value === undefined || value === "") return null;
  if (typeof value !== "string") return "invalid";
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Partial<Cursor>;
    const date = new Date(parsed.publishedAt ?? "");
    if (!parsed.id || Number.isNaN(date.getTime())) return "invalid";
    return { id: parsed.id, publishedAt: date.toISOString() };
  } catch {
    return "invalid";
  }
}

function publicArticle(snapshot: Record<string, unknown>, id: string) {
  const { slug, title, summary, body, category, tags, sources, publishedAt, version } = snapshot;
  return { id, slug, title, summary, body, category, tags, sources, publishedAt, version };
}

function publicArticleSummary(snapshot: Record<string, unknown>, id: string) {
  const { slug, title, summary, category, tags, publishedAt, version } = snapshot;
  return { id, slug, title, summary, category, tags, publishedAt, version };
}

router.get("/uc/blog", async (req, res): Promise<void> => {
  const requested = Number(req.query.limit);
  const limit = Number.isInteger(requested) ? Math.min(Math.max(requested, 1), MAX_PAGE_SIZE) : 10;
  const cursor = decodeCursor(req.query.cursor);
  if (cursor === "invalid") { fail(res, 400, "Invalid article pagination cursor"); return; }
  const search = typeof req.query.search === "string" ? req.query.search.trim().slice(0, 120) : "";
  const category = typeof req.query.category === "string" ? req.query.category.trim().slice(0, 80) : "";
  const values: unknown[] = [];
  const filters = ["status='published'", "published_snapshot IS NOT NULL"];
  if (search) {
    values.push(`%${search}%`);
    filters.push(`(published_snapshot->>'title' ILIKE $${values.length} OR published_snapshot->>'summary' ILIKE $${values.length})`);
  }
  if (category) {
    values.push(category);
    filters.push(`published_snapshot->>'category'=$${values.length}`);
  }
  if (cursor) {
    values.push(cursor.publishedAt);
    const dateIndex = values.length;
    values.push(cursor.id);
    filters.push(`(published_at < $${dateIndex} OR (published_at = $${dateIndex} AND id < $${values.length}))`);
  }
  values.push(limit + 1);
  const result = await pool.query(
    `SELECT id,published_at AS "publishedAt",published_snapshot AS snapshot FROM uc_blog_articles
     WHERE ${filters.join(" AND ")} ORDER BY published_at DESC,id DESC LIMIT $${values.length}`,
    values,
  );
  const page = result.rows.slice(0, limit);
  sendPublished(res, {
    articles: page.map((row) => publicArticleSummary(row.snapshot as Record<string, unknown>, row.id)),
    nextCursor: result.rows.length > limit && page.length
      ? Buffer.from(JSON.stringify({ publishedAt: new Date(page.at(-1)!.publishedAt).toISOString(), id: page.at(-1)!.id })).toString("base64url")
      : null,
  });
});

router.get("/uc/blog/:slug", async (req, res): Promise<void> => {
  const slug = Array.isArray(req.params.slug) ? req.params.slug[0] : req.params.slug;
  const result = await pool.query(
    `SELECT id,published_snapshot AS snapshot FROM uc_blog_articles
     WHERE published_snapshot->>'slug'=$1 AND status='published' AND published_snapshot IS NOT NULL
     ORDER BY published_at DESC,id DESC LIMIT 1`, [slug],
  );
  if (!result.rows[0]) { fail(res, 404, "Published article not found"); return; }
  sendPublished(res, { article: publicArticle(result.rows[0].snapshot as Record<string, unknown>, result.rows[0].id) });
});

router.get("/uc/editor/blog", async (req, res): Promise<void> => {
  if (!(await liveTeamActor(req))) { fail(res, 401, "An active ProjectHub team session is required"); return; }
  const status = typeof req.query.status === "string" ? req.query.status : "";
  if (status && !["draft", "rejected", "published"].includes(status)) { fail(res, 400, "Invalid article status filter"); return; }
  const articles = await pool.query(
    `SELECT id,slug,title,summary,body,body AS content,category,tags,sources,origin,status,rationale,
       rejection_feedback AS "rejectionFeedback",created_by AS "createdBy",updated_by AS "updatedBy",
       version,published_at AS "publishedAt",published_snapshot AS "publishedSnapshot",
       created_at AS "createdAt",updated_at AS "updatedAt"
     FROM uc_blog_articles ${status ? "WHERE status=$1" : ""}
     ORDER BY updated_at DESC,id DESC LIMIT 200`,
    status ? [status] : [],
  );
  res.json({ articles: articles.rows });
});

router.get("/uc/editor/blog/runs", async (req, res): Promise<void> => {
  if (!(await liveTeamActor(req))) { fail(res, 401, "An active ProjectHub team session is required"); return; }
  const runs = await pool.query(
    `SELECT id,run_key AS "runKey",run_type AS "runType",status,requested_by AS "requestedBy",brief,
      result_summary AS "resultSummary",error,topics,created_at AS "createdAt",started_at AS "startedAt",
      completed_at AS "completedAt" FROM uc_blog_runs ORDER BY created_at DESC LIMIT 100`,
  );
  res.json({ runs: runs.rows });
});

router.get("/uc/editor/blog/:id", async (req, res): Promise<void> => {
  if (!(await liveTeamActor(req))) { fail(res, 401, "An active ProjectHub team session is required"); return; }
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const article = await readEditorialArticle(id);
  if (!article) { fail(res, 404, "Article not found"); return; }
  const history = await pool.query(
    `SELECT id,actor_id AS "actorId",action,rationale,snapshot,created_at AS "createdAt"
     FROM uc_blog_article_history WHERE article_id=$1 ORDER BY created_at DESC,id DESC`, [id],
  );
  res.json({ article, history: history.rows });
});

router.post("/uc/editor/blog", async (req, res): Promise<void> => {
  const actorId = await liveTeamActor(req);
  if (!actorId) { fail(res, 401, "An active ProjectHub team session is required"); return; }
  const input = { ...(req.body ?? {}) } as Record<string, unknown>;
  const directPublish = input.directPublish === true;
  if (directPublish && !(await isAdminRequest(req.headers.authorization))) {
    fail(res, 403, "Only a live-verified admin can publish directly"); return;
  }
  let origin: "human" | "upload" = "human";
  if (input.filename !== undefined || input.base64Content !== undefined) {
    const imported = parseArticleUpload(input.filename, input.base64Content);
    if (!imported.ok) { fail(res, 400, imported.error); return; }
    input.body = imported.text;
    input.title = typeof input.title === "string" && input.title.trim()
      ? input.title : String(input.filename).replace(/\.[^.]+$/, "");
    origin = "upload";
  }
  if (input.body === undefined && typeof input.content === "string") input.body = input.content;
  delete input.filename;
  delete input.base64Content;
  delete input.directPublish;
  delete input.origin;
  delete input.content;
  const validation = validateArticleInput(input);
  if (!validation.ok) { fail(res, 400, validation.error); return; }
  try {
    const article = await saveDraft(validation.article, actorId, origin);
    if (!article) { fail(res, 500, "Article could not be created"); return; }
    if (directPublish) {
      const publishResult = await publishArticle(article.id, actorId);
      if (!publishResult.ok) { fail(res, publishResult.status, publishResult.error); return; }
      res.status(201).json({ article: publishResult.article });
      return;
    }
    res.status(201).json({ article });
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    if (/unique|duplicate/i.test(text)) { fail(res, 409, "An article already uses that slug"); return; }
    req.log.error({ err: error }, "Editorial blog article create failed");
    fail(res, 500, "Article could not be created");
  }
});

router.patch("/uc/editor/blog/:id", async (req, res): Promise<void> => {
  const actorId = await liveTeamActor(req);
  if (!actorId) { fail(res, 401, "An active ProjectHub team session is required"); return; }
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const current = await readEditorialArticle(id);
  if (!current) { fail(res, 404, "Article not found"); return; }
  const body = { ...(req.body ?? {}) };
  if (body.body === undefined && typeof body.content === "string") body.body = body.content;
  delete body.content;
  delete body.origin;
  const validation = validateArticleInput({ ...body, slug: body.slug ?? current.slug });
  if (!validation.ok) { fail(res, 400, validation.error); return; }
  const article = validation.article;
  const before = {
    slug: current.slug, title: current.title, summary: current.summary, body: current.body,
    category: current.category, tags: current.tags, sources: current.sources, version: current.version,
  };
  try {
    const result = await pool.query(
      `UPDATE uc_blog_articles SET slug=$2,title=$3,summary=$4,body=$5,category=$6,tags=$7::jsonb,
       sources=$8::jsonb,rationale=$9,updated_by=$10,version=(version::integer+1)::text,updated_at=now(),
       status=CASE WHEN status='rejected' THEN 'draft' ELSE status END,rejection_feedback=NULL
       WHERE id=$1 RETURNING id`,
      [id, article.slug, article.title, article.summary, article.body, article.category,
        JSON.stringify(article.tags), JSON.stringify(article.sources), article.rationale ?? null, actorId],
    );
    if (!result.rows[0]) { fail(res, 404, "Article not found"); return; }
    await appendArticleHistory(id, actorId, "edited", article.rationale ?? null, { before, after: article });
    res.json({ article: await readEditorialArticle(id) });
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    if (/unique|duplicate/i.test(text)) { fail(res, 409, "An article already uses that slug"); return; }
    req.log.error({ err: error, articleId: id }, "Editorial blog article update failed");
    fail(res, 500, "Article could not be saved");
  }
});

async function publishArticle(id: string, actorId: string): Promise<{ ok: true; article: unknown } | { ok: false; status: number; error: string }> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(`SELECT * FROM uc_blog_articles WHERE id=$1 FOR UPDATE`, [id]);
    const row = result.rows[0];
    if (!row) { await client.query("ROLLBACK"); return { ok: false, status: 404, error: "Article not found" }; }
    if (!Array.isArray(row.sources) || row.sources.length < 1) {
      await client.query("ROLLBACK");
      return { ok: false, status: 400, error: "At least one validated HTTPS source is required before publication" };
    }
    const validation = validateArticleInput(row);
    if (!validation.ok) {
      await client.query("ROLLBACK");
      return { ok: false, status: 400, error: `Article failed publication validation: ${validation.error}` };
    }
    const publishedAt = new Date().toISOString();
    const version = String(Number(row.version) + 1);
    const snapshot = { ...validation.article, publishedAt, version };
    await client.query(
      `UPDATE uc_blog_articles SET status='published',published_by=$2,published_at=$3,
       published_snapshot=$4::jsonb,version=$5,updated_at=now(),updated_by=$2 WHERE id=$1`,
      [id, actorId, publishedAt, JSON.stringify(snapshot), version],
    );
    await client.query(
      `INSERT INTO uc_blog_article_history(id,article_id,actor_id,action,rationale,snapshot)
       VALUES($1,$2,$3,'published',NULL,$4::jsonb)`,
      [randomUUID(), id, actorId, JSON.stringify(snapshot)],
    );
    await client.query("COMMIT");
    return { ok: true, article: await readEditorialArticle(id) };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

router.post("/uc/editor/blog/:id/publish", async (req, res): Promise<void> => {
  if (!(await isAdminRequest(req.headers.authorization))) { fail(res, 401, "Admin authentication required"); return; }
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const claims = verifyToken(req.headers.authorization);
  const actorId = typeof claims?.id === "string" || typeof claims?.id === "number" ? String(claims.id) : "verified-admin";
  try {
    const result = await publishArticle(id, actorId);
    if (!result.ok) { fail(res, result.status, result.error); return; }
    res.json({ article: result.article });
  } catch (error) {
    req.log.error({ err: error, articleId: id }, "Editorial blog article publish failed");
    fail(res, 500, "Article could not be published");
  }
});

router.post("/uc/editor/blog/:id/reject", async (req, res): Promise<void> => {
  if (!(await isAdminRequest(req.headers.authorization))) { fail(res, 401, "Admin authentication required"); return; }
  const feedback = typeof req.body?.feedback === "string" ? req.body.feedback.trim().slice(0, 1000) : "";
  if (!feedback) { fail(res, 400, "Reviewer feedback is required"); return; }
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const current = await readEditorialArticle(id);
  if (!current) { fail(res, 404, "Article not found"); return; }
  if (current.status === "published") { fail(res, 409, "Unpublish the live article before rejecting its next revision"); return; }
  const claims = verifyToken(req.headers.authorization);
  const actorId = typeof claims?.id === "string" || typeof claims?.id === "number" ? String(claims.id) : "verified-admin";
  await pool.query(`UPDATE uc_blog_articles SET status='rejected',rejection_feedback=$2,updated_by=$3,updated_at=now() WHERE id=$1`, [id, feedback, actorId]);
  await appendArticleHistory(id, actorId, "rejected", feedback, { articleId: id, feedback });
  res.json({ ok: true });
});

router.post("/uc/editor/blog/:id/unpublish", async (req, res): Promise<void> => {
  if (!(await isAdminRequest(req.headers.authorization))) { fail(res, 401, "Admin authentication required"); return; }
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const current = await readEditorialArticle(id);
  if (!current) { fail(res, 404, "Article not found"); return; }
  const claims = verifyToken(req.headers.authorization);
  const actorId = typeof claims?.id === "string" || typeof claims?.id === "number" ? String(claims.id) : "verified-admin";
  await pool.query(`UPDATE uc_blog_articles SET status='draft',updated_by=$2,updated_at=now() WHERE id=$1`, [id, actorId]);
  await appendArticleHistory(id, actorId, "unpublished", null, { articleId: id, publishedSnapshotRetained: true });
  res.json({ ok: true });
});

router.post("/uc/editor/blog/draft-from-brief", async (req, res): Promise<void> => {
  const actorId = await liveTeamActor(req);
  if (!actorId) { fail(res, 401, "An active ProjectHub team session is required"); return; }
  const brief = typeof req.body?.brief === "string" ? req.body.brief.trim() : "";
  if (brief.length < 10 || brief.length > 1000) { fail(res, 400, "Brief must be between 10 and 1,000 characters"); return; }
  const providedKey = typeof req.body?.idempotencyKey === "string" ? req.body.idempotencyKey.trim().slice(0, 120) : "";
  const key = providedKey ? `brief:${actorId}:${providedKey}` : `brief:${actorId}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
  try {
    const queued = await queueBlogRun("brief", key, actorId, brief);
    res.status(202).json({ run: queued.run, reused: !queued.created });
  } catch (error) {
    req.log.error({ err: error }, "Editorial brief generation could not be queued");
    fail(res, 503, "Brief run could not be queued. Retry with the same idempotency key.");
  }
});

export default router;