import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import { pool } from "@workspace/db";
import { issueToken } from "../lib/jwt.js";
import { ObjectStorageService } from "../lib/objectStorage.js";

describe("private water evidence serving", () => {
  let server: ReturnType<typeof createServer>;
  let baseUrl = "";
  const assessmentId = `media-${randomUUID()}`;
  const customerId = String(700000 + Math.floor(Math.random() * 100000));
  const teamId = `media-team-${randomUUID()}`;
  const objectPath = `/objects/water-tests/${assessmentId}/customer-${customerId}/evidence-123`;
  const originalGetObjectEntityFile = ObjectStorageService.prototype.getObjectEntityFile;
  const originalDownloadObject = ObjectStorageService.prototype.downloadObject;

  const customerHeader = () => `Bearer ${issueToken({ id: Number(customerId), email: "media-owner@test.internal" })}`;
  const otherHeader = () => `Bearer ${issueToken({ id: Number(customerId) + 1, email: "other@test.internal" })}`;
  const teamHeader = () => `Bearer ${issueToken({ id: teamId, email: "media-team@test.internal", type: "team-session", role: "member" })}`;

  before(async () => {
    process.env.SESSION_SECRET ??= "private-media-test-secret";
    ObjectStorageService.prototype.getObjectEntityFile = async function () {
      return {} as never;
    };
    ObjectStorageService.prototype.downloadObject = async function () {
      return new Response("evidence", { headers: { "content-type": "image/jpeg" } });
    };
    const { default: app } = await import("../app.js");
    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    await pool.query(
      `INSERT INTO instant_water_assessments
        (id, reference, customer_user_id, first_name, normalized_phone, consent_given, consent_version,
         country, area, source, concern, setting, raw_answers, rules_version, result,
         account_link_state)
       VALUES ($1, $2, $3, 'Owner', '+254700000011', 'true', 'instant-water-check-v1',
         'Kenya', 'Nakuru', 'borehole', 'safety', 'home', '{}'::jsonb, 'instant-water-check-v1',
         $4::jsonb, 'attached')`,
      [assessmentId, `WT-MEDIA-${randomUUID()}`, customerId, JSON.stringify({ bands: {} })],
    );
    await pool.query(
      `INSERT INTO instant_water_media_uploads
        (object_path, uploader_user_id, assessment_id, declared_type, declared_size, detected_type,
         detected_size, scan_status, expires_at)
       VALUES ($1, $2, $3, 'image/jpeg', 8, 'image/jpeg', 8, 'clean', now() + interval '1 hour')`,
      [objectPath, customerId, assessmentId],
    );
    await pool.query(
      `INSERT INTO team_users (id, email, name, password_hash, role, permissions, is_active)
       VALUES ($1, 'media-team@test.internal', 'Media Team', 'x', 'member', $2::jsonb, true)`,
      [teamId, JSON.stringify({ water_tests: "view" })],
    );
  });

  after(async () => {
    ObjectStorageService.prototype.getObjectEntityFile = originalGetObjectEntityFile;
    ObjectStorageService.prototype.downloadObject = originalDownloadObject;
    await pool.query(`DELETE FROM instant_water_assessments WHERE id = $1`, [assessmentId]);
    await pool.query(`DELETE FROM team_users WHERE id = $1`, [teamId]);
    server?.close();
  });

  it("serves the exact emitted owner URL and permits the live team", async () => {
    const path = `/api/storage/private/water-tests/${assessmentId}/customer-${customerId}/evidence-123`;
    const owner = await fetch(`${baseUrl}${path}`, { headers: { authorization: customerHeader() } });
    assert.equal(owner.status, 200);
    assert.equal(owner.headers.get("cache-control"), "private, no-store");
    assert.equal(owner.headers.get("x-content-type-options"), "nosniff");
    assert.equal(await owner.text(), "evidence");

    const team = await fetch(`${baseUrl}${path}`, { headers: { authorization: teamHeader() } });
    assert.equal(team.status, 200);
  });

  it("rejects cross-account access", async () => {
    const path = `/api/storage/private/water-tests/${assessmentId}/customer-${customerId}/evidence-123`;
    const other = await fetch(`${baseUrl}${path}`, { headers: { authorization: otherHeader() } });
    assert.equal(other.status, 403);
  });
});