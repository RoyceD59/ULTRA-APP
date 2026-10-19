import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import express from "express";
import supertest from "supertest";
import { pool } from "@workspace/db";
import { issueToken } from "../lib/jwt.js";
import { assertIsolatedApiTestDatabase } from "./assert-isolated-test-database.js";
import featureRouter from "../routes/refill-features.js";
import governanceRouter from "../routes/refill-governance.js";
import readinessRouter from "../routes/refill-readiness.js";

assertIsolatedApiTestDatabase();
process.env.SESSION_SECRET ??= "isolated-refill-feature-tests-only";

test("persisted refill feature controls require a live team admin and keep paid features hard-off", async () => {
  const adminId = `refill-admin-${randomUUID()}`;
  const memberId = `refill-member-${randomUUID()}`;
  const wooAdmin = issueToken({ id: "9999999999", email: "admin@example.test", src: "woo" });
  await pool.query(
    `INSERT INTO team_users (id,email,name,password_hash,role,is_active)
     VALUES ($1,$2,'Test administrator','not-used','admin',true),
            ($3,$4,'Test member','not-used','member',true)`,
    [adminId, `${adminId}@example.test`, memberId, `${memberId}@example.test`],
  );
  await pool.query(`
    INSERT INTO team_settings (id,care_overview_preview,refill_governance_preview)
    VALUES ('singleton',false,false)
    ON CONFLICT (id) DO UPDATE SET care_overview_preview=false,refill_governance_preview=false
  `);
  const admin = `Bearer ${issueToken({ id: adminId, email: `${adminId}@example.test`, role: "admin", type: "team-session" })}`;
  const member = `Bearer ${issueToken({ id: memberId, email: `${memberId}@example.test`, role: "member", type: "team-session" })}`;
  const app = express();
  app.use(express.json());
  app.use("/api", featureRouter, readinessRouter, governanceRouter);
  const api = supertest(app);
  const features = "/api/uc/admin/refill/features";

  try {
    assert.deepEqual((await api.get("/api/uc/refill/capabilities").expect(200)).body, {
      version: 1, careOverview: false, promoRefill: false, paidRefill: false,
      moneyWallet: false, paidCare: false, automaticCollection: false,
    });
    await api.get(features).expect(401);
    await api.patch(features).set("Authorization", wooAdmin).send({ careOverview: true }).expect(401);
    await api.patch(features).set("Authorization", member).send({ careOverview: true }).expect(403);
    await api.get("/api/uc/admin/refill/governance/stations").set("Authorization", admin).expect(404);
    assert.deepEqual((await api.get(features).set("Authorization", admin).expect(200)).body,
      { careOverview: false, refillGovernance: false });

    await api.patch(features).set("Authorization", admin).send({ careOverview: "true" }).expect(400);
    await api.patch(features).set("Authorization", admin).send({ paidRefill: true }).expect(400);
    await api.patch(features).set("Authorization", admin).send({}).expect(400);

    const [careResult, governanceResult] = await Promise.all([
      api.patch(features).set("Authorization", admin).send({ careOverview: true }),
      api.patch(features).set("Authorization", admin).send({ refillGovernance: true }),
    ]);
    assert.equal(careResult.status, 200);
    assert.equal(governanceResult.status, 200);
    assert.deepEqual((await api.get(features).set("Authorization", admin).expect(200)).body,
      { careOverview: true, refillGovernance: true });

    const freshApp = express();
    freshApp.use(express.json());
    freshApp.use("/api", featureRouter, readinessRouter, governanceRouter);
    const capabilities = await supertest(freshApp).get("/api/uc/refill/capabilities").expect(200);
    assert.equal(capabilities.body.careOverview, true);
    for (const name of ["promoRefill", "paidRefill", "moneyWallet", "paidCare", "automaticCollection"]) {
      assert.equal(capabilities.body[name], false, `${name} stays disabled`);
    }
    await api.get("/api/uc/admin/refill/governance/stations").set("Authorization", admin).expect(200);

    await api.patch(features).set("Authorization", admin).send({ careOverview: false }).expect(200);
    assert.equal((await supertest(freshApp).get("/api/uc/refill/capabilities").expect(200)).body.careOverview, false);
    await api.patch(features).set("Authorization", admin).send({ refillGovernance: false }).expect(200);
    await api.get("/api/uc/admin/refill/governance/stations").set("Authorization", admin).expect(404);
  } finally {
    await pool.query(
      "UPDATE team_settings SET care_overview_preview=false,refill_governance_preview=false WHERE id='singleton'",
    );
    await pool.query("DELETE FROM team_users WHERE id = ANY($1::text[])", [[adminId, memberId]]);
  }
});