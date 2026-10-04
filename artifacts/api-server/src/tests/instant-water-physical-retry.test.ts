import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { pool } from "@workspace/db";
import { hashInstantSecurityKey, requestPhysicalTest } from "../lib/instant-water-check-service.js";
import { setPhysicalTestNotificationSenderForTests } from "../lib/physical-test-notifications.js";

// Run through pnpm test so all fixtures and failure injection stay in the
// per-run database. Each fixture owns its identities, records, and cleanup.
describe("physical water-test retry keys", () => {
  const ids: string[] = [];
  const notifications: string[] = [];
  before(() => {
    // Do not contact real customer/team delivery providers from this suite.
    setPhysicalTestNotificationSenderForTests(async input => { notifications.push(input.ticketId); });
  });
  after(async () => {
    setPhysicalTestNotificationSenderForTests();
    await pool.query("DELETE FROM instant_water_idempotency WHERE assessment_id = ANY($1::text[])", [ids]);
    await pool.query("DELETE FROM instant_water_assessments WHERE id = ANY($1::text[])", [ids]);
  });

  async function fixture(country = "Kenya", guest = false) {
    const assessmentId = randomUUID();
    const ticketId = randomUUID();
    const userId = `physical-retry-${randomUUID()}`;
    ids.push(assessmentId);
    await pool.query(
      `INSERT INTO instant_water_assessments
        (id, reference, customer_user_id, first_name, normalized_phone,
         consent_given, consent_version, country, area, source, concern,
         setting, raw_answers, rules_version, result, lifecycle_status, physical_request_state)
       VALUES ($1,$2,$3,'Retry','+254712345678','true','v1',$4,'Nakuru',
         'borehole','safety','home','{}','v1','{}','instant_result_ready','instant_result_ready')`,
      [assessmentId, `WT-${randomUUID()}`, guest ? null : userId, country],
    );
    await pool.query(
      `INSERT INTO instant_water_check_tickets (id, assessment_id, country, area, service_state)
       VALUES ($1,$2,$3,'Nakuru','instant_result_ready')`,
      [ticketId, assessmentId, country],
    );
    const actionToken = randomUUID();
    if (guest) {
      await pool.query(
        `INSERT INTO instant_water_action_tokens (id, assessment_id, token_hash, expires_at)
         VALUES ($1,$2,$3,now() + interval '30 minutes')`,
        [randomUUID(), assessmentId, hashInstantSecurityKey(actionToken)],
      );
    }
    return {
      assessmentId, ticketId, userId, actionToken,
      request: {
        assessmentId,
        ...(guest ? { actionToken } : { userId }),
        serviceAddress: "Original address",
        preferredContactTime: "Morning",
        acknowledgement: true,
        idempotencyKey: randomUUID(),
      },
    };
  }

  async function expire(assessmentId: string) {
    await pool.query(
      `UPDATE instant_water_idempotency SET expires_at=now() - interval '1 second'
       WHERE endpoint='request-instant-water-physical-test' AND assessment_id=$1`,
      [assessmentId],
    );
  }

  async function snapshot(assessmentId: string) {
    const assessment = await pool.query("SELECT * FROM instant_water_assessments WHERE id=$1", [assessmentId]);
    const tickets = await pool.query("SELECT * FROM instant_water_check_tickets WHERE assessment_id=$1", [assessmentId]);
    const keys = await pool.query("SELECT * FROM instant_water_idempotency WHERE assessment_id=$1 ORDER BY id", [assessmentId]);
    const uploads = await pool.query("SELECT * FROM instant_water_media_uploads WHERE assessment_id=$1 ORDER BY object_path", [assessmentId]);
    const ticketIds = new Set(tickets.rows.map(ticket => ticket.id));
    return {
      assessment: assessment.rows, tickets: tickets.rows, keys: keys.rows, uploads: uploads.rows,
      notifications: notifications.filter(ticketId => ticketIds.has(ticketId)),
    };
  }

  async function retainStaffDetails(ticketId: string, state: string) {
    await pool.query(
      `UPDATE instant_water_check_tickets SET service_state=$2,
        service_address='Staff corrected address', preferred_contact_time='Afternoon',
        media_references='[{"reference":"retained-evidence","mediaType":"jpg"}]',
        internal_notes='Keep this history', promo_code='STAFF-CODE', free_water_test=true
       WHERE id=$1`,
      [ticketId, state],
    );
  }

  it("accepts a first submission only from an unacknowledged result-ready ticket", async () => {
    for (const country of ["Kenya", "Tanzania"]) {
      const f = await fixture(country);
      const first = await requestPhysicalTest(f.request);
      const state = country === "Kenya" ? "physical_test_requested" : "follow_up_requested";
      assert.equal(first.serviceState, state);
      const saved = await snapshot(f.assessmentId);
      assert.equal(saved.tickets.length, 1);
      assert.equal(saved.keys.length, 1);
      assert.equal(saved.tickets[0].service_address, f.request.serviceAddress);
      assert.equal(saved.tickets[0].preferred_contact_time, f.request.preferredContactTime);
      assert.ok(saved.tickets[0].physical_request_acknowledged_at instanceof Date);
      assert.equal(saved.assessment[0].physical_request_state, state);
      assert.equal(saved.notifications.length, country === "Kenya" ? 1 : 0);
    }
  });

  it("rejects new keys on acknowledged tickets and preserves staff details, evidence and benefits", async t => {
    for (const country of ["Kenya", "Tanzania"]) {
      for (const guest of [false, true]) {
        for (const state of ["instant_result_ready", "physical_test_requested", "follow_up_requested", "scheduled", "completed", "closed"]) {
          await t.test(`${country}: ${state}, ${guest ? "guest" : "owner"}`, async () => {
            const f = await fixture(country, guest);
            await requestPhysicalTest(f.request);
            await retainStaffDetails(f.ticketId, state);
            const uploadPath = `/objects/water-tests/${f.assessmentId}/${randomUUID()}`;
            await pool.query(
              `INSERT INTO instant_water_media_uploads
                (object_path, uploader_user_id, assessment_id, declared_type, declared_size, expires_at)
               VALUES ($1,$2,$3,'image/jpeg',128,now() + interval '1 hour')`,
              [uploadPath, guest ? null : f.userId, f.assessmentId],
            );
            const before = await snapshot(f.assessmentId);
            // Even an identical payload under a different key is a new action,
            // not replay. Changed details must fail before media/promo checks.
            for (const change of [
              {},
              { serviceAddress: "Customer changed address", preferredContactTime: "Evening" },
              { mediaReferences: [{ reference: uploadPath, mediaType: "jpg" }] },
              { promoCode: "NEW-CODE" },
            ]) {
              await assert.rejects(
                requestPhysicalTest({ ...f.request, ...change, idempotencyKey: randomUUID() }),
                (error: Error) => error.message === "CONFLICT",
              );
            }
            assert.deepEqual(await snapshot(f.assessmentId), before);
          });
        }
      }
    }
  });

  it("preserves submitted and staff-managed states even without an acknowledgement timestamp", async () => {
    for (const state of ["physical_test_requested", "follow_up_requested", "scheduled", "completed", "closed"]) {
      const f = await fixture();
      await retainStaffDetails(f.ticketId, state);
      const before = await snapshot(f.assessmentId);
      assert.equal(before.tickets[0].physical_request_acknowledged_at, null);
      await assert.rejects(
        requestPhysicalTest({ ...f.request, idempotencyKey: randomUUID() }),
        (error: Error) => error.message === "CONFLICT",
      );
      assert.deepEqual(await snapshot(f.assessmentId), before);
    }
  });

  it("rejects simultaneous different keys against an acknowledged request without any writes", async () => {
    for (const country of ["Kenya", "Tanzania"]) {
      const f = await fixture(country);
      const first = await requestPhysicalTest(f.request);
      await retainStaffDetails(f.ticketId, first.serviceState);
      const before = await snapshot(f.assessmentId);
      const results = await Promise.allSettled(Array.from({ length: 6 }, (_, index) =>
        requestPhysicalTest({ ...f.request, serviceAddress: `New address ${index}`, idempotencyKey: randomUUID() }),
      ));
      for (const result of results) {
        assert.equal(result.status, "rejected");
        if (result.status === "rejected") assert.equal(result.reason.message, "CONFLICT");
      }
      assert.deepEqual(await snapshot(f.assessmentId), before);
    }
  });

  it("checks the locked ticket after a simultaneous staff change commits", async () => {
    for (const acknowledgementOnly of [false, true]) {
      const f = await fixture();
      const staff = await pool.connect();
      let pending: Promise<PromiseSettledResult<Awaited<ReturnType<typeof requestPhysicalTest>>>[]> | undefined;
      try {
        await staff.query("BEGIN");
        const pid = (await staff.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
        await staff.query(
          `UPDATE instant_water_check_tickets
              SET service_state=$2, physical_request_acknowledged_at=$3,
                  service_address='Staff locked address', internal_notes='Staff work in progress'
            WHERE id=$1`,
          [f.ticketId, acknowledgementOnly ? "instant_result_ready" : "scheduled",
            acknowledgementOnly ? new Date() : null],
        );
        // Await the actual row-lock wait, not a timing-dependent sleep, so the
        // request necessarily observes the post-commit ticket state.
        pending = Promise.allSettled([requestPhysicalTest(f.request)]);
        let blocked = false;
        const deadline = Date.now() + 5000;
        while (!blocked && Date.now() < deadline) {
          const waiting = await pool.query(
            `SELECT 1 FROM pg_stat_activity WHERE $1::integer = ANY(pg_blocking_pids(pid))`,
            [pid],
          );
          blocked = !!waiting.rowCount;
          if (!blocked) await delay(10);
        }
        assert.ok(blocked, "customer request should wait for the staff-held ticket lock");
        await staff.query("COMMIT");
        const [result] = await pending;
        assert.equal(result.status, "rejected");
        if (result.status === "rejected") assert.equal(result.reason.message, "CONFLICT");
        const saved = await snapshot(f.assessmentId);
        assert.equal(saved.tickets[0].service_address, "Staff locked address");
        assert.equal(saved.tickets[0].internal_notes, "Staff work in progress");
        assert.equal(saved.assessment[0].physical_request_state, "instant_result_ready");
        assert.equal(saved.keys.length, 0);
        assert.equal(saved.notifications.length, 0);
      } finally {
        await staff.query("ROLLBACK");
        staff.release();
        await pending;
      }
    }
  });

  it("accepts just one simultaneous first submission with different keys and preserves the winning payload", async () => {
    for (const country of ["Kenya", "Tanzania"]) {
      const f = await fixture(country);
      const requests = Array.from({ length: 6 }, (_, index) => ({
        ...f.request, serviceAddress: `Address ${index}`,
        preferredContactTime: `Time ${index}`, idempotencyKey: randomUUID(),
      }));
      const results = await Promise.allSettled(requests.map(request => requestPhysicalTest(request)));
      const winners = results.flatMap((result, index) => result.status === "fulfilled" ? [index] : []);
      assert.equal(winners.length, 1);
      for (const result of results) {
        if (result.status === "rejected") assert.equal(result.reason.message, "CONFLICT");
      }
      const winner = requests[winners[0]];
      const saved = await snapshot(f.assessmentId);
      assert.equal(saved.tickets.length, 1);
      assert.equal(saved.keys.length, 1);
      assert.equal(saved.keys[0].idempotency_key, winner.idempotencyKey);
      assert.equal(saved.notifications.length, country === "Kenya" ? 1 : 0);
      assert.equal(saved.tickets[0].service_address, winner.serviceAddress);
      assert.equal(saved.tickets[0].preferred_contact_time, winner.preferredContactTime);
      assert.ok(saved.tickets[0].physical_request_acknowledged_at instanceof Date);
      assert.deepEqual(await requestPhysicalTest(winner), saved.keys[0].response);
      assert.deepEqual(await snapshot(f.assessmentId), saved);
    }
  });

  it("replays active requests unchanged and rejects changed payloads", async () => {
    const f = await fixture();
    const first = await requestPhysicalTest(f.request);
    await pool.query("UPDATE instant_water_check_tickets SET service_state='scheduled' WHERE id=$1", [f.ticketId]);
    const before = await snapshot(f.assessmentId);
    assert.deepEqual(await requestPhysicalTest(f.request), first);
    await assert.rejects(requestPhysicalTest({ ...f.request, serviceAddress: "Changed" }), /IDEMPOTENCY_CONFLICT/);
    assert.deepEqual(await snapshot(f.assessmentId), before);
  });

  it("renews expired retries with current state without changing prior service details or creating tickets", async t => {
    for (const country of ["Kenya", "Tanzania"]) {
      for (const state of ["physical_test_requested", "follow_up_requested", "scheduled", "completed", "closed"]) {
        await t.test(`${country}: ${state}`, async () => {
          const f = await fixture(country);
          const first = await requestPhysicalTest(f.request);
          await pool.query(
            `UPDATE instant_water_check_tickets SET service_state=$2,
              service_address='Staff corrected address', preferred_contact_time='Afternoon',
              media_references='[{"reference":"retained-evidence","mediaType":"jpg"}]',
              internal_notes='Keep this history' WHERE id=$1`,
            [f.ticketId, state],
          );
          await pool.query(
            "UPDATE instant_water_assessments SET lifecycle_status=$2,physical_request_state=$2 WHERE id=$1",
            [f.assessmentId, state],
          );
          await expire(f.assessmentId);
          const before = await snapshot(f.assessmentId);
          const renewed = await requestPhysicalTest(f.request);
          assert.deepEqual(renewed, { ...first, serviceState: state });
          const after = await snapshot(f.assessmentId);
          assert.deepEqual(after.tickets, before.tickets);
          assert.deepEqual(after.assessment, before.assessment);
          assert.equal(after.tickets.length, 1);
          assert.equal(after.keys.length, 1);
          assert.equal(after.keys[0].id, before.keys[0].id);
          assert.deepEqual(after.keys[0].response, renewed);
          assert.ok(after.keys[0].expires_at > before.keys[0].expires_at);
        });
      }
    }
  });

  it("rejects changed expired requests without erasing keys, details, or history", async () => {
    const f = await fixture();
    await requestPhysicalTest(f.request);
    await expire(f.assessmentId);
    const before = await snapshot(f.assessmentId);
    for (const change of [
      { serviceAddress: "Changed address" },
      { preferredContactTime: "Evening" },
      { mediaReferences: [{ reference: "/objects/uploads/changed", mediaType: "jpg" }] },
    ]) {
      await assert.rejects(requestPhysicalTest({ ...f.request, ...change }), /IDEMPOTENCY_CONFLICT/);
    }
    assert.deepEqual(await snapshot(f.assessmentId), before);
  });

  it("serializes concurrent expired retries and conflicts without duplicate tickets or unique-key errors", async () => {
    const f = await fixture();
    const first = await requestPhysicalTest(f.request);
    await expire(f.assessmentId);
    const before = await snapshot(f.assessmentId);
    const results = await Promise.allSettled([
      ...Array.from({ length: 6 }, () => requestPhysicalTest(f.request)),
      ...Array.from({ length: 3 }, () => requestPhysicalTest({ ...f.request, serviceAddress: "Changed" })),
    ]);
    for (const result of results.slice(0, 6)) {
      assert.equal(result.status, "fulfilled");
      if (result.status === "fulfilled") assert.deepEqual(result.value, first);
    }
    for (const result of results.slice(6)) {
      assert.equal(result.status, "rejected");
      if (result.status === "rejected") assert.equal(result.reason.message, "IDEMPOTENCY_CONFLICT");
    }
    const after = await snapshot(f.assessmentId);
    assert.deepEqual(after.tickets, before.tickets);
    assert.deepEqual(after.assessment, before.assessment);
    assert.equal(after.keys.length, 1);
  });

  it("requires current owner or valid action-token authorization before active or expired replay", async () => {
    for (const guest of [false, true]) {
      const f = await fixture("Kenya", guest);
      await requestPhysicalTest(f.request);
      for (const expired of [false, true]) {
        if (expired) await expire(f.assessmentId);
        const before = await snapshot(f.assessmentId);
        await assert.rejects(
          requestPhysicalTest({ ...f.request, actionToken: undefined, userId: "different-owner" }),
          /NOT_FOUND/,
        );
        await assert.rejects(
          requestPhysicalTest({ ...f.request, actionToken: undefined, userId: undefined }),
          /ACTION_UNAUTHORIZED/,
        );
        await assert.rejects(
          requestPhysicalTest({ ...f.request, actionToken: "invalid" }),
          /ACTION_UNAUTHORIZED/,
        );
        assert.deepEqual(await snapshot(f.assessmentId), before);
      }
      if (guest) {
        await pool.query("UPDATE instant_water_action_tokens SET expires_at=now() - interval '1 second' WHERE assessment_id=$1", [f.assessmentId]);
        await assert.rejects(requestPhysicalTest(f.request), /ACTION_UNAUTHORIZED/);
        await pool.query("UPDATE instant_water_action_tokens SET expires_at=now() + interval '30 minutes',used_at=now() WHERE assessment_id=$1", [f.assessmentId]);
        await assert.rejects(requestPhysicalTest(f.request), /ACTION_UNAUTHORIZED/);
        await pool.query("UPDATE instant_water_action_tokens SET used_at=NULL WHERE assessment_id=$1", [f.assessmentId]);
        assert.equal((await requestPhysicalTest(f.request)).ticketId, f.ticketId);
      }
    }
  });

  it("rolls back expired-key renewal on database failure and allows a subsequent retry", async () => {
    const f = await fixture();
    const first = await requestPhysicalTest(f.request);
    await expire(f.assessmentId);
    const before = await snapshot(f.assessmentId);
    const name = `physical_retry_${randomUUID().replaceAll("-", "")}`;
    // Scope the database failure to this fixture; no global pool mocks and no
    // trigger can affect another suite's records.
    await pool.query(`
      CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.assessment_id = '${f.assessmentId}' THEN
          RAISE EXCEPTION 'injected retry renewal failure';
        END IF;
        RETURN NEW;
      END $$;
      CREATE TRIGGER ${name} BEFORE UPDATE ON instant_water_idempotency
      FOR EACH ROW EXECUTE FUNCTION ${name}();
    `);
    try {
      await assert.rejects(requestPhysicalTest(f.request), /injected retry renewal failure/);
      assert.deepEqual(await snapshot(f.assessmentId), before);
    } finally {
      await pool.query(`DROP TRIGGER ${name} ON instant_water_idempotency; DROP FUNCTION ${name}()`);
    }
    assert.deepEqual(await requestPhysicalTest(f.request), first);
  });

  it("does not renew an expired key when its ticket is missing", async () => {
    const f = await fixture();
    await requestPhysicalTest(f.request);
    await expire(f.assessmentId);
    await pool.query("DELETE FROM instant_water_check_tickets WHERE id=$1", [f.ticketId]);
    const before = await snapshot(f.assessmentId);
    await assert.rejects(requestPhysicalTest(f.request), /NOT_FOUND/);
    assert.deepEqual(await snapshot(f.assessmentId), before);
  });
});