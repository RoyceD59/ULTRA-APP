import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import supertest from "supertest";
import { pool } from "@workspace/db";
import app from "../app.js";
import { issueToken } from "../lib/jwt.js";

const USER_ID = 987654321;
const REPORTER_ID = 987654320;
const ADMIN_ID = "location-quality-admin";
const LOCATION_ID = "location-quality-city-tap";
let userToken: string;
let reporterToken: string;
let adminToken: string;

const scores = {
  waterQuality: 5, cleanliness: 4, equipmentCondition: 3,
  serviceReliability: 4, safetyConfidence: 5,
};

function bearer(token: string): string {
  return `Bearer ${token}`;
}

before(async () => {
  await pool.query("DELETE FROM uc_location_rating_reports WHERE reporter_user_id=$1 OR rating_id IN (SELECT id FROM uc_location_ratings WHERE location_id=$2)", [USER_ID, LOCATION_ID]);
  await pool.query("DELETE FROM uc_location_ratings WHERE location_id=$1", [LOCATION_ID]);
  await pool.query("DELETE FROM uc_location_assessments WHERE location_id=$1", [LOCATION_ID]);
  await pool.query("DELETE FROM uc_locations WHERE id=$1", [LOCATION_ID]);
  await pool.query("DELETE FROM uc_users WHERE id=$1", [USER_ID]);
  await pool.query("DELETE FROM uc_users WHERE id=$1", [REPORTER_ID]);
  await pool.query("DELETE FROM team_users WHERE id=$1", [ADMIN_ID]);
  await pool.query(
    `INSERT INTO uc_users(id,email,password_hash,first_name,last_name,is_admin,deleted_at)
     VALUES($1,'location-quality-user@test.invalid','unused','Quality','User',false,NULL)`,
    [USER_ID],
  );
  await pool.query(
    `INSERT INTO uc_users(id,email,password_hash,first_name,last_name,is_admin,deleted_at)
     VALUES($1,'location-quality-reporter@test.invalid','unused','Quality','Reporter',false,NULL)`,
    [REPORTER_ID],
  );
  await pool.query(
    `INSERT INTO team_users(id,email,name,password_hash,role,is_active)
     VALUES($1,'location-quality-admin@test.invalid','Quality Admin','unused','admin',true)`,
    [ADMIN_ID],
  );
  await pool.query(
    `INSERT INTO uc_locations(id,type,name,address,latitude,longitude,hours,active,verified)
     VALUES($1,'city_tap','Quality City Tap','Test Street',0,0,'24/7',true,true)`,
    [LOCATION_ID],
  );
  userToken = issueToken({ id: USER_ID, email: "location-quality-user@test.invalid", name: "Quality User", exp: Math.floor(Date.now() / 1000) + 3600 });
  reporterToken = issueToken({ id: REPORTER_ID, email: "location-quality-reporter@test.invalid", name: "Quality Reporter", exp: Math.floor(Date.now() / 1000) + 3600 });
  adminToken = issueToken({ id: ADMIN_ID, type: "team-session", role: "admin", exp: Math.floor(Date.now() / 1000) + 3600 });
});

after(async () => {
  await pool.query("DELETE FROM uc_location_rating_reports WHERE reporter_user_id=$1 OR rating_id IN (SELECT id FROM uc_location_ratings WHERE location_id=$2)", [USER_ID, LOCATION_ID]);
  await pool.query("DELETE FROM uc_location_ratings WHERE location_id=$1", [LOCATION_ID]);
  await pool.query("DELETE FROM uc_location_assessments WHERE location_id=$1", [LOCATION_ID]);
  await pool.query("DELETE FROM uc_locations WHERE id=$1", [LOCATION_ID]);
  await pool.query("DELETE FROM uc_users WHERE id=$1", [USER_ID]);
  await pool.query("DELETE FROM uc_users WHERE id=$1", [REPORTER_ID]);
  await pool.query("DELETE FROM team_users WHERE id=$1", [ADMIN_ID]);
});

describe("managed location quality", () => {
  it("accepts city_tap managed locations", async () => {
    const response = await supertest(app).post("/api/uc/admin/locations")
      .set("Authorization", bearer(adminToken))
      .send({ type: "city_tap", name: "Another Tap", address: "A", latitude: 1, longitude: 2, hours: "daily",
        countryIso: "GH", city: "Accra", accessNotes: "Public tap", municipal: "Accra Metro", sourceAttribution: "City register" });
    assert.equal(response.status, 201);
    const createdId = response.body.location.id;
    await pool.query("DELETE FROM uc_locations WHERE id=$1", [createdId]);
  });

  it("validates structured scores and upserts one editable rating per user", async () => {
    const invalid = await supertest(app).put(`/api/uc/locations/${LOCATION_ID}/rating`)
      .set("Authorization", bearer(userToken)).send({ ...scores, cleanliness: 6 });
    assert.equal(invalid.status, 400);
    const first = await supertest(app).put(`/api/uc/locations/${LOCATION_ID}/rating`)
      .set("Authorization", bearer(userToken)).send({ ...scores, comment: "Observed today" });
    assert.equal(first.status, 200);
    const second = await supertest(app).put(`/api/uc/locations/${LOCATION_ID}/rating`)
      .set("Authorization", bearer(userToken)).send({ ...scores, waterQuality: 2, comment: "Updated" });
    assert.equal(second.status, 200);
    assert.equal(first.body.rating.id, second.body.rating.id);
    const count = await pool.query("SELECT count(*)::int AS count FROM uc_location_ratings WHERE location_id=$1 AND user_id=$2", [LOCATION_ID, USER_ID]);
    assert.equal(count.rows[0].count, 1);
  });

  it("returns privacy-safe public aggregates and supports one report", async () => {
    const aggregate = await supertest(app).get(`/api/uc/locations/${LOCATION_ID}/ratings`);
    assert.equal(aggregate.status, 200);
    assert.equal(aggregate.body.count, 1);
    assert.equal("userId" in aggregate.body, false);
    assert.equal("email" in aggregate.body, false);
    assert.equal("reporterUserId" in aggregate.body.ratings[0], false);
    assert.equal("status" in aggregate.body.ratings[0], false);
    const rating = await pool.query("SELECT id FROM uc_location_ratings WHERE location_id=$1 LIMIT 1", [LOCATION_ID]);
    const phantom = await supertest(app).post(`/api/uc/locations/${LOCATION_ID}/ratings/not-a-rating/reports`)
      .set("Authorization", bearer(reporterToken)).send({ reason: "spam" });
    assert.equal(phantom.status, 404);
    const owner = await supertest(app).post(`/api/uc/locations/${LOCATION_ID}/ratings/${rating.rows[0].id}/reports`)
      .set("Authorization", bearer(userToken)).send({ reason: "spam" });
    assert.equal(owner.status, 400);
    const report = await supertest(app).post(`/api/uc/locations/${LOCATION_ID}/ratings/${rating.rows[0].id}/reports`)
      .set("Authorization", bearer(reporterToken)).send({ reason: "inaccurate", detail: "Please review" });
    assert.equal(report.status, 201);
    const duplicate = await supertest(app).post(`/api/uc/locations/${LOCATION_ID}/ratings/${rating.rows[0].id}/reports`)
      .set("Authorization", bearer(reporterToken)).send({ reason: "spam" });
    assert.equal(duplicate.status, 409);
  });

  it("excludes hidden ratings, keeps admin assessments separate, and rechecks demotion", async () => {
    const rating = await pool.query("SELECT id FROM uc_location_ratings WHERE location_id=$1 LIMIT 1", [LOCATION_ID]);
    const hidden = await supertest(app).patch(`/api/uc/admin/location-ratings/${rating.rows[0].id}/moderation`)
      .set("Authorization", bearer(adminToken)).send({ status: "hidden" });
    assert.equal(hidden.status, 200);
    const aggregate = await supertest(app).get(`/api/uc/locations/${LOCATION_ID}/ratings`);
    assert.equal(aggregate.body.count, 0);
    const unhidden = await supertest(app).patch(`/api/uc/admin/location-ratings/${rating.rows[0].id}/moderation`)
      .set("Authorization", bearer(adminToken)).send({ status: "published" });
    assert.equal(unhidden.status, 200);
    const restored = await supertest(app).get(`/api/uc/locations/${LOCATION_ID}/ratings`);
    assert.equal(restored.body.count, 1);
    const assessment = await supertest(app).put(`/api/uc/admin/locations/${LOCATION_ID}/assessment`)
      .set("Authorization", bearer(adminToken)).send({ ...scores, checks: { sourceVerified: true }, notes: "Staff assessment" });
    assert.equal(assessment.status, 200);
    assert.equal(assessment.body.assessment.locationId, LOCATION_ID);
    assert.equal(assessment.body.assessment.assessorId, ADMIN_ID);
    await pool.query("UPDATE team_users SET role='member' WHERE id=$1", [ADMIN_ID]);
    const denied = await supertest(app).patch(`/api/uc/admin/location-ratings/${rating.rows[0].id}/moderation`)
      .set("Authorization", bearer(adminToken)).send({ status: "published" });
    assert.equal(denied.status, 403);
  });
});