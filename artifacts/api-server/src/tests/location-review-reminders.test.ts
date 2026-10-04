import assert from "node:assert/strict";
import { after, beforeEach, describe, it } from "node:test";
import { pool } from "@workspace/db";
import {
  buildReviewAlert, deliverReviewAlert, reviewWindow, runLocationReviewReminders,
  type ReviewAlert,
} from "../lib/location-review-reminders.js";

const prefix = "test-location-review-reminder-";
const ids = ["overdue", "today", "soon", "boundary", "later", "missing", "inactive", "unverified"]
  .map((suffix) => prefix + suffix);
const now = new Date("2026-10-04T06:00:00Z");

async function clean() {
  await pool.query("DELETE FROM uc_locations WHERE id = ANY($1::text[])", [ids]);
}

beforeEach(async () => {
  await clean();
  const dates = ["2026-10-01", "2026-10-04", "2026-10-07", "2026-10-11", "2026-10-12", null, "2026-10-01", null];
  for (const [i, id] of ids.entries()) {
    await pool.query(`
      INSERT INTO uc_locations(id,type,name,address,latitude,longitude,active,verified,
        last_field_verified_on,next_review_on)
      VALUES($1,'refill_atm',$2,'Nairobi field site',-1.2,36.8,$3,$4,'2026-09-01',$5)
    `, [id, `Water point ${i}`, i !== 6, i !== 7, dates[i]]);
  }
});

after(async () => {
  await clean();
  await pool.end();
});

function run(sendAlert: (alert: ReviewAlert) => Promise<boolean>, at = now) {
  return runLocationReviewReminders({ now: at, sendAlert, locationIds: ids });
}

describe("water point field-review reminders", () => {
  it("uses Nairobi calendar days and a seven-day inclusive window", () => {
    assert.deepEqual(reviewWindow(new Date("2026-10-04T20:59:00Z")), {
      today: "2026-10-04", through: "2026-10-11",
    });
    assert.deepEqual(reviewWindow(new Date("2026-10-04T21:00:00Z")), {
      today: "2026-10-05", through: "2026-10-12",
    });
    assert.deepEqual(reviewWindow(new Date("2026-12-29T06:00:00Z")), {
      today: "2026-12-29", through: "2027-01-05",
    });
  });

  it("groups published due/overdue rows and separately summarises missing dates", async () => {
    const alerts: ReviewAlert[] = [];
    const result = await run(async (alert) => { alerts.push(alert); return true; });
    assert.equal(result.notified, 5);
    assert.equal(alerts.length, 2);
    assert.match(alerts[0].subject, /1 overdue, 3 due within 7 days/);
    assert.match(alerts[0].text, /OVERDUE since 2026-10-01/);
    assert.match(alerts[0].text, /Review due 2026-10-04 \(today\)/);
    assert.match(alerts[0].text, /2026-10-11/);
    assert.match(alerts[0].text, /arrange a field visit/i);
    assert.match(alerts[1].text, /MISSING REVIEW DATE/);
    assert.match(alerts[1].text, /assign a next-review date/);
    for (const alert of alerts) {
      assert.doesNotMatch(alert.text, /Water point [467]/);
    }
  });

  it("persists deduplication between runs, including when a warned date becomes overdue", async () => {
    await run(async () => true);
    const alerts: ReviewAlert[] = [];
    const result = await run(async (alert) => { alerts.push(alert); return true; }, new Date("2026-10-15T06:00:00Z"));
    assert.equal(result.notified, 1); // Previously outside the window; not a repeat.
    assert.equal(alerts.length, 1);
    assert.match(alerts[0].text, /Water point 4/);
    assert.doesNotMatch(alerts[0].text, /Water point [01235]/);
  });

  it("retries failed deliveries without repeating an independently successful summary", async () => {
    const first = await run(async (alert) => alert.template === "location_review_missing_dates");
    assert.equal(first.notified, 1);
    assert.equal(first.failed, 4);
    const retried: ReviewAlert[] = [];
    const second = await run(async (alert) => { retried.push(alert); return true; });
    assert.equal(second.notified, 4);
    assert.equal(retried.length, 1);
    assert.equal(retried[0].template, "location_review_due");
    assert.equal((await run(async () => assert.fail("already delivered"))).notified, 0);
  });

  it("rearms after date corrections, including returning to an old date after a future date", async () => {
    await run(async () => true);
    await pool.query("UPDATE uc_locations SET next_review_on='2026-12-01' WHERE id=$1", [ids[0]]);
    await run(async () => assert.fail("future date must not alert"));
    await pool.query("UPDATE uc_locations SET next_review_on='2026-10-01' WHERE id=$1", [ids[0]]);
    assert.equal((await run(async () => true)).notified, 1);
    await pool.query("UPDATE uc_locations SET last_field_verified_on='2026-09-20' WHERE id=$1", [ids[0]]);
    assert.equal((await run(async () => true)).notified, 1);
  });

  it("rearms a missing-date summary after the date was fixed and later removed", async () => {
    await run(async () => true);
    await pool.query("UPDATE uc_locations SET next_review_on='2026-12-01' WHERE id=$1", [ids[5]]);
    await run(async () => assert.fail("future date must not alert"));
    await pool.query("UPDATE uc_locations SET next_review_on=NULL WHERE id=$1", [ids[5]]);
    const alerts: ReviewAlert[] = [];
    assert.equal((await run(async (alert) => { alerts.push(alert); return true; })).notified, 1);
    assert.equal(alerts[0].template, "location_review_missing_dates");
  });

  it("skips concurrent workers and releases the lock after delivery throws", async () => {
    let signalEntered!: () => void;
    let releaseDelivery!: () => void;
    const entered = new Promise<void>((resolve) => { signalEntered = resolve; });
    const blocked = new Promise<void>((resolve) => { releaseDelivery = resolve; });
    const first = run(async () => {
      signalEntered();
      await blocked;
      throw new Error("test provider outage");
    });
    await entered;
    try {
      assert.equal((await run(async () => assert.fail("overlapping send"))).skipped, true);
    } finally {
      releaseDelivery();
      await first;
    }
    assert.equal((await run(async () => true)).notified, 5);
  });

  it("does not mark a newer review saved during delivery as already notified", async () => {
    await run(async (alert) => {
      if (alert.template === "location_review_due") {
        await pool.query("UPDATE uc_locations SET next_review_on='2026-10-06' WHERE id=$1", [ids[0]]);
      }
      return true;
    });
    const marker = await pool.query("SELECT notified_at FROM uc_location_review_alerts WHERE location_id=$1", [ids[0]]);
    assert.equal(marker.rows[0].notified_at, null);
    assert.equal((await run(async () => true)).notified, 1);
  });

  it("sends SMS only on email failure, and reports a both-channel failure", async () => {
    const alert = buildReviewAlert([], "2026-10-04", false);
    let smsCalls = 0;
    const sms = async () => { smsCalls++; return true; };
    assert.equal(await deliverReviewAlert(alert, async () => true, sms), true);
    assert.equal(smsCalls, 0);
    assert.equal(await deliverReviewAlert(alert, async () => false, sms), true);
    assert.equal(smsCalls, 1);
    assert.equal(await deliverReviewAlert(alert, async () => { throw new Error("email failed"); }, sms), true);
    assert.equal(smsCalls, 2);
    assert.equal(await deliverReviewAlert(alert, async () => false, async () => false), false);
    assert.equal(await deliverReviewAlert(alert, async () => false, async () => { throw new Error("SMS failed"); }), false);
  });
});