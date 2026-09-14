import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { pool } from "@workspace/db";
import { requestVerification } from "../lib/instant-water-check-service.js";

describe("instant water OTP delivery durability", () => {
  it("retries the same challenge after failure, never duplicates sent replay, and recovers expired claims", async () => {
    process.env.WATER_CHECK_TOKEN_SECRET ??= "otp-test-secret";
    const assessmentId = `otp-${randomUUID()}`;
    const phone = "+254700000009";
    const key = `otp-key-${randomUUID()}`;
    let deliveries = 0;
    const codes: string[] = [];
    try {
      await pool.query(
        `INSERT INTO instant_water_assessments
          (id, reference, first_name, normalized_phone, consent_given, consent_version,
           country, area, source, concern, setting, raw_answers, rules_version, result)
         VALUES ($1, $2, 'OTP', $3, 'true', 'instant-water-check-v1',
           'Kenya', 'Nakuru', 'borehole', 'safety', 'home', '{}'::jsonb,
           'instant-water-check-v1', $4::jsonb)`,
        [assessmentId, `WT-OTP-${randomUUID()}`, phone, JSON.stringify({ bands: {} })],
      );

      const deliver = async (_channel: "whatsapp" | "sms", _phone: string, code: string) => {
        deliveries += 1;
        codes.push(code);
        if (deliveries === 1) throw new Error("provider unavailable");
      };
      await assert.rejects(
        requestVerification({
          assessmentId,
          channel: "sms",
          smsConsent: true,
          idempotencyKey: key,
          rateKey: `ip-${randomUUID()}`,
          deliver,
        }),
        (error: Error) => error.message === "DELIVERY_RETRYABLE",
      );
      const retry = await requestVerification({
        assessmentId,
        channel: "sms",
        smsConsent: true,
        idempotencyKey: key,
        rateKey: `ip-${randomUUID()}`,
        deliver,
      });
      assert.equal(retry.channel, "sms");
      assert.equal(deliveries, 2);
      assert.equal(codes[0], codes[1], "retry must send the same code");
      const challengeCount = await pool.query(
        `SELECT count(*)::int AS count, delivery_status, delivery_attempts
           FROM instant_water_verification_challenges
          WHERE assessment_id = $1
          GROUP BY delivery_status, delivery_attempts`,
        [assessmentId],
      );
      assert.equal(challengeCount.rows[0].count, 1);
      assert.equal(challengeCount.rows[0].delivery_status, "sent");

      await requestVerification({
        assessmentId,
        channel: "sms",
        smsConsent: true,
        idempotencyKey: key,
        rateKey: `ip-${randomUUID()}`,
        deliver,
      });
      assert.equal(deliveries, 2, "sent idempotency replay must not redeliver");

      await pool.query(
        `UPDATE instant_water_verification_challenges
            SET delivery_status = 'sending', delivery_claimed_at = now() - interval '10 minutes'
          WHERE assessment_id = $1`,
        [assessmentId],
      );
      await requestVerification({
        assessmentId,
        channel: "sms",
        smsConsent: true,
        idempotencyKey: key,
        rateKey: `ip-${randomUUID()}`,
        deliver,
      });
      assert.equal(deliveries, 3, "expired delivery lease should recover");
      assert.equal(codes[1], codes[2]);
    } finally {
      await pool.query(`DELETE FROM instant_water_assessments WHERE id = $1`, [assessmentId]);
    }
  });

  it("completes concurrent request transactions without pool starvation", async () => {
    process.env.WATER_CHECK_TOKEN_SECRET ??= "otp-test-secret";
    const assessments = Array.from({ length: 12 }, (_, index) => ({
      id: `otp-concurrent-${randomUUID()}`,
      phone: `+25470000${String(index).padStart(4, "0")}`,
    }));
    try {
      for (const assessment of assessments) {
        await pool.query(
          `INSERT INTO instant_water_assessments
            (id, reference, first_name, normalized_phone, consent_given, consent_version,
             country, area, source, concern, setting, raw_answers, rules_version, result)
           VALUES ($1, $2, 'OTP', $3, 'true', 'instant-water-check-v1',
             'Kenya', 'Nakuru', 'borehole', 'safety', 'home', '{}'::jsonb,
             'instant-water-check-v1', $4::jsonb)`,
          [assessment.id, `WT-OTP-${randomUUID()}`, assessment.phone, JSON.stringify({ bands: {} })],
        );
      }
      const results = await Promise.all(assessments.map((assessment) =>
        requestVerification({
          assessmentId: assessment.id,
          channel: "whatsapp",
          idempotencyKey: `concurrent-${assessment.id}`,
          rateKey: `ip-${assessment.id}`,
          deliver: async () => undefined,
        }),
      ));
      assert.equal(results.length, assessments.length);
    } finally {
      await pool.query(`DELETE FROM instant_water_assessments WHERE id = ANY($1::text[])`, [assessments.map(({ id }) => id)]);
    }
  });
});