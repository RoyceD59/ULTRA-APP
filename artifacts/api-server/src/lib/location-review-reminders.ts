import { pool } from "@workspace/db";
import { logger } from "./logger.js";

export interface ReviewLocation {
  id: string;
  name: string;
  address: string;
  nextReviewOn: string | null;
  reviewKey: string;
}

export interface ReviewAlert {
  subject: string;
  text: string;
  sms: string;
  template: string;
}

/** Calendar dates are evaluated in the team's working timezone, not DB/session UTC. */
export function reviewWindow(now: Date): { today: string; through: string } {
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Nairobi", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(now);
  const end = new Date(`${today}T00:00:00Z`);
  end.setUTCDate(end.getUTCDate() + 7);
  return { today, through: end.toISOString().slice(0, 10) };
}

export function buildReviewAlert(locations: ReviewLocation[], today: string, missing: boolean): ReviewAlert {
  const overdue = locations.filter((l) => l.nextReviewOn !== null && l.nextReviewOn < today).length;
  const subject = missing
    ? `Water point reviews: ${locations.length} published location(s) missing a review date`
    : `Water point reviews: ${overdue} overdue, ${locations.length - overdue} due within 7 days`;
  const text = [
    subject,
    "",
    ...locations.map((l) => `- ${l.name} [${l.id}] — ${l.address} — ${
      l.nextReviewOn === null ? "MISSING REVIEW DATE"
        : l.nextReviewOn < today ? `OVERDUE since ${l.nextReviewOn}`
          : `Review due ${l.nextReviewOn}${l.nextReviewOn === today ? " (today)" : ""}`
    }`),
    "",
    missing
      ? "Action: open ProjectHub → Locations and assign a next-review date to each location."
      : "Action: open ProjectHub → Locations, arrange a field visit, confirm the published details, and record the field-review and next-review dates.",
    "If details cannot be confirmed, unpublish the location until they have been checked.",
    "Only published (active and verified) locations are included. Dates use Africa/Nairobi.",
  ].join("\n");
  // Include all IDs in the fallback, so even an email outage leaves an actionable list.
  const sms = `${subject}. Locations: ${locations.map((l) => l.id).join(", ")}. ${
    missing ? "Assign review dates" : "Arrange field visits and update review dates"
  } in ProjectHub > Locations.`;
  return { subject, text, sms, template: missing ? "location_review_missing_dates" : "location_review_due" };
}

/** One clear alert: email first, configured SMS only when email did not succeed. */
export async function deliverReviewAlert(
  alert: ReviewAlert,
  sendEmail: (alert: ReviewAlert) => Promise<boolean>,
  sendSms: (alert: ReviewAlert) => Promise<boolean>,
): Promise<boolean> {
  try {
    if (await sendEmail(alert)) return true;
  } catch (err) {
    logger.warn({ err }, "Location review reminder: email failed; trying SMS");
  }
  try {
    return await sendSms(alert);
  } catch (err) {
    logger.warn({ err }, "Location review reminder: SMS failed");
    return false;
  }
}

/**
 * Holds a session advisory lock across delivery, so multiple scheduler instances
 * cannot send the same digest concurrently. Failed sends remain eligible.
 * Review state is reconciled for ALL published rows (including future dates),
 * so a new date/field visit rearms the reminder without using old cycle history.
 */
export async function runLocationReviewReminders(options: {
  now?: Date;
  sendAlert: (alert: ReviewAlert) => Promise<boolean>;
  /** Test isolation: restrict both reconciliation and candidates to these IDs. */
  locationIds?: string[];
}): Promise<{ notified: number; failed: number; skipped: boolean }> {
  const client = await pool.connect();
  let locked = false;
  const result = { notified: 0, failed: 0, skipped: false };
  try {
    const lock = await client.query<{ locked: boolean }>(
      "SELECT pg_try_advisory_lock(hashtext('uc-location-field-review-reminders')) AS locked",
    );
    locked = lock.rows[0].locked;
    if (!locked) return { ...result, skipped: true };
    const ids = options.locationIds ?? null;
    // Last field visit distinguishes a fresh review even if the next date stays unchanged.
    const key = "COALESCE(l.last_field_verified_on::text, '') || '/' || COALESCE(l.next_review_on::text, 'missing')";
    await client.query(`
      INSERT INTO uc_location_review_alerts(location_id, review_key)
      SELECT l.id, ${key} FROM uc_locations l
      WHERE l.active AND l.verified AND ($1::text[] IS NULL OR l.id = ANY($1))
      ON CONFLICT(location_id) DO UPDATE
      SET review_key = EXCLUDED.review_key, notified_at = NULL
      WHERE uc_location_review_alerts.review_key <> EXCLUDED.review_key
    `, [ids]);
    const { today, through } = reviewWindow(options.now ?? new Date());
    const candidates = await client.query<ReviewLocation>(`
      SELECT l.id, l.name, l.address, l.next_review_on::text AS "nextReviewOn",
        a.review_key AS "reviewKey"
      FROM uc_locations l JOIN uc_location_review_alerts a ON a.location_id = l.id
      WHERE l.active AND l.verified AND a.notified_at IS NULL
        AND (l.next_review_on IS NULL OR l.next_review_on <= $1::date)
        AND ($2::text[] IS NULL OR l.id = ANY($2))
      ORDER BY l.next_review_on NULLS LAST, l.name, l.id
    `, [through, ids]);
    for (const missing of [false, true]) {
      const locations = candidates.rows.filter((l) => (l.nextReviewOn === null) === missing);
      if (locations.length === 0) continue;
      let sent = false;
      try {
        sent = await options.sendAlert(buildReviewAlert(locations, today, missing));
      } catch (err) {
        logger.error({ err, missing }, "Location review reminder: delivery threw");
      }
      if (!sent) {
        result.failed += locations.length;
        logger.error({ count: locations.length, missing }, "Location review reminder: no channel delivered; retry on next run");
        continue;
      }
      for (const location of locations) {
        // Do not acknowledge a newer review saved while the provider was sending.
        await client.query(`
          UPDATE uc_location_review_alerts a SET notified_at = $3
          FROM uc_locations l
          WHERE a.location_id = $1 AND l.id = a.location_id
            AND a.review_key = $2 AND ${key} = $2
        `, [location.id, location.reviewKey, options.now ?? new Date()]);
      }
      result.notified += locations.length;
    }
    logger.info(result, "Location review reminder run completed");
    return result;
  } finally {
    // Destroy a connection if unlocking fails rather than returning a locked session.
    try {
      if (locked) await client.query("SELECT pg_advisory_unlock(hashtext('uc-location-field-review-reminders'))");
      client.release();
    } catch (err) {
      client.release(err instanceof Error ? err : new Error(String(err)));
      throw err;
    }
  }
}