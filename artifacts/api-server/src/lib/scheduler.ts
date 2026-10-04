/**
 * Scheduled jobs for the AI Monitor and maintenance tasks.
 * - Daily 08:00 UTC: push project report to Ultra Clear AI orchestrator.
 * - Daily 02:00 UTC: prune old uc_ai_feedback rows beyond retention window.
 * - Daily 03:00 UTC: prune old uc_notification_log rows (sent=30d, failed=90d).
 * - Daily 06:00 UTC: sync contacts from Google Sheets; alerts team on failure.
 */
import cron from "node-cron";
import { logger } from "./logger";
import { generateAndStoreReport, pushReportToOrchestrator } from "../routes/ai/monitor";
import { db, ucAiFeedbackTable, ucAlisonConversationsTable, ucNotificationLogTable, sheetSyncsTable, membersTable, ucOrdersTable, teamSettingsTable, ucLifespanAlertsTable, ucLowStockAlertsTable, aiPushEventsTable, ucWishlistTable, ucRestockDemandAlertsTable } from "@workspace/db";
import { lt, lte, gt, desc, eq, and, or, inArray, isNull, isNotNull, sql } from "drizzle-orm";
import { runSheetSync } from "../routes/contacts-sync.js";
import {
  hasWCCredentials,
  fetchAllPublishedProducts,
  normalizeProduct,
  auditProductLifespans,
  getTeamAlertEmail,
} from "../routes/uc.js";
import { sendViaResend } from "./resend.js";
import { sendSms, sendSmsAwaitable } from "./sms.js";
import { getTeamAlertPhone } from "../routes/payments.js";
import { getValidAccessToken } from "./google-auth.js";
import { needsGoogleReconnect, buildSheetSyncFailureEmail } from "./google-reconnect.js";
import { dispatchFilterReminders, creditReplacementRewardsAll } from "./reminder-dispatch.js";
import { sendPushToUser } from "./push.js";
import { processLeadDeliveryOutbox } from "./lead-delivery.js";
import {
  checkRestockDemandForProduct,
  getRestockDemandThreshold,
  projectHubInventoryUrl,
} from "./wishlist-demand.js";
import {
  processReferralSettlementAlerts,
  retryReferralSettlements,
} from "../routes/referrals.js";
import { processOrderNotificationOutbox, reconcileWooOrderStatuses } from "./order-status-pipeline.js";
import { queueBlogRun, resumeQueuedBlogRuns, weeklyBlogRunKey } from "./blog-editorial.js";
import { reconcileAbandonedCheckouts } from "./abandoned-checkouts.js";
import { deliverReviewAlert, runLocationReviewReminders } from "./location-review-reminders.js";

// ─── Wishlist restock check ───────────────────────────────────────────────────
// Runs every 4 hours. For each distinct product in the wishlist:
//   • If WC says instock  → push notification to all un-notified users, set notifiedRestockAt.
//   • If WC says outofstock → reset notifiedRestockAt to NULL so the user
//     is notified again when it restocks for a second time.
//   • While out of stock, email the team once when waiting customers reach the
//     configured demand threshold. The demand marker is reset on restock or
//     when demand drops below the threshold.

/** Default live lookup: fetch a product's WooCommerce stock_status, or null on any failure. */
async function fetchWcStockStatus(productId: number): Promise<string | null> {
  const base = process.env["WC_BASE_URL"] || "https://www.ucfilters.com";
  const ck   = process.env["WC_CONSUMER_KEY"]!;
  const cs   = process.env["WC_CONSUMER_SECRET"]!;

  const url = `${base}/wp-json/wc/v3/products/${productId}?consumer_key=${encodeURIComponent(ck)}&consumer_secret=${encodeURIComponent(cs)}`;
  const fetchRes = await fetch(url);
  if (!fetchRes.ok) return null;

  const text = await fetchRes.text();
  const jsonStart = text.search(/[{[]/);
  if (jsonStart === -1) return null;

  const data = JSON.parse(text.slice(jsonStart)) as Record<string, unknown>;
  return String(data["stock_status"] ?? "");
}

export interface WishlistRestockDeps {
  /** Test seam: avoid reading process-wide Woo credentials. */
  isWcConfigured?: () => boolean;
  /** Test seam: replace the live WooCommerce lookup. */
  fetchStockStatus?: (productId: number) => Promise<string | null>;
  /** Test seam: replace the push-notification sender. */
  sendPush?: typeof sendPushToUser;
  /** Test seam: replace the team alert email sender. */
  sendEmail?: typeof sendViaResend;
  /** Test seam: avoid reading the shared settings row. */
  demandThreshold?: number;
  /** Test seam: use a deterministic inventory link in alert emails. */
  inventoryUrl?: string;
  /** Test seam: pause a demand rearm between its delete and pending transition. */
  beforeDemandRearmTransition?: () => Promise<void>;
}

export interface WishlistRestockResult {
  /** Number of wishlist rows that were notified (restock this cycle). */
  notified: number;
  /** Number of wishlist rows reset back to "un-notified" (out of stock again). */
  reset: number;
}

export async function checkWishlistRestocks(
  deps: WishlistRestockDeps = {},
): Promise<WishlistRestockResult> {
  const isWcConfigured  = deps.isWcConfigured  ?? hasWCCredentials;
  const fetchStockStatus = deps.fetchStockStatus ?? fetchWcStockStatus;
  const sendPush        = deps.sendPush        ?? sendPushToUser;
  const sendEmail        = deps.sendEmail      ?? sendViaResend;

  const result: WishlistRestockResult = { notified: 0, reset: 0 };

  if (!isWcConfigured()) {
    logger.info("Scheduler: no WC credentials — skipping wishlist restock check");
    return result;
  }

  const demandThreshold = await getRestockDemandThreshold(deps.demandThreshold);
  const inventoryUrl = deps.inventoryUrl ?? projectHubInventoryUrl();

  // Distinct product IDs from the wishlist
  const rows = await db
    .select({ productId: ucWishlistTable.productId })
    .from(ucWishlistTable);

  const productIds = [...new Set(rows.map((r) => r.productId))];

  // A product with no remaining wishlist rows is below every valid threshold;
  // clear any old cycle state so a future waiting list can cross again.
  await db.delete(ucRestockDemandAlertsTable).where(
    sql`NOT EXISTS (
      SELECT 1
      FROM ${ucWishlistTable}
      WHERE ${ucWishlistTable.productId} = ${ucRestockDemandAlertsTable.productId}
    )`,
  );
  if (productIds.length === 0) {
    logger.info("Scheduler: wishlist is empty — skipping restock check");
    return result;
  }

  logger.info({ count: productIds.length }, "Scheduler: checking wishlist products for restocks");

  for (const productId of productIds) {
    try {
      const stockStatus = await fetchStockStatus(productId);
      if (stockStatus === null) continue;

      if (stockStatus === "instock") {
        // Find wishlist rows for this product that have NOT been notified yet
        const pending = await db
          .select({
            id:          ucWishlistTable.id,
            userId:      ucWishlistTable.userId,
            productName: ucWishlistTable.productName,
          })
          .from(ucWishlistTable)
          .where(
            and(
              eq(ucWishlistTable.productId,        productId),
              isNull(ucWishlistTable.notifiedRestockAt),
            )
          );

        if (pending.length > 0) {
          const productName = pending[0]!.productName;
          logger.info(
            { productId, productName, userCount: pending.length },
            "Scheduler: product back in stock — notifying wishlist users",
          );

          // Fire push notifications (fire-and-forget per user)
          for (const row of pending) {
            sendPush(
              row.userId,
              "Back in Stock! 🎉",
              `${row.productName} is now available. Tap to order before it sells out.`,
              { screen: "product", productId },
              "general",
            );
          }

          // Stamp the notification time so we don't fire again until next out-of-stock cycle
          await db
            .update(ucWishlistTable)
            .set({ notifiedRestockAt: new Date() })
            .where(
              and(
                eq(ucWishlistTable.productId,        productId),
                isNull(ucWishlistTable.notifiedRestockAt),
              )
            );

          result.notified += pending.length;

          logger.info(
            { productId, notifiedCount: pending.length },
            "Scheduler: wishlist restock notifications sent",
          );
        }

        // Restocking ends the current demand surge, even though wishlist rows
        // remain so the inventory page can show the historical notification cycle.
        const demandResult = await checkRestockDemandForProduct({
          productId,
          stockStatus,
          deps: {
            threshold: demandThreshold,
            sendEmail,
            getAlertEmail: getTeamAlertEmail,
            inventoryUrl,
            beforeRearmTransition: deps.beforeDemandRearmTransition,
          },
        });
        if (demandResult === "reset") {
          logger.info({ productId }, "Scheduler: restock demand alert re-armed after restock");
        }
      } else {
        // Product is out of stock again — reset so users get notified on the NEXT restock
        const resetRows = await db
          .update(ucWishlistTable)
          .set({ notifiedRestockAt: null })
          .where(
            and(
              eq(ucWishlistTable.productId, productId),
              isNotNull(ucWishlistTable.notifiedRestockAt),
            )
          )
          .returning({ id: ucWishlistTable.id });

        result.reset += resetRows.length;

        const demandResult = await checkRestockDemandForProduct({
          productId,
          stockStatus,
          deps: {
            threshold: demandThreshold,
            sendEmail,
            getAlertEmail: getTeamAlertEmail,
            inventoryUrl,
            beforeRearmTransition: deps.beforeDemandRearmTransition,
          },
        });
        if (demandResult === "alerted") {
          logger.info(
            { productId, waitingCustomerCount: (await db
              .select({ id: ucWishlistTable.id })
              .from(ucWishlistTable)
              .where(eq(ucWishlistTable.productId, productId))).length },
            "Scheduler: restock-demand alert email sent",
          );
        } else if (demandResult === "failed") {
          logger.warn(
            { productId },
            "Scheduler: restock-demand alert email failed — will retry on next check",
          );
        }
      }
    } catch (err) {
      logger.warn({ err, productId }, "Scheduler: restock check for product failed (non-fatal)");
    }
  }

  return result;
}

export function startScheduler() {
  cron.schedule("0 9 * * *", async () => {
    try {
      await runLocationReviewReminders({
        sendAlert: (alert) => deliverReviewAlert(
          alert,
          async (message) => sendViaResend({
            from: "Ultra Clear App <noreply@contacts.ucfilters.com>",
            to: await getTeamAlertEmail(),
            subject: message.subject,
            text: message.text,
            meta: { template: message.template },
            signal: AbortSignal.timeout(30_000),
          }),
          async (message) => {
            const phone = await getTeamAlertPhone();
            return phone ? sendSmsAwaitable(phone, message.sms, { template: message.template }, AbortSignal.timeout(30_000)) : false;
          },
        ),
      });
    } catch (err) {
      logger.error({ err }, "Scheduler: water point field-review reminder failed");
    }
  }, { timezone: "Africa/Nairobi" });
  logger.info("Scheduler: daily water point field-review reminders registered (09:00 Africa/Nairobi)");
  let checkoutCleanupRunning = false;
  cron.schedule("17 * * * *", async () => {
    if (checkoutCleanupRunning) return;
    checkoutCleanupRunning = true;
    try {
      const result = await reconcileAbandonedCheckouts();
      logger.info(result, "Scheduler: abandoned checkouts reconciled");
    } catch (err) {
      logger.error({ err }, "Scheduler: abandoned checkout reconciliation failed");
    } finally {
      checkoutCleanupRunning = false;
    }
  }, { timezone: "UTC" });
  logger.info("Scheduler: abandoned checkout reconciliation registered (hourly; 24-hour candidate age, provider-confirmed release only)");
  void resumeQueuedBlogRuns()
    .then((resumed) => {
      if (resumed) logger.info({ resumed }, "Scheduler: resuming queued Companion editorial runs");
    })
    .catch((err) => logger.error({ err }, "Scheduler: failed to resume Companion editorial runs"));
  cron.schedule("*/5 * * * *", async () => {
    try {
      const resumed = await resumeQueuedBlogRuns();
      if (resumed) logger.info({ resumed }, "Scheduler: resumed pending Companion editorial runs");
    } catch (err) {
      logger.error({ err }, "Scheduler: failed to recover Companion editorial runs");
    }
  }, { timezone: "UTC" });
  cron.schedule("0 9 * * 1", async () => {
    try {
      const queued = await queueBlogRun("weekly", weeklyBlogRunKey(), null);
      if (queued.created) logger.info({ runId: queued.run.id }, "Scheduler: weekly Companion editorial run queued");
    } catch (err) {
      logger.error({ err }, "Scheduler: weekly Companion editorial run could not be queued");
    }
  }, { timezone: "UTC" });
  logger.info("Scheduler: weekly Companion editorial run registered (Monday 09:00 UTC)");
  cron.schedule("* * * * *", async () => {
    try {
      const processed = await processLeadDeliveryOutbox();
      if (processed > 0) logger.info({ processed }, "Scheduler: lead delivery outbox processed");
    } catch (err) {
      logger.error({ err }, "Scheduler: lead delivery outbox run failed");
    }
  }, { timezone: "UTC" });
  logger.info("Scheduler: lead delivery outbox job registered (every minute)");
  // Deliver customer order-status outbox rows.  The transition transaction
  // never calls Expo, so provider outages cannot block webhook acknowledgements.
  cron.schedule("*/2 * * * *", async () => {
    try {
      const result = await processOrderNotificationOutbox();
      if (result.processed > 0) logger.info(result, "Scheduler: order notification outbox processed");
    } catch (err) {
      logger.error({ err }, "Scheduler: order notification outbox run failed");
    }
  }, { timezone: "UTC" });
  logger.info("Scheduler: order notification outbox job registered (every 2 minutes)");

  cron.schedule("*/10 * * * *", async () => {
    try {
      const result = await reconcileWooOrderStatuses();
      if (result.checked > 0) logger.info(result, "Scheduler: Woo order status reconciliation complete");
    } catch (err) {
      logger.error({ err }, "Scheduler: Woo order status reconciliation failed");
    }
  }, { timezone: "UTC" });
  logger.info("Scheduler: Woo order status reconciliation registered (every 10 minutes)");

  cron.schedule("*/5 * * * *", async () => {
    try {
      await retryReferralSettlements();
      await processReferralSettlementAlerts();
    } catch (err) {
      logger.error({ err }, "Scheduler: referral settlement retry/alert run failed");
    }
  });
  logger.info("Scheduler: referral settlement retry/alert job registered (every 5 minutes)");
  // Every 4 hours: check wishlisted out-of-stock products for restocks.
  cron.schedule("0 */4 * * *", async () => {
    logger.info("Scheduler: running wishlist restock check");
    try {
      await checkWishlistRestocks();
    } catch (err) {
      logger.error({ err }, "Scheduler: wishlist restock check failed");
    }
  }, { timezone: "UTC" });

  logger.info("Scheduler: wishlist restock and demand alert check registered (every 4 hours)");

  // Daily at 07:30 UTC (10:30 Nairobi) — deliver filter lifecycle reminders
  // via email / SMS / WhatsApp to customers who opted in.
  cron.schedule("30 7 * * *", async () => {
    logger.info("Scheduler: dispatching filter reminders (external channels)");
    try {
      await dispatchFilterReminders();
    } catch (err) {
      logger.error({ err }, "Scheduler: filter reminder dispatch failed");
    }
  });

  // Daily at 07:35 UTC — credit filter-replacement rewards for ALL customers
  // with active tracked filters, independent of notification channel preferences.
  // Runs 5 minutes after the notification dispatch so the stage claim has
  // settled, but uses the refId unique index for its own idempotency guarantee.
  cron.schedule("35 7 * * *", async () => {
    logger.info("Scheduler: crediting filter-replacement rewards (all customers)");
    try {
      const result = await creditReplacementRewardsAll();
      logger.info(result, "Scheduler: filter-replacement rewards run complete");
    } catch (err) {
      logger.error({ err }, "Scheduler: filter-replacement rewards run failed");
    }
  });

  // Daily at 08:00 UTC — generate a fresh report and push to the orchestrator.
  // The report is persisted (ai_reports) and the push recorded in the durable
  // push history (ai_push_events) exactly like a manual "Push to Orchestrator",
  // so scheduled pushes appear on the AI Monitor board too.
  cron.schedule("0 8 * * *", async () => {
    logger.info("Scheduler: generating daily AI project report");
    try {
      const report = await generateAndStoreReport();
      logger.info("Scheduler: daily report generated successfully");

      const outcome = await pushReportToOrchestrator({
        report,
        trigger: "scheduled",
        payloadType: "daily_project_status_report",
      });

      if (outcome.success) {
        logger.info(
          { pushId: outcome.pushId, message: outcome.message },
          "Scheduler: daily report push recorded",
        );
      } else {
        logger.error(
          { pushId: outcome.pushId, message: outcome.message },
          "Scheduler: orchestrator webhook push failed",
        );
      }
    } catch (err) {
      logger.error({ err }, "Scheduler: failed to generate or push report");
    }
  }, { timezone: "UTC" });

  logger.info("Scheduler: daily AI report job registered (08:00 UTC)");

  // ─── Daily 01:00 UTC: prune old AI push-event rows ───────────────────────
  // Keeps the ai_push_events table bounded.  All rows (regardless of status)
  // older than UC_PUSH_EVENTS_RETENTION_DAYS (default 90) are deleted.
  // Terminal-status rows (completed / failed) age out with the rest; the most
  // recent rows always survive because they fall inside the retention window.
  cron.schedule("0 1 * * *", async () => {
    try {
      await runAiPushEventsPruning();
    } catch (err) {
      logger.error({ err }, "Scheduler: AI push-events pruning failed");
    }
  }, { timezone: "UTC" });

  logger.info(
    "Scheduler: daily AI push-events pruning job registered (01:00 UTC, default 90-day retention)",
  );

  // ─── Daily 02:00 UTC: prune old feedback rows ─────────────────────────────
  // Retention window is configurable via UC_FEEDBACK_RETENTION_DAYS (default 90).
  // Runs at 02:00 UTC to avoid peak hours.
  cron.schedule("0 2 * * *", async () => {
    const retentionDays = Math.max(
      1,
      parseInt(process.env["UC_FEEDBACK_RETENTION_DAYS"] ?? "90", 10) || 90,
    );
    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
    logger.info({ retentionDays, cutoff }, "Scheduler: pruning old AI feedback rows");
    try {
      const deleted = await db
        .delete(ucAiFeedbackTable)
        .where(lt(ucAiFeedbackTable.createdAt, cutoff));
      logger.info({ deleted }, "Scheduler: AI feedback pruning complete");
    } catch (err) {
      logger.error({ err }, "Scheduler: AI feedback pruning failed");
    }
  }, { timezone: "UTC" });

  logger.info(
    "Scheduler: daily AI feedback pruning job registered (02:00 UTC, default 90-day retention)",
  );

  cron.schedule("30 2 * * *", async () => {
    try {
      await pruneAlisonChats();
    } catch (err) {
      logger.error({ err }, "Scheduler: Alison transcript pruning failed");
    }
  }, { timezone: "UTC" });
  logger.info("Scheduler: daily Alison transcript pruning registered (02:30 UTC, 30-day retention)");

  // ─── Daily 03:00 UTC: prune old notification log rows ────────────────────
  // Successful sends are pruned after UC_NOTIFICATION_LOG_SUCCESS_RETENTION_DAYS
  // (default 30).  Failed rows are kept longer — UC_NOTIFICATION_LOG_FAILURE_RETENTION_DAYS
  // (default 90) — so the team has time to investigate and retry.
  // Both values can be overridden from team_settings (admin panel) without a restart.
  cron.schedule("0 3 * * *", async () => {
    try {
      await runNotificationLogPruning();
    } catch (err) {
      logger.error({ err }, "Scheduler: notification log pruning failed");
    }
  }, { timezone: "UTC" });

  logger.info(
    "Scheduler: daily notification log pruning job registered (03:00 UTC, sent=30d / failed=90d default retention)",
  );

  // ─── Daily 06:00 UTC: sync contacts from Google Sheets ───────────────────
  // Reads the most-recently-configured sheet_syncs row and applies creates/updates
  // to the contacts table. Skips silently if no sheet is connected.
  // On failure: records the error in sheet_syncs and emails all team members.
  cron.schedule("0 6 * * *", () => runDailyContactsSync(), { timezone: "UTC" });

  logger.info("Scheduler: daily Google Sheets contacts sync registered (06:00 UTC)");

  // ─── Daily 07:00 UTC: remind team of stale webhook-recovery orders ────────
  // Finds webhook_recovery orders (M-Pesa or Paystack) whose status is still
  // "processing" or "pending" (i.e. not shipped/completed/cancelled) and that
  // were created more than 24 h ago.  Sends a single digest email + SMS to the
  // team so the team is alerted even if the original creation alert was missed
  // because Resend was temporarily down.
  //
  // TEAM_ALERT_PHONE — E.164 or Kenyan local format; SMS skipped when absent.
  cron.schedule("0 7 * * *", async () => {
    await runStaleRecoveryOrderDigest();
  }, { timezone: "UTC" });

  logger.info("Scheduler: stale recovery order digest job registered (07:00 UTC)");

  // ─── Daily 04:30 UTC: low-stock and out-of-stock email alerts ────────────
  // Checks every published WooCommerce product against the configured
  // low_stock_threshold (default 5 units). Sends one email listing all
  // products at or below the threshold, split into out-of-stock vs low-stock.
  // Skips silently when WooCommerce credentials are absent.
  cron.schedule("30 4 * * *", async () => {
    await runLowStockAlert();
  }, { timezone: "UTC" });

  logger.info("Scheduler: daily low-stock alert job registered (04:30 UTC)");

  // ─── Daily 05:00 UTC: audit live products for missing lifespan meta ───────
  // Runs the same audit as GET /api/uc/admin/products/lifespan-audit and
  // emails the team about newly flagged products. Each product is alerted
  // only once (tracked in uc_lifespan_alerts) so the team is not spammed
  // daily about the same gap. Skips silently when WooCommerce credentials
  // are absent (nothing live to audit).
  cron.schedule("0 5 * * *", async () => {
    await runLifespanAuditAlert();
  }, { timezone: "UTC" });

  logger.info("Scheduler: daily product lifespan audit job registered (05:00 UTC)");
}

/**
 * Check all published WooCommerce products for low / zero stock and email
 * the team when any product is at or below the configured threshold.
 *
 * - Reads `low_stock_threshold` from team_settings (default 5).
 * - Skips silently when WooCommerce credentials are absent.
 * - Aborts when the store is unreachable (partial catalogue must never send
 *   a misleadingly short list).
 * - Excludes products successfully emailed within the preceding 24 hours.
 * - Records included products only after the email provider accepts the digest.
 *
 * @internal — exported for the scheduler cron job and inventory PATCH handler.
 */
export async function runLowStockAlert(
  deps: LowStockAlertDependencies = {},
): Promise<LowStockAlertResult> {
  if (!(deps.isWcConfigured ?? hasWCCredentials)()) {
    logger.info("Scheduler: WooCommerce credentials absent — skipping low-stock alert");
    return { outOfStock: 0, lowStock: 0, emailed: false };
  }

  return db.transaction(async (tx) => {
    // Transaction-owned lock: shared by every server instance, released on
    // commit, rollback, or disconnect. Never expire a claim during delivery.
    // Non-blocking acquisition keeps overlapping cron runs from queueing.
    const claim = await tx.execute<{ claimed: boolean }>(sql`
      SELECT pg_try_advisory_xact_lock(hashtextextended('uc-low-stock-digest', 0)) AS claimed
    `);
    if (!claim.rows[0]?.claimed) {
      logger.info("Low-stock alert: another instance is already running — skipping");
      return { outOfStock: 0, lowStock: 0, emailed: false };
    }
    return runClaimedLowStockAlert(deps, tx);
  });
}

type LowStockAlertResult = { outOfStock: number; lowStock: number; emailed: boolean };

type LowStockAlertDependencies = {
    fetchProducts?: typeof fetchAllPublishedProducts;
    sendEmail?: typeof sendViaResend;
    /** Test seam: avoid reading process-wide Woo credentials. */
    isWcConfigured?: () => boolean;
    /** Test seam: avoid reading the shared settings row. */
    threshold?: number;
    /** When true, returns immediately without sending if nothing is flagged. */
    skipIfEmpty?: boolean;
    /** Test seam: return product IDs successfully alerted since the cutoff. */
    getRecentlyAlertedProductIds?: (productIds: number[], cutoff: Date) => Promise<Set<number>>;
    /** Test seam: record successful alert timestamps for included products. */
    recordAlertedProductIds?: (productIds: number[], alertedAt: Date) => Promise<void>;
    /** Test seam: deterministic 24-hour cutoff and recorded timestamp. */
    now?: Date;
};

async function runClaimedLowStockAlert(
  deps: LowStockAlertDependencies,
  historyDb: Pick<typeof db, "select" | "insert">,
): Promise<LowStockAlertResult> {
  const fetchProducts = deps.fetchProducts ?? fetchAllPublishedProducts;
  const sendEmail     = deps.sendEmail     ?? sendViaResend;
  const skipIfEmpty   = deps.skipIfEmpty   ?? true;
  const checkTime = deps.now ?? new Date();
  const getRecentlyAlertedProductIds = deps.getRecentlyAlertedProductIds ?? (async (productIds, cutoff) => {
    if (productIds.length === 0) return new Set<number>();
    const rows = await historyDb
      .select({ productId: ucLowStockAlertsTable.productId })
      .from(ucLowStockAlertsTable)
      .where(and(
        inArray(ucLowStockAlertsTable.productId, productIds),
        gt(ucLowStockAlertsTable.alertedAt, cutoff),
      ));
    return new Set(rows.map((row) => row.productId));
  });
  const recordAlertedProductIds = deps.recordAlertedProductIds ?? (async (productIds, alertedAt) => {
    if (productIds.length === 0) return;
    await historyDb
      .insert(ucLowStockAlertsTable)
      .values(productIds.map((productId) => ({ productId, alertedAt })))
      .onConflictDoUpdate({
        target: ucLowStockAlertsTable.productId,
        set: {
          alertedAt: sql`GREATEST(${ucLowStockAlertsTable.alertedAt}, ${alertedAt})`,
        },
      });
  });

  // Read threshold from DB (admin-configurable), fall back to default of 5.
  let threshold = deps.threshold ?? 5;
  if (deps.threshold === undefined) {
    try {
      const [row] = await db
        .select({ lowStockThreshold: teamSettingsTable.lowStockThreshold })
        .from(teamSettingsTable)
        .where(eq(teamSettingsTable.id, "singleton"))
        .limit(1);
      if (row?.lowStockThreshold != null) threshold = row.lowStockThreshold;
    } catch (err) {
      logger.warn({ err }, "Low-stock alert: could not read threshold from DB — using default (5)");
    }
  }

  logger.info({ threshold }, "Scheduler: running low-stock / out-of-stock alert check");

  let products: Awaited<ReturnType<typeof fetchAllPublishedProducts>>;
  try {
    products = await fetchProducts();
  } catch (err) {
    logger.error({ err }, "Low-stock alert: fetchProducts threw — aborting");
    return { outOfStock: 0, lowStock: 0, emailed: false };
  }

  if (products === null) {
    logger.error("Low-stock alert: could not reach WooCommerce store — aborting");
    return { outOfStock: 0, lowStock: 0, emailed: false };
  }

  type StockItem = {
    id: number;
    name: string;
    sku: string;
    /** null means WooCommerce explicitly marked an unmanaged product out of stock. */
    qty: number | null;
    permalink: string | null;
  };
  const outOfStockItems: StockItem[] = [];
  const lowStockItems:   StockItem[] = [];

  for (const raw of products) {
    const p = normalizeProduct(raw);
    const rawQty = p["stockQuantity"];
    const qty = typeof rawQty === "number" && Number.isFinite(rawQty) ? rawQty : null;
    const status = String(p["stockStatus"] ?? "").toLowerCase();

    // WooCommerce represents products that do not use stock management with
    // stock_quantity: null. Do not invent a quantity of zero for those products.
    // An explicit outofstock status remains actionable even without a quantity.
    const explicitlyOutOfStock = status === "outofstock";
    if (!explicitlyOutOfStock && (qty === null || qty > threshold)) continue;

    const item: StockItem = {
      id:        Number(p["id"]),
      name:      String(p["name"] ?? ""),
      sku:       String(p["sku"]  ?? ""),
      qty,
      permalink: typeof p["permalink"] === "string" ? p["permalink"] : null,
    };
    if (explicitlyOutOfStock || qty === 0) outOfStockItems.push(item);
    else           lowStockItems.push(item);
  }

  const flaggedIds = [...outOfStockItems, ...lowStockItems].map((item) => item.id);
  if (flaggedIds.length > 0) {
    const cutoff = new Date(checkTime.getTime() - 24 * 60 * 60 * 1000);
    try {
      const recentIds = await getRecentlyAlertedProductIds(flaggedIds, cutoff);
      if (recentIds.size > 0) {
        const keepUnalerted = (item: StockItem) => !recentIds.has(item.id);
        const skipped = outOfStockItems.length + lowStockItems.length;
        const filteredOutOfStock = outOfStockItems.filter(keepUnalerted);
        const filteredLowStock = lowStockItems.filter(keepUnalerted);
        outOfStockItems.splice(0, outOfStockItems.length, ...filteredOutOfStock);
        lowStockItems.splice(0, lowStockItems.length, ...filteredLowStock);
        logger.info(
          { skipped: skipped - filteredOutOfStock.length - filteredLowStock.length },
          "Low-stock alert: skipped products alerted within the last 24 hours",
        );
      }
    } catch (err) {
      logger.error({ err }, "Low-stock alert: could not read alert history — aborting");
      return { outOfStock: 0, lowStock: 0, emailed: false };
    }
  }

  if (outOfStockItems.length === 0 && lowStockItems.length === 0) {
    if (skipIfEmpty) {
      logger.info("Low-stock alert: all products above threshold — no email");
      return { outOfStock: 0, lowStock: 0, emailed: false };
    }
  }

  // Build WooCommerce admin edit URL for each product
  function wcEditUrl(item: StockItem): string {
    if (item.permalink) {
      try {
        return `${new URL(item.permalink).origin}/wp-admin/post.php?post=${item.id}&action=edit`;
      } catch { /* fall through */ }
    }
    return `https://www.ucfilters.com/wp-admin/post.php?post=${item.id}&action=edit`;
  }

  const formatItem = (item: StockItem) =>
    `  • ${item.name}${item.sku ? ` (SKU ${item.sku})` : ""} — ` +
    `${item.qty === null ? "status: out of stock (quantity not managed)" : `qty: ${item.qty}`} | ${wcEditUrl(item)}`;

  const sections: string[] = [];

  if (outOfStockItems.length > 0) {
    sections.push(
      `OUT OF STOCK (${outOfStockItems.length} product${outOfStockItems.length !== 1 ? "s" : ""}):`,
      ...outOfStockItems.map(formatItem),
    );
  }

  if (lowStockItems.length > 0) {
    if (sections.length > 0) sections.push("");
    sections.push(
      `LOW STOCK — ${threshold} units or fewer (${lowStockItems.length} product${lowStockItems.length !== 1 ? "s" : ""}):`,
      ...lowStockItems.map(formatItem),
    );
  }

  const totalFlagged = outOfStockItems.length + lowStockItems.length;
  const emailBody = [
    `${totalFlagged} product${totalFlagged !== 1 ? "s" : ""} need${totalFlagged === 1 ? "s" : ""} restocking (threshold: ≤ ${threshold} units).`,
    "",
    ...sections,
    "",
    "Restock each product in WooCommerce using the links above.",
    "You can adjust the alert threshold from ProjectHub → Admin → Inventory → Settings.",
  ].join("\n");

  const subjectParts: string[] = [];
  if (outOfStockItems.length > 0) subjectParts.push(`${outOfStockItems.length} out of stock`);
  if (lowStockItems.length   > 0) subjectParts.push(`${lowStockItems.length} low stock`);
  const subject = `📦 Stock alert: ${subjectParts.join(", ")}`;

  const emailOk = await sendEmail({
    from:    "Ultra Clear App <noreply@contacts.ucfilters.com>",
    to:      "info@ucfilters.com",
    subject,
    text:    emailBody,
    meta:    { template: "low_stock_alert" },
    signal:  AbortSignal.timeout(30_000),
  });

  if (emailOk) {
    const alertedProductIds = [...outOfStockItems, ...lowStockItems].map((item) => item.id);
    const alertedAt = deps.now ?? new Date();
    try {
      await recordAlertedProductIds(alertedProductIds, alertedAt);
    } catch (err) {
      logger.error({ err, alertedProductIds }, "Low-stock alert: email sent but alert history could not be recorded");
    }
    logger.info(
      { outOfStock: outOfStockItems.length, lowStock: lowStockItems.length, threshold },
      "Scheduler: low-stock alert email sent",
    );
  } else {
    logger.warn("Scheduler: low-stock alert email failed — will retry on next scheduled run");
  }

  return { outOfStock: outOfStockItems.length, lowStock: lowStockItems.length, emailed: emailOk };
}

/**
 * Audit live WooCommerce products for a missing `filter_lifespan_days` meta
 * and email the team about any products not previously alerted.
 *
 * - Skips silently when WooCommerce credentials are absent.
 * - Aborts loudly (log only) when the store is unreachable — a partial
 *   catalogue must never mark products as "alerted" or send a wrong list.
 * - Alerted product IDs are recorded in uc_lifespan_alerts ONLY after the
 *   email is accepted by Resend, so a failed send is retried next run.
 *
 * @internal — exported for tests; called by the daily 05:00 UTC cron job.
 */
export async function runLifespanAuditAlert(
  deps: {
    fetchProducts?: typeof fetchAllPublishedProducts;
    sendEmail?: typeof sendViaResend;
  } = {},
): Promise<{ flagged: number; newlyAlerted: number; emailed: boolean }> {
  const fetchProducts = deps.fetchProducts ?? fetchAllPublishedProducts;
  const sendEmail = deps.sendEmail ?? sendViaResend;

  if (!hasWCCredentials()) {
    logger.info("Scheduler: WooCommerce credentials absent — skipping lifespan audit");
    return { flagged: 0, newlyAlerted: 0, emailed: false };
  }

  logger.info("Scheduler: running daily product lifespan audit");
  try {
    const products = await fetchProducts();
    if (products === null) {
      logger.error("Scheduler: could not reach WooCommerce store — lifespan audit aborted");
      return { flagged: 0, newlyAlerted: 0, emailed: false };
    }

    const missing = auditProductLifespans(products.map(normalizeProduct)).map((p) => ({
      id: Number(p["id"]),
      name: String(p["name"] ?? ""),
      sku: String(p["sku"] ?? ""),
      categories: Array.isArray(p["categories"])
        ? (p["categories"] as { name?: string }[]).map((c) => c?.name ?? "").filter(Boolean)
        : [],
    }));

    // Resolve products that previously alerted but now HAVE a lifespan: mark
    // their dedupe rows resolved (keeping alert history) so a later regression
    // (meta removed again) re-alerts — flagged as a repeat offender.
    const missingIdSet = new Set(missing.map((p) => p.id));
    const resolvedIds = products
      .map((p) => Number((p as Record<string, unknown>)["id"]))
      .filter((id) => Number.isFinite(id) && !missingIdSet.has(id));
    if (resolvedIds.length > 0) {
      const resolved = await db
        .update(ucLifespanAlertsTable)
        .set({ resolvedAt: new Date() })
        .where(
          and(
            inArray(ucLifespanAlertsTable.productId, resolvedIds),
            isNull(ucLifespanAlertsTable.resolvedAt),
          ),
        )
        .returning({ productId: ucLifespanAlertsTable.productId });
      if (resolved.length > 0) {
        logger.info(
          { resolved: resolved.map((r) => r.productId) },
          "Scheduler: lifespan audit — previously alerted products now trackable, dedupe rows marked resolved",
        );
      }
    }

    if (missing.length === 0) {
      logger.info("Scheduler: lifespan audit clean — all live products trackable");
      return { flagged: 0, newlyAlerted: 0, emailed: false };
    }

    // Filter out products we have already emailed about. A row with
    // resolvedAt set means the product was fixed and has now regressed — it
    // must be re-alerted, flagged as a repeat offender with its prior count.
    const flaggedIds = missing.map((p) => p.id);
    const alreadyAlerted = await db
      .select({
        productId:  ucLifespanAlertsTable.productId,
        alertCount: ucLifespanAlertsTable.alertCount,
        resolvedAt: ucLifespanAlertsTable.resolvedAt,
      })
      .from(ucLifespanAlertsTable)
      .where(inArray(ucLifespanAlertsTable.productId, flaggedIds));
    const activeAlertSet = new Set(
      alreadyAlerted.filter((r) => r.resolvedAt === null).map((r) => r.productId),
    );
    const priorCounts = new Map(
      alreadyAlerted.filter((r) => r.resolvedAt !== null).map((r) => [r.productId, r.alertCount]),
    );
    const fresh = missing.filter((p) => !activeAlertSet.has(p.id));

    if (fresh.length === 0) {
      logger.info(
        { flagged: missing.length },
        "Scheduler: lifespan audit — all flagged products already alerted, no email",
      );
      return { flagged: missing.length, newlyAlerted: 0, emailed: false };
    }

    const lines = fresh.map((p) => {
      const prior = priorCounts.get(p.id);
      const repeatNote =
        prior !== undefined
          ? ` (regressed — alerted ${prior} time${prior > 1 ? "s" : ""} before)`
          : "";
      return `  • ${p.name}${p.sku ? ` (SKU ${p.sku})` : ""} — ID ${p.id}${p.categories.length ? ` | ${p.categories.join(", ")}` : ""}${repeatNote}`;
    });

    const emailBody = [
      `${fresh.length} new store product${fresh.length > 1 ? "s are" : " is"} missing the replacement-reminder setting (filter_lifespan_days).`,
      "Customers who buy these products will NOT get filter replacement reminders in the app.",
      "",
      "Products needing attention:",
      ...lines,
      "",
      "How to fix each product:",
      "  1. Open the product in the WooCommerce admin.",
      "  2. Add a custom field named filter_lifespan_days with the filter's lifespan in days.",
      "  3. The product disappears from this audit automatically.",
      "",
      "The full audit is also visible on the ProjectHub dashboard (admin only).",
      "You will not be emailed again about these products unless one is fixed and later regresses.",
    ].join("\n");

    const emailOk = await sendEmail({
      from:    "Ultra Clear App <noreply@contacts.ucfilters.com>",
      to:      "info@ucfilters.com",
      subject: `⚠️ ${fresh.length} store product${fresh.length > 1 ? "s" : ""} missing replacement-reminder setting`,
      text:    emailBody,
      meta:    { template: "lifespan_audit_alert" },
    });

    if (!emailOk) {
      // Do NOT record the products as alerted — next run will retry the email.
      logger.warn(
        { count: fresh.length },
        "Scheduler: lifespan audit email failed — will retry on next run",
      );
      return { flagged: missing.length, newlyAlerted: 0, emailed: false };
    }

    // Record only after a successful send so failures are retried. A conflict
    // means the product had a resolved row (regression): bump its alertCount
    // and clear resolvedAt so dedupe applies again while history is kept.
    await db
      .insert(ucLifespanAlertsTable)
      .values(fresh.map((p) => ({ productId: p.id, name: p.name, sku: p.sku })))
      .onConflictDoUpdate({
        target: ucLifespanAlertsTable.productId,
        set: {
          alertCount: sql`${ucLifespanAlertsTable.alertCount} + 1`,
          resolvedAt: null,
          alertedAt:  new Date(),
          name:       sql`excluded.name`,
          sku:        sql`excluded.sku`,
        },
      });

    logger.info(
      { flagged: missing.length, newlyAlerted: fresh.length },
      "Scheduler: lifespan audit alert email sent",
    );
    return { flagged: missing.length, newlyAlerted: fresh.length, emailed: true };
  } catch (err) {
    logger.error({ err }, "Scheduler: product lifespan audit job failed");
    return { flagged: 0, newlyAlerted: 0, emailed: false };
  }
}

/**
 * Delete notification log rows that have exceeded the configured retention window.
 *
 * Retention resolution order (per window):
 *   1. team_settings override set from the admin panel (no restart needed)
 *   2. environment variable —
 *        UC_NOTIFICATION_LOG_SUCCESS_RETENTION_DAYS  (rows with status='sent')
 *        UC_NOTIFICATION_LOG_FAILURE_RETENTION_DAYS  (rows with status='failed')
 *   3. hard defaults: sent=30 days, failed=90 days
 *
 * Failed rows are kept longer so the team has time to investigate and retry.
 * Existing rows are always unaffected until they age past the cutoff.
 * If the team_settings read fails, the function throws without deleting anything.
 *
 * Called by the daily 03:00 UTC cron job and by the admin
 * POST /api/uc/admin/notification-logs/prune endpoint ("Prune now").
 */
/**
 * Parse an env-var retention value strictly.
 *
 * Accepts only plain positive integers expressed as a bare decimal string
 * (e.g. "30", "90", "7").  Rejects — and falls back to `defaultDays` for:
 *   • non-numeric strings  ("banana")
 *   • values with suffixes ("7days")
 *   • scientific notation  ("1e3")   — parseInt would accept these
 *   • zero or below        ("0", "-5")
 *
 * This prevents accidental premature deletion of audit rows when a team member
 * sets a typo like "7days" in their deployment environment.
 */
function parseRetentionDays(raw: string | undefined, defaultDays: number): number {
  if (!raw) return defaultDays;
  const trimmed = raw.trim();
  // Only allow a non-empty string of ASCII digits (no sign, no dot, no exponent)
  if (!/^\d+$/.test(trimmed)) return defaultDays;
  const n = Number(trimmed);
  if (!Number.isInteger(n) || n < 1) return defaultDays;
  return n;
}

export interface NotificationLogPruningDeps {
  /**
   * Optional seams keep retention policy tests independent of the shared
   * team_settings singleton and process environment.
   */
  readRetentionSettings?: () => Promise<{
    successDays: number | null;
    failureDays: number | null;
  }>;
  deleteLogs?: (
    status: "sent" | "failed",
    cutoff: Date,
  ) => Promise<{ rowCount?: number }>;
  countLogs?: (
    status: "sent" | "failed",
    cutoff: Date,
  ) => Promise<number>;
  environment?: Readonly<Record<string, string | undefined>>;
  now?: () => Date;
}

async function resolveNotificationLogRetentionCutoffs(
  deps: NotificationLogPruningDeps = {},
): Promise<{
  successDays: number;
  failureDays: number;
  successCutoff: Date;
  failureCutoff: Date;
}> {
  // Read retention windows from team_settings (admin panel), falling back to
  // env vars or hard defaults only when the DB row has no override.
  // If the settings read fails, abort pruning entirely — better to keep logs
  // than to delete them with a potentially wrong retention window.
  const readRetentionSettings = deps.readRetentionSettings ?? (async () => {
    const [settingsRow] = await db
      .select({
        successDays: teamSettingsTable.notificationLogSuccessRetentionDays,
        failureDays: teamSettingsTable.notificationLogFailureRetentionDays,
      })
      .from(teamSettingsTable)
      .where(eq(teamSettingsTable.id, "singleton"))
      .limit(1);
    return {
      successDays: settingsRow?.successDays ?? null,
      failureDays: settingsRow?.failureDays ?? null,
    };
  });
  let settingsSuccess: number | null;
  let settingsFailure: number | null;
  try {
    ({ successDays: settingsSuccess, failureDays: settingsFailure } = await readRetentionSettings());
  } catch (err) {
    logger.error(
      { err },
      "Notification log pruning: failed to read retention settings — aborting to avoid data loss",
    );
    throw err;
  }

  const environment = deps.environment ?? process.env;
  const successDays = Math.max(
    1,
    settingsSuccess ??
      parseRetentionDays(environment["UC_NOTIFICATION_LOG_SUCCESS_RETENTION_DAYS"], 30),
  );
  const failureDays = Math.max(
    1,
    settingsFailure ??
      parseRetentionDays(environment["UC_NOTIFICATION_LOG_FAILURE_RETENTION_DAYS"], 90),
  );

  const now = deps.now?.() ?? new Date();
  const successCutoff = new Date(now.getTime() - successDays * 24 * 60 * 60 * 1000);
  const failureCutoff = new Date(now.getTime() - failureDays * 24 * 60 * 60 * 1000);
  return { successDays, failureDays, successCutoff, failureCutoff };
}

export async function getNotificationLogPrunePreview(
  deps: NotificationLogPruningDeps = {},
): Promise<{
  eligibleSuccess: number;
  eligibleFailure: number;
}> {
  const { successCutoff, failureCutoff } = await resolveNotificationLogRetentionCutoffs(deps);
  const countLogs = deps.countLogs ?? (async (status: "sent" | "failed", cutoff: Date) => {
    const [result] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(ucNotificationLogTable)
      .where(
        and(
          eq(ucNotificationLogTable.status, status),
          lt(ucNotificationLogTable.sentAt, cutoff),
        ),
      );
    return result?.count ?? 0;
  });

  const [eligibleSuccess, eligibleFailure] = await Promise.all([
    countLogs("sent", successCutoff),
    countLogs("failed", failureCutoff),
  ]);
  return { eligibleSuccess, eligibleFailure };
}

export async function runNotificationLogPruning(
  deps: NotificationLogPruningDeps = {},
): Promise<{
  deletedSuccess: number;
  deletedFailure: number;
}> {
  const { successDays, failureDays, successCutoff, failureCutoff } =
    await resolveNotificationLogRetentionCutoffs(deps);
  const deleteLogs = deps.deleteLogs ?? (async (status: "sent" | "failed", cutoff: Date) =>
    db
      .delete(ucNotificationLogTable)
      .where(
        and(
          eq(ucNotificationLogTable.status, status),
          lt(ucNotificationLogTable.sentAt, cutoff),
        ),
      ));

  logger.info(
    { successDays, failureDays, successCutoff, failureCutoff },
    "Scheduler: pruning old notification log rows",
  );

  try {
    // Prune successful rows beyond the shorter retention window, then failed
    // rows beyond the longer retention window.
    const successResult = await deleteLogs("sent", successCutoff);
    const failureResult = await deleteLogs("failed", failureCutoff);

    const deletedSuccess = (successResult as { rowCount?: number }).rowCount ?? 0;
    const deletedFailure = (failureResult as { rowCount?: number }).rowCount ?? 0;

    logger.info(
      { deletedSuccess, deletedFailure },
      "Scheduler: notification log pruning complete",
    );

    return { deletedSuccess, deletedFailure };
  } catch (err) {
    logger.error({ err }, "Scheduler: notification log pruning failed");
    throw err;
  }
}
/**
 * Delete ai_push_events rows older than the configured retention window.
 *
 * Retention window resolution order:
 *   1. UC_PUSH_EVENTS_RETENTION_DAYS env var (strict positive-integer only)
 *   2. Hard default: 90 days
 *
 * All rows older than the cutoff are removed regardless of status.
 * Terminal-status rows (completed / failed) age out with the rest; the most
 * recent rows always survive because they fall inside the retention window.
 *
 * Throws on DB errors so the cron wrapper can log them.
 *
 * @internal — exported for tests and the scheduler cron job.
 */
export async function runAiPushEventsPruning(): Promise<{ deleted: number }> {
  const retentionDays = parseRetentionDays(
    process.env["UC_PUSH_EVENTS_RETENTION_DAYS"],
    90,
  );
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

  logger.info(
    { retentionDays, cutoff },
    "Scheduler: pruning old AI push-event rows",
  );

  try {
    const result = await db
      .delete(aiPushEventsTable)
      .where(lt(aiPushEventsTable.sentAt, cutoff));

    const deleted = (result as { rowCount?: number }).rowCount ?? 0;
    logger.info({ deleted }, "Scheduler: AI push-events pruning complete");
    return { deleted };
  } catch (err) {
    logger.error({ err }, "Scheduler: AI push-events pruning failed");
    throw err;
  }
}

export async function pruneAlisonChats(now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const deleted = await db.delete(ucAlisonConversationsTable)
    .where(lt(ucAlisonConversationsTable.createdAt, cutoff))
    .returning({ id: ucAlisonConversationsTable.id });
  return deleted.length;
}

const staleRecoveryDigestClaims = new Set<string>();
/** @internal */
export async function runStaleRecoveryOrderDigest(
  deps: {
    sendEmail?: typeof sendViaResend;
    sendSmsAwaitable?: typeof sendSmsAwaitable;
  } = {},
): Promise<void> {
  const sendEmail       = deps.sendEmail       ?? sendViaResend;
  const _sendSmsAwaitable = deps.sendSmsAwaitable ?? sendSmsAwaitable;

  logger.info("Scheduler: checking for stale webhook-recovery orders");
  try {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const staleCandidates = await db
      .select()
      .from(ucOrdersTable)
      .where(
        and(
          eq(ucOrdersTable.webhookRecovery, true),
          or(
            eq(ucOrdersTable.status, "processing"),
            eq(ucOrdersTable.status, "pending"),
          ),
          lte(ucOrdersTable.dateCreated, cutoff),
        )
      );

    const { claimedIds, claimKeys } = claimStaleRecoveryDigestOrders(
      staleCandidates,
      new Date(),
    );
    const stale = staleCandidates.filter((order) => claimedIds.has(order.id));

    if (stale.length === 0) {
      logger.info("Scheduler: no unalerted stale recovery orders found");
      return;
    }

    logger.warn({ count: stale.length }, "Scheduler: stale recovery orders found — alerting team");

    const lines = stale.map(
      (o) =>
        `  Order #${o.id} | ${o.paymentMethod.toUpperCase()} | KES ${Number(o.total).toLocaleString()} | status=${o.status} | ref=${o.paymentReference || "(none)"} | created=${o.dateCreated.toUTCString()}`
    );

    const emailBody = [
      `${stale.length} webhook-recovery order${stale.length > 1 ? "s" : ""} have been sitting unfulfilled for more than 24 hours.`,
      "These orders were created automatically when a payment arrived but the app had lost connectivity.",
      "Each order needs manual review to confirm the customer's items and delivery address.",
      "",
      "Stale recovery orders:",
      ...lines,
      "",
      "Action required for each order:",
      "  1. Contact the customer (use the phone number stored in the order).",
      "  2. Confirm delivery address and item selection.",
      "  3. Dispatch and mark the order as shipped/completed.",
      "",
      "View all recovery orders in the admin panel — filter by 'Webhook recovery'.",
    ].join("\n");

    const smsBody =
      `UCFilters: ${stale.length} recovery order${stale.length > 1 ? "s" : ""} unfulfilled >24h. ` +
      stale.map((o) => `#${o.id}(${o.paymentMethod})`).join(", ") +
      ". Check admin panel.";

    // Use the same live setting as immediate recovery-order alerts.
    const teamEmail = await getTeamAlertEmail();
    const emailOk = await sendEmail({
      from:    "Ultra Clear App <noreply@contacts.ucfilters.com>",
      to:      teamEmail,
      subject: `⏰ ${stale.length} recovery order${stale.length > 1 ? "s" : ""} still unfulfilled after 24 h`,
      text:    emailBody,
      meta:    { template: "recovery_order_digest" },
    });

    if (emailOk) {
      logger.info({ count: stale.length }, "Scheduler: stale recovery order digest email sent");
    } else {
      logger.warn("Scheduler: digest email failed — will rely on SMS fallback");
    }

    // SMS fallback — awaited so we can detect a both-channels-down scenario.
    // Phone is resolved via getTeamAlertPhone (admin-panel DB value first, env var fallback)
    // so the digest honours the same configuration as single recovery alerts.
    let smsOk = false;
    const teamPhone = await getTeamAlertPhone();
    if (teamPhone) {
      smsOk = await _sendSmsAwaitable(teamPhone, smsBody, { template: "recovery_order_digest" });
      if (smsOk) {
        logger.info("Scheduler: stale recovery order SMS sent");
      } else {
        logger.warn("Scheduler: stale recovery order SMS failed");
      }
    } else {
      logger.info("Scheduler: team alert phone not configured — SMS reminder skipped");
    }

    // ── Both-channels-down guard ──────────────────────────────────────────────
    // When neither email nor SMS reached the team, write a durable failure row
    // to uc_notification_log so the failure is visible in the ProjectHub admin
    // Notification Log page and can be investigated / retried.
    if (!emailOk && !smsOk) {
      for (const key of claimKeys) staleRecoveryDigestClaims.delete(key);

      logger.error(
        { count: stale.length },
        "Scheduler: stale recovery order digest — BOTH email and SMS channels failed; recording durable failure",
      );
      db.insert(ucNotificationLogTable)
        .values({
          channel:      "digest",
          provider:     "none",
          recipient:    teamEmail,
          template:     "recovery_order_digest",
          messageBody:  emailBody,
          status:       "failed",
          errorMessage: "Both email (Resend) and SMS (Africa's Talking) channels failed for the stale recovery-order digest. Manual follow-up required.",
        })
        .catch((err: unknown) => {
          logger.error({ err }, "Scheduler: failed to write both-channels-down log row");
        });
    }
  } catch (err) {
    logger.error({ err }, "Scheduler: stale recovery order digest job failed");
  }
}

/** Daily sync entry point; injectable providers avoid live Google/email calls in tests. */
export async function runDailyContactsSync(deps: {
  getToken?: typeof getValidAccessToken;
  runSync?: typeof runSheetSync;
  notifyFailure?: typeof notifySyncFailure;
} = {}): Promise<void> {
  logger.info("Scheduler: starting daily Google Sheets contacts sync");
  try {
    const [sync] = await db.select().from(sheetSyncsTable)
      .orderBy(desc(sheetSyncsTable.createdAt)).limit(1);
    if (!sync) return;

    const gid = sync.sheetUrl.match(/[#&?]gid=(\d+)/)?.[1];
    let result: Awaited<ReturnType<typeof runSheetSync>>;
    try {
      let accessToken: string | null = null;
      try {
        accessToken = await (deps.getToken ?? getValidAccessToken)();
      } catch (tokenErr) {
        // Do not mask revoked access with an unrelated public-sheet failure.
        if (needsGoogleReconnect(tokenErr)) throw tokenErr;
        logger.warn({ err: tokenErr }, "Scheduler: could not get OAuth token, trying public access");
      }
      result = await (deps.runSync ?? runSheetSync)(sync.sheetUrl, gid, accessToken);
    } catch (syncErr) {
      const errorMessage = syncErr instanceof Error ? syncErr.message : String(syncErr);
      const errorAt = new Date();
      logger.error({ err: syncErr }, "Scheduler: Google Sheets contacts sync failed");
      await db.update(sheetSyncsTable)
        .set({ lastError: errorMessage, lastErrorAt: errorAt })
        .where(eq(sheetSyncsTable.id, sync.id));
      await (deps.notifyFailure ?? notifySyncFailure)({
        sheetLabel: sync.sheetLabel || sync.sheetUrl, errorMessage, errorAt,
      });
      return;
    }

    await db.update(sheetSyncsTable)
      .set({ lastSyncedAt: new Date(), lastError: null, lastErrorAt: null })
      .where(eq(sheetSyncsTable.id, sync.id));
    logger.info(result, "Scheduler: Google Sheets contacts sync complete");
  } catch (err) {
    logger.error({ err }, "Scheduler: Google Sheets contacts sync job error");
  }
}

// ─── Sync-failure notification ────────────────────────────────────────────────

async function notifySyncFailure(params: {
  sheetLabel: string;
  errorMessage: string;
  errorAt: Date;
}): Promise<void> {
  const { sheetLabel, errorMessage, errorAt } = params;

  let members: Array<{ email: string; name: string }> = [];
  try {
    members = await db.select({ email: membersTable.email, name: membersTable.name }).from(membersTable);
  } catch (err) {
    logger.error({ err }, "Scheduler: failed to load team members for sync-failure alert");
    return;
  }

  if (!members.length) {
    logger.warn("Scheduler: no team members found — skipping sync-failure email");
    return;
  }

  const from = "ProjectHub <notifications@contacts.ucfilters.com>";
  const configured = process.env["PROJECTHUB_URL"]?.trim() || "https://app.ucfilters.com";
  const base = /^https?:\/\//i.test(configured) ? configured : `https://${configured}`;
  const { subject, text } = buildSheetSyncFailureEmail({
    sheetLabel, errorMessage, errorAt,
    contactsUrl: `${base.replace(/\/+$/, "")}/contacts`,
  });

  const results = await Promise.allSettled(
    members.map((m) =>
      sendViaResend({ from, to: m.email, subject, text, meta: { template: "sheet_sync_failure_alert" } }),
    ),
  );

  const sent = results.filter((r) => r.status === "fulfilled" && r.value).length;
  logger.info(
    { sent, total: members.length },
    "Scheduler: sync-failure alert emails dispatched",
  );
}

function claimStaleRecoveryDigestOrders(
  orders: Array<{ id: number }>,
  now: Date,
): { claimedIds: Set<number>; claimKeys: string[] } {
  const day = now.toISOString().slice(0, 10);

  for (const key of staleRecoveryDigestClaims) {
    if (!key.startsWith(`${day}:`)) staleRecoveryDigestClaims.delete(key);
  }

  const claimedIds = new Set<number>();
  const claimKeys: string[] = [];
  for (const order of orders) {
    const key = `${day}:${order.id}`;
    if (staleRecoveryDigestClaims.has(key)) continue;
    staleRecoveryDigestClaims.add(key);
    claimedIds.add(order.id);
    claimKeys.push(key);
  }

  return { claimedIds, claimKeys };
}
