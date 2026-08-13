/**
 * Scheduled jobs for the AI Monitor and maintenance tasks.
 * - Daily 08:00 UTC: push project report to Ultra Clear AI orchestrator.
 * - Daily 02:00 UTC: prune old uc_ai_feedback rows beyond retention window.
 * - Daily 03:00 UTC: prune old uc_notification_log rows (sent=30d, failed=90d).
 * - Daily 06:00 UTC: sync contacts from Google Sheets; alerts team on failure.
 */
import cron from "node-cron";
import { logger } from "./logger";
import { generateReport, setLatestReport } from "../routes/ai/monitor";
import { db, ucAiFeedbackTable, ucNotificationLogTable, sheetSyncsTable, membersTable, ucOrdersTable, teamSettingsTable } from "@workspace/db";
import { lt, lte, desc, eq, and, or } from "drizzle-orm";
import { runSheetSync } from "../routes/contacts-sync.js";
import { sendViaResend } from "./resend.js";
import { sendSms } from "./sms.js";
import { getValidAccessToken } from "./google-auth.js";

export function startScheduler() {
  // Daily at 08:00 UTC — generate a fresh report and push to the orchestrator
  cron.schedule("0 8 * * *", async () => {
    logger.info("Scheduler: generating daily AI project report");
    try {
      const report = await generateReport();
      setLatestReport(report);
      logger.info("Scheduler: daily report generated successfully");

      const webhookUrl = process.env.AI_ORCHESTRATOR_WEBHOOK_URL;
      if (!webhookUrl) {
        logger.info(
          "Scheduler: AI_ORCHESTRATOR_WEBHOOK_URL not set, skipping push",
        );
        return;
      }

      const secret = process.env.PROJECTHUB_WEBHOOK_SECRET;
      const res = await fetch(webhookUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(secret ? { "Authorization": `Bearer ${secret}` } : {}),
        },
        body: JSON.stringify({
          source: "projecthub",
          type: "daily_project_status_report",
          report,
        }),
      });

      if (res.ok) {
        logger.info(
          { status: res.status },
          "Scheduler: daily report pushed to Ultra Clear AI",
        );
      } else {
        logger.error(
          { status: res.status, body: await res.text() },
          "Scheduler: orchestrator webhook returned error",
        );
      }
    } catch (err) {
      logger.error({ err }, "Scheduler: failed to generate or push report");
    }
  }, { timezone: "UTC" });

  logger.info("Scheduler: daily AI report job registered (08:00 UTC)");

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

  // ─── Daily 03:00 UTC: prune old notification log rows ────────────────────
  // Successful sends are pruned after UC_NOTIFICATION_LOG_SUCCESS_RETENTION_DAYS
  // (default 30).  Failed rows are kept longer — UC_NOTIFICATION_LOG_FAILURE_RETENTION_DAYS
  // (default 90) — so the team has time to investigate and retry.
  // Both values can be overridden from team_settings (admin panel) without a restart.
  cron.schedule("0 3 * * *", async () => {
    // Read retention windows from team_settings (admin panel), falling back to
    // env vars or hard defaults only when the DB row has no override.
    // If the DB query itself fails, abort pruning entirely — better to keep logs
    // than to silently delete them with a potentially wrong retention window.
    let successDays: number;
    let failureDays: number;
    try {
      const [settingsRow] = await db
        .select({
          successDays: teamSettingsTable.notificationLogSuccessRetentionDays,
          failureDays: teamSettingsTable.notificationLogFailureRetentionDays,
        })
        .from(teamSettingsTable)
        .where(eq(teamSettingsTable.id, "singleton"))
        .limit(1);

      successDays = Math.max(
        1,
        settingsRow?.successDays ??
        (parseInt(process.env["UC_NOTIFICATION_LOG_SUCCESS_RETENTION_DAYS"] ?? "30", 10) || 30),
      );
      failureDays = Math.max(
        1,
        settingsRow?.failureDays ??
        (parseInt(process.env["UC_NOTIFICATION_LOG_FAILURE_RETENTION_DAYS"] ?? "90", 10) || 90),
      );
    } catch (err) {
      logger.error(
        { err },
        "Scheduler: failed to read notification log retention settings — aborting pruning to avoid data loss",
      );
      return;
    }

    const successCutoff = new Date(Date.now() - successDays * 24 * 60 * 60 * 1000);
    const failureCutoff = new Date(Date.now() - failureDays * 24 * 60 * 60 * 1000);

    logger.info(
      { successDays, failureDays, successCutoff, failureCutoff },
      "Scheduler: pruning old notification log rows",
    );

    try {
      // Prune successful rows beyond the shorter retention window
      const deletedSuccess = await db
        .delete(ucNotificationLogTable)
        .where(
          and(
            eq(ucNotificationLogTable.status, "sent"),
            lt(ucNotificationLogTable.sentAt, successCutoff),
          ),
        );

      // Prune failed rows beyond the longer retention window
      const deletedFailure = await db
        .delete(ucNotificationLogTable)
        .where(
          and(
            eq(ucNotificationLogTable.status, "failed"),
            lt(ucNotificationLogTable.sentAt, failureCutoff),
          ),
        );

      logger.info(
        { deletedSuccess, deletedFailure },
        "Scheduler: notification log pruning complete",
      );
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
  cron.schedule("0 6 * * *", async () => {
    logger.info("Scheduler: starting daily Google Sheets contacts sync");
    try {
      const [sync] = await db
        .select()
        .from(sheetSyncsTable)
        .orderBy(desc(sheetSyncsTable.createdAt))
        .limit(1);

      if (!sync) {
        logger.info("Scheduler: no Google Sheet connected — skipping contacts sync");
        return;
      }

      const gidMatch = sync.sheetUrl.match(/[#&?]gid=(\d+)/);
      const gid = gidMatch?.[1];

      // Get OAuth access token for private sheets (falls back to null = public mode)
      let accessToken: string | null = null;
      try {
        accessToken = await getValidAccessToken();
        if (accessToken) {
          logger.info("Scheduler: using Google OAuth token for private sheet access");
        }
      } catch (tokenErr) {
        logger.warn({ err: tokenErr }, "Scheduler: could not get OAuth token, trying public access");
      }

      let result: Awaited<ReturnType<typeof runSheetSync>>;
      try {
        result = await runSheetSync(sync.sheetUrl, gid, accessToken);
      } catch (syncErr) {
        const errorMessage = syncErr instanceof Error ? syncErr.message : String(syncErr);
        const errorAt = new Date();

        logger.error({ err: syncErr }, "Scheduler: Google Sheets contacts sync failed");

        // Record failure in the database
        await db
          .update(sheetSyncsTable)
          .set({ lastError: errorMessage, lastErrorAt: errorAt })
          .where(eq(sheetSyncsTable.id, sync.id));

        // Notify all team members by email
        await notifySyncFailure({
          sheetLabel: sync.sheetLabel || sync.sheetUrl,
          errorMessage,
          errorAt,
        });

        return;
      }

      // Success — clear any previous error state and update lastSyncedAt
      await db
        .update(sheetSyncsTable)
        .set({ lastSyncedAt: new Date(), lastError: null, lastErrorAt: null })
        .where(eq(sheetSyncsTable.id, sync.id));

      logger.info(
        { created: result.created, updated: result.updated, skipped: result.skipped, failed: result.failed },
        "Scheduler: Google Sheets contacts sync complete",
      );
    } catch (err) {
      logger.error({ err }, "Scheduler: Google Sheets contacts sync job error");
    }
  }, { timezone: "UTC" });

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
}

/**
 * Delete notification log rows that have exceeded the configured retention window.
 *
 * Retention is controlled by two environment variables:
 *   UC_NOTIFICATION_LOG_SUCCESS_RETENTION_DAYS  (default 30)  — rows with status='sent'
 *   UC_NOTIFICATION_LOG_FAILURE_RETENTION_DAYS  (default 90)  — rows with status='failed'
 *
 * Failed rows are kept longer so the team has time to investigate and retry.
 * Existing rows are always unaffected until they age past the cutoff.
 *
 * @internal — exported for tests; called by the daily 03:00 UTC cron job.
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

export async function runNotificationLogPruning(): Promise<{
  deletedSuccess: number;
  deletedFailure: number;
}> {
  const successDays = parseRetentionDays(
    process.env["UC_NOTIFICATION_LOG_SUCCESS_RETENTION_DAYS"],
    30,
  );
  const failureDays = parseRetentionDays(
    process.env["UC_NOTIFICATION_LOG_FAILURE_RETENTION_DAYS"],
    90,
  );

  const successCutoff = new Date(Date.now() - successDays * 24 * 60 * 60 * 1000);
  const failureCutoff = new Date(Date.now() - failureDays * 24 * 60 * 60 * 1000);

  logger.info(
    { successDays, failureDays, successCutoff, failureCutoff },
    "Scheduler: pruning old notification log rows",
  );

  try {
    // Prune successful rows beyond the shorter retention window
    const successResult = await db
      .delete(ucNotificationLogTable)
      .where(
        and(
          eq(ucNotificationLogTable.status, "sent"),
          lt(ucNotificationLogTable.sentAt, successCutoff),
        ),
      );

    // Prune failed rows beyond the longer retention window
    const failureResult = await db
      .delete(ucNotificationLogTable)
      .where(
        and(
          eq(ucNotificationLogTable.status, "failed"),
          lt(ucNotificationLogTable.sentAt, failureCutoff),
        ),
      );

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
/** @internal */
export async function runStaleRecoveryOrderDigest(): Promise<void> {
  logger.info("Scheduler: checking for stale webhook-recovery orders");
  try {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const stale = await db
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

    if (stale.length === 0) {
      logger.info("Scheduler: no stale recovery orders found");
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

    // Email to team
    const emailOk = await sendViaResend({
      from:    "Ultra Clear App <noreply@contacts.ucfilters.com>",
      to:      "info@ucfilters.com",
      subject: `⏰ ${stale.length} recovery order${stale.length > 1 ? "s" : ""} still unfulfilled after 24 h`,
      text:    emailBody,
      meta:    { template: "recovery_order_digest" },
    });

    if (emailOk) {
      logger.info({ count: stale.length }, "Scheduler: stale recovery order digest email sent");
    } else {
      logger.warn("Scheduler: digest email failed — will rely on SMS fallback");
    }

    // SMS fallback — fires unconditionally so the team is reached even when Resend is down
    const teamPhone = process.env["TEAM_ALERT_PHONE"];
    if (teamPhone) {
      await sendSms(teamPhone, smsBody, { template: "recovery_order_digest" });
      logger.info("Scheduler: stale recovery order SMS sent");
    } else {
      logger.info("Scheduler: TEAM_ALERT_PHONE not set — SMS reminder skipped");
    }
  } catch (err) {
    logger.error({ err }, "Scheduler: stale recovery order digest job failed");
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
  const subject = `⚠️ Google Sheets sync failed — ${sheetLabel}`;
  const text = [
    `The daily Google Sheets contacts sync failed at ${errorAt.toUTCString()}.`,
    "",
    `Sheet: ${sheetLabel}`,
    `Error: ${errorMessage}`,
    "",
    "Please check that the sheet is still published and the URL is correct.",
    "You can re-run the sync from the ProjectHub Contacts page once the issue is resolved.",
  ].join("\n");

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
