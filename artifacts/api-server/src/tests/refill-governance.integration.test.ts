import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import express from "express";
import supertest from "supertest";
import { pool } from "@workspace/db";
import { issueToken } from "../lib/jwt.js";
import { setRefillFeaturesReaderForTests, type RefillFeatures } from "../lib/refill-features.js";
import governanceRouter from "../routes/refill-governance.js";
import { assertIsolatedApiTestDatabase } from "./assert-isolated-test-database.js";

assertIsolatedApiTestDatabase();
process.env.SESSION_SECRET ??= "isolated-refill-governance-tests-only";

// Use a per-worker injected persisted-settings reader: the real singleton
// setting is exercised by refill-features.integration.test.ts, so this route
// suite cannot race that test while node:test runs files concurrently.
test("refill governance records enforce live team authority and immutable pilot rules", async () => {
  const suffix = randomUUID();
  const maker = `refill-maker-${suffix}`;
  const checker = `refill-checker-${suffix}`;
  const operator = `refill-operator-${suffix}`;
  const station = `refill-station-${suffix}`;
  const unverifiedStation = `refill-unverified-${suffix}`;
  const campaignKey = `pilot-${suffix.replaceAll("-", "").slice(0, 12)}`;
  let featureSettings: RefillFeatures = { careOverview: false, refillGovernance: false };
  setRefillFeaturesReaderForTests(async () => featureSettings);
  const migration = await readFile(new URL("../../../../lib/db/migrations/0054_uc_refill_governance.sql", import.meta.url), "utf8");
  await pool.query(migration);
  await pool.query(migration);

  await pool.query(
    `INSERT INTO team_users (id,email,name,password_hash,role,is_active)
     VALUES ($1,$2,'Refill maker','not-used','admin',true),
            ($3,$4,'Refill checker','not-used','admin',true),
            ($5,$6,'Refill operator','not-used','member',true)`,
    [maker, `${maker}@example.test`, checker, `${checker}@example.test`, operator, `${operator}@example.test`],
  );
  await pool.query(
    `INSERT INTO uc_locations (id,type,name,address,latitude,longitude,active,verified)
     VALUES ($1,'refill_station','Pilot station','Test address',-1.286389,36.817223,true,true),
            ($2,'refill_station','Unverified station','Test address',-1.286389,36.817223,true,false)`,
    [station, unverifiedStation],
  );

  const app = express();
  app.use(express.json());
  app.use("/api", governanceRouter);
  const api = supertest(app);
  const url = "/api/uc/admin/refill/governance";
  const reason = { reason: "Reviewed for the isolated pilot test." };
  const auth = (id: string, role: string) => ({
    Authorization: `Bearer ${issueToken({ id, email: `${id}@example.test`, role, type: "team-session" })}`,
  });

  try {
    assert.equal((await api.get(`${url}/stations`)).status, 404);
    featureSettings = { ...featureSettings, refillGovernance: true };
    assert.equal((await api.get(`${url}/stations`)).status, 401);
    assert.equal((await api.get(`${url}/stations`).set(auth(operator, "admin"))).status, 403);
    assert.equal((await api.post(`${url}/stations/${unverifiedStation}/enable`).set(auth(maker, "admin")).send(reason)).status, 409);
    assert.equal((await api.post(`${url}/stations/${station}/enable`).set(auth(maker, "admin")).send(reason)).status, 200);
    assert.equal((await api.post(`${url}/stations/${station}/operators/${operator}/grant`).set(auth(maker, "admin")).send(reason)).status, 200);
    let scope = await api.get("/api/uc/station/refill/scope").set(auth(operator, "member"));
    assert.equal(scope.status, 200);
    assert.deepEqual(scope.body, { stations: [{ stationId: station, name: "Pilot station" }], mayDispense: false });

    const now = Date.now();
    const proposal = {
      campaignKey, version: 1, stationId: station, eligibilityPolicy: "manual_review", maxGrants: 3,
      startsAt: new Date(now + 3_600_000).toISOString(), endsAt: new Date(now + 86_400_000).toISOString(),
      scenario: {
        pricingVersion: "cost-evidence-1", campaignVersion: `${campaignKey}:1`, volumeMl: 1000,
        cashChargeMinor: 0, sponsorFundingMinor: 1000,
        costs: { waterPerLitreMinor: 100, paymentMinor: 0, deliverySupportMinor: 50, benefitObligationMinor: 10, taxMinor: 0 },
      },
    };
    assert.equal((await api.post(`${url}/rules`).set(auth(operator, "admin")).send(proposal)).status, 403);
    const created = await api.post(`${url}/rules`).set(auth(maker, "admin")).send(proposal);
    assert.equal(created.status, 200);
    assert.equal(created.body.status, "proposed");
    assert.equal((await api.post(`${url}/rules`).set(auth(maker, "admin")).send({ ...proposal, maxGrants: 4 })).status, 409);
    assert.equal((await api.post(`${url}/rules/${created.body.id}/approve`).set(auth(maker, "admin")).send(reason)).status, 403);
    assert.equal((await api.post(`${url}/rules/${created.body.id}/approve`).set(auth(checker, "admin")).send(reason)).status, 200);
    assert.equal((await api.post(`${url}/rules/${created.body.id}/approve`).set(auth(checker, "admin")).send(reason)).body.changed, false);

    const missingCost = await api.post(`${url}/rules`).set(auth(maker, "admin")).send({
      ...proposal, version: 2,
      scenario: { ...proposal.scenario, campaignVersion: `${campaignKey}:2`, costs: { ...proposal.scenario.costs, taxMinor: null } },
    });
    assert.equal(missingCost.status, 200);
    assert.equal((await api.post(`${url}/rules/${missingCost.body.id}/approve`).set(auth(checker, "admin")).send(reason)).status, 422);
    const unfunded = await api.post(`${url}/rules`).set(auth(maker, "admin")).send({
      ...proposal, version: 3,
      scenario: { ...proposal.scenario, campaignVersion: `${campaignKey}:3`, sponsorFundingMinor: 0 },
    });
    assert.equal(unfunded.status, 200);
    assert.equal((await api.post(`${url}/rules/${unfunded.body.id}/approve`).set(auth(checker, "admin")).send(reason)).status, 422);

    await assert.rejects(
      pool.query("UPDATE uc_refill_campaign_versions SET max_grants=999 WHERE id=$1", [created.body.id]),
      /append-only/,
    );
    await assert.rejects(
      pool.query("DELETE FROM uc_refill_campaign_actions WHERE campaign_version_id=$1", [created.body.id]),
      /append-only/,
    );
    assert.equal((await api.post(`${url}/rules/${created.body.id}/suspend`).set(auth(maker, "admin")).send(reason)).status, 200);
    const listed = await api.get(`${url}/rules`).set(auth(checker, "admin"));
    assert.equal(listed.body.find((rule: { id: string }) => rule.id === created.body.id)?.status, "suspended");

    await pool.query("UPDATE team_users SET is_active=false WHERE id=$1", [operator]);
    scope = await api.get("/api/uc/station/refill/scope").set(auth(operator, "member"));
    assert.equal(scope.status, 403);
    await pool.query("UPDATE team_users SET is_active=true WHERE id=$1", [operator]);
    assert.equal((await api.post(`${url}/stations/${station}/suspend`).set(auth(maker, "admin")).send(reason)).status, 200);
    scope = await api.get("/api/uc/station/refill/scope").set(auth(operator, "member"));
    assert.deepEqual(scope.body, { stations: [], mayDispense: false });
    assert.equal((await api.post(`${url}/stations/${station}/enable`).set(auth(maker, "admin")).send(reason)).status, 403);
    assert.equal((await api.post(`${url}/stations/${station}/enable`).set(auth(checker, "admin")).send(reason)).status, 200);
    scope = await api.get("/api/uc/station/refill/scope").set(auth(operator, "member"));
    assert.deepEqual(scope.body, { stations: [], mayDispense: false });
    assert.equal((await api.post(`${url}/stations/${station}/operators/${operator}/grant`).set(auth(checker, "admin")).send(reason)).status, 200);
    scope = await api.get("/api/uc/station/refill/scope").set(auth(operator, "member"));
    assert.equal(scope.body.stations.length, 1);
  } finally {
    setRefillFeaturesReaderForTests(null);
  }
});