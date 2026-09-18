import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import supertest from "supertest";
import { pool } from "@workspace/db";
import app from "../app.js";
import { issueToken } from "../lib/jwt.js";

const ADMIN_ID = "reviewed-starter-tap-admin";
const ADMIN_EMAIL = "reviewed-starter-tap-admin@test.invalid";
const LOCATION_ID = "reviewed-starter-tap";
let adminToken: string;

const publishedLocation = {
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
  lastFieldVerifiedOn: null,
};
function bearer(token: string): string {
  return `Bearer ${token}`;
}

before(async () => {
  await pool.query("DELETE FROM team_users WHERE id=$1", [ADMIN_ID]);
  await pool.query(
    `INSERT INTO team_users(id,email,name,password_hash,role,is_active)
     VALUES($1,$2,'Starter Tap Reviewer','unused','admin',true)`,
    [ADMIN_ID, ADMIN_EMAIL],
  );
  adminToken = issueToken({
    id: ADMIN_ID,
    type: "team-session",
    role: "admin",
    exp: Math.floor(Date.now() / 1000) + 3600,
  });
});

beforeEach(async () => {
  await pool.query("DELETE FROM uc_locations WHERE id=$1", [LOCATION_ID]);
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
});

after(async () => {
  await pool.query("DELETE FROM uc_locations WHERE id=$1", [LOCATION_ID]);
  await pool.query("DELETE FROM team_users WHERE id=$1", [ADMIN_ID]);
});

describe("reviewed starter tap customer journey", () => {
  it("hides a deactivated reviewed tap from customer maps", async () => {
    const firstReview = await supertest(app)
      .post(`/api/uc/admin/locations/${LOCATION_ID}/verify`)
      .set("Authorization", bearer(adminToken));
    assert.equal(firstReview.status, 200);

    const initiallyPublished = await supertest(app).get("/api/uc/locations");
    assert.equal(initiallyPublished.status, 200);
    assert.equal(
      initiallyPublished.body.filter((location: { id: string }) => location.id === LOCATION_ID).length,
      1,
    );

    const deactivated = await supertest(app)
      .patch(`/api/uc/admin/locations/${LOCATION_ID}`)
      .set("Authorization", bearer(adminToken))
      .send({ active: false });
    assert.equal(deactivated.status, 200);
    assert.equal(deactivated.body.location.active, false);
    assert.equal(deactivated.body.location.verified, true);
    assert.equal(deactivated.body.location.verifiedBy, ADMIN_EMAIL);
    assert.ok(deactivated.body.location.verifiedAt);

    const hiddenAfterDeactivation = await supertest(app).get("/api/uc/locations");
    assert.equal(hiddenAfterDeactivation.status, 200);
    assert.equal(
      hiddenAfterDeactivation.body.some((location: { id: string }) => location.id === LOCATION_ID),
      false,
    );

    const reactivated = await supertest(app)
      .patch(`/api/uc/admin/locations/${LOCATION_ID}`)
      .set("Authorization", bearer(adminToken))
      .send({ active: true });
    assert.equal(reactivated.status, 200);
    assert.equal(reactivated.body.location.active, true);
    assert.equal(reactivated.body.location.verified, true);
    assert.equal(reactivated.body.location.verifiedBy, ADMIN_EMAIL);
    assert.equal(reactivated.body.location.verifiedAt, deactivated.body.location.verifiedAt);

    const republished = await supertest(app).get("/api/uc/locations");
    assert.equal(republished.status, 200);
    assert.equal(
      republished.body.filter((location: { id: string }) => location.id === LOCATION_ID).length,
      1,
    );
  });

  it("keeps an unchanged reviewed tap published when staff save its identity details", async () => {
    const firstReview = await supertest(app)
      .post(`/api/uc/admin/locations/${LOCATION_ID}/verify`)
      .set("Authorization", bearer(adminToken));
    assert.equal(firstReview.status, 200);

    const unchanged = await supertest(app)
      .patch(`/api/uc/admin/locations/${LOCATION_ID}`)
      .set("Authorization", bearer(adminToken))
      .send({
        type: " city_tap ",
        name: " Reviewed Starter Tap ",
        address: " Market Road ",
        latitude: "-1.286400",
        longitude: "36.817200",
        vendorName: "",
      });
    assert.equal(unchanged.status, 200);
    assert.equal(unchanged.body.verificationReset, false);
    assert.equal(unchanged.body.location.verified, true);
    assert.equal(unchanged.body.location.verifiedBy, ADMIN_EMAIL);
    assert.equal(unchanged.body.location.verifiedAt, firstReview.body.location.verifiedAt);

    const stillPublished = await supertest(app).get("/api/uc/locations");
    assert.equal(stillPublished.status, 200);
    assert.equal(
      stillPublished.body.filter((location: { id: string }) => location.id === LOCATION_ID).length,
      1,
    );
  });

  const identityEdits = [
    { label: "name", patch: { name: "Reviewed Starter Tap - Updated" }, expected: { name: "Reviewed Starter Tap - Updated" } },
    { label: "address", patch: { address: "New Market Road" }, expected: { address: "New Market Road" } },
    { label: "type", patch: { type: "water_atm" }, expected: { type: "water_atm" } },
    { label: "latitude", patch: { lat: -1.287 }, expected: { lat: -1.287 } },
    { label: "longitude", patch: { lng: 36.818 }, expected: { lng: 36.818 } },
  ] as const;

  for (const identityEdit of identityEdits) it(`requires a new review after changing only the tap ${identityEdit.label}`, async () => {
    const firstReview = await supertest(app)
      .post(`/api/uc/admin/locations/${LOCATION_ID}/verify`)
      .set("Authorization", bearer(adminToken));
    assert.equal(firstReview.status, 200);
    assert.equal(firstReview.body.location.verified, true);
    assert.equal(firstReview.body.location.verifiedBy, ADMIN_EMAIL);
    assert.ok(firstReview.body.location.verifiedAt);

    const edited = await supertest(app)
      .patch(`/api/uc/admin/locations/${LOCATION_ID}`)
      .set("Authorization", bearer(adminToken))
      .send(identityEdit.patch);
    assert.equal(edited.status, 200);
    assert.equal(edited.body.verificationReset, true);
    assert.equal(edited.body.location.verified, false);
    assert.equal(edited.body.location.verifiedBy, null);
    assert.equal(edited.body.location.verifiedAt, null);

    // Both customer map implementations consume this endpoint and therefore
    // receive no marker or list item while the edited identity is unreviewed.
    const hiddenFromCustomerMaps = await supertest(app).get("/api/uc/locations");
    assert.equal(hiddenFromCustomerMaps.status, 200);
    assert.equal(
      hiddenFromCustomerMaps.body.some((location: { id: string }) => location.id === LOCATION_ID),
      false,
    );

    const secondReview = await supertest(app)
      .post(`/api/uc/admin/locations/${LOCATION_ID}/verify`)
      .set("Authorization", bearer(adminToken));
    assert.equal(secondReview.status, 200);
    assert.equal(secondReview.body.location.verified, true);
    assert.equal(secondReview.body.location.verifiedBy, ADMIN_EMAIL);
    assert.ok(secondReview.body.location.verifiedAt);

    const published = await supertest(app).get("/api/uc/locations");
    assert.equal(published.status, 200);
    const matches = published.body.filter((location: { id: string }) => location.id === LOCATION_ID);
    assert.equal(matches.length, 1);
    assert.deepEqual(matches[0], { ...publishedLocation, ...identityEdit.expected });
  });
});
