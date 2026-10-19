import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { db, pool, teamUsersTable, ucUsersTable } from "@workspace/db";
import { inArray } from "drizzle-orm";
import app from "../app.js";
import { issueToken } from "../lib/jwt.js";
import {
  qualifyReferralSuccessfulPayment, registerReferralAtSignup,
  consumeReferralDiscount, reverseReferralForRefund, enqueueReferralSettlement,
  processPendingReferralSettlements,
  processReferralSettlementAlerts,
  deleteOrderWithReferralRelease,
  setReferralRuleLookupForTests,
} from "../routes/referrals.js";
import { finalizeRecoveryOrder } from "../routes/uc.js";
// This is a deliberately offline service harness, not a live shop request.
delete process.env.WC_BASE_URL;
delete process.env.WC_CONSUMER_KEY;
delete process.env.WC_CONSUMER_SECRET;

/* These are service-level integration tests: every assertion uses the isolated
 * PostgreSQL database created by tests/run.ts, while the production transaction
 * helpers execute unchanged. */
let stamp = "", ids: number[] = [], orderIds: number[] = [];
let server: http.Server, base: string;
const teamUserIds: string[] = [];
async function user(label: string) {
  const [u] = await db.insert(ucUsersTable).values({
    email: `${label}-${stamp}@test.invalid`, passwordHash: await bcrypt.hash("x", 4),
    firstName: label, lastName: "Referral",
  }).returning();
  ids.push(u!.id); return u!;
}
async function order(userId: number, method = "mpesa", status = "processing") {
  const q = await pool.query(`INSERT INTO uc_orders(user_id,status,total,currency,payment_method)
    VALUES ($1,$2,'1000','KES',$3) RETURNING id`, [String(userId), status, method]);
  const id = Number(q.rows[0].id);
  await pool.query("INSERT INTO uc_order_items(order_id,product_id,name,quantity,total) VALUES($1,1,'Eligible',1,'1000')", [id]);
  orderIds.push(id); return id;
}
async function attribute(referrer: number, invited: number, code = "TEST-CODE") {
  await pool.query(`INSERT INTO uc_referral_attributions(referrer_user_id,referred_user_id,referral_code)
    VALUES($1,$2,$3)`, [referrer, invited, code]);
}

describe("durable referral lifecycle", { concurrency: false }, () => {
  before(async () => {
    stamp = `${Date.now()}-${process.pid}`;
    await pool.query(`INSERT INTO uc_rewards_rules(event_type,label,points_value,active)
      VALUES('referral-successful-payment','Referral test',37,true)
      ON CONFLICT(event_type) DO UPDATE SET points_value=37,active=true`);
    server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address() as { port: number };
    base = `http://127.0.0.1:${address.port}/api`;
  });
  after(async () => {
    setReferralRuleLookupForTests(null);
    await new Promise<void>((resolve) => server.close(() => resolve()));
    if (orderIds.length) {
      await pool.query(`DELETE FROM uc_rewards_ledger WHERE ref_id LIKE 'referral:%' OR ref_id LIKE 'referral-reversal:%'`);
      await pool.query("DELETE FROM uc_referral_benefits WHERE conversion_id IN (SELECT id FROM uc_referral_conversions WHERE qualifying_order_id=ANY($1::int[]))", [orderIds]);
      await pool.query("DELETE FROM uc_referral_conversions WHERE qualifying_order_id=ANY($1::int[])", [orderIds]);
    }
    if (ids.length) await pool.query("DELETE FROM uc_referral_attributions WHERE referrer_user_id=ANY($1::int[]) OR referred_user_id=ANY($1::int[])", [ids]);
    if (orderIds.length) await pool.query("DELETE FROM uc_orders WHERE id=ANY($1::int[])", [orderIds]);
    if (ids.length) await pool.query("DELETE FROM uc_users WHERE id=ANY($1::int[])", [ids]);
    if (teamUserIds.length) {
      // Audited actors must remain referenced until the temporary DB is dropped.
      await pool.query(
        `DELETE FROM team_users WHERE id=ANY($1::text[])
         AND NOT EXISTS (
           SELECT 1 FROM referral_alert_threshold_changes WHERE actor_team_user_id=team_users.id
         )`,
        [teamUserIds],
      );
    }
  });

  it("rejects self attribution and first attribution wins; signup alone grants nothing", async () => {
    const owner = await user("owner"), invitee = await user("invitee");
    const firstCode = `FIRST-${stamp}`;
    const secondCode = `SECOND-${stamp}`;
    await pool.query(`INSERT INTO uc_referral_codes(code,owner_email,owner_name) VALUES($1,$2,'Owner')`, [firstCode, owner.email]);
    await pool.query(`INSERT INTO uc_referral_codes(code,owner_email,owner_name) VALUES($1,$2,'Other')`, [secondCode, (await user("other")).email]);
    await registerReferralAtSignup(owner.email, firstCode);
    await registerReferralAtSignup(invitee.email, firstCode);
    await registerReferralAtSignup(invitee.email, secondCode);
    const a = await pool.query("SELECT * FROM uc_referral_attributions WHERE referred_user_id=$1", [invitee.id]);
    assert.equal(a.rows.length, 1); assert.equal(Number(a.rows[0].referrer_user_id), owner.id);
    const self = await pool.query("SELECT count(*)::int n FROM uc_referral_attributions WHERE referred_user_id=$1", [owner.id]);
    assert.equal(Number(self.rows[0].n), 0);
    const benefits = await pool.query("SELECT count(*)::int n FROM uc_referral_benefits WHERE user_id=$1", [invitee.id]);
    assert.equal(Number(benefits.rows[0].n), 0);
  });

  it("excludes COD and failed orders, then issues one conversion, four paired benefits and configured points", async () => {
    const r = await user("paid-referrer"), i = await user("paid-invitee"); await attribute(r.id, i.id);
    for (const [method, status] of [["cod", "processing"], ["mpesa", "failed"]] as const) {
      const result = await qualifyReferralSuccessfulPayment(await order(i.id, method, status));
      assert.equal(result.issued, false);
    }
    const paid = await order(i.id); assert.equal((await qualifyReferralSuccessfulPayment(paid)).issued, true);
    assert.equal((await qualifyReferralSuccessfulPayment(paid)).issued, false, "replay is idempotent");
    const c = await pool.query("SELECT count(*)::int n FROM uc_referral_conversions WHERE qualifying_order_id=$1", [paid]);
    const b = await pool.query(`SELECT count(*)::int n,coalesce(sum(points),0)::int points,
      coalesce(max(discount_percent) FILTER (WHERE recipient_role='referred' AND kind='discount'),0)::int referred_discount
      FROM uc_referral_benefits WHERE conversion_id=(SELECT id FROM uc_referral_conversions WHERE qualifying_order_id=$1)`, [paid]);
    assert.equal(Number(c.rows[0].n), 1); assert.equal(Number(b.rows[0].n), 4); assert.equal(Number(b.rows[0].points), 74);
    assert.equal(Number(b.rows[0].referred_discount), 10);
    const ledger = await pool.query(`SELECT points FROM uc_rewards_ledger
      WHERE user_id=$1 AND ref_id LIKE 'referral:%' ORDER BY id DESC LIMIT 1`, [r.id]);
    assert.equal(Number(ledger.rows[0].points), 37);
  });

  it("qualifies the earliest successful purchase even when a later paid row already exists", async () => {
    const r = await user("ordered-referrer"), i = await user("ordered-invitee"); await attribute(r.id, i.id);
    const first = await order(i.id);
    // Ensure ordering is deterministic independently of timestamp resolution.
    await new Promise((resolve) => setTimeout(resolve, 2));
    const later = await order(i.id);
    assert.equal((await qualifyReferralSuccessfulPayment(first)).issued, true);
    assert.equal((await qualifyReferralSuccessfulPayment(later)).issued, false);
    const conversion = await pool.query(`SELECT qualifying_order_id FROM uc_referral_conversions
      WHERE attribution_id=(SELECT id FROM uc_referral_attributions WHERE referred_user_id=$1)`, [i.id]);
    assert.equal(Number(conversion.rows[0].qualifying_order_id), first);
  });

  it("durably settles duplicate paid-boundary deliveries once", async () => {
    const r = await user("queue-referrer"), i = await user("queue-invitee"); await attribute(r.id, i.id);
    const paid = await order(i.id);
    await enqueueReferralSettlement(paid);
    await enqueueReferralSettlement(paid);
    await processPendingReferralSettlements();
    const settlement = await pool.query("SELECT status FROM uc_referral_settlements WHERE order_id=$1", [paid]);
    const benefits = await pool.query(`SELECT count(*)::int n FROM uc_referral_benefits
      WHERE conversion_id=(SELECT id FROM uc_referral_conversions WHERE qualifying_order_id=$1)`, [paid]);
    assert.equal(settlement.rows[0].status, "completed");
    assert.equal(Number(benefits.rows[0].n), 4);
  });

  it("retains a failed settlement and later completes it without duplicate benefits", async () => {
    const r = await user("retry-referrer"), i = await user("retry-invitee"); await attribute(r.id, i.id);
    const paid = await order(i.id);
    setReferralRuleLookupForTests(async (orderId) => {
      if (orderId === paid) throw new Error("deliberate reward-rule lookup failure");
      return undefined;
    });
    try {
      await enqueueReferralSettlement(paid);
      await processPendingReferralSettlements();
      const pending = await pool.query("SELECT status,attempts,last_error FROM uc_referral_settlements WHERE order_id=$1", [paid]);
      assert.equal(pending.rows[0].status, "pending"); assert.equal(Number(pending.rows[0].attempts), 1);
      assert.ok(String(pending.rows[0].last_error).length > 0);
    } finally {
      setReferralRuleLookupForTests(null);
    }
    await pool.query("UPDATE uc_referral_settlements SET next_attempt_at=now() WHERE order_id=$1", [paid]);
    await processPendingReferralSettlements();
    const settled = await pool.query("SELECT status FROM uc_referral_settlements WHERE order_id=$1", [paid]);
    const benefits = await pool.query(`SELECT count(*)::int n FROM uc_referral_benefits
      WHERE conversion_id=(SELECT id FROM uc_referral_conversions WHERE qualifying_order_id=$1)`, [paid]);
    assert.equal(settled.rows[0].status, "completed"); assert.equal(Number(benefits.rows[0].n), 4);
  });

  it("alerts once after the configurable settlement failure threshold", async () => {
    const r = await user("alert-referrer"), i = await user("alert-invitee"); await attribute(r.id, i.id);
    const paid = await order(i.id);
    await enqueueReferralSettlement(paid);
    await pool.query(`INSERT INTO team_settings(id,referral_failure_alert_threshold) VALUES('singleton',2)
      ON CONFLICT(id) DO UPDATE SET referral_failure_alert_threshold=2`);
    await pool.query(`UPDATE uc_referral_settlements SET attempts=2,last_error='temporary failure',
      next_attempt_at=now()+interval '5 minutes' WHERE order_id=$1`, [paid]);
    const messages: Array<{ subject: string }> = [];
    const fakeSend = async (email: Parameters<typeof import("../lib/resend.js").sendViaResend>[0]) => {
      messages.push({ subject: email.subject }); return true;
    };
    const slackMessages: string[] = [];
    const fakeSlack = async (text: string) => { slackMessages.push(text); return true; };
    assert.equal(await processReferralSettlementAlerts(fakeSend, fakeSlack), 2);
    assert.equal(await processReferralSettlementAlerts(fakeSend, fakeSlack), 0);
    assert.equal(messages.length, 1);
    assert.equal(slackMessages.length, 1);
    assert.match(messages[0]!.subject, new RegExp(`#${paid}`));
    assert.match(slackMessages[0]!, new RegExp(`#${paid}`));
    const state = await pool.query("SELECT alerted_at,alert_attempts,slack_alerted_at,slack_alert_attempts FROM uc_referral_settlements WHERE order_id=$1", [paid]);
    assert.ok(state.rows[0].alerted_at); assert.equal(Number(state.rows[0].alert_attempts), 1);
    assert.ok(state.rows[0].slack_alerted_at); assert.equal(Number(state.rows[0].slack_alert_attempts), 1);
  });

  it("retries email independently after Slack has already been delivered", async () => {
    const r = await user("channel-retry-referrer"), i = await user("channel-retry-invitee"); await attribute(r.id, i.id);
    const paid = await order(i.id);
    await enqueueReferralSettlement(paid);
    await pool.query(`INSERT INTO team_settings(id,referral_failure_alert_threshold) VALUES('singleton',2)
      ON CONFLICT(id) DO UPDATE SET referral_failure_alert_threshold=2`);
    await pool.query(`UPDATE uc_referral_settlements SET attempts=2,last_error='still failing'
      WHERE order_id=$1`, [paid]);
    let emailCalls = 0;
    let slackCalls = 0;
    const failedEmail = async () => { emailCalls += 1; return false; };
    const successfulSlack = async () => { slackCalls += 1; return true; };
    assert.equal(await processReferralSettlementAlerts(failedEmail, successfulSlack), 1);
    let state = await pool.query(`SELECT alerted_at,alert_attempts,alert_last_error,
      slack_alerted_at,slack_alert_attempts FROM uc_referral_settlements WHERE order_id=$1`, [paid]);
    assert.equal(state.rows[0].alerted_at, null);
    assert.equal(Number(state.rows[0].alert_attempts), 1);
    assert.ok(state.rows[0].alert_last_error);
    assert.ok(state.rows[0].slack_alerted_at);
    assert.equal(Number(state.rows[0].slack_alert_attempts), 1);

    await pool.query("UPDATE uc_referral_settlements SET alert_next_attempt_at=now() WHERE order_id=$1", [paid]);
    const successfulEmail = async () => { emailCalls += 1; return true; };
    const unexpectedSlack = async () => { slackCalls += 1; throw new Error("Slack must not be retried"); };
    assert.equal(await processReferralSettlementAlerts(successfulEmail, unexpectedSlack), 1);
    state = await pool.query(`SELECT alerted_at,alert_attempts,slack_alerted_at,slack_alert_attempts
      FROM uc_referral_settlements WHERE order_id=$1`, [paid]);
    assert.ok(state.rows[0].alerted_at);
    assert.ok(state.rows[0].slack_alerted_at);
    assert.equal(Number(state.rows[0].alert_attempts), 2);
    assert.equal(Number(state.rows[0].slack_alert_attempts), 1);
    assert.equal(emailCalls, 2);
    assert.equal(slackCalls, 1);
  });

  it("reuses Slack's deterministic message ID when its sent-state acknowledgement is lost", async () => {
    const r = await user("slack-dedupe-referrer"), i = await user("slack-dedupe-invitee"); await attribute(r.id, i.id);
    const paid = await order(i.id);
    await enqueueReferralSettlement(paid);
    await pool.query(`INSERT INTO team_settings(id,referral_failure_alert_threshold) VALUES('singleton',2)
      ON CONFLICT(id) DO UPDATE SET referral_failure_alert_threshold=2`);
    await pool.query(`UPDATE uc_referral_settlements SET attempts=2,last_error='still failing',
      alerted_at=now() WHERE order_id=$1`, [paid]);

    const acceptedMessageIds = new Set<string>();
    const attemptedMessageIds: string[] = [];
    let visibleWarnings = 0;
    let duplicateResponses = 0;
    const deduplicatingSlack: Parameters<typeof processReferralSettlementAlerts>[1] = async (_text, _template, options) => {
      const messageId = options?.idempotencyKey;
      assert.ok(messageId);
      attemptedMessageIds.push(messageId);
      if (acceptedMessageIds.has(messageId)) {
        duplicateResponses += 1;
        return true;
      }
      acceptedMessageIds.add(messageId);
      visibleWarnings += 1;
      return true;
    };
    const unexpectedEmail: Parameters<typeof processReferralSettlementAlerts>[0] = async () => {
      throw new Error("Email must already be acknowledged");
    };

    assert.equal(await processReferralSettlementAlerts(unexpectedEmail, deduplicatingSlack), 1);
    assert.equal(visibleWarnings, 1, "Slack accepted the first warning");

    // Model the crash window: Slack committed the message, but the database
    // acknowledgement did not survive. The expired claim makes it retryable.
    await pool.query(`UPDATE uc_referral_settlements SET slack_alerted_at=NULL,
      slack_alert_claimed_at=NULL,slack_alert_next_attempt_at=now() WHERE order_id=$1`, [paid]);

    assert.equal(await processReferralSettlementAlerts(unexpectedEmail, deduplicatingSlack), 1);
    assert.deepEqual(attemptedMessageIds, [
      `referral-settlement-failure:${paid}`,
      `referral-settlement-failure:${paid}`,
    ]);
    assert.equal(duplicateResponses, 1);
    assert.equal(visibleWarnings, 1, "Slack absorbed the retry without another visible warning");
    const state = await pool.query(`SELECT slack_alerted_at,slack_alert_attempts
      FROM uc_referral_settlements WHERE order_id=$1`, [paid]);
    assert.ok(state.rows[0].slack_alerted_at);
    assert.equal(Number(state.rows[0].slack_alert_attempts), 2);
  });

  it("only lets admins persist a valid referral failure alert threshold", async () => {
    const createTeamUser = async (role: "admin" | "member") => {
      const id = randomUUID();
      const email = `threshold-${role}-${stamp}@test.invalid`;
      await db.insert(teamUsersTable).values({
        id, email, name: `Threshold ${role}`, passwordHash: await bcrypt.hash("x", 4),
        role, isActive: true, permissions: {},
      });
      teamUserIds.push(id);
      return issueToken({ id, email, name: `Threshold ${role}`, type: "team-session", role });
    };
    const adminToken = await createTeamUser("admin");
    const memberToken = await createTeamUser("member");
    const patch = async (failureAlertThreshold: number, bearer?: string) => {
      const response = await fetch(`${base}/uc/admin/referrals/settings`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
        },
        body: JSON.stringify({ failureAlertThreshold }),
      });
      return { status: response.status, body: await response.json() as Record<string, unknown> };
    };
    const stored = async () => Number((await pool.query(
      "SELECT referral_failure_alert_threshold FROM team_settings WHERE id='singleton'",
    )).rows[0]?.referral_failure_alert_threshold);
    const original = await stored();

    try {
      assert.equal((await patch(17)).status, 401);
      assert.equal(await stored(), original, "unauthenticated request must not persist");
      assert.equal((await patch(17, memberToken)).status, 401);
      assert.equal(await stored(), original, "non-admin request must not persist");

      for (const invalid of [0, 101, 1.5]) {
        assert.equal((await patch(invalid, adminToken)).status, 400);
        assert.equal(await stored(), original, `invalid value ${invalid} must not persist`);
      }

      const updated = await patch(17, adminToken);
      assert.equal(updated.status, 200);
      assert.equal(updated.body.failureAlertThreshold, 17);
      assert.equal(await stored(), 17);

      const support = await fetch(`${base}/uc/admin/referrals`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      assert.equal(support.status, 200);
      const body = await support.json() as Record<string, unknown>;
      assert.equal(body.settlementFailureThreshold, 17);
    } finally {
      await pool.query(`UPDATE team_settings SET referral_failure_alert_threshold=$1,updated_at=now()
        WHERE id='singleton'`, [original]);
    }
  });

  it("immediately denies referral support data after admin demotion or deactivation", async () => {
    const id = randomUUID();
    const email = `referral-support-revocation-${stamp}@test.invalid`;
    await db.insert(teamUsersTable).values({
      id,
      email,
      name: "Referral Support Revocation",
      passwordHash: await bcrypt.hash("x", 4),
      role: "admin",
      isActive: true,
      permissions: {},
    });
    teamUserIds.push(id);
    const adminToken = issueToken({
      id,
      email,
      name: "Referral Support Revocation",
      type: "team-session",
      role: "admin",
    });
    const support = async () => {
      const response = await fetch(`${base}/uc/admin/referrals`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      return {
        status: response.status,
        body: await response.json() as Record<string, unknown>,
      };
    };

    const allowed = await support();
    assert.equal(allowed.status, 200, "active admin must reach referral support");
    assert.ok(Array.isArray(allowed.body.settlementFailures));

    await db.update(teamUsersTable)
      .set({ role: "member" })
      .where(inArray(teamUsersTable.id, [id]));
    const demoted = await support();
    assert.equal(demoted.status, 401, "demotion must invalidate the existing token");
    assert.deepEqual(demoted.body, { error: "Admin authentication required" });
    assert.equal(demoted.body.settlementFailures, undefined, "denied response must not expose support data");

    await db.update(teamUsersTable)
      .set({ role: "admin", isActive: false })
      .where(inArray(teamUsersTable.id, [id]));
    const deactivated = await support();
    assert.equal(deactivated.status, 401, "deactivation must invalidate the existing token");
    assert.deepEqual(deactivated.body, { error: "Admin authentication required" });
    assert.equal(deactivated.body.settlementFailures, undefined, "denied response must not expose support data");
  });

  it("does not alert after settlement wins the per-order concurrency lock", async () => {
    const r = await user("alert-race-referrer"), i = await user("alert-race-invitee"); await attribute(r.id, i.id);
    const paid = await order(i.id);
    await enqueueReferralSettlement(paid);
    await pool.query(`UPDATE uc_referral_settlements SET attempts=2,last_error='temporary failure'
      WHERE order_id=$1`, [paid]);
    const lock = await pool.connect();
    await lock.query("SELECT pg_advisory_lock(613,$1)", [paid]);
    const alerts = processReferralSettlementAlerts(async () => true, async () => true);
    await new Promise((resolve) => setTimeout(resolve, 20));
    await lock.query("UPDATE uc_referral_settlements SET status='completed',completed_at=now() WHERE order_id=$1", [paid]);
    await lock.query("SELECT pg_advisory_unlock(613,$1)", [paid]);
    lock.release();
    assert.equal(await alerts, 0);
    const state = await pool.query("SELECT alerted_at FROM uc_referral_settlements WHERE order_id=$1", [paid]);
    assert.equal(state.rows[0].alerted_at, null);
  });

  it("repairs a confirmed attributed paid order that missed its outbox insert", async () => {
    const r = await user("scan-referrer"), i = await user("scan-invitee"); await attribute(r.id, i.id);
    const paid = await order(i.id);
    await pool.query("UPDATE uc_orders SET payment_confirmed_at=now() WHERE id=$1", [paid]);
    const absent = await pool.query("SELECT 1 FROM uc_referral_settlements WHERE order_id=$1", [paid]);
    assert.equal(absent.rows.length, 0);
    await processPendingReferralSettlements();
    await processPendingReferralSettlements();
    const settlement = await pool.query("SELECT status FROM uc_referral_settlements WHERE order_id=$1", [paid]);
    const benefits = await pool.query(`SELECT count(*)::int n FROM uc_referral_benefits
      WHERE conversion_id=(SELECT id FROM uc_referral_conversions WHERE qualifying_order_id=$1)`, [paid]);
    assert.equal(settlement.rows[0].status, "completed"); assert.equal(Number(benefits.rows[0].n), 4);
  });

  it("finalizes a webhook recovery, reopens settlement, and qualifies exactly once", async () => {
    const r = await user("recovery-referrer"), i = await user("recovery-invitee"); await attribute(r.id, i.id);
    const recovery = await pool.query(`INSERT INTO uc_orders
      (user_id,status,total,currency,payment_method,payment_reference,webhook_recovery,payment_confirmed_at)
      VALUES($1,'processing','1599','KES','paystack',$2,true,now()) RETURNING id`,
      [i.email, `recovery-${stamp}-${i.id}`]);
    const recoveryId = Number(recovery.rows[0].id); orderIds.push(recoveryId);
    await pool.query(`INSERT INTO uc_referral_settlements(order_id,status,completed_at)
      VALUES($1,'completed',now())`, [recoveryId]);
    await finalizeRecoveryOrder({
      orderId: recoveryId, accountId: i.id,
      lineItems: [{ productId: 22, quantity: 1 }],
      shippingAddress: { address1: "1 Test Road", city: "Nairobi", fulfillment: "delivery" },
    });
    const finalized = await pool.query("SELECT user_id,webhook_recovery FROM uc_orders WHERE id=$1", [recoveryId]);
    const lines = await pool.query("SELECT product_id,quantity,total FROM uc_order_items WHERE order_id=$1", [recoveryId]);
    const pending = await pool.query("SELECT status,completed_at FROM uc_referral_settlements WHERE order_id=$1", [recoveryId]);
    assert.equal(finalized.rows[0].user_id, String(i.id)); assert.equal(finalized.rows[0].webhook_recovery, false);
    assert.equal(lines.rows.length, 1); assert.equal(Number(lines.rows[0].total), 1099);
    assert.equal(pending.rows[0].status, "pending"); assert.equal(pending.rows[0].completed_at, null);
    await processPendingReferralSettlements(); await processPendingReferralSettlements();
    const conversions = await pool.query("SELECT count(*)::int n FROM uc_referral_conversions WHERE qualifying_order_id=$1", [recoveryId]);
    const benefits = await pool.query(`SELECT count(*)::int n FROM uc_referral_benefits
      WHERE conversion_id=(SELECT id FROM uc_referral_conversions WHERE qualifying_order_id=$1)`, [recoveryId]);
    assert.equal(Number(conversions.rows[0].n), 1); assert.equal(Number(benefits.rows[0].n), 4);
  });

  it("maintenance releases a terminal anchor missed by the status writer and remains idempotent", async () => {
    const r = await user("release-referrer"), i = await user("release-invitee"); await attribute(r.id, i.id);
    const qualifying = await order(i.id); await qualifyReferralSuccessfulPayment(qualifying);
    const benefit = await pool.query("SELECT id FROM uc_referral_benefits WHERE user_id=$1 AND kind='discount' LIMIT 1", [i.id]);
    const bound = await pool.query(`INSERT INTO uc_orders(user_id,status,total,currency,payment_method,referral_benefit_id)
      VALUES($1,'pending-wc','1400','KES','mpesa',$2) RETURNING id`, [String(i.id), benefit.rows[0].id]);
    const boundId = Number(bound.rows[0].id); orderIds.push(boundId);
    await pool.query("UPDATE uc_referral_benefits SET status='used',used_order_id=$2,used_at=now() WHERE id=$1", [benefit.rows[0].id, boundId]);
    await pool.query("UPDATE uc_orders SET status='cancelled' WHERE id=$1", [boundId]);
    await processPendingReferralSettlements();
    const state = await pool.query("SELECT status,used_order_id,used_at FROM uc_referral_benefits WHERE id=$1", [benefit.rows[0].id]);
    assert.equal(state.rows[0].status, "available"); assert.equal(state.rows[0].used_order_id, null);
    assert.equal(state.rows[0].used_at, null);
    const binding = await pool.query("SELECT referral_benefit_id FROM uc_orders WHERE id=$1", [boundId]);
    assert.equal(binding.rows[0].referral_benefit_id, null);
    await processPendingReferralSettlements();
    const unchanged = await pool.query("SELECT status,used_order_id,used_at FROM uc_referral_benefits WHERE id=$1", [benefit.rows[0].id]);
    assert.equal(unchanged.rows[0].status, "available"); assert.equal(unchanged.rows[0].used_order_id, null);
    assert.equal(unchanged.rows[0].used_at, null);
  });

  it("production delete lifecycle releases a pending WC anchor and permits deletion", async () => {
    const r = await user("delete-referrer"), i = await user("delete-invitee"); await attribute(r.id, i.id);
    const qualifying = await order(i.id); await qualifyReferralSuccessfulPayment(qualifying);
    const benefit = await pool.query("SELECT id FROM uc_referral_benefits WHERE user_id=$1 AND kind='discount' LIMIT 1", [i.id]);
    const bound = await pool.query(`INSERT INTO uc_orders(user_id,status,total,currency,payment_method,referral_benefit_id)
      VALUES($1,'pending-wc','1400','KES','mpesa',$2) RETURNING id`, [String(i.id), benefit.rows[0].id]);
    const boundId = Number(bound.rows[0].id); orderIds.push(boundId);
    await pool.query("UPDATE uc_referral_benefits SET status='used',used_order_id=$2,used_at=now() WHERE id=$1", [benefit.rows[0].id, boundId]);
    assert.equal(await deleteOrderWithReferralRelease(boundId), true);
    const deleted = await pool.query("SELECT 1 FROM uc_orders WHERE id=$1", [boundId]);
    const released = await pool.query("SELECT status,used_order_id,used_at FROM uc_referral_benefits WHERE id=$1", [benefit.rows[0].id]);
    assert.equal(deleted.rows.length, 0); assert.equal(released.rows[0].status, "available");
    assert.equal(released.rows[0].used_order_id, null); assert.equal(released.rows[0].used_at, null);
  });

  it("production delete lifecycle rejects a confirmed bound order without changing either row", async () => {
    const r = await user("audit-delete-referrer"), i = await user("audit-delete-invitee"); await attribute(r.id, i.id);
    const qualifying = await order(i.id); await qualifyReferralSuccessfulPayment(qualifying);
    const benefit = await pool.query("SELECT id FROM uc_referral_benefits WHERE user_id=$1 AND kind='discount' LIMIT 1", [i.id]);
    const bound = await pool.query(`INSERT INTO uc_orders
      (user_id,status,total,currency,payment_method,referral_benefit_id,payment_confirmed_at)
      VALUES($1,'processing','1400','KES','mpesa',$2,now()) RETURNING id`, [String(i.id), benefit.rows[0].id]);
    const boundId = Number(bound.rows[0].id); orderIds.push(boundId);
    await pool.query("UPDATE uc_referral_benefits SET status='used',used_order_id=$2,used_at=now() WHERE id=$1", [benefit.rows[0].id, boundId]);
    await assert.rejects(() => deleteOrderWithReferralRelease(boundId),
      (error: Error & { code?: string }) => error.code === "REFERRAL_AUDIT_REQUIRED");
    const unchangedOrder = await pool.query("SELECT status,referral_benefit_id,payment_confirmed_at FROM uc_orders WHERE id=$1", [boundId]);
    const unchangedBenefit = await pool.query("SELECT status,used_order_id,used_at FROM uc_referral_benefits WHERE id=$1", [benefit.rows[0].id]);
    assert.equal(unchangedOrder.rows[0].status, "processing");
    assert.equal(Number(unchangedOrder.rows[0].referral_benefit_id), Number(benefit.rows[0].id));
    assert.ok(unchangedOrder.rows[0].payment_confirmed_at);
    assert.equal(unchangedBenefit.rows[0].status, "used");
    assert.equal(Number(unchangedBenefit.rows[0].used_order_id), boundId);
    assert.ok(unchangedBenefit.rows[0].used_at);
  });

  it("locks concurrent qualification/discount claim and reverses exactly once on refund", async () => {
    const r = await user("race-referrer"), i = await user("race-invitee"); await attribute(r.id, i.id);
    const paid = await order(i.id);
    const results = await Promise.all(Array.from({ length: 5 }, () => qualifyReferralSuccessfulPayment(paid)));
    assert.equal(results.filter((x) => x.issued).length, 1);
    const claims = await Promise.all([consumeReferralDiscount(paid), consumeReferralDiscount(paid)]);
    assert.equal(claims.filter(Boolean).length, 1);
    await reverseReferralForRefund(paid); await reverseReferralForRefund(paid);
    const state = await pool.query(`SELECT c.status,count(b.id) FILTER (WHERE b.status='reversed')::int reversed
      FROM uc_referral_conversions c JOIN uc_referral_benefits b ON b.conversion_id=c.id WHERE c.qualifying_order_id=$1 GROUP BY c.status`, [paid]);
    assert.equal(state.rows[0].status, "reversed"); assert.equal(Number(state.rows[0].reversed), 4);
    const ledger = await pool.query(`SELECT sum(points)::int n FROM uc_rewards_ledger WHERE ref_id LIKE $1`, [`referral-reversal:%`]);
    assert.ok(Number(ledger.rows[0].n) <= -74, "compensating negative entries retained");
  });

  it("serializes concurrent tenth/eleventh referrals at the ten-point-award cap", async () => {
    const r = await user("cap-referrer");
    const invited = await Promise.all(Array.from({ length: 11 }, (_, n) => user(`cap-invitee-${n}`)));
    const orders = await Promise.all(invited.map(async (i) => { await attribute(r.id, i.id, `CAP-${i.id}`); return order(i.id); }));
    const result = await Promise.all(orders.map((id) => qualifyReferralSuccessfulPayment(id)));
    assert.equal(result.filter((x) => x.issued).length, 10);
    const conversions = await pool.query(`SELECT count(*)::int n FROM uc_referral_conversions c
      JOIN uc_referral_attributions a ON a.id=c.attribution_id WHERE a.referrer_user_id=$1 AND c.status='confirmed'`, [r.id]);
    const awards = await pool.query(`SELECT count(*)::int n FROM uc_referral_benefits
      WHERE user_id=$1 AND kind='points' AND points>0 AND status='available'`, [r.id]);
    assert.equal(Number(conversions.rows[0].n), 10); assert.equal(Number(awards.rows[0].n), 10);
  });
});