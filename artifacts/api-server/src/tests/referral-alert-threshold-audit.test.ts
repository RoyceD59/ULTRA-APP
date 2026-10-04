import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import supertest from "supertest";
import { readFile } from "node:fs/promises";
import { pool } from "@workspace/db";
import app from "../app.js";
import { issueToken } from "../lib/jwt.js";
import {
  processReferralSettlementAlerts,
  recordReferralConversion,
  retryReferralSettlements,
} from "../routes/referrals.js";

const ADMIN_ID = "referral-threshold-audit-admin";
const MEMBER_ID = "referral-threshold-audit-member";
const FAILING_ADMIN_ID = "referral-threshold-audit-failing-admin";

function bearer(id: string, role: "admin" | "member"): string {
  return `Bearer ${issueToken({
    id,
    email: `${id}@test.invalid`,
    name: id,
    type: "team-session",
    role,
    exp: Math.floor(Date.now() / 1000) + 3600,
  })}`;
}

async function auditCount(actorId?: string): Promise<number> {
  const result = actorId
    ? await pool.query(
        "SELECT count(*)::int AS count FROM referral_alert_threshold_changes WHERE actor_team_user_id=$1",
        [actorId],
      )
    : await pool.query("SELECT count(*)::int AS count FROM referral_alert_threshold_changes");
  return Number(result.rows[0]?.count ?? 0);
}

before(async () => {
  await pool.query("DELETE FROM team_users WHERE id = ANY($1::text[])", [
    [ADMIN_ID, MEMBER_ID, FAILING_ADMIN_ID],
  ]);
  await pool.query(
    `INSERT INTO team_users(id,email,name,password_hash,role,is_active)
     VALUES
       ($1,$2,'Referral Audit Admin','unused','admin',true),
       ($3,$4,'Referral Audit Member','unused','member',true),
       ($5,$6,'Referral Audit Failing Admin','unused','admin',true)`,
    [
      ADMIN_ID,
      `${ADMIN_ID}@test.invalid`,
      MEMBER_ID,
      `${MEMBER_ID}@test.invalid`,
      FAILING_ADMIN_ID,
      `${FAILING_ADMIN_ID}@test.invalid`,
    ],
  );
});

after(async () => {
  await pool.query("DROP TRIGGER IF EXISTS referral_conversion_test_failure ON uc_referral_codes");
  await pool.query("DROP FUNCTION IF EXISTS fail_referral_conversion_test()");
  await pool.query("DROP TRIGGER IF EXISTS referral_threshold_audit_test_failure ON referral_alert_threshold_changes");
  await pool.query("DROP FUNCTION IF EXISTS fail_referral_threshold_audit_test()");
  // Immutable audit fixtures and their referenced actors live until run.ts
  // drops the isolated test database. Do not disable the production trigger.
  await pool.query(`DELETE FROM team_users WHERE id = ANY($1::text[])
    AND NOT EXISTS (
      SELECT 1 FROM referral_alert_threshold_changes WHERE actor_team_user_id=team_users.id
    )`, [
    [ADMIN_ID, MEMBER_ID, FAILING_ADMIN_ID],
  ]);
  await pool.query("DELETE FROM uc_referral_settlements WHERE order_id BETWEEN 617000000 AND 617000099");
  await pool.query("DELETE FROM uc_referral_users WHERE email LIKE 'task617-%@test.invalid'");
  await pool.query("DELETE FROM uc_referral_codes WHERE code LIKE 'T617-%'");
});

describe("referral alert threshold audit", () => {
  it("records and returns the actor, old value, new value, and time", async () => {
    await pool.query(
      `INSERT INTO team_settings(id,referral_failure_alert_threshold)
       VALUES('singleton',7)
       ON CONFLICT(id) DO UPDATE SET referral_failure_alert_threshold=7`,
    );

    const updated = await supertest(app)
      .patch("/api/uc/admin/referrals/settings")
      .set("Authorization", bearer(ADMIN_ID, "admin"))
      .send({ failureAlertThreshold: 11 });

    assert.equal(updated.status, 200);
    const row = await pool.query(
      `SELECT actor_team_user_id,actor_name,actor_email,previous_value,new_value,changed_at
       FROM referral_alert_threshold_changes WHERE actor_team_user_id=$1
       ORDER BY id DESC LIMIT 1`,
      [ADMIN_ID],
    );
    assert.equal(row.rows[0]?.actor_team_user_id, ADMIN_ID);
    assert.equal(row.rows[0]?.actor_name, "Referral Audit Admin");
    assert.equal(row.rows[0]?.actor_email, `${ADMIN_ID}@test.invalid`);
    assert.equal(Number(row.rows[0]?.previous_value), 7);
    assert.equal(Number(row.rows[0]?.new_value), 11);
    assert.ok(row.rows[0]?.changed_at);

    const read = await supertest(app)
      .get("/api/uc/admin/referrals")
      .set("Authorization", bearer(ADMIN_ID, "admin"));
    assert.equal(read.status, 200);
    assert.equal(read.body.latestThresholdChange.actor_team_user_id, ADMIN_ID);
    assert.equal(Number(read.body.latestThresholdChange.previous_value), 7);
    assert.equal(Number(read.body.latestThresholdChange.new_value), 11);
  });

  it("returns threshold history to admins in stable, paginated reverse chronology", async () => {
    await pool.query(
      `INSERT INTO referral_alert_threshold_changes(
         actor_team_user_id,actor_name,actor_email,previous_value,new_value,changed_at
       ) VALUES
         ($1,'Referral Audit Admin',$2,1,2,'2026-01-01T00:00:00Z'),
         ($1,'Referral Audit Admin',$2,2,3,'2026-01-02T00:00:00Z'),
         ($1,'Referral Audit Admin',$2,3,4,'2026-01-03T00:00:00Z')`,
      [ADMIN_ID, `${ADMIN_ID}@test.invalid`],
    );

    const firstPage = await supertest(app)
      .get("/api/uc/admin/referrals/threshold-history?page=1&pageSize=2")
      .set("Authorization", bearer(ADMIN_ID, "admin"));
    assert.equal(firstPage.status, 200);
    assert.deepEqual(firstPage.body.pagination, {
      page: 1,
      pageSize: 2,
      total: 4,
      totalPages: 2,
    });
    assert.deepEqual(
      firstPage.body.changes.map((change: { new_value: number }) => Number(change.new_value)),
      [11, 4],
    );

    const secondPage = await supertest(app)
      .get("/api/uc/admin/referrals/threshold-history?page=2&pageSize=2")
      .set("Authorization", bearer(ADMIN_ID, "admin"));
    assert.equal(secondPage.status, 200);
    assert.deepEqual(
      secondPage.body.changes.map((change: { new_value: number }) => Number(change.new_value)),
      [3, 2],
    );
  });

  it("rejects direct updates and deletes while preserving rows and allowing inserts", async () => {
    const inserted = await pool.query(
      `INSERT INTO referral_alert_threshold_changes(
         actor_team_user_id,actor_name,actor_email,previous_value,new_value
       ) VALUES($1,'Referral Audit Admin',$2,11,12) RETURNING *`,
      [ADMIN_ID, `${ADMIN_ID}@test.invalid`],
    );
    const original = inserted.rows[0];
    assert.ok(original);
    for (const statement of [
      "UPDATE referral_alert_threshold_changes SET new_value=99 WHERE id=$1",
      "UPDATE referral_alert_threshold_changes SET new_value=new_value WHERE id=$1",
      "DELETE FROM referral_alert_threshold_changes WHERE id=$1",
    ]) {
      await assert.rejects(pool.query(statement, [original.id]), (error: unknown) => {
        const pgError = error as { code?: string; message?: string };
        assert.equal(pgError.code, "55000");
        assert.match(pgError.message ?? "", /append-only/);
        return true;
      });
      const preserved = await pool.query(
        "SELECT * FROM referral_alert_threshold_changes WHERE id=$1", [original.id],
      );
      assert.deepEqual(preserved.rows, [original]);
    }

    // Reapplying the migration must preserve existing history and protection.
    await pool.query(await readFile(
      new URL("../../../../lib/db/migrations/0062_referral_threshold_audit_append_only.sql", import.meta.url),
      "utf8",
    ));
    await assert.rejects(
      pool.query("DELETE FROM referral_alert_threshold_changes WHERE id=$1", [original.id]),
      /append-only/,
    );
    const preserved = await pool.query(
      "SELECT * FROM referral_alert_threshold_changes WHERE id=$1", [original.id],
    );
    assert.deepEqual(preserved.rows, [original]);
    const next = await pool.query(
      `INSERT INTO referral_alert_threshold_changes(
         actor_team_user_id,actor_name,actor_email,previous_value,new_value
       ) VALUES($1,'Referral Audit Admin',$2,12,13) RETURNING id`,
      [ADMIN_ID, `${ADMIN_ID}@test.invalid`],
    );
    assert.equal(next.rowCount, 1);
  });

  it("protects threshold history and rejects invalid pagination", async () => {
    const unauthenticated = await supertest(app)
      .get("/api/uc/admin/referrals/threshold-history");
    const member = await supertest(app)
      .get("/api/uc/admin/referrals/threshold-history")
      .set("Authorization", bearer(MEMBER_ID, "member"));
    const invalid = await supertest(app)
      .get("/api/uc/admin/referrals/threshold-history?page=0&pageSize=101")
      .set("Authorization", bearer(ADMIN_ID, "admin"));

    assert.equal(unauthenticated.status, 401);
    assert.equal(member.status, 401);
    assert.equal(invalid.status, 400);
  });

  it("does not audit invalid, coerced, or unauthorized attempts", async () => {
    const beforeCount = await auditCount();
    const invalid = await supertest(app)
      .patch("/api/uc/admin/referrals/settings")
      .set("Authorization", bearer(ADMIN_ID, "admin"))
      .send({ failureAlertThreshold: 0 });
    const coercedValues = await Promise.all(
      [true, "12", null].map((failureAlertThreshold) =>
        supertest(app)
          .patch("/api/uc/admin/referrals/settings")
          .set("Authorization", bearer(ADMIN_ID, "admin"))
          .send({ failureAlertThreshold }),
      ),
    );
    const unauthorized = await supertest(app)
      .patch("/api/uc/admin/referrals/settings")
      .set("Authorization", bearer(MEMBER_ID, "admin"))
      .send({ failureAlertThreshold: 12 });

    assert.equal(invalid.status, 400);
    assert.deepEqual(coercedValues.map((response) => response.status), [400, 400, 400]);
    assert.equal(unauthorized.status, 401);
    assert.equal(await auditCount(), beforeCount);
  });

  it("records a correct predecessor chain for concurrent updates", async () => {
    await pool.query(
      `INSERT INTO team_settings(id,referral_failure_alert_threshold)
       VALUES('singleton',23)
       ON CONFLICT(id) DO UPDATE SET referral_failure_alert_threshold=23`,
    );
    const beforeId = await pool.query(
      "SELECT COALESCE(max(id),0)::bigint AS id FROM referral_alert_threshold_changes",
    );

    const responses = await Promise.all([
      supertest(app)
        .patch("/api/uc/admin/referrals/settings")
        .set("Authorization", bearer(ADMIN_ID, "admin"))
        .send({ failureAlertThreshold: 31 }),
      supertest(app)
        .patch("/api/uc/admin/referrals/settings")
        .set("Authorization", bearer(ADMIN_ID, "admin"))
        .send({ failureAlertThreshold: 32 }),
    ]);
    assert.deepEqual(responses.map((response) => response.status), [200, 200]);

    const changes = await pool.query(
      `SELECT previous_value,new_value
       FROM referral_alert_threshold_changes
       WHERE id > $1 ORDER BY id`,
      [beforeId.rows[0]?.id],
    );
    assert.equal(changes.rows.length, 2);
    assert.equal(Number(changes.rows[0]?.previous_value), 23);
    assert.equal(
      Number(changes.rows[1]?.previous_value),
      Number(changes.rows[0]?.new_value),
    );
  });

  it("uses the saved threshold to decide which settlement failures alert", async () => {
    await pool.query(
      `INSERT INTO team_settings(id,referral_failure_alert_threshold)
       VALUES('singleton',3)
       ON CONFLICT(id) DO UPDATE SET referral_failure_alert_threshold=3`,
    );
    await pool.query(
      `INSERT INTO uc_referral_settlements(
         order_id,referral_code,user_email,status,attempts,last_error,next_attempt_at
       ) VALUES(617000001,'TEST-CODE','invitee@test.invalid','pending',2,'forced failure',now())`,
    );
    const sentFor: string[] = [];
    const send = async (message: { subject: string }) => {
      sentFor.push(message.subject);
      return true;
    };

    assert.equal(await processReferralSettlementAlerts(send), 0);
    assert.equal(sentFor.length, 0);

    const update = await supertest(app)
      .patch("/api/uc/admin/referrals/settings")
      .set("Authorization", bearer(ADMIN_ID, "admin"))
      .send({ failureAlertThreshold: 2 });
    assert.equal(update.status, 200);

    assert.equal(await processReferralSettlementAlerts(send), 1);
    assert.deepEqual(sentFor, ["Referral reward stuck for order #617000001"]);
    await pool.query("DELETE FROM uc_referral_settlements WHERE order_id=617000001");
  });

  it("durably enqueues a failed order conversion and completes it on retry", async () => {
    await pool.query(
      `INSERT INTO uc_referral_codes(code,owner_email,owner_name)
       VALUES('T617-RETRY','task617-owner-retry@test.invalid','Retry Owner')`,
    );
    await pool.query(`
      CREATE OR REPLACE FUNCTION fail_referral_conversion_test()
      RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.code = 'T617-RETRY' THEN
          RAISE EXCEPTION 'forced referral conversion failure';
        END IF;
        RETURN NEW;
      END
      $$;
      CREATE TRIGGER referral_conversion_test_failure
        BEFORE UPDATE ON uc_referral_codes
        FOR EACH ROW EXECUTE FUNCTION fail_referral_conversion_test();
    `);

    await assert.rejects(
      recordReferralConversion(
        "T617-RETRY",
        "task617-retry-customer@test.invalid",
        200,
        617000010,
      ),
      /forced referral conversion failure/,
    );
    const queued = await pool.query(
      "SELECT status,attempts FROM uc_referral_settlements WHERE order_id=617000010",
    );
    assert.equal(queued.rows[0]?.status, "pending");
    assert.equal(Number(queued.rows[0]?.attempts), 1);

    await pool.query("DROP TRIGGER referral_conversion_test_failure ON uc_referral_codes");
    await pool.query("DROP FUNCTION fail_referral_conversion_test()");
    assert.equal(await retryReferralSettlements(), 1);
    assert.equal(await retryReferralSettlements(), 0);

    const completed = await pool.query(
      "SELECT status FROM uc_referral_settlements WHERE order_id=617000010",
    );
    const referral = await pool.query(
      "SELECT conversions,credits_earned_kes,referred_emails FROM uc_referral_codes WHERE code='T617-RETRY'",
    );
    assert.equal(completed.rows[0]?.status, "completed");
    assert.equal(Number(referral.rows[0]?.conversions), 1);
    assert.equal(Number(referral.rows[0]?.credits_earned_kes), 200);
    assert.deepEqual(referral.rows[0]?.referred_emails, ["task617-retry-customer@test.invalid"]);

    const adminRead = await supertest(app)
      .get("/api/uc/admin/referrals")
      .set("Authorization", bearer(ADMIN_ID, "admin"));
    assert.equal(adminRead.status, 200);
    assert.ok(adminRead.body.referrals.some((row: { code: string }) => row.code === "T617-RETRY"));
  });

  it("serializes concurrent settlement workers without losing or duplicating credits", async () => {
    await pool.query(
      `INSERT INTO uc_referral_codes(code,owner_email,owner_name)
       VALUES('T617-CONCURRENT','task617-owner-concurrent@test.invalid','Concurrent Owner')`,
    );
    await pool.query(
      `INSERT INTO uc_referral_settlements(
         order_id,referral_code,user_email,status,attempts,last_error,next_attempt_at
       ) VALUES
         (617000011,'T617-CONCURRENT','task617-first@test.invalid','pending',1,'retry',now()),
         (617000012,'T617-CONCURRENT','task617-second@test.invalid','pending',1,'retry',now())`,
    );

    await Promise.all([retryReferralSettlements(), retryReferralSettlements()]);
    const referral = await pool.query(
      "SELECT conversions,credits_earned_kes,referred_emails FROM uc_referral_codes WHERE code='T617-CONCURRENT'",
    );
    const completed = await pool.query(
      "SELECT count(*)::int AS count FROM uc_referral_settlements WHERE order_id IN (617000011,617000012) AND status='completed'",
    );
    assert.equal(Number(completed.rows[0]?.count), 2);
    assert.equal(Number(referral.rows[0]?.conversions), 2);
    assert.equal(Number(referral.rows[0]?.credits_earned_kes), 400);
    assert.deepEqual(
      [...referral.rows[0]?.referred_emails].sort(),
      ["task617-first@test.invalid", "task617-second@test.invalid"],
    );
  });

  it("prevents a stale retry worker from overwriting a reclaimed settlement", async () => {
    await pool.query(
      `INSERT INTO uc_referral_codes(code,owner_email,owner_name)
       VALUES('T617-FENCED','task617-owner-fenced@test.invalid','Fenced Owner')`,
    );
    await pool.query(
      `INSERT INTO uc_referral_settlements(
         order_id,referral_code,user_email,status,attempts,last_error,next_attempt_at
       ) VALUES(617000013,'T617-FENCED','task617-fenced@test.invalid','pending',1,'retry',now())`,
    );

    const staleResult = await retryReferralSettlements({
      afterClaim: async (rows) => {
        assert.equal(rows.length, 1);
        await pool.query(
          "UPDATE uc_referral_settlements SET claim_expires_at=now()-interval '1 second' WHERE id=$1",
          [rows[0]!.id],
        );
        assert.equal(await retryReferralSettlements(), 1);
      },
    });
    assert.equal(staleResult, 0);

    const settlement = await pool.query(
      "SELECT status,attempts,claim_token FROM uc_referral_settlements WHERE order_id=617000013",
    );
    const referral = await pool.query(
      "SELECT conversions,credits_earned_kes,referred_emails FROM uc_referral_codes WHERE code='T617-FENCED'",
    );
    assert.equal(settlement.rows[0]?.status, "completed");
    assert.equal(Number(settlement.rows[0]?.attempts), 1);
    assert.equal(settlement.rows[0]?.claim_token, null);
    assert.equal(Number(referral.rows[0]?.conversions), 1);
    assert.equal(Number(referral.rows[0]?.credits_earned_kes), 200);
    assert.deepEqual(referral.rows[0]?.referred_emails, ["task617-fenced@test.invalid"]);
  });

  it("rolls back the setting when the audit write fails", async () => {
    await pool.query(
      `INSERT INTO team_settings(id,referral_failure_alert_threshold)
       VALUES('singleton',13)
       ON CONFLICT(id) DO UPDATE SET referral_failure_alert_threshold=13`,
    );
    await pool.query(`
      CREATE OR REPLACE FUNCTION fail_referral_threshold_audit_test()
      RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.actor_team_user_id = '${FAILING_ADMIN_ID}' THEN
          RAISE EXCEPTION 'forced audit failure';
        END IF;
        RETURN NEW;
      END
      $$;
      DROP TRIGGER IF EXISTS referral_threshold_audit_test_failure ON referral_alert_threshold_changes;
      CREATE TRIGGER referral_threshold_audit_test_failure
        BEFORE INSERT ON referral_alert_threshold_changes
        FOR EACH ROW EXECUTE FUNCTION fail_referral_threshold_audit_test();
    `);

    const response = await supertest(app)
      .patch("/api/uc/admin/referrals/settings")
      .set("Authorization", bearer(FAILING_ADMIN_ID, "admin"))
      .send({ failureAlertThreshold: 21 });

    assert.equal(response.status, 500);
    const setting = await pool.query(
      "SELECT referral_failure_alert_threshold FROM team_settings WHERE id='singleton'",
    );
    assert.equal(Number(setting.rows[0]?.referral_failure_alert_threshold), 13);
    assert.equal(await auditCount(FAILING_ADMIN_ID), 0);
  });
});