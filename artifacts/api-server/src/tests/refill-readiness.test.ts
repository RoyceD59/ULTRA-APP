import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import express from 'express';
import request from 'supertest';
import { simulateRefillEconomics, type RefillSimulationInput } from "@workspace/api-zod/refill-readiness";
import { getRefillCapabilities } from "../lib/refill-readiness.js";
import { setRefillFeaturesReaderForTests } from "../lib/refill-features.js";
import router from "../routes/refill-readiness.js";

const scenario = (): RefillSimulationInput => ({
  pricingVersion: "test-rule-v1", campaignVersion: "test-campaign-v1",
  volumeMl: 1501, cashChargeMinor: 0, sponsorFundingMinor: 1000,
  costs: { waterPerLitreMinor: 101, paymentMinor: 0, deliverySupportMinor: 20, benefitObligationMinor: 30, taxMinor: 0 },
});

describe("controlled refill foundation", () => {
  beforeEach(() => {
    setRefillFeaturesReaderForTests(async () => ({ careOverview: false, refillGovernance: false }));
  });
  afterEach(() => { setRefillFeaturesReaderForTests(null); });
  it("keeps every paid or posting capability off regardless of persisted feature values", () => {
    const flags = getRefillCapabilities({ careOverview: true, refillGovernance: true });
    assert.equal(flags.careOverview, true);
    for (const name of ["promoRefill", "paidRefill", "moneyWallet", "paidCare", "automaticCollection"] as const) {
      assert.equal(flags[name], false);
    }
  });
  it("defaults all persisted preview capabilities to off", () => {
    assert.equal(getRefillCapabilities().careOverview, false);
  });
  it("reads the public Care API gate dynamically from injectable persisted features", async () => {
    const app = express(); app.use(express.json()); app.use("/api", router);
    try {
      setRefillFeaturesReaderForTests(async () => ({ careOverview: false, refillGovernance: false }));
      const disabled = await request(app).get("/api/uc/refill/capabilities").expect(200);
      assert.equal(disabled.body.careOverview, false);
      setRefillFeaturesReaderForTests(async () => ({ careOverview: true, refillGovernance: false }));
      const enabled = await request(app).get("/api/uc/refill/capabilities").expect(200);
      assert.equal(enabled.body.careOverview, true);
    } finally {
      setRefillFeaturesReaderForTests(null);
    }
  });
  it("uses exact mL and minor units, rounds water cost up, and excludes promotional MRR", () => {
    const result = simulateRefillEconomics(scenario());
    assert.equal(result.totalCostMinor, 202);
    assert.equal(result.contributionMinor, 798);
    assert.equal(result.promotionalMrrMinor, 0);
    assert.equal(result.activationAllowed, false);
  });
  it("fails closed when persisted feature capabilities cannot be read", async () => {
    setRefillFeaturesReaderForTests(async () => { throw new Error("unavailable test store"); });
    const app = express(); app.use('/api', router);
    const response = await request(app).get('/api/uc/refill/capabilities').expect(503);
    assert.equal(response.headers['cache-control'], 'no-store');
    assert.deepEqual(response.body, { error: "Feature capabilities could not be loaded." });
  });
  it("does not treat a missing cost as zero or calculate contribution", () => {
    for (const name of Object.keys(scenario().costs) as (keyof RefillSimulationInput["costs"])[]) {
      const input = scenario(); input.costs[name] = null;
      const result = simulateRefillEconomics(input);
      assert.equal(result.status, "missing_costs");
      assert.deepEqual(result.missingCosts, [name]);
      assert.equal(result.totalCostMinor, null); assert.equal(result.contributionMinor, null);
    }
  });
  it("keeps a negative contribution visible", () => {
    const input = scenario(); input.sponsorFundingMinor = 0;
    assert.equal(simulateRefillEconomics(input).contributionMinor, -202);
  });
  it("rejects fractional, negative, unsafe or extra posting inputs", () => {
    for (const changes of [{ volumeMl: 1.5 }, { cashChargeMinor: -1 }, { cashChargeMinor: Number.MAX_SAFE_INTEGER + 1 }, { accountId: 7 }, { approved: true }]) {
      assert.throws(() => simulateRefillEconomics({ ...scenario(), ...changes }));
    }
    assert.throws(() => simulateRefillEconomics({
      ...scenario(), volumeMl: Number.MAX_SAFE_INTEGER,
      costs: { ...scenario().costs, waterPerLitreMinor: Number.MAX_SAFE_INTEGER },
    }), RangeError);
  });
  it("returns only safe public booleans and denies anonymous admin access", async () => {
    const app = express(); app.use(express.json()); app.use('/api', router);
    const publicResult = await request(app).get('/api/uc/refill/capabilities').expect(200);
    assert.equal(publicResult.headers['cache-control'], 'no-store');
    assert.deepEqual(Object.keys(publicResult.body).sort(), ['version','careOverview','promoRefill','paidRefill','moneyWallet','paidCare','automaticCollection'].sort());
    await request(app).get('/api/uc/admin/refill/readiness').expect(401);
    await request(app).post('/api/uc/admin/refill/simulate').send(scenario()).expect(401);
    await request(app).post('/api/uc/refill/authorize').send({ approved: true }).expect(404);
  });
});
