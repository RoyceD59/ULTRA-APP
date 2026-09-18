import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import supertest from "supertest";
import { pool } from "@workspace/db";
import app from "../app.js";
import { issueToken } from "../lib/jwt.js";
import { validateAuthoritativeVideoDuration } from "../routes/guides.js";

const GUIDE_ID = "guide-focused-test";
const SECTION_ID = "guide-focused-test-section";
const ADMIN_ID = "guide-focused-test-admin";

function bearer(): string {
  return `Bearer ${issueToken({
    id: ADMIN_ID, email: "guide-focused-admin@test.invalid", name: "Guide Test Admin",
    type: "team-session", role: "admin", exp: Math.floor(Date.now() / 1000) + 3600,
  })}`;
}

before(async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS uc_guides (
      id text PRIMARY KEY, slug text NOT NULL UNIQUE, title text NOT NULL, summary text NOT NULL,
      category text NOT NULL, products text NOT NULL DEFAULT '', icon text NOT NULL DEFAULT 'document-text-outline',
      read_time text NOT NULL DEFAULT '3 min read', status text NOT NULL DEFAULT 'draft',
      version integer NOT NULL DEFAULT 1, published_at timestamptz, updated_at timestamptz NOT NULL DEFAULT now(),
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS uc_guide_sections (
      id text PRIMARY KEY, guide_id text NOT NULL REFERENCES uc_guides(id) ON DELETE CASCADE,
      position integer NOT NULL, heading text NOT NULL, body text, steps text[] NOT NULL DEFAULT '{}',
      tip text, warning text, illustration_icon text
    );
    CREATE TABLE IF NOT EXISTS uc_guide_media (
      id text PRIMARY KEY, section_id text NOT NULL REFERENCES uc_guide_sections(id) ON DELETE CASCADE,
      position integer NOT NULL, kind text NOT NULL, url text NOT NULL, object_path text,
      mime_type text NOT NULL, alt_text text NOT NULL, caption text, poster_url text,
      byte_size integer, duration_seconds integer, animated boolean NOT NULL DEFAULT false
    );
  `);
  await pool.query("ALTER TABLE uc_guides ADD COLUMN IF NOT EXISTS published_snapshot jsonb");
  await pool.query("DELETE FROM uc_guides WHERE id=$1", [GUIDE_ID]);
  await pool.query("DELETE FROM team_users WHERE id=$1", [ADMIN_ID]);
  await pool.query(
    `INSERT INTO team_users(id,email,name,password_hash,role,is_active)
     VALUES($1,'guide-focused-admin@test.invalid','Guide Test Admin','unused','admin',true)`,
    [ADMIN_ID],
  );
  await pool.query(
    `INSERT INTO uc_guides(id,slug,title,summary,category,status,version,published_snapshot)
     VALUES($1,'focused-guide','Focused guide','Published test guide','Installation','published',1,$2::jsonb)`,
    [GUIDE_ID, JSON.stringify({
      id: GUIDE_ID, slug: "focused-guide", title: "Focused guide", summary: "Published test guide",
      category: "Installation", products: "", icon: "document-text-outline", readTime: "3 min read",
      version: 1, sections: [{ id: SECTION_ID, position: 0, heading: "Test section", steps: ["Read the instructions"], media: [] }],
    })],
  );
  await pool.query(
    `INSERT INTO uc_guide_sections(id,guide_id,position,heading,steps)
     VALUES($1,$2,0,'Test section',ARRAY['Read the instructions'])`,
    [SECTION_ID, GUIDE_ID],
  );
});

after(async () => {
  await pool.query("DELETE FROM uc_guides WHERE id=$1", [GUIDE_ID]);
  await pool.query("DELETE FROM team_users WHERE id=$1", [ADMIN_ID]);
});

describe("Companion guide API", () => {
  it("requires authoritative finite video duration metadata and enforces 90 seconds", () => {
    assert.equal(validateAuthoritativeVideoDuration({ metadata: {} }).ok, false);
    assert.equal(validateAuthoritativeVideoDuration({ metadata: { durationSeconds: "not-a-number" } }).ok, false);
    assert.equal(validateAuthoritativeVideoDuration({ metadata: { durationSeconds: -1 } }).ok, false);
    assert.equal(validateAuthoritativeVideoDuration({ metadata: { durationSeconds: 90 }}).ok, true);
    assert.equal(validateAuthoritativeVideoDuration({ metadata: { durationSeconds: 90.01 }}).ok, false);
  });

  it("isolates drafts and returns cache validators", async () => {
    const list = await supertest(app).get("/api/uc/guides");
    assert.equal(list.status, 200);
    assert.ok(list.headers.etag);
    assert.ok(list.headers["last-modified"]);
    assert.ok(list.body.guides.some((guide: { slug: string }) => guide.slug === "focused-guide"));

    const unchanged = await supertest(app).get("/api/uc/guides").set("If-None-Match", list.headers.etag);
    assert.equal(unchanged.status, 304);
  });

  it("rejects unsafe media URLs before writing a guide", async () => {
    const response = await supertest(app)
      .put(`/api/uc/admin/guides/${GUIDE_ID}`)
      .set("Authorization", bearer())
      .send({
        slug: "focused-guide", title: "Focused guide", summary: "Updated",
        sections: [{ heading: "Media", media: [{
          kind: "animation", url: "javascript:alert(1)", mimeType: "image/gif", altText: "bad",
        }] }],
      });
    assert.equal(response.status, 400);
    assert.match(String(response.body.error), /HTTPS|approved guide object/i);
    const traversal = await supertest(app)
      .put(`/api/uc/admin/guides/${GUIDE_ID}`)
      .set("Authorization", bearer())
      .send({
        slug: "focused-guide", title: "Focused guide", summary: "Updated",
        sections: [{ heading: "Media", media: [{
          kind: "animation", url: "/api/storage/objects/library/guides/../secret.gif",
          objectPath: "/objects/library/guides/../secret.gif", mimeType: "image/gif", altText: "bad",
        }] }],
      });
    assert.equal(traversal.status, 400);
  });

  it("keeps the published snapshot while a draft is edited", async () => {
    const update = await supertest(app)
      .put(`/api/uc/admin/guides/${GUIDE_ID}`)
      .set("Authorization", bearer())
      .send({
        slug: "focused-guide", title: "Draft title", summary: "Draft summary",
        sections: [{ heading: "Draft section", steps: ["Draft only"] }],
      });
    assert.equal(update.status, 200);
    const publicGuide = await supertest(app).get("/api/uc/guides/focused-guide");
    assert.equal(publicGuide.status, 200);
    assert.equal(publicGuide.body.guide.title, "Focused guide");
    assert.equal(publicGuide.body.guide.sections[0].heading, "Test section");
  });

  it("accepts animated GIF and short-video guide media", async () => {
    const slug = `media-guide-${Date.now()}`;
    const response = await supertest(app)
      .post("/api/uc/admin/guides")
      .set("Authorization", bearer())
      .send({
        slug,
        title: "Media installation guide",
        summary: "Shows an animation and a short installation video",
        sections: [{
          heading: "Install the filter",
          steps: ["Follow the animation, then play the short video."],
          media: [
            {
              kind: "animation",
              url: "https://cdn.example.test/install.gif",
              mimeType: "image/gif",
              altText: "Animated filter installation",
              byteSize: 1_000_000,
              animated: true,
            },
            {
              kind: "video",
              url: "https://cdn.example.test/install.mp4",
              posterUrl: "https://cdn.example.test/install-poster.webp",
              mimeType: "video/mp4",
              altText: "Short filter installation video",
              byteSize: 4_000_000,
              durationSeconds: 30,
            },
          ],
        }],
      });

    assert.equal(response.status, 201);
    const guideId = String(response.body.guide.id);
    try {
      assert.equal(response.body.guide.sections[0].media.length, 2);
      assert.deepEqual(
        response.body.guide.sections[0].media.map((item: { kind: string }) => item.kind),
        ["animation", "video"],
      );
    } finally {
      await pool.query("DELETE FROM uc_guides WHERE id=$1", [guideId]);
    }
  });
});