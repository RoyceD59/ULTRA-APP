/**
 * Slack delivery via the Replit Slack connector.
 *
 * Used for team notifications (e.g. password-reset links). Messages go to the
 * connected Slack user's self-DM (the account that authorized the connector),
 * resolved once via auth.test and cached for the process lifetime.
 *
 * sendSlackTeamMessage returns true when Slack accepted the message, false
 * otherwise — it never throws. Every attempt is written non-blocking to
 * uc_notification_log (channel "slack").
 */
import { ReplitConnectors } from "@replit/connectors-sdk";
import { db, ucNotificationLogTable } from "@workspace/db";
import { logger } from "./logger.js";

const connectors = new ReplitConnectors();

let cachedSelfId: string | null = null;

/** POST a Slack Web API method through the connector proxy. Throws on any
 *  HTTP or Slack-level (`ok:false`) failure — Slack can return HTTP 200 with
 *  `{ok:false,error:"..."}`, so both must be checked. */
async function slackCall<T extends { ok: boolean; error?: string }>(
  method: string,
  body?: Record<string, unknown>,
): Promise<T> {
  const res = await connectors.proxy("slack", method, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) throw new Error(`Slack ${method} failed: HTTP ${res.status}`);
  const json = (await res.json()) as T;
  if (!json.ok) throw new Error(`Slack ${method} error: ${json.error ?? "unknown"}`);
  return json;
}

async function resolveSelfUserId(): Promise<string> {
  if (cachedSelfId) return cachedSelfId;
  const auth = await slackCall<{ ok: boolean; error?: string; user_id?: string }>("/auth.test");
  if (!auth.user_id) throw new Error("Slack auth.test returned no user_id");
  cachedSelfId = auth.user_id;
  return cachedSelfId;
}

/** Write a send-attempt row to uc_notification_log. Never throws. */
function logSlackAttempt(params: {
  recipient: string;
  template: string;
  messageBody: string;
  status: "sent" | "failed";
  errorMessage?: string;
}): void {
  db.insert(ucNotificationLogTable)
    .values({
      channel: "slack",
      provider: "slack-connector",
      recipient: params.recipient,
      template: params.template,
      messageBody: params.messageBody,
      status: params.status,
      errorMessage: params.errorMessage,
    })
    .catch((err: unknown) => {
      logger.warn({ err }, "Slack notification log write failed");
    });
}

/**
 * Send a message to the team via Slack (self-DM of the connected account).
 * Returns true on success, false on any failure. Never throws.
 */
export async function sendSlackTeamMessage(
  text: string,
  template = "TEAM_NOTIFICATION",
): Promise<boolean> {
  let recipient = "slack-self-dm";
  try {
    const userId = await resolveSelfUserId();
    recipient = userId;
    await slackCall("/chat.postMessage", { channel: userId, text });
    logSlackAttempt({ recipient, template, messageBody: text, status: "sent" });
    return true;
  } catch (err) {
    logSlackAttempt({
      recipient,
      template,
      messageBody: text,
      status: "failed",
      errorMessage: err instanceof Error ? err.message : String(err),
    });
    logger.warn({ err }, "Slack message delivery failed");
    return false;
  }
}
