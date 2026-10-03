import { before, after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { pool } from "@workspace/db";
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
    const replay = await createInstantAssessment(request);
    assert.equal(replay.replay, true);
    const original = await pool.query("SELECT result FROM instant_water_assessments WHERE id=$1", [first.response.assessmentId]);
    await pool.query("UPDATE instant_water_assessments SET raw_answers='{}'::jsonb,rules_version='instant-water-check-v1' WHERE id=$1", [first.response.assessmentId]);
    const legacy = (await listOwnedAssessments(String(userId))).find(r => r.assessmentId === first.response.assessmentId)!;
    assert.deepEqual(legacy.answers.sources, ["municipal"]);
    const saved = await pool.query("SELECT result FROM instant_water_assessments WHERE id=$1", [first.response.assessmentId]);
    assert.deepEqual(saved.rows[0].result, original.rows[0].result);
  });
});