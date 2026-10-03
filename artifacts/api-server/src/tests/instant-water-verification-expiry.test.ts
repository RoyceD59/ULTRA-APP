import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";
import { pool } from "@workspace/db";
import {
  hashInstantSecurityKey,
  instantOtpRateLimitKeys,
  requestVerification,
} from "../lib/instant-water-check-service.js";

type Channel = "whatsapp" | "sms";

async function fixture() {
  process.env.WATER_CHECK_TOKEN_SECRET ??= "otp-expiry-test-secret";
  const assessmentId = `otp-expiry-${randomUUID()}`;
  const phone = `+254${randomInt(100000000, 1000000000)}`;
  const key = randomUUID();
  const rateKey = randomUUID();
  const delivered: { channel: Channel; code: string }[] = [];
  await pool.query(
    `INSERT INTO instant_water_assessments
      (id, reference, first_name, normalized_phone, consent_given, consent_version,
       country, area, source, concern, setting, raw_answers, rules_version, result)
     VALUES ($1,$2,'OTP expiry',$3,'true','instant-water-check-v1',
       'Kenya','Nakuru','borehole','safety','home','{}','instant-water-check-v1','{}')`,
    [assessmentId, randomUUID(), phone],
  );
  const input = {
    assessmentId, idempotencyKey: key, rateKey,
    channel: "whatsapp" as Channel,
    deliver: async (channel: Channel, _phone: string, code: string) => {
      delivered.push({ channel, code });
    },
  };
  const rateKeys = instantOtpRateLimitKeys("request", rateKey, phone);
  const bucketHashes = [rateKeys.ip, rateKeys.phone, `otp-request-assessment:${assessmentId}`]
    .map(k => hashInstantSecurityKey(`rate:${k}`));
  return {
    assessmentId, key, input, delivered, bucketHashes,
    async challenges() {
      return (await pool.query(
        "SELECT * FROM instant_water_verification_challenges WHERE assessment_id=$1 ORDER BY created_at, id",
        [assessmentId],
      )).rows;
    },
    async retryRows() {
      return (await pool.query(
        "SELECT * FROM instant_water_idempotency WHERE assessment_id=$1 ORDER BY id",
        [assessmentId],
      )).rows;
    },
    async expire() {
      await pool.query(
        `UPDATE instant_water_idempotency SET expires_at=now()-interval '1 second'
         WHERE endpoint='request-instant-water-verification' AND scope=$1 AND idempotency_key=$2`,
        [assessmentId, key],
      );
    },
    async cleanup() {
      await pool.query("DELETE FROM instant_water_assessments WHERE id=$1", [assessmentId]);
      await pool.query("DELETE FROM instant_water_rate_limits WHERE key_hash=ANY($1::text[])", [bucketHashes]);
    },
  };
}

describe("instant verification 30-day retry-key expiry", () => {
  it("reuses an expired key for identical or changed requests while preserving historical challenges", async t => {
    for (const channel of ["whatsapp", "sms"] as const) {
      await t.test(channel, async () => {
        const f = await fixture();
        try {
          await requestVerification(f.input);
          const oldChallenges = await f.challenges();
          const oldRetry = (await f.retryRows())[0];
          await f.expire();
          const renewed = { ...f.input, channel, smsConsent: channel === "sms" };
          assert.deepEqual(await requestVerification(renewed), { channel });
          const challenges = await f.challenges();
          assert.equal(challenges.length, 2);
          assert.deepEqual(challenges.find(c => c.id === oldChallenges[0].id), oldChallenges[0]);
          const retries = await f.retryRows();
          assert.equal(retries.length, 1);
          assert.notEqual(retries[0].id, oldRetry.id);
          assert.notEqual(retries[0].response.challengeId, oldRetry.response.challengeId);
          assert.ok(retries[0].expires_at.getTime() > Date.now() + 29 * 86400000);
          assert.equal(f.delivered.length, 2);
          await requestVerification(renewed);
          assert.equal(f.delivered.length, 2, "active replay must not redeliver");
          await assert.rejects(requestVerification({
            ...renewed, channel: channel === "sms" ? "whatsapp" : "sms", smsConsent: true,
          }), /IDEMPOTENCY_CONFLICT/);
          const buckets = await pool.query(
            "SELECT request_count FROM instant_water_rate_limits WHERE key_hash=ANY($1::text[])",
            [f.bucketHashes],
          );
          assert.deepEqual(buckets.rows.map(b => b.request_count), [2, 2, 2], "replays/conflicts do not consume rate limits");
        } finally {
          await f.cleanup();
        }
      });
    }
  });

  it("retires only the exact expired endpoint/scope/key row", async () => {
    const f = await fixture();
    try {
      await requestVerification(f.input);
      await f.expire();
      const ids = [randomUUID(), randomUUID(), randomUUID()];
      await pool.query(
        `INSERT INTO instant_water_idempotency
          (id,endpoint,scope,idempotency_key,request_hash,assessment_id,response,expires_at)
         VALUES ($1,'create-instant-water-assessment',$4,$5,'other',$4,'{}',now()-interval '1 day'),
                ($2,'request-instant-water-verification','other-scope',$5,'other',$4,'{}',now()-interval '1 day'),
                ($3,'request-instant-water-verification',$4,'other-key','other',$4,'{}',now()-interval '1 day')`,
        [...ids, f.assessmentId, f.key],
      );
      const unrelated = (await f.retryRows()).filter(r => ids.includes(r.id));
      await requestVerification(f.input);
      assert.deepEqual((await f.retryRows()).filter(r => ids.includes(r.id)), unrelated);
      assert.equal((await f.retryRows()).length, 4);
    } finally {
      await f.cleanup();
    }
  });

  it("preserves expired retry records and challenges when SMS consent is missing", async () => {
    const f = await fixture();
    try {
      await requestVerification(f.input);
      await f.expire();
      const retries = await f.retryRows();
      const challenges = await f.challenges();
      await assert.rejects(requestVerification({ ...f.input, channel: "sms" }), /SMS_CONSENT_REQUIRED/);
      assert.deepEqual(await f.retryRows(), retries);
      assert.deepEqual(await f.challenges(), challenges);
      assert.equal(f.delivered.length, 1);
    } finally {
      await f.cleanup();
    }
  });

  it("retains expired keys on each rate-limit rejection and permits later reuse", async t => {
    for (const bucket of [0, 1, 2]) {
      await t.test(`bucket ${bucket}`, async () => {
        const f = await fixture();
        try {
          await requestVerification(f.input);
          await f.expire();
          const retries = await f.retryRows();
          const challenges = await f.challenges();
          await pool.query("UPDATE instant_water_rate_limits SET request_count=5 WHERE key_hash=$1", [f.bucketHashes[bucket]]);
          await assert.rejects(requestVerification(f.input), /RATE_LIMITED/);
          assert.deepEqual(await f.retryRows(), retries);
          assert.deepEqual(await f.challenges(), challenges);
          assert.equal(f.delivered.length, 1);
          assert.equal((await pool.query(
            "SELECT request_count FROM instant_water_rate_limits WHERE key_hash=$1", [f.bucketHashes[bucket]],
          )).rows[0].request_count, 6, "rejected attempt counter remains committed");
          await pool.query(
            "UPDATE instant_water_rate_limits SET bucket_start=now()-interval '2 hours' WHERE key_hash=ANY($1::text[])",
            [f.bucketHashes],
          );
          await requestVerification(f.input);
          assert.equal(f.delivered.length, 2);
          assert.equal((await f.challenges()).length, 2);
        } finally {
          await f.cleanup();
        }
      });
    }
  });

  it("rolls back retirement and new challenges when replacement insertion fails", async () => {
    const f = await fixture();
    try {
      await requestVerification(f.input);
      await f.expire();
      const retries = await f.retryRows();
      const challenges = await f.challenges();
      // NOT VALID leaves the historical row intact but rejects its replacement.
      // Scope this failure injection to our fixture in the wrapper's test DB.
      await pool.query(
        `ALTER TABLE instant_water_idempotency ADD CONSTRAINT otp_expiry_test_key
         CHECK (scope <> '${f.assessmentId}' OR idempotency_key <> '${f.key}') NOT VALID`,
      );
      await assert.rejects(requestVerification(f.input), /otp_expiry_test_key/);
      assert.deepEqual(await f.challenges(), challenges);
      const restored = await f.retryRows();
      assert.deepEqual(restored, retries);
      assert.equal(f.delivered.length, 1);
    } finally {
      await pool.query("ALTER TABLE instant_water_idempotency DROP CONSTRAINT IF EXISTS otp_expiry_test_key");
      await f.cleanup();
    }
  });

  it("creates and dispatches one replacement under identical and conflicting concurrent requests", async t => {
    for (const conflicting of [false, true]) {
      await t.test(conflicting ? "conflicting" : "identical", async () => {
        const f = await fixture();
        try {
          await requestVerification(f.input);
          await f.expire();
          const oldChallenges = await f.challenges();
          const results = await Promise.allSettled(Array.from({ length: 4 }, (_, i) =>
            requestVerification({
              ...f.input,
              channel: conflicting && i % 2 ? "sms" : "whatsapp",
              smsConsent: conflicting && i % 2 ? true : undefined,
              deliver: async (channel, phone, code) => {
                await f.input.deliver(channel, phone, code);
                await new Promise(resolve => setTimeout(resolve, 50));
              },
            }),
          ));
          assert.ok(results.some(r => r.status === "fulfilled"));
          for (const result of results) {
            if (result.status === "rejected") {
              assert.match(result.reason.message, conflicting
                ? /^(IDEMPOTENCY_CONFLICT|DELIVERY_IN_PROGRESS)$/
                : /^DELIVERY_IN_PROGRESS$/);
            }
          }
          const challenges = await f.challenges();
          assert.equal(challenges.length, 2);
          assert.deepEqual(challenges.find(c => c.id === oldChallenges[0].id), oldChallenges[0]);
          assert.equal(f.delivered.length, 2);
          const retries = await f.retryRows();
          assert.equal(retries.length, 1);
          const winner = { ...f.input, channel: retries[0].response.channel as Channel };
          await requestVerification({ ...winner, smsConsent: winner.channel === "sms" });
          assert.equal(f.delivered.length, 2);
        } finally {
          await f.cleanup();
        }
      });
    }
  });
});