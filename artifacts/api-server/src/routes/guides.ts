import { Router, type Request, type Response } from "express";
import { createHash, randomUUID } from "node:crypto";
import { pool } from "@workspace/db";
import { requireTeamAdmin } from "./auth.js";
import { ObjectStorageService } from "../lib/objectStorage.js";

const router = Router();
const MAX_VIDEO_BYTES = 25 * 1024 * 1024;
const MAX_ANIMATION_BYTES = 8 * 1024 * 1024;
const MAX_VIDEO_SECONDS = 90;
const MEDIA_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "video/mp4", "video/webm"]);
const objectStorage = new ObjectStorageService();
function isCanonicalGuidePath(value: string): boolean {
  if (!/^\/objects\/library\/guides\/[A-Za-z0-9._/-]+$/.test(value)) return false;
  return value.slice("/objects/library/guides/".length).split("/").every((part) =>
    part.length > 0 && part !== "." && part !== ".." && !part.includes("..") && !part.includes("\\"));
}

/** Duration must come from authoritative object metadata, never request JSON or DB. */
export function validateAuthoritativeVideoDuration(metadata: unknown): { ok: true; seconds: number } | { ok: false; error: string } {
  const raw = (metadata as { metadata?: Record<string, unknown> } | null)?.metadata?.durationSeconds;
  const seconds = typeof raw === "number"
    ? raw
    : typeof raw === "string" && raw.trim() !== "" ? Number(raw) : Number.NaN;
  if (!Number.isFinite(seconds) || seconds < 0) {
    return { ok: false, error: "Video object metadata must include a finite nonnegative durationSeconds" };
  }
  if (seconds > MAX_VIDEO_SECONDS) return { ok: false, error: "Video object metadata durationSeconds exceeds the 90 second limit" };
  return { ok: true, seconds };
}

type MediaInput = {
  id?: string; kind: "image" | "animation" | "video"; url: string; objectPath?: string;
  mimeType: string; altText: string; caption?: string; posterUrl?: string;
  byteSize?: number; durationSeconds?: number; animated?: boolean;
};
type SectionInput = {
  id?: string; position: number; heading: string; body?: string; steps?: string[];
  tip?: string; warning?: string; illustrationIcon?: string; media?: MediaInput[];
};

function fail(res: Response, status: number, error: string): void { res.status(status).json({ error }); }

function validateMedia(media: MediaInput): string | null {
  if (!MEDIA_TYPES.has(media.mimeType)) return `Unsupported media type: ${media.mimeType}`;
  const validUrl = (value: string, allowObjectPath: boolean): boolean => {
    if (allowObjectPath && /^\/api\/storage\/objects\/library\/guides\/[A-Za-z0-9._/-]+$/.test(value)) {
      return isCanonicalGuidePath(value.replace("/api/storage", ""));
    }
    try {
      const parsed = new URL(value);
      return parsed.protocol === "https:" && !parsed.username && !parsed.password && !!parsed.hostname;
    } catch { return false; }
  };
  if (!validUrl(media.url, true)) return "Media URL must be HTTPS or an approved guide object path";
  if (media.posterUrl && !validUrl(media.posterUrl, true)) return "Poster URL must be HTTPS or an approved guide object path";
  if (media.objectPath && !isCanonicalGuidePath(media.objectPath)) {
    return "Media URL must be HTTPS or an approved guide object path";
  }
  if (!media.altText?.trim()) return "Media alt text is required";
  if (media.kind === "video" && (media.mimeType === "video/mp4" || media.mimeType === "video/webm")) {
    if (media.byteSize != null && media.byteSize > MAX_VIDEO_BYTES) return "Videos must be 25 MB or smaller";
    if (media.durationSeconds != null && media.durationSeconds > MAX_VIDEO_SECONDS) return "Videos must be 90 seconds or shorter";
  }
  if (media.kind === "animation" && media.byteSize != null && media.byteSize > MAX_ANIMATION_BYTES) {
    return "Animated GIF/WebP files must be 8 MB or smaller";
  }
  return null;
}

type Queryable = { query: (text: string, values?: unknown[]) => Promise<{ rows: any[] }> };
async function buildSnapshot(queryable: Queryable, id: string): Promise<Record<string, unknown> | null> {
  const guide = await queryable.query(
    `SELECT id,slug,title,summary,category,products,icon,read_time AS "readTime",version FROM uc_guides WHERE id=$1 LIMIT 1`, [id]);
  if (!guide.rows[0]) return null;
  const sections = await queryable.query(
    `SELECT id,position,heading,body,steps,tip,warning,illustration_icon AS "illustrationIcon" FROM uc_guide_sections WHERE guide_id=$1 ORDER BY position,id`, [id]);
  const media = await queryable.query(
    `SELECT m.id,m.section_id AS "sectionId",m.position,m.kind,m.url,m.mime_type AS "mimeType",m.alt_text AS "altText",m.caption,m.poster_url AS "posterUrl",m.byte_size AS "byteSize",m.duration_seconds AS "durationSeconds",m.animated FROM uc_guide_media m JOIN uc_guide_sections s ON s.id=m.section_id WHERE s.guide_id=$1 ORDER BY m.section_id,m.position,m.id`, [id]);
  return { ...guide.rows[0], sections: sections.rows.map((section) => ({ ...section, media: media.rows.filter((item) => item.sectionId === section.id) })) };
}

async function readGuide(idOrSlug: string, publishedOnly: boolean): Promise<Record<string, unknown> | null> {
  const guide = await pool.query(
    `SELECT id,slug,title,summary,category,products,icon,read_time AS "readTime",status,version,
            published_at AS "publishedAt",updated_at AS "updatedAt"
       FROM uc_guides WHERE (slug=$1 OR id=$1) ${publishedOnly ? "AND status='published'" : ""} LIMIT 1`,
    [idOrSlug],
  );
  if (!guide.rows[0]) return null;
  const sections = await pool.query(
    `SELECT id,position,heading,body,steps,tip,warning,illustration_icon AS "illustrationIcon"
       FROM uc_guide_sections WHERE guide_id=$1 ORDER BY position,id`,
    [guide.rows[0].id],
  );
  const media = await pool.query(
    `SELECT m.id,m.section_id AS "sectionId",m.position,m.kind,m.url,m.mime_type AS "mimeType",
            m.alt_text AS "altText",m.caption,m.poster_url AS "posterUrl",m.byte_size AS "byteSize",
            m.duration_seconds AS "durationSeconds",m.animated
       FROM uc_guide_media m JOIN uc_guide_sections s ON s.id=m.section_id
      WHERE s.guide_id=$1 ORDER BY m.section_id,m.position,m.id`,
    [guide.rows[0].id],
  );
  return {
    ...guide.rows[0],
    sections: sections.rows.map((section) => ({
      ...section,
      media: media.rows.filter((item) => item.sectionId === section.id),
    })),
  };
}

router.get("/uc/guides", async (_req, res): Promise<void> => {
  const result = await pool.query(
    `SELECT published_snapshot AS snapshot,updated_at AS "updatedAt"
       FROM uc_guides WHERE status='published' AND published_snapshot IS NOT NULL ORDER BY updated_at DESC`,
  );
  const guides = result.rows.map((row) => {
    const { sections: _sections, ...summary } = row.snapshot as Record<string, unknown>;
    return { ...summary, updatedAt: row.updatedAt };
  });
  const body = JSON.stringify({ guides });
  const etag = `"${createHash("sha256").update(body).digest("hex")}"`;
  res.setHeader("ETag", etag);
  const latest = result.rows.reduce((value, row) => Math.max(value, new Date(String(row.updatedAt)).getTime()), 0);
  if (latest) res.setHeader("Last-Modified", new Date(latest).toUTCString());
  res.setHeader("Cache-Control", "public, max-age=30, must-revalidate");
  if (res.req.headers["if-none-match"] === etag) { res.status(304).end(); return; }
  res.json(JSON.parse(body));
});

router.get("/uc/guides/:slug", async (req, res): Promise<void> => {
  const result = await pool.query(
    `SELECT published_snapshot AS snapshot,updated_at AS "updatedAt"
       FROM uc_guides WHERE (slug=$1 OR id=$1) AND status='published'
         AND published_snapshot IS NOT NULL LIMIT 1`, [String(req.params.slug)]);
  const guide = result.rows[0]
    ? { ...(result.rows[0].snapshot as Record<string, unknown>), updatedAt: result.rows[0].updatedAt }
    : null;
  if (!guide) { fail(res, 404, "Guide not found"); return; }
  const body = JSON.stringify({ guide });
  const etag = `"${createHash("sha256").update(body).digest("hex")}"`;
  res.setHeader("ETag", etag);
  res.setHeader("Last-Modified", new Date(String(guide.updatedAt)).toUTCString());
  res.setHeader("Cache-Control", "public, max-age=30, must-revalidate");
  if (res.req.headers["if-none-match"] === etag) { res.status(304).end(); return; }
  res.json(JSON.parse(body));
});

router.get("/uc/admin/guides", requireTeamAdmin, async (_req, res): Promise<void> => {
  const result = await pool.query(`SELECT id,slug,title,summary,category,products,icon,read_time AS "readTime",
    status,version,published_at AS "publishedAt",updated_at AS "updatedAt" FROM uc_guides ORDER BY updated_at DESC`);
  res.json({ guides: result.rows });
});

router.get("/uc/admin/guides/:id", requireTeamAdmin, async (req, res): Promise<void> => {
  const guide = await readGuide(String(req.params.id), false);
  if (!guide) { fail(res, 404, "Guide not found"); return; }
  res.json({ guide });
});

router.put("/uc/admin/guides/:id", requireTeamAdmin, async (req, res): Promise<void> => {
  const body = req.body as Partial<{
    slug: string; title: string; summary: string; category: string; products: string; icon: string; readTime: string;
    sections: SectionInput[];
  }>;
  if (!body.slug?.match(/^[a-z0-9-]{3,120}$/) || !body.title?.trim() || !body.summary?.trim() || !Array.isArray(body.sections)) {
    fail(res, 400, "slug, title, summary, and sections are required"); return;
  }
  for (const section of body.sections) {
    if (!section.heading?.trim()) { fail(res, 400, "Every section needs a heading"); return; }
    for (const media of section.media ?? []) {
      const issue = validateMedia(media);
      if (issue) { fail(res, 400, issue); return; }
    }
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const exists = await client.query("SELECT id FROM uc_guides WHERE id=$1 FOR UPDATE", [String(req.params.id)]);
    if (!exists.rows[0]) { await client.query("ROLLBACK"); fail(res, 404, "Guide not found"); return; }
    await client.query(`UPDATE uc_guides SET slug=$2,title=$3,summary=$4,category=$5,products=$6,icon=$7,read_time=$8,
      version=version+1,updated_at=now() WHERE id=$1`,
      [req.params.id, body.slug, body.title.trim(), body.summary.trim(), body.category ?? "Installation",
       body.products ?? "", body.icon ?? "document-text-outline", body.readTime ?? "3 min read"]);
    await client.query("DELETE FROM uc_guide_sections WHERE guide_id=$1", [req.params.id]);
    for (const [index, section] of body.sections.entries()) {
      const sectionId = section.id ?? randomUUID();
      await client.query(`INSERT INTO uc_guide_sections
        (id,guide_id,position,heading,body,steps,tip,warning,illustration_icon)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [sectionId, req.params.id, index, section.heading.trim(), section.body ?? null, section.steps ?? [],
         section.tip ?? null, section.warning ?? null, section.illustrationIcon ?? null]);
      for (const [mediaIndex, media] of (section.media ?? []).entries()) {
        await client.query(`INSERT INTO uc_guide_media
          (id,section_id,position,kind,url,object_path,mime_type,alt_text,caption,poster_url,byte_size,duration_seconds,animated)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
          [media.id ?? randomUUID(), sectionId, mediaIndex, media.kind, media.url, media.objectPath ?? null, media.mimeType,
           media.altText.trim(), media.caption ?? null, media.posterUrl ?? null, media.byteSize ?? null,
           media.durationSeconds ?? null, media.animated ?? media.kind === "animation"]);
      }
    }
    await client.query("COMMIT");
    const guide = await readGuide(String(req.params.id), false);
    res.json({ guide });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    req.log.error({ err: error }, "Guide update failed");
    fail(res, 500, "Guide could not be saved");
  } finally { client.release(); }
});

router.post("/uc/admin/guides", requireTeamAdmin, async (req, res): Promise<void> => {
  const id = randomUUID();
  const body = req.body as Partial<{
    slug: string; title: string; summary: string; category: string; products: string; icon: string; readTime: string;
    sections: SectionInput[];
  }>;
  const slug = body.slug ?? `guide-${id.slice(0, 8)}`;
  const title = body.title?.trim() || "Untitled guide";
  const summary = body.summary?.trim() || "Draft installation guide";
  const sections = body.sections ?? [];
  if (!slug.match(/^[a-z0-9-]{3,120}$/) || !Array.isArray(sections)) {
    fail(res, 400, "slug and sections must be valid"); return;
  }
  for (const section of sections) {
    if (!section.heading?.trim()) { fail(res, 400, "Every section needs a heading"); return; }
    for (const media of section.media ?? []) {
      const issue = validateMedia(media);
      if (issue) { fail(res, 400, issue); return; }
    }
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO uc_guides(id,slug,title,summary,category,products,icon,read_time)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
      [id, slug, title, summary, body.category ?? "Installation", body.products ?? "",
       body.icon ?? "document-text-outline", body.readTime ?? "3 min read"],
    );
    for (const [index, section] of sections.entries()) {
      const sectionId = section.id ?? randomUUID();
      await client.query(
        `INSERT INTO uc_guide_sections
           (id,guide_id,position,heading,body,steps,tip,warning,illustration_icon)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [sectionId, id, index, section.heading.trim(), section.body ?? null, section.steps ?? [],
         section.tip ?? null, section.warning ?? null, section.illustrationIcon ?? null],
      );
      for (const [mediaIndex, media] of (section.media ?? []).entries()) {
        await client.query(
          `INSERT INTO uc_guide_media
             (id,section_id,position,kind,url,object_path,mime_type,alt_text,caption,poster_url,byte_size,duration_seconds,animated)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
          [media.id ?? randomUUID(), sectionId, mediaIndex, media.kind, media.url, media.objectPath ?? null,
           media.mimeType, media.altText.trim(), media.caption ?? null, media.posterUrl ?? null,
           media.byteSize ?? null, media.durationSeconds ?? null, media.animated ?? media.kind === "animation"],
        );
      }
    }
    await client.query("COMMIT");
    res.status(201).json({ guide: await readGuide(id, false) });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    req.log.error({ err: error }, "Guide creation failed");
    fail(res, 500, "Guide could not be created");
  } finally {
    client.release();
  }
});

router.post("/uc/admin/guides/:id/publish", requireTeamAdmin, async (req, res): Promise<void> => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const found = await client.query(`SELECT id FROM uc_guides WHERE id=$1 FOR UPDATE`, [req.params.id]);
    if (!found.rows[0]) { await client.query("ROLLBACK"); fail(res, 404, "Guide not found"); return; }
    const content = await client.query(`SELECT s.id,m.id AS media_id,m.kind,m.mime_type,m.url,m.object_path,m.alt_text,m.byte_size,m.duration_seconds
      FROM uc_guide_sections s
      LEFT JOIN uc_guide_media m ON m.section_id=s.id WHERE s.guide_id=$1`, [req.params.id]);
    if (!content.rows.length) { await client.query("ROLLBACK"); fail(res, 400, "A guide needs at least one section"); return; }
    for (const row of content.rows) if (row.kind) {
      if (!MEDIA_TYPES.has(row.mime_type) || !row.alt_text || !row.url || !row.object_path ||
          !isCanonicalGuidePath(row.object_path) ||
          !row.url.startsWith("/api/storage/objects/library/guides/")) {
        await client.query("ROLLBACK"); fail(res, 400, "Uploaded guide media must use an approved object path"); return;
      }
      try {
        const file = await objectStorage.getObjectEntityFile(row.object_path);
        const [metadata] = await file.getMetadata();
        const actualType = String((metadata as Record<string, unknown>).contentType ?? "").toLowerCase();
        const actualSize = Number((metadata as Record<string, unknown>).size ?? 0);
        if (actualType !== String(row.mime_type).toLowerCase() || !actualSize || actualSize > (row.kind === "animation" ? MAX_ANIMATION_BYTES : row.kind === "video" ? MAX_VIDEO_BYTES : Number.MAX_SAFE_INTEGER)) {
          await client.query("ROLLBACK"); fail(res, 400, "Guide media object metadata does not match the declared type or size"); return;
        }
        if (row.kind === "video") {
          const duration = validateAuthoritativeVideoDuration(metadata);
          if (!duration.ok) {
            await client.query("ROLLBACK"); fail(res, 400, duration.error); return;
          }
        }
      } catch {
        await client.query("ROLLBACK"); fail(res, 400, "Guide media object could not be verified in storage"); return;
      }
    }
    const snapshot = await buildSnapshot(client, String(req.params.id));
    if (!snapshot) { await client.query("ROLLBACK"); fail(res, 404, "Guide not found"); return; }
    await client.query(`UPDATE uc_guides SET status='published',published_at=now(),published_snapshot=$2,updated_at=now(),version=version+1 WHERE id=$1`, [req.params.id, JSON.stringify(snapshot)]);
    await client.query("COMMIT");
    res.json({ guide: await readGuide(String(req.params.id), false) });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    req.log.error({ err: error }, "Guide publish failed");
    fail(res, 500, "Guide could not be published");
  } finally { client.release(); }
});

router.post("/uc/admin/guides/:id/unpublish", requireTeamAdmin, async (req, res): Promise<void> => {
  await pool.query("UPDATE uc_guides SET status='draft',updated_at=now() WHERE id=$1", [req.params.id]);
  res.json({ ok: true });
});

export default router;