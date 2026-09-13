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
import { createHash } from "node:crypto";
import { logger } from "./logger.js";

interface SlackMessageOptions {
  idempotencyKey?: string;
}

/**
 * Test seam — wraps sendSlackTeamMessage so tests can observe or stub calls
 * without patching non-configurable ES module namespace bindings.
 *
 * When `_slackSeams.sendMessage` is non-null, sendSlackTeamMessage delegates
 * entirely to it. Set back to null after each test to restore live behaviour.
 *
 * @internal — only intended for use by the test suite.
 */
export const _slackSeams: {
  sendMessage: ((text: string, template: string, options?: SlackMessageOptions) => Promise<boolean>) | null;
} = {
  sendMessage: null,
};

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
  options?: SlackMessageOptions,
): Promise<boolean> {
  // Test seam: allow the test suite to intercept without replacing module bindings.
  if (_slackSeams.sendMessage !== null) {
    return _slackSeams.sendMessage(text, template, options);
  }
  let recipient = "slack-self-dm";
  try {
    const configuredChannel = process.env["SLACK_TEAM_CHANNEL_ID"]?.trim();
    recipient = configuredChannel || await resolveSelfUserId();
    const clientMessageId = options?.idempotencyKey
      ? createHash("sha256").update(options.idempotencyKey).digest("hex").slice(0, 32).replace(
          /^(.{8})(.{4})(.{4})(.{4})(.{12})$/,
          "$1-$2-$3-$4-$5",
        )
      : undefined;
    await slackCall("/chat.postMessage", {
      channel: recipient,
      text,
      ...(clientMessageId ? { client_msg_id: clientMessageId } : {}),
    });
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
