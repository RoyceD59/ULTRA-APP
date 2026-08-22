/**
 * Resend email helper.
 *
 * Two delivery modes, checked in order:
 *   1. Direct API — when RESEND_API_KEY is set (or RESEND_BASE_URL, used by
 *      tests to point at a stub server).
 *   2. Replit Resend connector — authenticated proxy, no API key needed.
 *
 * Returns true when Resend accepted the email, false otherwise (caller
 * decides whether to fall back to another provider). Never throws.
 *
 * Every send attempt is audited in uc_notification_log. A DB write failure
 * never changes the send result seen by callers.
 */
import { ReplitConnectors } from "@replit/connectors-sdk";
import { db, ucNotificationLogTable } from "@workspace/db";

const connectors = new ReplitConnectors();

export interface ResendEmail {
  from: string;
  to: string;
  subject: string;
  text: string;
  html?: string;
  /** Optional metadata stored in the notification log. Not sent to Resend. */
  meta?: {
    template?: string;
    orderId?:  number | string;
    ticketId?: string;
    testId?:   string;
    /** Keep only provider metadata in the audit log (for recovery links). */
    auditMode?: "metadata-only";
  };
  /**
   * Override what is written to the notification log. Use this for sensitive
   * emails whose body contains a credential or bearer token. Not sent to Resend.
   */
  logBody?: string;
}

/** Write a send-attempt row to uc_notification_log. Never throws. */
async function logResendAttempt(params: {
  recipient:    string;
  template:     string;
  messageBody:  string;
  orderId?:     number | string;
  ticketId?:    string;
  testId?:      string;
  status:       "sent" | "failed";
  errorMessage?: string;
  resendMessageId?: string;
}): Promise<void> {
  try {
    await db.insert(ucNotificationLogTable).values({
      channel:      "email",
      provider:     "resend",
      recipient:    params.recipient,
      template:     params.template,
      messageBody:  params.messageBody,
      orderId:      params.orderId != null ? Number(params.orderId) : undefined,
      ticketId:     params.ticketId,
      testId:       params.testId,
      status:       params.status,
      errorMessage: params.errorMessage,
      resendMessageId: params.resendMessageId,
    });
  } catch (err) {
    console.error("[resend] notification log write failed:", err);
  }
}

export type ResendDeliveryEvent =
  | "accepted"
  | "delivered"
  | "delayed"
  | "bounced"
  | "complained"
  | "failed";

export type ResendDeliveryUpdate = {
  event: ResendDeliveryEvent;
  occurredAt?: Date;
};

function normaliseDeliveryEvent(value: unknown): ResendDeliveryEvent | null {
  const event = typeof value === "string"
    ? value.toLowerCase()
    : value && typeof value === "object" && "type" in value && typeof value.type === "string"
      ? value.type.toLowerCase()
      : "";

  if (event === "email.delivered" || event === "delivered") return "delivered";
  if (event === "email.delivery_delayed" || event === "delivery_delayed" || event === "delayed") return "delayed";
  if (event === "email.bounced" || event === "bounced") return "bounced";
  if (event === "email.complained" || event === "complained") return "complained";
  if (event === "email.sent" || event === "sent" || event === "accepted") return "accepted";
  return null;
}

function deliveryEventTime(value: unknown): Date | undefined {
  if (!value || typeof value !== "object") return undefined;
  const dateValue = "created_at" in value
    ? value.created_at
    : "occurred_at" in value
      ? value.occurred_at
      : undefined;
  if (typeof dateValue !== "string") return undefined;
  const parsed = new Date(dateValue);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

/**
 * Read the latest Resend event for one accepted email.
 * Returns provider metadata only; no email fields are passed to callers.
 */
export async function getResendDeliveryEvent(
  messageId: string,
): Promise<ResendDeliveryUpdate | null> {
  const apiKey = process.env["RESEND_API_KEY"];
  const baseUrl = process.env["RESEND_BASE_URL"];

  try {
    const resp = apiKey || baseUrl
      ? await fetch(`${baseUrl ?? "https://api.resend.com"}/emails/${encodeURIComponent(messageId)}`, {
          headers: { Authorization: `Bearer ${apiKey ?? ""}` },
        })
      : await connectors.proxy("resend", `/emails/${encodeURIComponent(messageId)}`, {
          method: "GET",
        });
    if (!resp.ok) {
      console.warn(`[resend] delivery event lookup failed (${resp.status})`);
      return null;
    }

    const payload = await resp.json() as { last_event?: unknown };
    const event = normaliseDeliveryEvent(payload.last_event);
    return event ? { event, occurredAt: deliveryEventTime(payload.last_event) } : null;
  } catch (err) {
    console.warn("[resend] delivery event lookup failed:", err);
    return null;
  }
}

export async function sendViaResend(email: ResendEmail): Promise<boolean> {
  const apiKey = process.env["RESEND_API_KEY"];
  const baseUrl = process.env["RESEND_BASE_URL"];

  // Strip helper-only fields before sending — Resend API doesn't know about them.
  const { meta, logBody, ...resendPayload } = email;
  // Store the full plain-text body so retries can reconstruct a useful message.
  const logBase = {
    recipient:   email.to,
    template:    meta?.template ?? "",
    messageBody: meta?.auditMode === "metadata-only" ? "" : (logBody ?? email.text),
    orderId:     meta?.orderId,
    ticketId:    meta?.ticketId,
    testId:      meta?.testId,
  };

  try {
    let resp: Response;
    if (apiKey || baseUrl) {
      resp = await fetch(`${baseUrl ?? "https://api.resend.com"}/emails`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey ?? ""}` },
        body: JSON.stringify(resendPayload),
      });
    } else {
      resp = await connectors.proxy("resend", "/emails", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(resendPayload),
      });
    }
    if (resp.ok) {
      let resendMessageId: string | undefined;
      try {
        const payload = await resp.json() as { id?: unknown };
        if (typeof payload.id === "string") resendMessageId = payload.id;
      } catch {
        // Acceptance is still valid when the provider returns a non-JSON body.
      }
      await logResendAttempt({ ...logBase, status: "sent", resendMessageId });
      return true;
    }
    // Log only the status and Resend's error name — never the raw response
    // body, which may echo request fields containing customer PII.
    let errName = "";
    try {
      const parsed = (await resp.json()) as { name?: string };
      if (typeof parsed?.name === "string") errName = ` (${parsed.name})`;
    } catch { /* body not JSON — ignore */ }
    const errMsg = `Resend ${resp.status}${errName}`;
    console.error(`[resend] ${errMsg} for "${email.subject}"`);
    await logResendAttempt({ ...logBase, status: "failed", errorMessage: errMsg });
    return false;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[resend] send failed for "${email.subject}":`, msg);
    await logResendAttempt({ ...logBase, status: "failed", errorMessage: `Network error: ${msg}` });
    return false;
  }
}
