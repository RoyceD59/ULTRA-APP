import { before, after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { pool } from "@workspace/db";
import { WATER_RECOMMENDATION_TARGETS, type CatalogueLoader } from "../lib/water-recommendation-targets.js";
import { createInstantAssessment, listOwnedAssessments, getAdminAssessment, getPublicAssessment, latestOwnedAssessmentSummary, buildInstantAssessmentAiContext, hashInstantSecurityKey } from "../lib/instant-water-check-service.js";

describe("assessment selections survive storage and compatibility paths", () => {
  let userId: number;
  const ids: string[] = [];
  before(async () => {
    // This suite uses the isolated test DB and never queries live WooCommerce.
    delete process.env.WC_CONSUMER_KEY; delete process.env.WC_CONSUMER_SECRET;
    const result = await pool.query("INSERT INTO uc_users(email,password_hash,first_name) VALUES($1,'unused','Test') RETURNING id", [`multi-${randomUUID()}@example.test`]);
    userId = result.rows[0].id;
  });
  after(async () => {
    await pool.query("DELETE FROM instant_water_assessments WHERE id = ANY($1::text[])", [ids]);
    await pool.query("DELETE FROM uc_users WHERE id=$1", [userId]);
  });
  const input = (answers: any, idempotencyKey = randomUUID()) => ({
    firstName: "Test", phone: "+254712345679", consentVersion: "instant-water-check-v1",
    country: "KE", area: "Nakuru", answers: { country: "KE", area: "Nakuru", ...answers },
    customerUserId: String(userId), scope: `customer:${userId}`, idempotencyKey,
  });
  const verifiedCatalogue: CatalogueLoader = async sku => {
    const target = Object.values(WATER_RECOMMENDATION_TARGETS).find(target => target.sku === sku)!;
    return [{ id: 842, sku, name: target.name }];
  };
  it("returns the stored product on identical/reordered retries and rejects conflicts without calling the catalogue", async () => {
    const request = input({ sources: ["municipal", "bottled"], concerns: ["taste"], settings: ["home"] });
    let calls = 0;
    const first = await createInstantAssessment(request, { loadCatalogue: async sku => {
      calls++;
      return verifiedCatalogue(sku);
    } });
    ids.push(first.response.assessmentId);
    assert.equal(calls, 1);
    assert.equal(first.response.result.recommendation.action, "product");
    assert.equal(first.response.result.recommendation.productId, 842);
    const unavailable: CatalogueLoader = async () => {
      calls++;
      throw new Error("Replay must not wait on the catalogue");
    };
    for (const retry of [request, { ...request, answers: { ...request.answers, sources: [...request.answers.sources].reverse() } }]) {
      const replay = await createInstantAssessment(retry, { loadCatalogue: unavailable });
      assert.equal(replay.replay, true);
      assert.deepEqual(replay.response, first.response);
    }
    await assert.rejects(
      createInstantAssessment({ ...request, area: "Nairobi" }, { loadCatalogue: unavailable }),
      /IDEMPOTENCY_CONFLICT/,
    );
    assert.equal(calls, 1);
  });
  it("keeps exact catalogue verification and enquiry fallbacks for new submissions", async () => {
    for (const loadCatalogue of [
      async () => null,
      async (sku: string) => [{ id: 842, sku, name: "Not the expected product" }],
      async () => [{ id: 842, sku: "WRONG-SKU", name: "Sweet Home" }],
    ]) {
      const created = await createInstantAssessment(input({ source: "municipal", concern: "taste", setting: "home" }), { loadCatalogue });
      ids.push(created.response.assessmentId);
      assert.equal(created.replay, false);
      assert.equal(created.response.result.recommendation.action, "enquiry");
      assert.equal(created.response.result.recommendation.productId, undefined);
    }
  });
  it("waits for a slow catalogue without acquiring a transaction and rechecks a concurrent winner", async t => {
    const request = input({ source: "municipal", concern: "taste", setting: "home" });
    let releaseCatalogue!: () => void;
    let catalogueStarted!: () => void;
    const pendingCatalogue = new Promise<void>(resolve => { releaseCatalogue = resolve; });
    const started = new Promise<void>(resolve => { catalogueStarted = resolve; });
    const originalConnect = pool.connect.bind(pool);
    const connect = t.mock.method(pool, "connect", originalConnect);
    const pending = createInstantAssessment(request, { loadCatalogue: async sku => {
      catalogueStarted();
      await pendingCatalogue;
      return verifiedCatalogue(sku);
    } });
    let winner: Awaited<ReturnType<typeof createInstantAssessment>> | undefined;
    try {
      await started;
      // Only the short autocommit idempotency read has borrowed a connection.
      assert.equal(connect.mock.callCount(), 1);
      winner = await createInstantAssessment(request, { loadCatalogue: async () => null });
      ids.push(winner.response.assessmentId);
    } finally {
      releaseCatalogue();
    }
    const replay = await pending;
    assert.equal(replay.replay, true);
    assert.deepEqual(replay.response, winner!.response);
    const count = await pool.query("SELECT count(*) FROM instant_water_assessments WHERE id=$1", [winner!.response.assessmentId]);
    assert.equal(Number(count.rows[0].count), 1);
  });
  it("retains all choices in raw/owner/staff/AI context, redacts public identity, and replays reordered arrays", async () => {
    const request = input({ sources: ["bottled", "borehole", "shallow"], concerns: ["safety", "taste", "skin"], settings: ["home", "school", "salon"] });
    const first = await createInstantAssessment(request);
    ids.push(first.response.assessmentId);
    const reordered = await createInstantAssessment({ ...request, answers: { ...request.answers, sources: [...request.answers.sources].reverse(), concerns: [...request.answers.concerns].reverse(), settings: [...request.answers.settings].reverse() } });
    assert.equal(reordered.replay, true); assert.deepEqual(reordered.response, first.response);
    const saved = await pool.query("SELECT raw_answers,result FROM instant_water_assessments WHERE id=$1", [first.response.assessmentId]);
    assert.equal(saved.rows[0].raw_answers.sources.length, 3);
    assert.equal(saved.rows[0].raw_answers.concerns.length, 3);
    assert.equal(saved.rows[0].raw_answers.settings.length, 3);
    const owner = (await listOwnedAssessments(String(userId)))[0];
    assert.equal(owner.answers.sources?.length, 3);
    const staff = await getAdminAssessment(first.response.assessmentId);
    assert.equal((staff!.answers as any).settings.length, 3);
    const latest = await latestOwnedAssessmentSummary(String(userId));
    assert.equal(JSON.parse(buildInstantAssessmentAiContext(latest!)).answers.concerns.length, 3);
    const guest = await createInstantAssessment({ ...request, scope: "public-view-test", customerUserId: undefined, idempotencyKey: randomUUID() });
    ids.push(guest.response.assessmentId);
    const publicView = await getPublicAssessment(guest.response.resultToken!, "public-test");
    assert.equal("answers" in publicView!, false);
    assert.equal("phone" in publicView!, false);
    assert.equal("area" in publicView!, false);
  });
  it("keeps pre-upgrade scalar idempotency retries compatible and old result snapshots unchanged", async () => {
    const request = input({ source: "municipal", concern: "taste", setting: "home" });
    const first = await createInstantAssessment(request);
    ids.push(first.response.assessmentId);
    const oldPayload = { firstName: request.firstName, normalizedPhone: request.phone, consentVersion: request.consentVersion, country: request.country, area: request.area, answers: request.answers, sourceAttribution: {}, customerUserId: request.customerUserId };
    const stable = (v: any): string => JSON.stringify(v, (_key, item) =>
      item && typeof item === "object" && !Array.isArray(item)
        ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)))
        : item);
    const hash = hashInstantSecurityKey(stable(oldPayload));
    await pool.query("UPDATE instant_water_idempotency SET request_hash=$1 WHERE assessment_id=$2 AND endpoint='create-instant-water-assessment'", [hash, first.response.assessmentId]);
    const replay = await createInstantAssessment(request, { loadCatalogue: async () => {
      throw new Error("Legacy replay must not call the catalogue");
    } });
    assert.equal(replay.replay, true);
    const original = await pool.query("SELECT result FROM instant_water_assessments WHERE id=$1", [first.response.assessmentId]);
    await pool.query("UPDATE instant_water_assessments SET raw_answers='{}'::jsonb,rules_version='instant-water-check-v1' WHERE id=$1", [first.response.assessmentId]);
    const legacy = (await listOwnedAssessments(String(userId))).find(r => r.assessmentId === first.response.assessmentId)!;
    assert.deepEqual(legacy.answers.sources, ["municipal"]);
    const saved = await pool.query("SELECT result FROM instant_water_assessments WHERE id=$1", [first.response.assessmentId]);
    assert.deepEqual(saved.rows[0].result, original.rows[0].result);
  });
});