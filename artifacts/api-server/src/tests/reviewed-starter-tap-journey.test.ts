import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import supertest from "supertest";
import { pool } from "@workspace/db";
import app from "../app.js";
import { issueToken } from "../lib/jwt.js";

const ADMIN_ID = "reviewed-starter-tap-admin";
const ADMIN_EMAIL = "reviewed-starter-tap-admin@test.invalid";
const LOCATION_ID = "reviewed-starter-tap";
let adminToken: string;

function bearer(token: string): string {
  return `Bearer ${token}`;
}

before(async () => {
  await pool.query("DELETE FROM uc_locations WHERE id=$1", [LOCATION_ID]);
  await pool.query("DELETE FROM team_users WHERE id=$1", [ADMIN_ID]);
  await pool.query(
    `INSERT INTO team_users(id,email,name,password_hash,role,is_active)
     VALUES($1,$2,'Starter Tap Reviewer','unused','admin',true)`,
    [ADMIN_ID, ADMIN_EMAIL],
  );
  await pool.query(
    `INSERT INTO uc_locations(
       id,type,name,address,latitude,longitude,hours,active,verified,
       country_iso,city,access_notes,municipal,source_attribution,created_by
     ) VALUES(
       $1,'city_tap','Reviewed Starter Tap','Market Road','-1.2864','36.8172','Daily, 06:00–20:00',true,false,
       'KE','Nairobi','Use the public tap beside the market entrance.','Nairobi City Water','Starter tap field survey','starter-seed'
     )`,
    [LOCATION_ID],
  );
  adminToken = issueToken({
    id: ADMIN_ID,
    type: "team-session",
    role: "admin",
    exp: Math.floor(Date.now() / 1000) + 3600,
  });
});

after(async () => {
  await pool.query("DELETE FROM uc_locations WHERE id=$1", [LOCATION_ID]);
  await pool.query("DELETE FROM team_users WHERE id=$1", [ADMIN_ID]);
});

describe("reviewed starter tap customer journey", () => {
  it("publishes a pending tap exactly once after administrator verification", async () => {
    const pending = await supertest(app).get("/api/uc/locations");
    assert.equal(pending.status, 200);
    assert.equal(pending.body.some((location: { id: string }) => location.id === LOCATION_ID), false);

    const verified = await supertest(app)
      .post(`/api/uc/admin/locations/${LOCATION_ID}/verify`)
      .set("Authorization", bearer(adminToken));
    assert.equal(verified.status, 200);
    assert.equal(verified.body.location.verified, true);
    assert.equal(verified.body.location.verifiedBy, ADMIN_EMAIL);
    assert.ok(verified.body.location.verifiedAt);

    const repeated = await supertest(app)
      .post(`/api/uc/admin/locations/${LOCATION_ID}/verify`)
      .set("Authorization", bearer(adminToken));
    assert.equal(repeated.status, 200);

    const published = await supertest(app).get("/api/uc/locations");
    assert.equal(published.status, 200);
    const matches = published.body.filter((location: { id: string }) => location.id === LOCATION_ID);
    assert.equal(matches.length, 1);
    assert.deepEqual(matches[0], {
      id: LOCATION_ID,
      type: "city_tap",
      name: "Reviewed Starter Tap",
      address: "Market Road",
      lat: -1.2864,
      lng: 36.8172,
      hours: "Daily, 06:00–20:00",
      phone: null,
      vendorName: null,
      countryIso: "KE",
      city: "Nairobi",
      accessNotes: "Use the public tap beside the market entrance.",
      municipal: "Nairobi City Water",
      sourceAttribution: "Starter tap field survey",
    });
  });
});