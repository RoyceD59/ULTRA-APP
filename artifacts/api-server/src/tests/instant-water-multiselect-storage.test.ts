import { before, after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, randomInt } from "node:crypto";
import { pool } from "@workspace/db";
import { WATER_RECOMMENDATION_TARGETS, type CatalogueLoader } from "../lib/water-recommendation-targets.js";
import { createInstantAssessment, listOwnedAssessments, getAdminAssessment, getPublicAssessment, latestOwnedAssessmentSummary, buildInstantAssessmentAiContext, hashInstantSecurityKey, instantCreateRateLimitKeys } from "../lib/instant-water-check-service.js";

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
    await pool.query("DELETE FROM instant_water_idempotency WHERE assessment_id = ANY($1::text[])", [ids]);
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
  const expire = async (assessmentId: string) => {
    await pool.query(
      "UPDATE instant_water_idempotency SET expires_at=now() - interval '1 second' WHERE assessment_id=$1 AND endpoint='create-instant-water-assessment'",
      [assessmentId],
    );
  };
  it("reuses expired keys for identical or changed submissions without losing old assessments, tickets, or lead deliveries", async t => {
    const previousLeadUrl = process.env.GOOGLE_LEAD_APPS_SCRIPT_URL;
    process.env.GOOGLE_LEAD_APPS_SCRIPT_URL = "https://example.test/lead";
    t.after(() => {
      if (previousLeadUrl === undefined) delete process.env.GOOGLE_LEAD_APPS_SCRIPT_URL;
      else process.env.GOOGLE_LEAD_APPS_SCRIPT_URL = previousLeadUrl;
    });
    for (const changed of [false, true]) {
      const request = input({ source: "municipal", concern: "taste", setting: "home" });
      const first = await createInstantAssessment(request, { loadCatalogue: verifiedCatalogue });
      ids.push(first.response.assessmentId);
      const original = await pool.query("SELECT * FROM instant_water_assessments WHERE id=$1", [first.response.assessmentId]);
      const ticket = await pool.query("SELECT * FROM instant_water_check_tickets WHERE assessment_id=$1", [first.response.assessmentId]);
      await expire(first.response.assessmentId);
      const nextRequest = changed ? { ...request, area: "Nairobi" } : request;
      const next = await createInstantAssessment(nextRequest, { loadCatalogue: verifiedCatalogue });
      ids.push(next.response.assessmentId);
      assert.equal(next.replay, false);
      assert.notEqual(next.response.assessmentId, first.response.assessmentId);
      assert.deepEqual((await pool.query("SELECT * FROM instant_water_assessments WHERE id=$1", [first.response.assessmentId])).rows, original.rows);
      assert.deepEqual((await pool.query("SELECT * FROM instant_water_check_tickets WHERE assessment_id=$1", [first.response.assessmentId])).rows, ticket.rows);
      const retry = await pool.query(
        "SELECT assessment_id, expires_at > now() AS active FROM instant_water_idempotency WHERE endpoint='create-instant-water-assessment' AND scope=$1 AND idempotency_key=$2",
        [request.scope, request.idempotencyKey],
      );
      assert.deepEqual(retry.rows, [{ assessment_id: next.response.assessmentId, active: true }]);
      const outbox = await pool.query(
        "SELECT assessment_id, idempotency_key, submission_id FROM instant_water_lead_outbox WHERE assessment_id=ANY($1::text[])",
        [[first.response.assessmentId, next.response.assessmentId]],
      );
      assert.equal(outbox.rows.length, 2);
      assert.equal(new Set(outbox.rows.map(row => row.idempotency_key)).size, 2);
      assert.equal(new Set(outbox.rows.map(row => row.submission_id)).size, 2);
      const replay = await createInstantAssessment(nextRequest, { loadCatalogue: async () => { throw new Error("Active retry must not call catalogue"); } });
      assert.equal(replay.replay, true);
      assert.deepEqual(replay.response, next.response);
      await assert.rejects(createInstantAssessment({ ...nextRequest, area: "Kisumu" }), /IDEMPOTENCY_CONFLICT/);
    }
  });
  it("creates only one new assessment and ticket for concurrent expired-key reuse, including conflicting requests", async () => {
    for (const conflicting of [false, true]) {
      const request = input({ source: "municipal", concern: "taste", setting: "home" });
      const first = await createInstantAssessment(request, { loadCatalogue: verifiedCatalogue });
      ids.push(first.response.assessmentId);
      await expire(first.response.assessmentId);
      let started = 0;
      let release!: () => void;
      const barrier = new Promise<void>(resolve => { release = resolve; });
      const loadCatalogue: CatalogueLoader = async sku => {
        if (++started === 2) release();
        await barrier;
        return verifiedCatalogue(sku);
      };
      const attempts = await Promise.allSettled([
        createInstantAssessment(request, { loadCatalogue }),
        createInstantAssessment(conflicting ? { ...request, area: "Nairobi" } : request, { loadCatalogue }),
      ]);
      const successes = attempts.filter(attempt => attempt.status === "fulfilled").map(attempt => attempt.value);
      const newIds = [...new Set(successes.map(attempt => attempt.response.assessmentId))];
      ids.push(...newIds);
      assert.equal(newIds.length, 1);
      assert.notEqual(newIds[0], first.response.assessmentId);
      assert.equal(successes.filter(attempt => !attempt.replay).length, 1);
      if (conflicting) {
        assert.equal(successes.length, 1);
        const failure = attempts.find(attempt => attempt.status === "rejected");
        assert.match(String(failure!.reason), /IDEMPOTENCY_CONFLICT/);
      } else {
        assert.equal(successes.length, 2);
        assert.deepEqual(successes[0].response, successes[1].response);
      }
      const count = await pool.query(
        "SELECT count(*) FROM instant_water_check_tickets WHERE assessment_id=ANY($1::text[])",
        [[first.response.assessmentId, ...newIds]],
      );
      assert.equal(Number(count.rows[0].count), 2);
    }
  });
  it("preserves expired keys on rate-limit rejection so later guest and customer reuse still delivers a new lead", async t => {
    const previousLeadUrl = process.env.GOOGLE_LEAD_APPS_SCRIPT_URL;
    process.env.GOOGLE_LEAD_APPS_SCRIPT_URL = "https://example.test/lead";
    t.after(() => {
      if (previousLeadUrl === undefined) delete process.env.GOOGLE_LEAD_APPS_SCRIPT_URL;
      else process.env.GOOGLE_LEAD_APPS_SCRIPT_URL = previousLeadUrl;
    });
    for (const guest of [true, false]) {
      const request = {
        ...input({ source: "municipal", concern: "taste", setting: "home" }),
        phone: `+25471${randomInt(1000000, 10000000)}`,
        ...(guest ? { customerUserId: undefined, scope: `guest:${randomUUID()}` } : {}),
        rateKey: `expired-rate:${randomUUID()}`,
      };
      const limits = instantCreateRateLimitKeys(request.rateKey, request.phone, request.customerUserId);
      const rateHashes = Object.values(limits).map(key => hashInstantSecurityKey(`rate:${key}`));
      t.after(async () => {
        await pool.query("DELETE FROM instant_water_rate_limits WHERE key_hash=ANY($1::text[])", [rateHashes]);
      });
      const first = await createInstantAssessment(request, { loadCatalogue: verifiedCatalogue });
      ids.push(first.response.assessmentId);
      await expire(first.response.assessmentId);
      const expired = await pool.query("SELECT * FROM instant_water_idempotency WHERE assessment_id=$1", [first.response.assessmentId]);
      await pool.query("UPDATE instant_water_rate_limits SET request_count=8 WHERE key_hash=$1", [rateHashes[0]]);
      await assert.rejects(createInstantAssessment(request, { loadCatalogue: verifiedCatalogue }), /RATE_LIMITED/);
      assert.deepEqual((await pool.query("SELECT * FROM instant_water_idempotency WHERE assessment_id=$1", [first.response.assessmentId])).rows, expired.rows);
      const counter = await pool.query("SELECT request_count FROM instant_water_rate_limits WHERE key_hash=$1", [rateHashes[0]]);
      assert.equal(counter.rows[0].request_count, 9, "Rejected attempts still persist rate accounting");
      const beforeReuse = await pool.query(
        "SELECT count(*) FROM instant_water_assessments WHERE normalized_phone=$1",
        [request.phone],
      );
      assert.equal(Number(beforeReuse.rows[0].count), 1);
      await pool.query("UPDATE instant_water_rate_limits SET request_count=0 WHERE key_hash=$1", [rateHashes[0]]);
      const next = await createInstantAssessment(request, { loadCatalogue: verifiedCatalogue });
      ids.push(next.response.assessmentId);
      assert.equal(next.replay, false);
      assert.notEqual(next.response.assessmentId, first.response.assessmentId);
      const deliveries = await pool.query(
        "SELECT assessment_id,idempotency_key,submission_id FROM instant_water_lead_outbox WHERE assessment_id=ANY($1::text[])",
        [[first.response.assessmentId, next.response.assessmentId]],
      );
      assert.equal(deliveries.rows.length, 2);
      assert.equal(new Set(deliveries.rows.map(row => row.idempotency_key)).size, 2);
      assert.equal(new Set(deliveries.rows.map(row => row.submission_id)).size, 2);
    }
  });
  it("retires only the expired create record for the exact scope and key", async () => {
    const request = input({ source: "municipal", concern: "taste", setting: "home" });
    const first = await createInstantAssessment(request, { loadCatalogue: verifiedCatalogue });
    ids.push(first.response.assessmentId);
    await expire(first.response.assessmentId);
    for (const [endpoint, scope, key] of [
      ["request-physical-water-check", request.scope, request.idempotencyKey],
      ["create-instant-water-assessment", `${request.scope}:other`, request.idempotencyKey],
      ["create-instant-water-assessment", request.scope, `${request.idempotencyKey}:other`],
    ]) {
      await pool.query(
        `INSERT INTO instant_water_idempotency (id,endpoint,scope,idempotency_key,request_hash,assessment_id,response,expires_at)
         VALUES ($1,$2,$3,$4,'unrelated',$5,'{}',now() - interval '1 second')`,
        [randomUUID(), endpoint, scope, key, first.response.assessmentId],
      );
    }
    const unrelated = await pool.query("SELECT * FROM instant_water_idempotency WHERE assessment_id=$1 AND request_hash='unrelated' ORDER BY id", [first.response.assessmentId]);
    const next = await createInstantAssessment(request, { loadCatalogue: verifiedCatalogue });
    ids.push(next.response.assessmentId);
    assert.deepEqual((await pool.query("SELECT * FROM instant_water_idempotency WHERE assessment_id=$1 AND request_hash='unrelated' ORDER BY id", [first.response.assessmentId])).rows, unrelated.rows);
  });
  it("restores the expired retry record if replacement creation fails", async () => {
    const request = input({ source: "municipal", concern: "taste", setting: "home" });
    const first = await createInstantAssessment(request, { loadCatalogue: verifiedCatalogue });
    ids.push(first.response.assessmentId);
    await expire(first.response.assessmentId);
    const before = await pool.query("SELECT * FROM instant_water_idempotency WHERE assessment_id=$1", [first.response.assessmentId]);
    // Force a database failure after expired-key retirement, without replacing
    // shared pool methods or affecting other suites' clients.
    await assert.rejects(
      createInstantAssessment({ ...request, consentVersion: null as unknown as string }, { loadCatalogue: verifiedCatalogue }),
      (error: { code?: string }) => error.code === "23502",
    );
    assert.deepEqual((await pool.query("SELECT * FROM instant_water_idempotency WHERE assessment_id=$1", [first.response.assessmentId])).rows, before.rows);
    const count = await pool.query("SELECT count(*) FROM instant_water_assessments WHERE customer_user_id=$1 AND id<>ALL($2::text[])", [String(userId), ids]);
    assert.equal(Number(count.rows[0].count), 0);
  });
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