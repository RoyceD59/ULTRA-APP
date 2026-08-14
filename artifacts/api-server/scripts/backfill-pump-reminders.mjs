#!/usr/bin/env node
/**
 * Backfill replacement-reminder nudges for past "Portable Water Filter Pump"
 * (product 8147) buyers.
 *
 * Background
 * ----------
 * Product 8147 only received its `filter_lifespan_days` WooCommerce meta
 * (120 days) after some orders had already been placed. Customers who bought
 * it before that change were treated as non-trackable and received no
 * replacement-reminder notification in the Ultra Clear Companion app.
 *
 * When a user opens the app, `syncActivationWithCatalogue()` (in
 * uc-companion/hooks/useNotifications.ts:543) detects the lifespan change
 * (0 → 120) and reschedules the full notification sequence from the original
 * activation date. This script sends a push nudge to drive affected users to
 * open the app — specifically the Account tab, which mounts the filter tracker.
 *
 * Status filtering
 * ----------------
 * Only WooCommerce orders in a paid/fulfilled state are eligible:
 *   ELIGIBLE_WC_STATUSES = ['processing', 'completed']
 * Pending, on-hold, failed, cancelled, refunded, trash, and checkout-draft
 * orders are all excluded — the customer did not successfully purchase the
 * product.
 *
 * Idempotency
 * -----------
 * Each run writes a delivery log to DELIVERY_LOG_PATH. On re-runs, users
 * already recorded in that log are skipped, so they never receive duplicates
 * even if the script is retried after a partial failure.
 *
 * WooCommerce error handling
 * --------------------------
 * Non-2xx HTTP responses and JSON parse failures both throw, causing the
 * script to exit non-zero. The script only reports "0 orders found" after a
 * verified successful empty response.
 *
 * Buyer-to-app-user correlation
 * ------------------------------
 * WC orders carry a billing e-mail. App accounts in `uc_users` are keyed by
 * the same e-mail (normalised to lowercase). Unmatched WC buyers (no app
 * account yet) are reported so the team can follow up manually.
 *
 * Run
 * ---
 *   cd artifacts/api-server
 *   node scripts/backfill-pump-reminders.mjs
 *
 *   # Dry-run (discover orders, print actions without sending notifications):
 *   DRY_RUN=1 node scripts/backfill-pump-reminders.mjs
 *
 * Required env vars:
 *   DATABASE_URL          — Postgres connection string
 *   WC_CONSUMER_KEY       — WooCommerce REST API key  (optional; WC check skipped if absent)
 *   WC_CONSUMER_SECRET    — WooCommerce REST API secret
 */

import pg from "pg";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

const { Pool } = pg;

export const PRODUCT_ID    = 8147;
export const PRODUCT_NAME  = "Portable Water Filter Pump";
export const LIFESPAN_DAYS = 120;

// Only orders in these WC statuses represent a completed purchase.
// All other statuses (pending, on-hold, failed, cancelled, refunded,
// checkout-draft, trash) are excluded.
export const ELIGIBLE_WC_STATUSES = ["processing", "completed"];

// Only DB orders in these statuses represent a confirmed purchase.
// 'pending' (COD awaiting payment), 'pending-wc' (in-flight WC idempotency
// anchor), 'failed', 'cancelled', 'refunded', 'declined', and any other
// non-final status are all excluded by not appearing in this list.
export const ELIGIBLE_DB_STATUSES = ["processing", "completed", "paid", "shipped"];

const DRY_RUN = process.env.DRY_RUN === "1";

// Idempotency log path — kept outside the repo tree to avoid PII in source
// control.  Override with BACKFILL_LOG_PATH for a different location.
export const DELIVERY_LOG_PATH =
  process.env.BACKFILL_LOG_PATH ??
  join("/tmp", "backfill-pump-8147-reminders.log.json");

// ─── Delivery log (idempotency) ───────────────────────────────────────────────
/**
 * Load the delivery log.  Returns { notifiedEmails: Set, notifiedUserIds: Set }.
 */
export function loadDeliveryLog() {
  try {
    const raw = JSON.parse(readFileSync(DELIVERY_LOG_PATH, "utf8"));
    return {
      notifiedEmails:  new Set(raw.notifiedEmails  ?? []),
      notifiedUserIds: new Set(raw.notifiedUserIds ?? []),
    };
  } catch {
    return { notifiedEmails: new Set(), notifiedUserIds: new Set() };
  }
}

/**
 * Persist the delivery log back to disk.
 */
export function saveDeliveryLog(log) {
  if (DRY_RUN) return; // never write in dry-run
  writeFileSync(
    DELIVERY_LOG_PATH,
    JSON.stringify({
      notifiedEmails:  [...log.notifiedEmails],
      notifiedUserIds: [...log.notifiedUserIds],
    }, null, 2),
  );
}

// ─── WooCommerce helpers ──────────────────────────────────────────────────────
/**
 * Parse a WooCommerce REST response that may have PHP notices prepended.
 * Throws SyntaxError when no JSON is found or JSON.parse fails.
 * Throws on non-2xx HTTP responses (caller should pass the status too).
 */
export function parseWcResponse(text, httpStatus) {
  if (httpStatus < 200 || httpStatus >= 300) {
    throw new Error(`WooCommerce API returned HTTP ${httpStatus}`);
  }
  const start = text.search(/[{[]/);
  if (start === -1) throw new SyntaxError("No JSON found in WooCommerce response");
  return JSON.parse(text.slice(start));
}

/**
 * Return true when a WC order status represents a completed purchase.
 */
export function isEligibleWcStatus(status) {
  return ELIGIBLE_WC_STATUSES.includes(status);
}

/**
 * Fetch all WooCommerce orders for a given product ID, paging automatically.
 * Only returns orders in ELIGIBLE_WC_STATUSES.
 * Throws on HTTP errors, JSON parse failures, or credentials missing.
 * Returns null when credentials are not configured (WC check disabled).
 */
export async function fetchEligibleWcOrders(productId, { wcKey, wcSecret, wcBase, fetchFn = fetch } = {}) {
  if (!wcKey || !wcSecret) return null;

  const auth = `Basic ${Buffer.from(`${wcKey}:${wcSecret}`).toString("base64")}`;
  const orders = [];
  let page = 1;

  while (true) {
    const url =
      `${wcBase}/wp-json/wc/v3/orders` +
      `?product=${productId}&per_page=100&page=${page}` +
      `&status=${ELIGIBLE_WC_STATUSES.join(",")}`;

    const res  = await fetchFn(url, {
      headers: { "User-Agent": "Mozilla/5.0", Authorization: auth },
    });
    const text = await res.text();
    const batch = parseWcResponse(text, res.status); // throws on non-2xx / parse error

    if (!Array.isArray(batch) || batch.length === 0) break;
    orders.push(...batch.filter(o => isEligibleWcStatus(o.status)));
    if (batch.length < 100) break;
    page++;
  }

  return orders;
}

// ─── Expo push helper ─────────────────────────────────────────────────────────
/**
 * Send a single push notification via the Expo Push API.
 *
 * Returns { staleToken: false } on a confirmed "ok" ticket.
 * Returns { staleToken: true  } when Expo reports DeviceNotRegistered.
 * Throws on:
 *   - non-2xx HTTP from Expo
 *   - JSON parse failure
 *   - missing ticket in the response
 *   - any ticket error other than DeviceNotRegistered
 *
 * Callers MUST NOT record the send in the idempotency log unless this
 * function returns without throwing.
 */
export async function sendExpoPush(token, title, body, data = {}, { fetchFn = fetch } = {}) {
  if (DRY_RUN) return { staleToken: false };

  const res = await fetchFn("https://exp.host/--/api/v2/push/send", {
    method:  "POST",
    headers: {
      "Content-Type":    "application/json",
      "Accept":          "application/json",
      "Accept-Encoding": "gzip, deflate",
    },
    body: JSON.stringify([{ to: token, title, body, data }]),
  });

  if (!res.ok) {
    throw new Error(`Expo Push API returned HTTP ${res.status}`);
  }

  // Throws on malformed JSON (let it propagate — do not swallow).
  const json = await res.json();
  const ticket = json?.data?.[0];

  if (!ticket) {
    throw new Error("Expo Push API returned no ticket in response");
  }

  if (ticket.status === "error") {
    if (ticket.details?.error === "DeviceNotRegistered") {
      return { staleToken: true };
    }
    throw new Error(`Expo push ticket error: ${ticket.details?.error ?? "unknown"}`);
  }

  // ticket.status === "ok" — delivery accepted.
  return { staleToken: false };
}

// ─── Main runner ──────────────────────────────────────────────────────────────
/**
 * Run the full backfill. Exported for testing; also invoked when executed
 * directly via `node backfill-pump-reminders.mjs`.
 *
 * @param {object} opts - Dependency-injection seams for testing.
 */
export async function run({
  dbPool        = null,
  wcKey         = process.env.WC_CONSUMER_KEY,
  wcSecret      = process.env.WC_CONSUMER_SECRET,
  wcBase        = process.env.WC_BASE_URL || "https://www.ucfilters.com",
  fetchFn       = fetch,
  deliveryLog   = null,
  log           = console.log,
  error         = console.error,
} = {}) {
  if (DRY_RUN) log("── DRY RUN — no notifications will be sent ────────────────────\n");

  log(`Backfill replacement-reminder nudge — product ${PRODUCT_ID} "${PRODUCT_NAME}"`);
  log(`Lifespan: ${LIFESPAN_DAYS} days\n`);

  // Load idempotency log
  const dl = deliveryLog ?? loadDeliveryLog();

  // DB query helper
  const qry = dbPool
    ? async (sql, params = []) => {
        const client = await dbPool.connect();
        try { return (await client.query(sql, params)).rows; }
        finally { client.release(); }
      }
    : null;

  // Counters
  let wcEligible  = 0;
  let wcMatched   = 0;
  let wcUnmatched = 0;
  let dbEligible  = 0;
  let sent        = 0;
  let failed      = 0; // push transport/ticket errors — not logged, eligible for retry
  let skippedLog  = 0;
  let optedOut    = 0;
  let noToken     = 0;
  let stale       = 0;

  // ── WooCommerce orders ──────────────────────────────────────────────────────
  log("── WooCommerce orders ──────────────────────────────────────────");
  let wcOrders = null;
  try {
    wcOrders = await fetchEligibleWcOrders(PRODUCT_ID, { wcKey, wcSecret, wcBase, fetchFn });
  } catch (err) {
    error(`FATAL  WooCommerce fetch failed: ${err.message}`);
    throw err; // exit non-zero
  }

  if (wcOrders === null) {
    log("SKIP  WC credentials not set — WooCommerce check disabled");
  } else if (wcOrders.length === 0) {
    log(`OK    0 eligible WooCommerce orders for product ${PRODUCT_ID}`);
  } else {
    wcEligible = wcOrders.length;
    log(`FOUND ${wcEligible} eligible WooCommerce order(s):`);

    // Deduplicate by billing e-mail — one nudge per customer.
    const seenEmails = new Map();
    for (const o of wcOrders) {
      const email = (o.billing?.email ?? "").toLowerCase().trim();
      const name  = `${o.billing?.first_name ?? ""} ${o.billing?.last_name ?? ""}`.trim() || "—";
      const qty   = (o.line_items ?? [])
        .filter(li => li.product_id === PRODUCT_ID)
        .reduce((s, li) => s + (li.quantity ?? 1), 0);
      log(`  WC order ${o.id}  status=${o.status}  qty=${qty}  "${name}" <${email}>`);
      if (email && !seenEmails.has(email)) seenEmails.set(email, o.id);
    }

    if (qry) {
      log(`\n  Correlating ${seenEmails.size} unique buyer email(s) with app accounts…`);
      for (const [email, wcOrderId] of seenEmails) {
        if (dl.notifiedEmails.has(email)) {
          log(`  SKIP  <${email}> — already nudged (idempotency log)`);
          skippedLog++;
          continue;
        }
        const userRows = await qry(`SELECT id FROM uc_users WHERE email = $1`, [email]);
        if (userRows.length === 0) {
          log(`  UNMATCH  <${email}> (WC order ${wcOrderId}) — no app account`);
          wcUnmatched++;
          continue;
        }
        wcMatched++;
        const userId = String(userRows[0].id);
        const outcome = await nudgeUser(userId, `user ${userId} <${email}>`, qry, fetchFn, log);
        if (outcome === "sent") {
          sent++;
          dl.notifiedEmails.add(email);
          dl.notifiedUserIds.add(userId);
          saveDeliveryLog(dl);
        } else if (outcome === "failed")    failed++;
        else if (outcome === "opted_out")   optedOut++;
        else if (outcome === "no_token")    noToken++;
        else if (outcome === "stale")       stale++;
      }
    } else {
      log("  NOTE  No DB connection — cannot correlate WC emails with push tokens");
    }
  }

  // ── DB (mock-mode) orders ───────────────────────────────────────────────────
  log("\n── DB (mock-mode) orders ───────────────────────────────────────");
  if (!qry) {
    log("SKIP  No DB connection provided");
  } else {
    const ph = ELIGIBLE_DB_STATUSES.map((_, k) => `$${k + 2}`).join(",");
    const dbRows = await qry(
      `SELECT o.id AS order_id, o.user_id, o.status, o.date_created, i.quantity
       FROM uc_order_items i
       JOIN uc_orders o ON o.id = i.order_id
       WHERE i.product_id = $1 AND o.status IN (${ph})
       ORDER BY o.date_created ASC`,
      [PRODUCT_ID, ...ELIGIBLE_DB_STATUSES],
    );
    dbEligible = dbRows.length;

    if (dbRows.length === 0) {
      log(`OK    0 DB orders for product ${PRODUCT_ID}`);
    } else {
      log(`FOUND ${dbRows.length} DB order item(s):`);
      for (const r of dbRows) {
        const date = String(r.date_created).slice(0, 10);
        log(`  order ${r.order_id}  status=${r.status}  user=${r.user_id}  qty=${r.quantity}  date=${date}`);
      }

      const userIds = [...new Set(dbRows.map(r => String(r.user_id)))];
      log(`\n  Nudging ${userIds.length} unique DB user(s)…`);
      for (const userId of userIds) {
        if (dl.notifiedUserIds.has(userId)) {
          log(`  SKIP  user ${userId} — already nudged (idempotency log)`);
          skippedLog++;
          continue;
        }
        const outcome = await nudgeUser(userId, `user ${userId}`, qry, fetchFn, log);
        if (outcome === "sent") {
          sent++;
          dl.notifiedUserIds.add(userId);
          saveDeliveryLog(dl);
        } else if (outcome === "failed")    failed++;
        else if (outcome === "opted_out")   optedOut++;
        else if (outcome === "no_token")    noToken++;
        else if (outcome === "stale")       stale++;
      }
    }
  }

  // ── Summary ─────────────────────────────────────────────────────────────────
  log("\n── Summary ─────────────────────────────────────────────────────");
  if (wcOrders !== null) {
    log(`WC eligible orders:          ${wcEligible}`);
    log(`  → app account matched:     ${wcMatched}`);
    log(`  → no app account:          ${wcUnmatched}`);
  } else {
    log("WC orders:                   (not checked — no credentials)");
  }
  log(`DB eligible orders:          ${dbEligible}`);
  log(`Nudges sent:                 ${sent}${DRY_RUN ? " (DRY RUN)" : ""}`);
  log(`Nudges failed (retry needed):${failed}`);
  log(`Skipped (already nudged):    ${skippedLog}`);
  log(`Skipped (opted out):         ${optedOut}`);
  log(`Skipped (no token):          ${noToken}`);
  log(`Stale tokens removed:        ${stale}`);

  const totalEligible = wcEligible + dbEligible;
  if (wcOrders !== null && totalEligible === 0) {
    log(
      `\nRESULT  No eligible orders for product ${PRODUCT_ID} in WooCommerce or DB.` +
      `\n        No backfill action required.`
    );
  } else if (totalEligible > 0) {
    log(
      `\nRESULT  Eligible orders found.  Nudged users will have their reminder` +
      `\n        auto-synced (lifespan 0 → ${LIFESPAN_DAYS} days) via syncActivationWithCatalogue()` +
      `\n        the next time they open the Account tab.`
    );
    if (wcUnmatched > 0) {
      log(
        `\nACTION  ${wcUnmatched} WC buyer(s) have no matching app account.` +
        `\n        Follow up via the billing email on the WC order.`
      );
    }
  }

  return { wcEligible, wcMatched, wcUnmatched, dbEligible, sent, failed, skippedLog, optedOut, noToken, stale };
}

// ─── Per-user nudge helper ────────────────────────────────────────────────────
async function nudgeUser(userId, label, qry, fetchFn, log) {
  const tokenRows = await qry(
    `SELECT push_token, opt_out_orders FROM uc_push_tokens WHERE user_id = $1`,
    [userId],
  );
  if (tokenRows.length === 0) {
    log(`  SKIP  ${label} — no push token`);
    return "no_token";
  }
  const { push_token: token, opt_out_orders: optOut } = tokenRows[0];
  if (optOut) {
    log(`  SKIP  ${label} — opted out of order notifications`);
    return "opted_out";
  }

  let pushResult;
  try {
    pushResult = await sendExpoPush(
      token,
      "Your filter reminder is ready",
      `Open the app to activate your ${PRODUCT_NAME} replacement reminder (${LIFESPAN_DAYS}-day lifespan).`,
      // screen: 'filterTracker' navigates to /(tabs)/account (see _layout.tsx)
      // where syncActivationWithCatalogue() reschedules lifespan 0 → 120.
      { screen: "filterTracker", productId: PRODUCT_ID },
      { fetchFn },
    );
  } catch (err) {
    // Transport failure, non-2xx, bad JSON, or non-stale ticket error.
    // Do NOT record in the idempotency log — this user must be retried.
    log(`  ERROR ${label} — Expo push failed: ${err.message}`);
    return "failed";
  }

  if (pushResult.staleToken) {
    if (!DRY_RUN) await qry(`DELETE FROM uc_push_tokens WHERE user_id = $1`, [userId]);
    log(`  STALE ${label} — token removed`);
    return "stale";
  }

  log(`  ${DRY_RUN ? "WOULD SEND" : "SENT "} ${label}`);
  return "sent";
}

// ─── Entry point ──────────────────────────────────────────────────────────────
// Only run when executed directly (not when imported by tests).
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is not set");
    process.exit(1);
  }
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  run({ dbPool: pool }).then(() => pool.end()).catch(err => {
    console.error(err);
    pool.end().finally(() => process.exit(1));
  });
}
