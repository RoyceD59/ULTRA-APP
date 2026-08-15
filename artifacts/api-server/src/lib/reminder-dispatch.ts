/**
 * Daily filter-reminder dispatch — delivers the mobile app's 5-stage filter
 * lifecycle messages via email / SMS / WhatsApp to customers who OPTED IN
 * (uc_notif_prefs.reminder_email / reminder_sms / reminder_whatsapp).
 *
 * Mirrors the schedule in uc-companion/hooks/useNotifications.ts:
 *   1. activation  — day 0        (app: +2 h)
 *   2. day30       — day 30       (only when lifespan > 45)
 *   3. day60       — day 60       (only when lifespan > 75)
 *   4. replace30   — lifespan−30  (discount codes REPLACE10 / REPLACE15)
 *   5. replace15   — lifespan−15  (48-hour code FRESH48)
 *
 * Dispatch rules:
 * - A stage is DUE when daysSince ∈ [offset, offset + GRACE_DAYS].
 * - A stage older than the grace window is marked as handled WITHOUT sending,
 *   so first-time syncs of long-running filters never trigger a backlog blast.
 * - Each stage is CLAIMED atomically (conditional jsonb append keyed to the
 *   exact cycle: user + product + activation date) BEFORE any send. Overlapping
 *   runs, multiple instances, or a concurrent cycle reset can never double-send
 *   — one attempt per stage, never daily retries. Failures remain visible in
 *   uc_notification_log / ProjectHub.
 * - Channel helpers already audit to uc_notification_log (email, sms);
 *   WhatsApp attempts are logged here with channel "whatsapp".
 */
import { and, eq, gt, isNull, or, sql } from "drizzle-orm";
import {
  db,
  ucFilterRemindersTable,
  ucNotifPrefsTable,
  ucUsersTable,
  ucNotificationLogTable,
} from "@workspace/db";
import { logger } from "./logger";
import { sendViaResend } from "./resend.js";
import { sendSms } from "./sms.js";
import { sendWhatsAppMessage, getWhatsAppStatus } from "./whatsapp.js";

/** Days past a stage's target date during which we still send it. */
export const GRACE_DAYS = 3;
/** Safety cap on messages per run (per channel-send counts once). */
const MAX_SENDS_PER_RUN = 300;

const FROM_ADDRESS = "Ultra Clear <noreply@contacts.ucfilters.com>";

// ─── Stage schedule (mirror of the app's local notification offsets) ─────────

export type StageKey = "activation" | "day30" | "day60" | "replace30" | "replace15";

interface StageDef {
  key: StageKey;
  /** Day offset from activation, or null when the stage doesn't apply. */
  offset: (lifespanDays: number) => number | null;
}

export const STAGES: StageDef[] = [
  { key: "activation", offset: () => 0 },
  { key: "day30", offset: (L) => (L > 45 ? 30 : null) },
  { key: "day60", offset: (L) => (L > 75 ? 60 : null) },
  {
    key: "replace30",
    offset: (L) => Math.max(Math.min(L - 30, L - 1), 1),
  },
  {
    key: "replace15",
    offset: (L) => {
      const r30 = Math.max(Math.min(L - 30, L - 1), 1);
      return Math.max(r30 + 1, L - 15);
    },
  },
];

// ─── Message templates ────────────────────────────────────────────────────────

interface StageMessage {
  subject: string;
  /** Long-form body for email (plain text; also used to build simple HTML). */
  email: string;
  /** Short body for SMS / WhatsApp (keep under ~320 chars). */
  short: string;
}

export function buildStageMessage(
  stage: StageKey,
  productName: string,
  lifespanDays: number,
  firstName: string
): StageMessage {
  const hi = firstName ? `Hi ${firstName}, ` : "";
  switch (stage) {
    case "activation":
      return {
        subject: `Activate your ${productName}`,
        email:
          `${hi}thanks for registering your ${productName}!\n\n` +
          `Follow the installation guide in the Ultra Clear app to get your filter running — clean, purified water in minutes.\n\n` +
          `Need help? Open the app and tap Support, or reply to this email.`,
        short: `${hi}your ${productName} is registered! Follow the installation guide in the Ultra Clear app to get it running. Need help? Open the app and tap Support.`,
      };
    case "day30":
      return {
        subject: `30-day check-in for your ${productName}`,
        email:
          `${hi}your ${productName} has been running for 30 days — about ${lifespanDays - 30} days remaining.\n\n` +
          `How's the water taste and flow? Open the Ultra Clear app to run a quick performance check-in.`,
        short: `${hi}your ${productName} hit 30 days (~${lifespanDays - 30} days left). How's the taste and flow? Run a quick check-in in the Ultra Clear app.`,
      };
    case "day60":
      return {
        subject: `60-day performance check for your ${productName}`,
        email:
          `${hi}your ${productName} is at 60 days (about ${lifespanDays - 60} days left).\n\n` +
          `Nairobi's water can be harsh on filters — noticing slow flow or an unusual taste? Try a flush, or let the AI assistant in the Ultra Clear app guide you.`,
        short: `${hi}your ${productName} is at 60 days (~${lifespanDays - 60} left). Slow flow or odd taste? Try a flush or ask the AI assistant in the Ultra Clear app.`,
      };
    case "replace30":
      return {
        subject: `Time to order your replacement ${productName}`,
        email:
          `${hi}your ${productName} needs replacing in about 30 days.\n\n` +
          `Order now and save:\n` +
          `  • 10% off 1 filter — code REPLACE10\n` +
          `  • 15% off 2 filters — code REPLACE15\n\n` +
          `Delivery takes 1–2 days. Order in the Ultra Clear app or at www.ucfilters.com.`,
        short: `${hi}your ${productName} needs replacing in ~30 days. Save 10% (code REPLACE10) or 15% on 2 (REPLACE15) at ucfilters.com or in the app. Delivery 1-2 days.`,
      };
    case "replace15":
      return {
        subject: `Your ${productName} expires in ~15 days — 10% off inside`,
        email:
          `${hi}your ${productName} expires in about 15 days.\n\n` +
          `Order your replacement today with code FRESH48 for 10% off (valid 48 hours). Clean water protects your family and your appliances — don't risk it!\n\n` +
          `Order in the Ultra Clear app or at www.ucfilters.com.`,
        short: `${hi}your ${productName} expires in ~15 days. Order today with code FRESH48 for 10% off (48 hrs only) at ucfilters.com or in the app.`,
      };
  }
}

// ─── Stage due computation (exported for tests) ───────────────────────────────

export interface StageDecision {
  key: StageKey;
  action: "send" | "skip_stale";
}

/**
 * Returns the stages that require action today: stages whose target day has
 * arrived and which aren't in sentStages. Stages within the grace window are
 * "send"; older ones are "skip_stale" (mark handled, never send).
 *
 * @param adjustedOffsets  When set, replace30 and replace15 use the stored
 *   day-offsets (computed by the app at check-in time) instead of the formula.
 *   This guarantees parity with the rescheduled phone notifications, including
 *   for late check-ins where the app's "tomorrow" guard moved the offset past
 *   what the lifespan formula alone would produce.
 */
export function dueStages(
  lifespanDays: number,
  activatedAt: Date,
  sentStages: string[],
  now: Date = new Date(),
  adjustedOffsets?: { replace30?: number | null; replace15?: number | null } | null
): StageDecision[] {
  if (!(lifespanDays > 0)) return [];
  const daysSince = Math.floor((now.getTime() - activatedAt.getTime()) / 86_400_000);
  if (daysSince < 0) return [];
  const out: StageDecision[] = [];
  for (const stage of STAGES) {
    if (sentStages.includes(stage.key)) continue;
    // For replace30/replace15 use the app-computed offset when available;
    // fall back to the formula for all other stages and when no adjustment
    // was stored.
    const storedOffset =
      (stage.key === "replace30" || stage.key === "replace15")
        ? (adjustedOffsets?.[stage.key] ?? null)
        : null;
    const offset = storedOffset != null ? storedOffset : stage.offset(lifespanDays);
    if (offset == null) continue;
    if (daysSince < offset) continue;
    out.push({
      key: stage.key,
      action: daysSince <= offset + GRACE_DAYS ? "send" : "skip_stale",
    });
  }
  return out;
}

// ─── WhatsApp audit logging (email/SMS helpers log internally) ────────────────

function logWhatsAppAttempt(params: {
  recipient: string;
  template: string;
  messageBody: string;
  status: "sent" | "failed";
  errorMessage?: string;
}): void {
  db.insert(ucNotificationLogTable)
    .values({
      channel: "whatsapp",
      provider: "baileys",
      recipient: params.recipient,
      template: params.template,
      messageBody: params.messageBody,
      status: params.status,
      errorMessage: params.errorMessage,
    })
    .catch((err) => logger.error({ err }, "reminder-dispatch: whatsapp log write failed"));
}

// ─── Main dispatch ────────────────────────────────────────────────────────────

export interface DispatchSummary {
  usersConsidered: number;
  stagesSent: number;
  stagesSkippedStale: number;
  channelSends: number;
}

export async function dispatchFilterReminders(): Promise<DispatchSummary> {
  const summary: DispatchSummary = {
    usersConsidered: 0,
    stagesSent: 0,
    stagesSkippedStale: 0,
    channelSends: 0,
  };

  // Only rows for users with at least one channel opted in, an active
  // trackable filter, and a live (non-deleted) account.
  const rows = await db
    .select({
      userId: ucFilterRemindersTable.userId,
      productId: ucFilterRemindersTable.productId,
      productName: ucFilterRemindersTable.productName,
      lifespanDays: ucFilterRemindersTable.lifespanDays,
      effectiveLifespanDays: ucFilterRemindersTable.effectiveLifespanDays,
      adjustedReplaceOffsets: ucFilterRemindersTable.adjustedReplaceOffsets,
      activatedAt: ucFilterRemindersTable.activatedAt,
      sourceOrderId: ucFilterRemindersTable.sourceOrderId,
      sentStages: ucFilterRemindersTable.sentStages,
      reminderEmail: ucNotifPrefsTable.reminderEmail,
      reminderSms: ucNotifPrefsTable.reminderSms,
      reminderWhatsapp: ucNotifPrefsTable.reminderWhatsapp,
      email: ucUsersTable.email,
      phone: ucUsersTable.phone,
      firstName: ucUsersTable.firstName,
    })
    .from(ucFilterRemindersTable)
    .innerJoin(ucNotifPrefsTable, eq(ucNotifPrefsTable.userId, ucFilterRemindersTable.userId))
    .innerJoin(ucUsersTable, eq(ucUsersTable.id, sqlToInt(ucFilterRemindersTable.userId)))
    .where(
      and(
        eq(ucFilterRemindersTable.active, true),
        gt(ucFilterRemindersTable.lifespanDays, 0),
        isNull(ucUsersTable.deletedAt),
        or(
          eq(ucNotifPrefsTable.reminderEmail, true),
          eq(ucNotifPrefsTable.reminderSms, true),
          eq(ucNotifPrefsTable.reminderWhatsapp, true)
        )
      )
    );

  const waConnected = getWhatsAppStatus().state === "connected";

  for (const row of rows) {
    summary.usersConsidered++;
    if (summary.channelSends >= MAX_SENDS_PER_RUN) {
      logger.warn(
        { cap: MAX_SENDS_PER_RUN },
        "reminder-dispatch: send cap reached — remaining users deferred to next run"
      );
      break;
    }

    const sent = Array.isArray(row.sentStages) ? row.sentStages : [];
    // day30/day60 use rated lifespanDays — they are informational performance
    // prompts tied to calendar milestones, matching the local scheduler which
    // also uses rated lifespanDays for those guards (lifespanDays > 45 / > 75).
    // replace30/replace15 use adjustedReplaceOffsets when available so they
    // fire on the exact dates the app computed at check-in time.
    const decisions = dueStages(row.lifespanDays, row.activatedAt, sent, new Date(), row.adjustedReplaceOffsets);
    if (decisions.length === 0) continue;

    for (const decision of decisions) {
      // Atomically claim the stage BEFORE doing anything. If another run (or
      // instance) claimed it first, or the cycle was reset concurrently, the
      // claim fails and we skip — guarantees at-most-once delivery per stage.
      const claimed = await claimStage(row.userId, row.productId, row.activatedAt, decision.key);
      if (!claimed) continue;

      if (decision.action === "skip_stale") {
        summary.stagesSkippedStale++;
        continue;
      }

      // day30/day60 message bodies quote remaining-life figures; use rated
      // lifespanDays so they match the local notification content.
      const msg = buildStageMessage(
        decision.key,
        row.productName,
        row.lifespanDays,
        row.firstName ?? ""
      );
      const template = `filter_reminder_${decision.key}`;

      // Email
      if (row.reminderEmail && row.email) {
        summary.channelSends++;
        await sendViaResend({
          from: FROM_ADDRESS,
          to: row.email,
          subject: msg.subject,
          text: msg.email,
          meta: { template, orderId: row.sourceOrderId ?? undefined },
        });
      }
      // SMS (no-op with a logged skip when AT credentials are absent)
      if (row.reminderSms && row.phone) {
        summary.channelSends++;
        await sendSms(row.phone, msg.short, {
          template,
          orderId: row.sourceOrderId ?? undefined,
        });
      }
      // WhatsApp
      if (row.reminderWhatsapp && row.phone) {
        summary.channelSends++;
        if (!waConnected) {
          logWhatsAppAttempt({
            recipient: row.phone,
            template,
            messageBody: msg.short,
            status: "failed",
            errorMessage: "WhatsApp session not connected",
          });
        } else {
          try {
            await sendWhatsAppMessage(row.phone, msg.short);
            logWhatsAppAttempt({
              recipient: row.phone,
              template,
              messageBody: msg.short,
              status: "sent",
            });
          } catch (err) {
            logWhatsAppAttempt({
              recipient: row.phone,
              template,
              messageBody: msg.short,
              status: "failed",
              errorMessage: err instanceof Error ? err.message : String(err),
            });
          }
        }
      }

      summary.stagesSent++;
    }
  }

  logger.info(summary, "reminder-dispatch: run complete");
  return summary;
}

// ─── Helper: join text userId to integer uc_users.id ──────────────────────────

/** uc_filter_reminders.user_id is text (JWT sub); uc_users.id is integer. */
function sqlToInt(col: typeof ucFilterRemindersTable.userId) {
  return sql<number>`CAST(${col} AS INTEGER)`;
}

// ─── Atomic stage claim ───────────────────────────────────────────────────────

/**
 * Appends `stageKey` to sent_stages ONLY IF it isn't there yet AND the row
 * still describes the exact same cycle (product + activation date, active).
 * Returns true when this call won the claim. A concurrent run, instance, or
 * cycle reset makes the conditional update match zero rows → false → no send.
 */
async function claimStage(
  userId: string,
  productId: number,
  activatedAt: Date,
  stageKey: StageKey
): Promise<boolean> {
  try {
    const claimed = await db
      .update(ucFilterRemindersTable)
      .set({
        sentStages: sql`${ucFilterRemindersTable.sentStages} || ${JSON.stringify([stageKey])}::jsonb`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(ucFilterRemindersTable.userId, userId),
          eq(ucFilterRemindersTable.active, true),
          eq(ucFilterRemindersTable.productId, productId),
          // Postgres stores microseconds; JS Dates only carry milliseconds.
          // Compare at millisecond precision or the cycle check never matches.
          sql`date_trunc('milliseconds', ${ucFilterRemindersTable.activatedAt}) = date_trunc('milliseconds', ${activatedAt}::timestamptz)`,
          sql`NOT (${ucFilterRemindersTable.sentStages} ? ${stageKey})`
        )
      )
      .returning({ userId: ucFilterRemindersTable.userId });
    return claimed.length === 1;
  } catch (err) {
    logger.error({ err, userId, stageKey }, "reminder-dispatch: stage claim failed");
    return false;
  }
}
