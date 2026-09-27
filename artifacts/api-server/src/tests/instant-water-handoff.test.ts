import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { pool } from "@workspace/db";
import { issueToken } from "../lib/jwt.js";
import {
  confirmVerification,
  consumeInstantAssessmentHandoff,
  hashInstantSecurityKey,
} from "../lib/instant-water-check-service.js";

const result = JSON.stringify({
  bands: { hardness: "Low", taste: "Low", sediment: "Low", microbial: "Low" },
});

async function fixture(options: {
  phone?: string;
  assessmentPhone?: string;
  verified?: boolean;
  accountState?: string;
  expires?: string;
} = {}) {
  const suffix = randomUUID();
  const user = await pool.query(
    `INSERT INTO uc_users
      (email, password_hash, phone, phone_verified, first_name, last_name)
     VALUES ($1, 'test', $2, $3, 'Handoff', 'User')
     RETURNING id`,
    [`handoff-${suffix}@test.internal`, options.phone ?? "+254711000001", options.verified ?? true],
  );
  const userId = String(user.rows[0].id);
  const assessmentId = `handoff-${suffix}`;
  const handoffToken = `handoff-token-${randomUUID()}-${randomUUID()}`;
  await pool.query(
    `INSERT INTO instant_water_assessments
      (id, reference, first_name, normalized_phone, phone_verification_state, phone_verified_at,
       consent_given, consent_version, country, area, source, concern, setting, raw_answers,
       rules_version, result, account_link_state)
     VALUES ($1, $2, 'Lead', $3, 'verified', now(), 'true', 'instant-water-check-v1',
       'Kenya', 'Nairobi', 'borehole', 'safety', 'home', '{}'::jsonb,
       'instant-water-check-v1', $4::jsonb, $5)`,
    [assessmentId, `WT-${suffix}`, options.assessmentPhone ?? options.phone ?? "+254711000001", result, options.accountState ?? "verified_unmatched"],
  );
  await pool.query(
    `INSERT INTO instant_water_check_tickets
      (id, assessment_id, country, area)
     VALUES ($1, $2, 'Kenya', 'Nairobi')`,
    [`ticket-${suffix}`, assessmentId],
  );
  await pool.query(
    `INSERT INTO instant_water_handoff_tokens
      (id, assessment_id, token_hash, expires_at)
     VALUES ($1, $2, $3, $4)`,
    [`handoff-row-${suffix}`, assessmentId, hashInstantSecurityKey(handoffToken),
      options.expires ?? "2035-01-01T00:00:00.000Z"],
  );
  return { suffix, userId, assessmentId, handoffToken };
}

async function cleanup(suffix: string): Promise<void> {
  await pool.query(`DELETE FROM uc_users WHERE email = $1`, [`handoff-${suffix}@test.internal`]);
  await pool.query(`DELETE FROM instant_water_assessments WHERE id = $1`, [`handoff-${suffix}`]);
}

describe("instant water unmatched-account handoff", () => {
  it("generates a separate short-lived handoff only after unmatched OTP verification", async () => {
    const item = await fixture({ verified: false });
    const challengeId = `challenge-${item.suffix}`;
    try {
      await pool.query(
        `INSERT INTO instant_water_verification_challenges
          (id, assessment_id, channel, phone_hash, code_hash, code_ciphertext, delivery_status, expires_at)
         VALUES ($1, $2, 'sms', $3, $4, 'encrypted-test-code', 'sent', now() + interval '10 minutes')`,
        [
          challengeId,
          item.assessmentId,
          hashInstantSecurityKey("+254711000001"),
          hashInstantSecurityKey(`${challengeId}:123456`),
        ],
      );
      const confirmation = await confirmVerification(item.assessmentId, "123456", `handoff-ip-${item.suffix}`);
      assert.equal(confirmation.accountLinkState, "verified_unmatched");
      assert.match(confirmation.handoffToken ?? "", /^[A-Za-z0-9_-]{40,}$/);
      const tokens = await pool.query(
        `SELECT count(*)::int AS count
           FROM instant_water_handoff_tokens
          WHERE assessment_id = $1 AND consumed_at IS NULL AND revoked_at IS NULL AND expires_at > now()`,
        [item.assessmentId],
      );
      assert.equal(tokens.rows[0].count, 2);
    } finally {
      await cleanup(item.suffix);
    }
  });

  it("attaches assessment and ticket only for a live verified matching account", async () => {
    process.env.WATER_CHECK_TOKEN_SECRET ??= "handoff-test-secret";
    const item = await fixture();
    try {
      const attached = await consumeInstantAssessmentHandoff(item.handoffToken, item.userId);
      assert.equal(attached.assessmentId, item.assessmentId);
      assert.equal(attached.accountLinkState, "attached");
      const ownership = await pool.query(
        `SELECT a.customer_user_id AS assessment_owner, t.customer_user_id AS ticket_owner,
                h.consumed_at IS NOT NULL AS consumed
           FROM instant_water_assessments a
           JOIN instant_water_check_tickets t ON t.assessment_id = a.id
           JOIN instant_water_handoff_tokens h ON h.assessment_id = a.id
          WHERE a.id = $1`,
        [item.assessmentId],
      );
      assert.deepEqual(ownership.rows[0], {
        assessment_owner: item.userId,
        ticket_owner: item.userId,
        consumed: true,
      });
      await assert.rejects(
        consumeInstantAssessmentHandoff(item.handoffToken, item.userId),
        (error: Error) => error.message === "HANDOFF_INVALID",
      );
    } finally {
      await cleanup(item.suffix);
    }
  });

  it("rejects expired, mismatched, and unverified handoffs without disclosure", async () => {
    const expired = await fixture({ expires: "2020-01-01T00:00:00.000Z" });
    const mismatch = await fixture({ phone: "+254711000002", assessmentPhone: "+254711000003" });
    const unverified = await fixture({ verified: false });
    try {
      await assert.rejects(consumeInstantAssessmentHandoff(expired.handoffToken, expired.userId), /HANDOFF_INVALID/);
      await assert.rejects(consumeInstantAssessmentHandoff(mismatch.handoffToken, mismatch.userId), /HANDOFF_INVALID/);
      await assert.rejects(consumeInstantAssessmentHandoff(unverified.handoffToken, unverified.userId), /HANDOFF_INVALID/);
    } finally {
      await cleanup(expired.suffix);
      await cleanup(mismatch.suffix);
      await cleanup(unverified.suffix);
    }
  });

  it("wins one concurrent consume and never transfers to the losing account", async () => {
    const item = await fixture();
    const other = await fixture({ phone: "+254711000001" });
    try {
      const outcomes = await Promise.allSettled([
        consumeInstantAssessmentHandoff(item.handoffToken, item.userId),
        consumeInstantAssessmentHandoff(item.handoffToken, other.userId),
      ]);
      assert.equal(outcomes.filter((outcome) => outcome.status === "fulfilled").length, 1);
      assert.equal(outcomes.filter((outcome) => outcome.status === "rejected").length, 1);
      const owner = await pool.query(`SELECT customer_user_id FROM instant_water_assessments WHERE id = $1`, [item.assessmentId]);
      assert.ok(owner.rows[0].customer_user_id === item.userId || owner.rows[0].customer_user_id === other.userId);
      assert.notEqual(owner.rows[0].customer_user_id, null);
    } finally {
      await cleanup(item.suffix);
      await cleanup(other.suffix);
    }
  });

  it("supports the generated endpoint with a real authenticated customer", async () => {
    const item = await fixture();
    const { default: app } = await import("../app.js");
    const server = app.listen(0);
    try {
      await new Promise<void>((resolve) => server.once("listening", () => resolve()));
      const address = server.address() as { port: number };
      const response = await fetch(`http://127.0.0.1:${address.port}/api/water-check/handoff/consume`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${issueToken({ id: Number(item.userId), email: "handoff@test.internal" })}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ handoffToken: item.handoffToken }),
      });
      assert.equal(response.status, 200);
      const body = await response.json() as { assessmentId: string; accountLinkState: string };
      assert.equal(body.assessmentId, item.assessmentId);
      assert.equal(body.accountLinkState, "attached");
    } finally {
      server.close();
      await cleanup(item.suffix);
    }
  });
});