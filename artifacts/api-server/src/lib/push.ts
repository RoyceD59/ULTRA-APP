/**
 * Shared UC push notification helpers.
 *
 * Wraps the Expo Push API and the uc_push_tokens table.
 * Fire-and-forget: failures are logged but never thrown to the caller.
 */
import { db, ucNotificationLogTable, ucPushTokensTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger.js";

// ─── Helpers (also exported for routes that need fine-grained control) ────────

export async function getPushTokenRow(
  userId: string
): Promise<{ pushToken: string; optOutOrders: boolean } | null> {
  try {
    const row = await db.query.ucPushTokensTable.findFirst({
      where: eq(ucPushTokensTable.userId, userId),
    });
    if (!row) return null;
    return { pushToken: row.pushToken, optOutOrders: row.optOutOrders };
  } catch {
    return null;
  }
}

export async function removePushToken(userId: string): Promise<void> {
  try {
    await db.delete(ucPushTokensTable).where(eq(ucPushTokensTable.userId, userId));
  } catch { /* ignore */ }
}

export async function callExpoPushApi(
  token: string,
  title: string,
  body: string,
  data: Record<string, unknown> = {}
): Promise<{ staleToken: boolean; accepted: boolean; error?: string }> {
  try {
    const res = await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: {
        "Content-Type":    "application/json",
        "Accept":          "application/json",
        "Accept-Encoding": "gzip, deflate",
      },
      body: JSON.stringify([{ to: token, title, body, data }]),
    });
    const json = await res.json() as {
      data?: Array<{ status: string; details?: { error?: string } }>;
    };
    const ticket = json?.data?.[0];
    if (ticket?.status === "error" && ticket?.details?.error === "DeviceNotRegistered") {
      return { staleToken: true, accepted: false, error: "DeviceNotRegistered" };
    }
    if (ticket?.status === "ok") return { staleToken: false, accepted: true };
    return { staleToken: false, accepted: false, error: ticket?.details?.error ?? "Expo push provider rejected the notification" };
  } catch (err) {
    return {
      staleToken: false,
      accepted: false,
      error: err instanceof Error ? err.message : "Expo push provider request failed",
    };
  }
}

export type RewardPushOutcome = {
  status: "sent" | "failed" | "skipped";
  deliveryEvent: "accepted" | "no_push_token" | "opted_out" | "stale_token" | "provider_failure";
  errorMessage?: string;
};

/**
 * Sends a reward notification and persists its outcome in the UC notification
 * audit path. "accepted" means Expo accepted a ticket; it intentionally does
 * not overstate provider acceptance as device delivery.
 */
export async function sendRewardPushNotification(input: {
  userId: number;
  ledgerId: number;
  title: string;
  body: string;
}): Promise<RewardPushOutcome> {
  const recipient = String(input.userId);
  const audit = async (outcome: RewardPushOutcome): Promise<void> => {
    await db.insert(ucNotificationLogTable).values({
      channel: "push",
      provider: "expo",
      recipient,
      template: "reward-points",
      messageBody: input.body,
      rewardLedgerId: input.ledgerId,
      status: outcome.status,
      deliveryEvent: outcome.deliveryEvent,
      deliveryEventAt: new Date(),
      errorMessage: outcome.errorMessage ?? null,
    }).catch((err) => {
      logger.warn({ err, userId: input.userId, ledgerId: input.ledgerId }, "push: reward outcome audit write failed");
    });
  };

  try {
    const row = await getPushTokenRow(recipient);
    if (!row) {
      const outcome: RewardPushOutcome = { status: "skipped", deliveryEvent: "no_push_token" };
      await audit(outcome);
      return outcome;
    }
    if (row.optOutOrders) {
      const outcome: RewardPushOutcome = { status: "skipped", deliveryEvent: "opted_out" };
      await audit(outcome);
      return outcome;
    }
    const result = await callExpoPushApi(row.pushToken, input.title, input.body, { screen: "rewards" });
    if (result.staleToken) {
      await removePushToken(recipient);
      const outcome: RewardPushOutcome = {
        status: "failed",
        deliveryEvent: "stale_token",
        errorMessage: result.error,
      };
      await audit(outcome);
      return outcome;
    }
    if (!result.accepted) {
      const outcome: RewardPushOutcome = {
        status: "failed",
        deliveryEvent: "provider_failure",
        errorMessage: result.error,
      };
      await audit(outcome);
      return outcome;
    }
    const outcome: RewardPushOutcome = { status: "sent", deliveryEvent: "accepted" };
    await audit(outcome);
    return outcome;
  } catch (err) {
    const outcome: RewardPushOutcome = {
      status: "failed",
      deliveryEvent: "provider_failure",
      errorMessage: err instanceof Error ? err.message : "Reward push processing failed",
    };
    await audit(outcome);
    return outcome;
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Fire-and-forget push notification to a UC user.
 *
 * - Silently skips when no push token is registered.
 * - Respects `optOutOrders` when `category` is `"orders"`.
 * - Automatically removes stale tokens Expo reports as DeviceNotRegistered.
 * - Never throws; all errors are logged as warnings.
 *
 * @param userId   String user id (JWT sub / uc_push_tokens.user_id).
 * @param title    Notification title.
 * @param body     Notification body text.
 * @param data     Optional extra payload forwarded to the app.
 * @param category `"orders"` checks optOutOrders; `"general"` always sends.
 */
export function sendPushToUser(
  userId: string,
  title: string,
  body: string,
  data: Record<string, unknown> = {},
  category: "orders" | "general" = "general"
): void {
  getPushTokenRow(userId)
    .then(async (row) => {
      if (!row) {
        logger.debug({ userId }, "push: no token registered — skipping");
        return;
      }
      if (category === "orders" && row.optOutOrders) {
        logger.debug({ userId }, "push: user opted out of order/reminder notifications — skipping");
        return;
      }
      const { staleToken } = await callExpoPushApi(row.pushToken, title, body, data);
      if (staleToken) {
        logger.warn({ userId }, "push: DeviceNotRegistered — removing stale token");
        await removePushToken(userId);
      }
    })
    .catch((err) => {
      logger.warn({ err, userId }, "push: sendPushToUser failed (non-fatal)");
    });
}
