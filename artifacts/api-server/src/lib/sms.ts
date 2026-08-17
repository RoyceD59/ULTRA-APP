/**
 * Africa's Talking SMS helper for Ultra-Clear Companion.
 *
 * Reads AT_API_KEY and AT_USERNAME from the environment.
 * All calls are fire-and-forget — errors are logged but never thrown.
 * When credentials are absent the function is a silent no-op.
 *
 * Every send attempt (success or failure) is written to uc_notification_log
 * non-blocking; a DB write error never affects the caller.
 *
 * Africa's Talking SMS API docs:
 * https://developers.africastalking.com/docs/sms/sending
 */

import { db, ucNotificationLogTable } from "@workspace/db";

const AT_BASE = "https://api.africastalking.com/version1/messaging";

/** Returns true when Africa's Talking credentials are present. */
function hasATCredentials(): boolean {
  return !!(process.env["AT_API_KEY"] && process.env["AT_USERNAME"]);
}

/**
 * Normalise a phone number to international format for Africa's Talking.
 * AT requires numbers in E.164, e.g. +254712345678.
 * Strips spaces; converts leading 07/01 Kenyan numbers to +2547/+2541.
 */
function normalisePhone(raw: string): string {
  const stripped = raw.replace(/\s+/g, "");
  if (stripped.startsWith("+")) return stripped;
  if (stripped.startsWith("07") || stripped.startsWith("01")) {
    return "+254" + stripped.slice(1);
  }
  return stripped;
}

/** Write a send-attempt row to uc_notification_log. Never throws. */
function logSmsAttempt(params: {
  recipient:    string;
  template:     string;
  messageBody:  string;
  orderId?:     number | string;
  ticketId?:    string;
  testId?:      string;
  status:       "sent" | "failed";
  errorMessage?: string;
}): void {
  db.insert(ucNotificationLogTable)
    .values({
      channel:      "sms",
      provider:     "africas_talking",
      recipient:    params.recipient,
      template:     params.template,
      messageBody:  params.messageBody,
      orderId:      params.orderId != null ? Number(params.orderId) : undefined,
      ticketId:     params.ticketId,
      testId:       params.testId,
      status:       params.status,
      errorMessage: params.errorMessage,
    })
    .catch((err: unknown) => {
      console.error("[sms] notification log write failed:", err);
    });
}

/**
 * Send an SMS via Africa's Talking (fire-and-forget).
 *
 * @param to      Recipient phone number (international or Kenyan local format)
 * @param message SMS body (max 160 chars for single-part; longer auto-splits)
 * @param meta    Optional metadata written to uc_notification_log
 */
export async function sendSms(
  to: string,
  message: string,
  meta?: {
    template?: string;
    orderId?:  number | string;
    ticketId?: string;
    testId?:   string;
  },
): Promise<void> {
  if (!hasATCredentials()) {
    console.log("[sms] AT credentials absent — skipping SMS to", to);
    logSmsAttempt({
      recipient:    normalisePhone(to) || to,
      template:     meta?.template ?? "",
      messageBody:  message,
      orderId:      meta?.orderId,
      ticketId:     meta?.ticketId,
      testId:       meta?.testId,
      status:       "failed",
      errorMessage: "Africa's Talking credentials not configured (AT_API_KEY / AT_USERNAME)",
    });
    return;
  }

  const phone = normalisePhone(to);
  if (!phone) {
    console.warn("[sms] Cannot normalise phone number:", to);
    return;
  }

  const apiKey   = process.env["AT_API_KEY"]!;
  const username = process.env["AT_USERNAME"]!;

  const logMeta = {
    recipient:   phone,
    template:    meta?.template ?? "",
    messageBody: message,
    orderId:     meta?.orderId,
    ticketId:    meta?.ticketId,
    testId:      meta?.testId,
  };

  // Fire and forget — do NOT await at the call site
  fetch(AT_BASE, {
    method: "POST",
    headers: {
      "Accept":       "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
      "apiKey":       apiKey,
    },
    body: new URLSearchParams({
      username,
      to: phone,
      message,
      // from: "UCFilters",  // uncomment once your sender ID is approved by AT
    }).toString(),
  })
    .then(async (res) => {
      if (!res.ok) {
        const body = await res.text().catch(() => "(unreadable)");
        console.error(`[sms] AT returned ${res.status}:`, body);
        logSmsAttempt({ ...logMeta, status: "failed", errorMessage: `AT ${res.status}: ${body}` });
      } else {
        const data = await res.json().catch(() => null);
        console.log("[sms] sent to", phone, "—", JSON.stringify(data));
        logSmsAttempt({ ...logMeta, status: "sent" });
      }
    })
    .catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[sms] network error:", err);
      logSmsAttempt({ ...logMeta, status: "failed", errorMessage: `Network error: ${msg}` });
    });
}

/**
 * Awaitable variant of sendSms — resolves to `true` when AT accepts the
 * message (HTTP 2xx) and `false` otherwise (non-2xx, network error, or
 * missing credentials / phone).
 *
 * Unlike `sendSms` this awaits the AT fetch so callers that need to know
 * whether the channel succeeded can react accordingly.  The same
 * uc_notification_log row is written regardless.
 */
export async function sendSmsAwaitable(
  to: string,
  message: string,
  meta?: {
    template?: string;
    orderId?:  number | string;
    ticketId?: string;
    testId?:   string;
  },
): Promise<boolean> {
  if (!hasATCredentials()) {
    console.log("[sms] AT credentials absent — skipping SMS to", to);
    logSmsAttempt({
      recipient:    normalisePhone(to) || to,
      template:     meta?.template ?? "",
      messageBody:  message,
      orderId:      meta?.orderId,
      ticketId:     meta?.ticketId,
      testId:       meta?.testId,
      status:       "failed",
      errorMessage: "Africa's Talking credentials not configured (AT_API_KEY / AT_USERNAME)",
    });
    return false;
  }

  const phone = normalisePhone(to);
  if (!phone) {
    console.warn("[sms] Cannot normalise phone number:", to);
    return false;
  }

  const apiKey   = process.env["AT_API_KEY"]!;
  const username = process.env["AT_USERNAME"]!;

  const logMeta = {
    recipient:   phone,
    template:    meta?.template ?? "",
    messageBody: message,
    orderId:     meta?.orderId,
    ticketId:    meta?.ticketId,
    testId:      meta?.testId,
  };

  try {
    const res = await fetch(AT_BASE, {
      method: "POST",
      headers: {
        "Accept":       "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
        "apiKey":       apiKey,
      },
      body: new URLSearchParams({
        username,
        to: phone,
        message,
      }).toString(),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "(unreadable)");
      console.error(`[sms] AT returned ${res.status}:`, body);
      logSmsAttempt({ ...logMeta, status: "failed", errorMessage: `AT ${res.status}: ${body}` });
      return false;
    }

    const data = await res.json().catch(() => null);
    console.log("[sms] sent to", phone, "—", JSON.stringify(data));
    logSmsAttempt({ ...logMeta, status: "sent" });
    return true;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[sms] network error:", err);
    logSmsAttempt({ ...logMeta, status: "failed", errorMessage: `Network error: ${msg}` });
    return false;
  }
}

// ─── Message templates ─────────────────────────────────────────────────────────

export function orderConfirmationSms(params: {
  orderId:   string | number;
  total:     string;
  firstName: string;
}): string {
  return (
    `Hi ${params.firstName}! Your Ultra Clear order #${params.orderId} has been placed. ` +
    `Total: KES ${Number(params.total).toLocaleString("en-KE")}. ` +
    `Track your order in the Ultra Clear app. Thank you for choosing certified clean water!`
  );
}

export function ticketConfirmationSms(params: {
  ticketId:  string;
  firstName: string;
}): string {
  return (
    `Hi ${params.firstName}! Your Ultra Clear maintenance ticket ${params.ticketId} has been submitted. ` +
    `Our team will contact you within 24–48 hours. ` +
    `For urgent help call 0717774049.`
  );
}

export function waterTestConfirmationSms(params: {
  testId:    string;
  address:   string;
  firstName: string;
}): string {
  const shortAddr = params.address.length > 40
    ? params.address.slice(0, 37) + "…"
    : params.address;
  return (
    `Hi ${params.firstName}! Your free Ultra Clear water quality test (ref: ${params.testId}) ` +
    `is booked for ${shortAddr}. ` +
    `We'll call to confirm the appointment time. Questions? Call 0717774049.`
  );
}
