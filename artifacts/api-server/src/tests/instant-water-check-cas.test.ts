import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { pool } from "@workspace/db";
import { updateAdminAssessment } from "../lib/instant-water-check-service.js";

describe("instant water ProjectHub CAS", () => {
  it("accepts one transition and rejects a stale second transition", async () => {
    const assessmentId = `cas-${randomUUID()}`;
    const ticketId = `cas-ticket-${randomUUID()}`;
    const initialUpdatedAt = new Date(Date.now() - 10_000);
    try {
      await pool.query(
        `INSERT INTO instant_water_assessments
           (id, reference, first_name, normalized_phone, consent_given, consent_version,
            country, area, source, concern, setting, raw_answers, rules_version, result,
            lifecycle_status, account_link_state, physical_request_state, created_at, updated_at)
         VALUES ($1, $2, 'CAS', '+254700000001', 'true', 'instant-water-check-v1',
            'Kenya', 'Nakuru', 'borehole', 'safety', 'home', '{}'::jsonb, 'instant-water-check-v1',
            $3::jsonb, 'instant_result_ready', 'unverified_lead', 'instant_result_ready', $4, $4)`,
        [assessmentId, `WT-CAS-${randomUUID()}`, JSON.stringify({ bands: {} }), initialUpdatedAt],
      );
      await pool.query(
        `INSERT INTO instant_water_check_tickets
           (id, assessment_id, country, area, service_state, created_at, updated_at)
         VALUES ($1, $2, 'Kenya', 'Nakuru', 'instant_result_ready', $3, $3)`,
        [ticketId, assessmentId, initialUpdatedAt],
      );

      const first = await updateAdminAssessment(assessmentId, {
        serviceState: "follow_up_requested",
        expectedUpdatedAt: initialUpdatedAt,
      });
      assert.ok(first);
      assert.ok(first.updatedAt instanceof Date);
      assert.ok((first.updatedAt as Date).getTime() > initialUpdatedAt.getTime());

      await assert.rejects(
        updateAdminAssessment(assessmentId, {
          serviceState: "physical_test_requested",
          expectedUpdatedAt: initialUpdatedAt,
        }),
        (error: Error) => error.message === "CONFLICT",
      );
    } finally {
      await pool.query(`DELETE FROM instant_water_assessments WHERE id = $1`, [assessmentId]);
    }
  });
});